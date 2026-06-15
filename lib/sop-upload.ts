import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import {
  resolveSopDatesFromContent,
  sopDatesToDbFields,
} from "@/lib/sop-dates";
import {
  defaultExpiryDate,
  deriveSopRecordName,
  extractIdentifierFromFilename,
  parseUploadPathMetadata,
  resolveDepartmentFromUpload,
  sopVersionFields,
  versionFromIdentifier,
} from "@/lib/sop-utils";
import { normalizeSopIdentifierKey, sopIdentifierMatchFilter } from "@/lib/sopIdentifierNormalize";
import { reconcileSopVersions } from "@/lib/reconcile-sop-versions";
import { resolveUploadLanguage } from "@/lib/sop-filename";
import {
  contentScriptMismatch,
  languageFromContentScript,
} from "@/lib/sop-name-resolution";
import {
  detectFileType,
  resetBunnyUploadCircuit,
  saveUploadedFile,
} from "@/lib/upload";
import { extractTextFromBuffer } from "@/lib/extractContent";
import { triggerMcqGenerationAsync } from "@/lib/mcq-generation";
import { invalidateDashboardSopsCache } from "@/lib/cache";
import { requireAuth } from "@/lib/withAuth";

export async function processSopUpload(formData: FormData) {
  resetBunnyUploadCircuit();
  await connectDB();

  const batchDepartment = (formData.get("department") as string)?.trim() || undefined;
  const language = (formData.get("language") as string) || "English";
  const identifierInput = (formData.get("identifier") as string)?.trim();
  const nameInput = (formData.get("name") as string)?.trim();
  const versionInput = (formData.get("version") as string)?.trim();
  const location = (formData.get("location") as string)?.trim();
  const generateMcq = formData.get("generateMcq") === "true";
  // Bulk uploads defer the (expensive, whole-collection) version reconcile to a single
  // pass after the LAST batch — running it per 4-file batch made large uploads crawl.
  const deferReconcile = formData.get("deferReconcile") === "true";
  const files = formData.getAll("files") as File[];
  const paths = formData.getAll("paths").map((value) => String(value));

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const startedAt = Date.now();
  console.log(
    `[sop-upload] received ${files.length} file(s) — lang=${language}` +
      `${batchDepartment ? `, dept=${batchDepartment}` : ""}${generateMcq ? ", mcq=on" : ""}` +
      `${deferReconcile ? ", reconcile=deferred" : ""}`,
  );

  const results: Array<{ file: string; success: boolean; error?: string; id?: string; identifier?: string }> = [];
  const mcqIdentifiers = new Set<string>();

  for (const [index, file] of files.entries()) {
    try {
      const fileType = detectFileType(file.name);
      if (!fileType) {
        results.push({ file: file.name, success: false, error: "Unsupported file type" });
        continue;
      }
      if (file.name.startsWith(".") || file.name.startsWith("~$")) {
        results.push({ file: file.name, success: false, error: "System file skipped" });
        continue;
      }

      const relativePath = paths[index] || file.name;
      const pathMeta = parseUploadPathMetadata(relativePath);
      const rawIdentifier =
        identifierInput ||
        pathMeta.identifierFromPath ||
        extractIdentifierFromFilename(pathMeta.fileName || file.name);
      const identifier = normalizeSopIdentifierKey(rawIdentifier);

      const version =
        versionInput ||
        pathMeta.versionFromPath ||
        versionFromIdentifier(identifier) ||
        "1.0";
      const { sopBaseId, versionNum, version: resolvedVersion } = sopVersionFields(
        identifier,
        version,
        pathMeta.versionFromPath,
      );
      const department = resolveDepartmentFromUpload({
        batchOverride: batchDepartment,
        relativePath,
        identifier,
      });
      const buffer = Buffer.from(await file.arrayBuffer());
      const content = await extractTextFromBuffer(buffer, fileType);

      // Filename hints first, then correct against the document's actual script
      // (a Gujarati doc with an English-looking filename must not stay "English").
      const lang = languageFromContentScript(content, resolveUploadLanguage(relativePath, language));

      // Language-aware name: English docs → English title, Gujarati docs → Gujarati title.
      const name = deriveSopRecordName({
        identifier,
        language: lang,
        fileType,
        content,
        originalFileName: pathMeta.fileName || file.name,
        titleFromPath: pathMeta.titleFromPath,
        explicitName: nameInput,
      });

      const { fileUrl, checksum, fileSize } = await saveUploadedFile(
        file,
        department,
        identifier,
        lang,
      );

      const docEntry = {
        fileName: file.name,
        filePath: fileUrl,
        fileType,
        language: lang,
      };

      let existing = await SOP.findOne({
        sopBaseId,
        versionNum,
        language: lang,
        fileType,
        isObsolete: { $ne: true },
      });

      if (!existing) {
        existing = await SOP.findOne({
          ...sopIdentifierMatchFilter(identifier),
          language: lang,
          fileType,
          isObsolete: { $ne: true },
        });
      }

      // A matched record whose stored text is clearly the other script was
      // mislabelled when it was uploaded. Overwriting it would destroy the only
      // copy of that language — retag it instead and save this file as a new
      // record, so the pair surfaces as a dual-language SOP.
      if (existing && fileType === "docx" && contentScriptMismatch(existing.content, lang)) {
        const actualLang = lang === "English" ? "Gujarati" : "English";
        await existing.updateOne({ language: actualLang });
        existing = null;
      }

      const dateFields =
        fileType === "docx"
          ? sopDatesToDbFields(resolveSopDatesFromContent(content))
          : {};

      const sharedFields = {
        name,
        identifier,
        department,
        language: lang,
        fileUrl,
        fileType,
        content,
        checksum,
        version: resolvedVersion,
        sopBaseId,
        versionNum,
        location,
        folderPath: pathMeta.folderPath,
        parentFolder: pathMeta.parentFolder,
        subfolderLevel: pathMeta.folderPath ? pathMeta.folderPath.split("/").length : 0,
        originalFileName: file.name,
        metadata: { fileSize },
        sopDocuments: [docEntry],
        ...dateFields,
      };

      let sop = existing;
      if (existing) {
        sop = await SOP.findByIdAndUpdate(
          existing._id,
          {
            ...sharedFields,
            uploadedAt: new Date(),
            pipelineStatus: generateMcq ? "mcq_generating" : existing.pipelineStatus,
          },
          { new: true },
        );
      } else {
        sop = await SOP.create({
          ...sharedFields,
          expiryDate: dateFields.expiryDate ?? defaultExpiryDate(24),
          status: "uploaded",
          pipelineStatus: generateMcq ? "mcq_generating" : "idle",
        });
      }

      if (fileType === "docx" && dateFields.expiryDate) {
        await SOP.updateMany(
          { sopBaseId, versionNum, isObsolete: { $ne: true } },
          { $set: dateFields },
        );
      }

      if (!sop) {
        results.push({ file: file.name, success: false, error: "Failed to save SOP record" });
        continue;
      }

      if (generateMcq) mcqIdentifiers.add(identifier);
      console.log(
        `[sop-upload] ✓ (${index + 1}/${files.length}) ${identifier} v${resolvedVersion} ${lang} ${fileType} → ${department}`,
      );
      results.push({
        file: file.name,
        success: true,
        id: sop._id.toString(),
        identifier,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      console.error(`[sop-upload] ✗ (${index + 1}/${files.length}) ${file.name}: ${message}`);
      results.push({
        file: file.name,
        success: false,
        error: message,
      });
    }
  }

  for (const identifier of mcqIdentifiers) {
    triggerMcqGenerationAsync(identifier);
  }

  invalidateDashboardSopsCache();

  // Re-group version fields so newly uploaded prior-version files attach to the
  // correct SOP family immediately (fixes QAGE01-05 vs QAGE1-05 split families).
  // Bulk uploads skip this here and run a single reconcile after the final batch.
  const successCount = results.filter((r) => r.success).length;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[sop-upload] batch done: ${successCount} ok, ${results.length - successCount} failed in ${elapsed}s` +
      `${deferReconcile && successCount > 0 ? " (reconcile deferred to caller)" : ""}`,
  );

  if (successCount > 0 && !deferReconcile) {
    try {
      await reconcileSopVersions();
    } catch (e) {
      console.error("[sop-upload] post-upload reconcile error:", e);
    }
  }

  return NextResponse.json({ results });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    const formData = await request.formData();
    return processSopUpload(formData);
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}
