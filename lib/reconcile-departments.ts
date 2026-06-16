import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import { invalidateDashboardSopsCache } from "@/lib/server-cache";
import { resolveDepartmentForExistingSop } from "@/lib/sop-utils";

export async function reconcileAllDepartments(options?: { onlyGeneral?: boolean }) {
  await connectDB();
  const query = options?.onlyGeneral !== false ? { department: "General" } : {};
  const records = await SOP.find(query);

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  const changes: Array<{ identifier: string; from: string; to: string }> = [];

  for (const record of records) {
    const next = resolveDepartmentForExistingSop({
      identifier: record.identifier,
      folderPath: record.folderPath,
      fileUrl: record.fileUrl,
      originalFileName: record.originalFileName,
      deptManualOverride: record.deptManualOverride,
    });

    if (!next) {
      skipped++;
      continue;
    }

    if (next === record.department) {
      unchanged++;
      continue;
    }

    await record.updateOne({ department: next });
    changes.push({
      identifier: record.identifier,
      from: record.department,
      to: next,
    });
    updated++;
  }

  if (updated > 0) {
    invalidateDashboardSopsCache();
  }

  return { updated, skipped, unchanged, total: records.length, changes };
}
