import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import { invalidateDashboardSopsCache } from "@/lib/server-cache";
import { getGroupedRegistryRows } from "@/lib/dashboardRegistrySource";
import { isBunnyConfigured } from "@/lib/validateEnv";
import {
  departmentFromIdentifier,
  sopVersionFields,
} from "@/lib/sop-utils";
import { sopIdentifierMatchFilter } from "@/lib/sopIdentifierNormalize";
import { reconcileSopVersions } from "@/lib/reconcile-sop-versions";
import {
  backfillPriorHeaderDateFlags,
} from "@/lib/prior-header-dates";
import {
  buildBunnyVersionFileIndex,
  invalidateBunnyVersionIndexCache,
  lookupBunnyVersionFile,
} from "@/lib/bunny-version-index";
import {
  computeMissingFiles,
  type MissingVersionFile,
  type VersionLang,
} from "@/lib/version-diagnostics";
import {
  isUnextractedDocxContent,
  LINKED_CONTENT_PLACEHOLDER,
  reextractDocxContentFromUrl,
} from "@/lib/prior-header-dates";
const LOOKUP_CONCURRENCY = 24;

type MissingSlot = MissingVersionFile & { department: string };

function slotLanguage(lang: VersionLang): "English" | "Gujarati" {
  return lang === "GUJ" ? "Gujarati" : "English";
}

async function upsertBunnyFile(bf: {
  identifier: string;
  department: string;
  language: "English" | "Gujarati";
  fileType: "docx" | "pdf";
  fileUrl: string;
  fileName: string;
}): Promise<"linked" | "created" | "skipped"> {
  const { sopBaseId, versionNum, version } = sopVersionFields(bf.identifier);

  let existing = await SOP.findOne({
    sopBaseId,
    versionNum,
    language: bf.language,
    fileType: bf.fileType,
    isObsolete: { $ne: true },
  });

  if (!existing) {
    existing = await SOP.findOne({
      ...sopIdentifierMatchFilter(bf.identifier),
      language: bf.language,
      fileType: bf.fileType,
      isObsolete: { $ne: true },
    });
  }

  const docEntry = {
    fileName: bf.fileName,
    filePath: bf.fileUrl,
    fileType: bf.fileType,
    language: bf.language,
  };

  if (existing) {
    if (existing.fileUrl === bf.fileUrl) return "skipped";
    const update: Record<string, unknown> = {
      identifier: bf.identifier,
      fileUrl: bf.fileUrl,
      sopBaseId,
      versionNum,
      version,
      sopDocuments: [docEntry],
      uploadedAt: new Date(),
    };
    if (
      bf.fileType === "docx" &&
      isUnextractedDocxContent(existing.content)
    ) {
      const content = await reextractDocxContentFromUrl(bf.fileUrl);
      if (content) {
        update.content = content;
        update.linkedFromBunny = false;
      }
    }
    await existing.updateOne(update);
    return "linked";
  }

  const dept = bf.department || departmentFromIdentifier(bf.identifier) || "General";
  const docxContent =
    bf.fileType === "docx"
      ? (await reextractDocxContentFromUrl(bf.fileUrl)) ?? LINKED_CONTENT_PLACEHOLDER
      : LINKED_CONTENT_PLACEHOLDER;
  await SOP.create({
    name: bf.identifier,
    identifier: bf.identifier,
    department: dept,
    fileUrl: bf.fileUrl,
    fileType: bf.fileType,
    content: docxContent,
    language: bf.language,
    version,
    sopBaseId,
    versionNum,
    originalFileName: bf.fileName,
    sopDocuments: [docEntry],
    expiryDate: new Date(Date.now() + 24 * 30 * 86400000),
    status: "uploaded",
    pipelineStatus: "idle",
    linkedFromBunny: docxContent === LINKED_CONTENT_PLACEHOLDER,
  });
  return "created";
}

function collectMissingSlots(department?: string): Promise<MissingSlot[]> {
  return getGroupedRegistryRows().then((rows) => {
    const dept = department?.trim();
    const scoped =
      dept && dept !== "All" && dept !== "Total"
        ? rows.filter((s) => !s.isObsolete && s.department === dept)
        : rows.filter((s) => !s.isObsolete);

    const slots: MissingSlot[] = [];
    for (const sop of scoped) {
      for (const m of computeMissingFiles(sop)) {
        slots.push({ ...m, department: sop.department });
      }
    }
    return slots;
  });
}

/**
 * Link version files from Bunny to MongoDB using a full parallel storage index.
 */
export async function relinkBunnyVersionFiles(opts?: { department?: string; refreshIndex?: boolean }) {
  if (!isBunnyConfigured()) {
    throw new Error("Bunny CDN is not configured");
  }

  await connectDB();
  const department = opts?.department?.trim();
  const startedAt = Date.now();

  if (opts?.refreshIndex) invalidateBunnyVersionIndexCache();

  console.log(`[relink-bunny] building Bunny file index${department ? ` for dept=${department}` : ""}…`);
  const [missingSlots, bunnyIndex] = await Promise.all([
    collectMissingSlots(department),
    buildBunnyVersionFileIndex(opts?.refreshIndex),
  ]);
  console.log(
    `[relink-bunny] index ready (${bunnyIndex.size} files), checking ${missingSlots.length} missing slot(s)…`,
  );

  let linked = 0;
  let created = 0;
  let skipped = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (let i = 0; i < missingSlots.length; i += LOOKUP_CONCURRENCY) {
    const batch = missingSlots.slice(i, i + LOOKUP_CONCURRENCY);

    for (const slot of batch) {
      const language = slotLanguage(slot.lang);
      const hit = lookupBunnyVersionFile(bunnyIndex, slot.fileIdentifier, language, slot.format);
      if (!hit) {
        notFound++;
        continue;
      }
      try {
        const result = await upsertBunnyFile({
          identifier: hit.identifier,
          department: hit.department || slot.department,
          language: hit.language,
          fileType: hit.fileType,
          fileUrl: hit.fileUrl,
          fileName: hit.fileName,
        });
        if (result === "linked") linked++;
        else if (result === "created") created++;
        else skipped++;
      } catch (err) {
        errors.push(
          `${slot.fileIdentifier} ${slot.format}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
  }

  const reconcile =
    linked + created > 0 ? await reconcileSopVersions() : { updated: 0, cleaned: 0, total: 0 };
  if (linked + created > 0) {
    try {
      await backfillPriorHeaderDateFlags();
    } catch (e) {
      console.error("[relink-bunny] prior header date backfill error:", e);
    }
  }
  invalidateDashboardSopsCache();

  console.log(
    `[relink-bunny] done: ${linked} linked, ${created} created, ${skipped} skipped, ${notFound} not-found in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );

  return {
    missingSlotsChecked: missingSlots.length,
    bunnyIndexSize: bunnyIndex.size,
    bunnyFilesFound: linked + created + skipped,
    linked,
    created,
    skipped,
    notFoundInBunny: notFound,
    errors: errors.slice(0, 30),
    reconcile,
  };
}
