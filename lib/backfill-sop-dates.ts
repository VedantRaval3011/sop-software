import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import { invalidateDashboardSopsCache } from "@/lib/server-cache";
import {
  resolveSopDatesFromContent,
  sopDatesToDbFields,
} from "@/lib/sop-dates";
import type { ISOP } from "@/models/SOP";

type LangKey = "English" | "Gujarati";

function langOf(record: ISOP): LangKey {
  return record.language === "Gujarati" ? "Gujarati" : "English";
}

/**
 * Dates are extracted PER LANGUAGE: each language's effective/review/expiry date
 * must come from that language's OWN docx text. English and Gujarati are never
 * allowed to borrow each other's dates — a Gujarati document with no date in its
 * own text stays undated rather than inheriting the English date, so the
 * "Version Date Found" count reflects what each document actually carries.
 */
function familyLangKey(record: ISOP): string {
  const base = record.sopBaseId ?? record.identifier;
  const version = record.versionNum ?? 0;
  return `${base}::${version}::${langOf(record)}`;
}

/**
 * The one docx whose text we extract dates from for a (base, version, language)
 * group. PDFs are scanned images with no extractable text, so they can never be
 * a date source; a same-language PDF instead inherits whatever this docx yields.
 */
function pickDocxWithContent(records: ISOP[]): ISOP | undefined {
  return records.find(
    (r) =>
      r.fileType === "docx" &&
      r.content &&
      !r.content.startsWith("[") &&
      !r.content.startsWith("%PDF"),
  );
}

// Cleared when a language group has no genuine date of its own, so stale
// propagated dates from earlier runs don't survive.
const DATE_FIELDS_TO_UNSET = {
  effectiveDate: "",
  reviewDate: "",
  expiryDate: "",
  nextReviewDate: "",
  validityPeriod: "",
} as const;

/**
 * Re-derive effective / review / expiry dates from stored DOCX content, one
 * (base, version, language) group at a time. The extracted dates are written to
 * every record in that group — the docx and its same-language PDF — and cleared
 * outright when the language's docx carries no real date.
 */
export async function backfillSopDates() {
  await connectDB();

  const records = await SOP.find({ isObsolete: { $ne: true } });
  const groups = new Map<string, ISOP[]>();

  for (const record of records) {
    const key = familyLangKey(record);
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }

  let datedRecords = 0;
  let clearedRecords = 0;
  let datedGroups = 0;
  let undatedGroups = 0;
  const ops: Parameters<typeof SOP.bulkWrite>[0] = [];

  for (const [, group] of groups) {
    const docx = pickDocxWithContent(group);
    const resolved = docx?.content
      ? resolveSopDatesFromContent(docx.content)
      : undefined;
    // A genuine date means the document itself stated an effective / revision
    // date — resolveSopDatesFromContent only surfaces effectiveDate when one was
    // actually found (it never invents one).
    const hasRealDate = Boolean(resolved?.effectiveDate);

    if (hasRealDate) {
      const fields = sopDatesToDbFields(resolved!);
      for (const r of group) {
        ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: fields } } });
      }
      datedRecords += group.length;
      datedGroups++;
    } else {
      for (const r of group) {
        ops.push({
          updateOne: { filter: { _id: r._id }, update: { $unset: DATE_FIELDS_TO_UNSET } },
        });
      }
      clearedRecords += group.length;
      undatedGroups++;
    }
  }

  if (ops.length) await SOP.bulkWrite(ops);

  invalidateDashboardSopsCache();

  return {
    totalGroups: groups.size,
    datedGroups,
    undatedGroups,
    datedRecords,
    clearedRecords,
  };
}
