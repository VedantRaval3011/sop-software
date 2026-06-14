import { connectDB } from '@/lib/mongodb';
import SOP from '@/models/SOP';
import { groupSOPRecords } from '@/lib/sop-utils';
import { getOrBuildServerGroupedCache } from '@/lib/cache';
import { getDashboardSopsCache, setDashboardSopsCache } from '@/lib/dashboardSopsCache';
import type { RegistrySOP } from '@/lib/types';

type DashboardPayload = {
  success: boolean;
  data?: Array<{
    sopNo: string;
    identifier: string;
    englishName: string;
    gujaratiName?: string;
    department: string;
    name: string;
  }>;
};

function registryToDashboardRows(items: RegistrySOP[]): DashboardPayload['data'] {
  return items.map((row) => ({
    sopNo: row.identifier,
    identifier: row.identifier,
    englishName: row.name,
    gujaratiName: row.nameGujarati,
    department: row.department,
    name: row.name,
  }));
}

async function loadGroupedRegistry(): Promise<RegistrySOP[]> {
  // A single shared, in-flight-deduped build of the grouped registry. Concurrent
  // callers (e.g. the dashboard firing /api/sops and /api/sops/stats together)
  // await the same computation instead of each scanning the collection.
  return getOrBuildServerGroupedCache(async () => {
    await connectDB();
    // Exclude the heavy `content` field (full extracted SOP text, ~30KB avg / up to
    // 77KB per doc — ~56MB across the collection). Grouping never reads it, and on a
    // free-tier (M0) cluster transferring the full collection gets throttled to
    // minutes. Projecting it out drops the load to ~2s.
    const records = await SOP.find({}).select('-content').sort({ updatedAt: -1 }).lean();
    return groupSOPRecords(records as never[]);
  });
}

/** Dashboard SOP registry payload — same universe as the Dashboard /api/sops route. */
export async function getDashboardRegistryPayload(): Promise<DashboardPayload> {
  const cached = await getDashboardSopsCache();
  if (cached?.payload) return cached.payload as DashboardPayload;

  const grouped = await loadGroupedRegistry();
  const payload: DashboardPayload = { success: true, data: registryToDashboardRows(grouped) };
  await setDashboardSopsCache(payload);
  return payload;
}

/** Grouped registry rows for server routes that need full RegistrySOP objects. */
export async function getGroupedRegistryRows(): Promise<RegistrySOP[]> {
  return loadGroupedRegistry();
}

export { loadGroupedRegistry };
