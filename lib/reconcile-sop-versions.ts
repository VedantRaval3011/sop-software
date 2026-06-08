import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import { invalidateDashboardSopsCache } from "@/lib/cache";
import {
  baseIdentifierFromIdentifier,
  maxVersionInGroup,
  recordsForVersion,
  sopVersionFields,
} from "@/lib/sop-utils";
import type { ISOP } from "@/models/SOP";

export function groupRecordsByBase(records: ISOP[]) {
  const grouped = new Map<string, ISOP[]>();
  for (const record of records) {
    const base = record.sopBaseId ?? record.identifier;
    const key = baseIdentifierFromIdentifier(base).toUpperCase();
    const bucket = grouped.get(key) ?? [];
    bucket.push(record);
    grouped.set(key, bucket);
  }
  return grouped;
}

/** Backfill version fields and strip contaminated file links from prior-version records. */
export async function reconcileSopVersions() {
  await connectDB();
  const records = await SOP.find({});
  const grouped = groupRecordsByBase(records);

  let updated = 0;
  let cleaned = 0;

  for (const [, family] of grouped) {
    const currentVersion = maxVersionInGroup(family);
    const currentIds = new Set(
      recordsForVersion(family, currentVersion).map((r) => r._id.toString()),
    );

    for (const record of family) {
      const fields = sopVersionFields(record.identifier, record.version);
      const isCurrent = currentIds.has(record._id.toString());
      const patch: Record<string, unknown> = {};

      if (
        record.sopBaseId !== fields.sopBaseId ||
        record.versionNum !== fields.versionNum ||
        record.version !== fields.version
      ) {
        patch.sopBaseId = fields.sopBaseId;
        patch.versionNum = fields.versionNum;
        patch.version = fields.version;
      }

      if (!isCurrent) {
        const docs = (record.sopDocuments ?? []).filter((doc) => {
          const type = doc.fileType?.toLowerCase();
          return type !== "docx" && type !== "pdf";
        });
        if (docs.length !== (record.sopDocuments ?? []).length) {
          patch.sopDocuments = docs;
          cleaned++;
        }
      }

      if (Object.keys(patch).length > 0) {
        await record.updateOne(patch);
        updated++;
      }
    }
  }

  if (updated > 0) invalidateDashboardSopsCache();
  return { updated, cleaned, total: records.length };
}
