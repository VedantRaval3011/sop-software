import SOP, { type ISOP } from "@/models/SOP";
import { sopIdentifierMatchFilter } from "@/lib/sopIdentifierNormalize";
import {
  isUnusableMcqSourceText,
  normalizeSopTextForMcq,
  scoreSopRecordForMcq,
} from "@/lib/mcq-source-text";
import { isUnextractedDocxContent, reextractDocxContentFromUrl } from "@/lib/prior-header-dates";
import { detectCrossSopReferences } from "@/lib/gmpIntelligence";

export type ComplianceSopContentResult = {
  record: ISOP;
  content: string;
  source: "primary" | "sibling" | "reextracted";
  referencedSupplementChars: number;
};

function preferEnglish(records: ISOP[]): ISOP[] {
  const english = records.filter((r) => r.language !== "Gujarati");
  return english.length ? english : records;
}

/** Same scoring as MCQ — prefer DOCX with real extracted text over PDF placeholders. */
export function pickBestSopRecordForCompliance(records: ISOP[]): ISOP | null {
  const candidates = preferEnglish(records.filter((r) => !r.isObsolete));
  let best: ISOP | null = null;
  let bestScore = 0;
  for (const r of candidates) {
    const score = scoreSopRecordForMcq(r);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

async function ensureUsableContent(
  record: ISOP,
): Promise<{ content: string; reextracted: boolean }> {
  const score = scoreSopRecordForMcq(record);
  if (!isUnusableMcqSourceText(record.content) && score >= 50) {
    return { content: normalizeSopTextForMcq(record.content), reextracted: false };
  }

  if (
    record.fileType === "docx" &&
    record.fileUrl &&
    (isUnextractedDocxContent(record.content) || isUnusableMcqSourceText(record.content))
  ) {
    const fresh = await reextractDocxContentFromUrl(record.fileUrl);
    if (fresh && !isUnusableMcqSourceText(fresh)) {
      await SOP.updateOne(
        { _id: record._id },
        { $set: { content: fresh, linkedFromBunny: false, updatedAt: new Date() } },
      );
      return { content: normalizeSopTextForMcq(fresh), reextracted: true };
    }
  }

  return { content: normalizeSopTextForMcq(record.content ?? ""), reextracted: false };
}

/**
 * Resolve the best parseable SOP text for compliance (DOCX > PDF, English > Gujarati,
 * re-download DOCX from CDN when DB still has a Bunny placeholder).
 */
export async function resolveComplianceSopContent(
  sopId: string,
): Promise<ComplianceSopContentResult | null> {
  const primary = (await SOP.findById(sopId).lean()) as ISOP | null;
  if (!primary) return null;

  const family = (await SOP.find({
    ...sopIdentifierMatchFilter(primary.identifier),
    isObsolete: { $ne: true },
  }).lean()) as ISOP[];

  const ordered = [
    primary,
    ...family.filter((r) => r._id.toString() !== primary._id.toString()),
  ];
  const best = pickBestSopRecordForCompliance(family.length ? family : [primary]) ?? primary;

  const tryRecords = [
    best,
    ...ordered.filter((r) => r._id.toString() !== best._id.toString()),
  ];

  for (const record of tryRecords) {
    const { content, reextracted } = await ensureUsableContent(record);
    if (content.length >= 50 && scoreSopRecordForMcq({ ...record, content }) >= 50) {
      const source: ComplianceSopContentResult["source"] = reextracted
        ? "reextracted"
        : record._id.toString() === primary._id.toString()
          ? "primary"
          : "sibling";

      const supplement = await buildReferencedSopSupplement(content);
      const merged = supplement
        ? `${content}\n\n${supplement}`.slice(0, 120_000)
        : content;

      if (source === "sibling") {
        console.log(
          `[compliance] using sibling ${record.identifier} (${record.fileType}) for audit — primary had weak content`,
        );
      }
      if (reextracted) {
        console.log(`[compliance] re-extracted DOCX text for ${record.identifier}`);
      }

      return {
        record: { ...record, content: merged },
        content: merged,
        source,
        referencedSupplementChars: supplement.length,
      };
    }
  }

  return null;
}

/** Pull text from SOPs this document references (change control, deviation, etc.). */
export async function buildReferencedSopSupplement(primaryContent: string): Promise<string> {
  const refs = detectCrossSopReferences(primaryContent);
  if (!refs.length) return "";

  const chunks: string[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const pattern = ref.libraryMatch.source;
    if (seen.has(pattern)) continue;
    seen.add(pattern);

    const matches = (await SOP.find({
      isObsolete: { $ne: true },
      $or: [
        { name: { $regex: ref.libraryMatch } },
        { identifier: { $regex: ref.libraryMatch } },
      ],
    })
      .select("identifier name content fileType language fileUrl isObsolete")
      .limit(5)
      .lean()) as ISOP[];

    const best = pickBestSopRecordForCompliance(matches);
    if (!best) continue;

    const { content } = await ensureUsableContent(best);
    if (content.length < 80) continue;

    chunks.push(
      `--- Referenced ${ref.type} (${best.identifier}) ---\n${content.slice(0, 12_000)}`,
    );
  }

  return chunks.join("\n\n").slice(0, 48_000);
}
