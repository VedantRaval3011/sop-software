import { connectDB } from '@/lib/mongodb';
import SOP from '@/models/SOP';
import { groupSOPRecords } from '@/lib/sop-utils';
import { getOrBuildServerGroupedCache } from '@/lib/cache';
import {
  readPersistentGroupedCache,
  writePersistentGroupedCache,
  signatureFromRecords,
} from '@/lib/persistentGroupedCache';
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

    // Cross-container persistent cache: a cold serverless container has an empty
    // in-memory cache and would otherwise re-scan the whole collection. Read the
    // shared Mongo blob first — it's served only while it still matches live
    // collection state (count + newest updatedAt), so a mutation in any container
    // transparently invalidates it.
    const persisted = await readPersistentGroupedCache();
    if (persisted) return persisted;

    // Exclude the heavy `content` field (full extracted SOP text, ~30KB avg / up to
    // 77KB per doc — ~56MB across the collection). Grouping never reads it, and on a
    // free-tier (M0) cluster transferring the full collection gets throttled to
    // minutes. Projecting it out drops the load to ~2s.
    //
    // No DB-side sort: `groupSOPRecords` re-sorts each family by updatedAt itself
    // (sop-utils), and the dashboard sorts/paginates client-side, so ordering the
    // full scan here buys nothing. Worse, sorting an unindexed scan forces an
    // in-memory sort that exceeds M0's 32MB limit on this collection — that was the
    // ~31s cold-query penalty. Dropping it lets the scan stream straight through.
    const records = await SOP.find({}).select('-content').lean();
    const grouped = groupSOPRecords(records as never[]);

    // Persist for the next cold container. Signature is taken from the records we
    // just scanned (exact, no race with a concurrent mutation). Fire-and-forget so
    // the request isn't held up by the cache write.
    void writePersistentGroupedCache(grouped, signatureFromRecords(records as never[]));

    return grouped;
  });
}

/** Dashboard SOP registry payload — same universe as the Dashboard /api/sops route. */
export async function getDashboardRegistryPayload(): Promise<DashboardPayload> {
  // Build straight from the shared grouped registry. It already has its own
  // in-memory + persistent caching that self-invalidates on mutation, so a
  // separate 5-min cache here only served to make obsolete/revive changes lag
  // behind in the training-matrix view. The row transform below is a cheap map.
  const grouped = await loadGroupedRegistry();
  return { success: true, data: registryToDashboardRows(grouped) };
}

/** Grouped registry rows for server routes that need full RegistrySOP objects. */
export async function getGroupedRegistryRows(): Promise<RegistrySOP[]> {
  return loadGroupedRegistry();
}

export { loadGroupedRegistry };
