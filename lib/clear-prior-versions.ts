import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import { invalidateDashboardSopsCache } from "@/lib/cache";
import {
  maxVersionInGroup,
  recordsForVersion,
  sopVersionFields,
} from "@/lib/sop-utils";
import { groupRecordsByBase } from "@/lib/reconcile-sop-versions";
import type { ISOP } from "@/models/SOP";

function ownFileDocument(record: ISOP) {
  if (!record.fileUrl) return [];
  return [
    {
      fileName: record.originalFileName ?? `${record.identifier}.${record.fileType}`,
      filePath: record.fileUrl,
      fileType: record.fileType,
      language: record.language ?? "English",
    },
  ];
}

/**
 * Delete all non-current version file records. Keeps the latest version files
 * and SOP metadata for each SOP family; removes incorrect prior-version mappings.
 */
export async function clearAllPriorVersionRecords() {
  await connectDB();
  const records = await SOP.find({ isObsolete: { $ne: true } });
  const grouped = groupRecordsByBase(records);

  let deleted = 0;
  let kept = 0;
  let normalized = 0;
  const families: string[] = [];

  for (const [baseId, family] of grouped) {
    const currentVersion = maxVersionInGroup(family);
    const currentRecords = recordsForVersion(family, currentVersion);
    const currentIds = new Set(currentRecords.map((r) => r._id.toString()));
    const priorCount = family.length - currentRecords.length;

    if (priorCount > 0) families.push(baseId);

    for (const record of family) {
      if (!currentIds.has(record._id.toString())) {
        await SOP.deleteOne({ _id: record._id });
        deleted++;
        continue;
      }

      const fields = sopVersionFields(record.identifier, record.version);
      await record.updateOne({
        sopBaseId: fields.sopBaseId,
        version: fields.version,
        versionNum: fields.versionNum,
        sopDocuments: ownFileDocument(record),
      });
      kept++;
      normalized++;
    }
  }

  invalidateDashboardSopsCache();
  return {
    deleted,
    kept,
    normalized,
    familiesCleared: families.length,
    families,
  };
}
