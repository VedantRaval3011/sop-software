import mongoose, { Schema } from "mongoose";
import SOP from "@/models/SOP";
import type { RegistrySOP } from "@/lib/types";

/* ─── Persistent grouped-registry cache ──────────────────────────────────
 * The in-memory cache in lib/cache.ts is per-process, so a cold serverless
 * container starts empty and would re-scan + re-group the entire SOP
 * collection (~56MB) — the multi-second cold-start penalty. This stores the
 * already-grouped registry in a single Mongo doc so any container, warm or
 * cold, can read a few-hundred-KB blob instead.
 *
 * Cross-container invalidation without touching the ~20 mutation call sites:
 * we stamp the cache with a cheap "signature" of the collection at build time
 * (document count + the newest updatedAt). On read we recompute that signature
 * with two fast, indexed queries; if it differs, a write happened somewhere
 * (insert → count up, update → newer updatedAt, delete → count down) and we
 * treat the cache as stale. No mutation handler needs to know this exists. */

// Bump when grouped-registry computation logic changes (e.g. version-date rules).
const CACHE_KEY = "grouped-registry-v5";
const LEGACY_CACHE_KEYS = ["grouped-registry-v4", "grouped-registry-v3", "grouped-registry-v2", "grouped-registry-v1"] as const;

interface Signature {
  count: number;
  maxUpdatedAt: number; // epoch ms; 0 when collection is empty
}

interface CacheDoc {
  key: string;
  data: RegistrySOP[];
  count: number;
  maxUpdatedAt: Date | null;
  builtAt: Date;
}

const cacheSchema = new Schema<CacheDoc>(
  {
    key: { type: String, required: true, unique: true },
    data: { type: Schema.Types.Mixed, required: true },
    count: { type: Number, required: true },
    maxUpdatedAt: { type: Date, default: null },
    builtAt: { type: Date, required: true },
  },
  { collection: "dashboard_grouped_cache", minimize: false },
);

const DashboardGroupedCache =
  (mongoose.models.DashboardGroupedCache as mongoose.Model<CacheDoc>) ||
  mongoose.model<CacheDoc>("DashboardGroupedCache", cacheSchema);

/** Newest updatedAt + document count — a cheap fingerprint of collection state.
 *  estimatedDocumentCount() is a metadata read; the findOne is index-backed by
 *  the declared `updatedAt: -1` index (run /api/admin/sync-indexes once). */
async function liveSignature(): Promise<Signature> {
  const [count, latest] = await Promise.all([
    SOP.estimatedDocumentCount(),
    SOP.findOne({}).select("updatedAt").sort({ updatedAt: -1 }).lean(),
  ]);
  return {
    count,
    maxUpdatedAt: latest?.updatedAt ? new Date(latest.updatedAt).getTime() : 0,
  };
}

/** Signature computed directly from the records we just scanned — exact, and
 *  free of a race against a mutation landing between scan and write. */
export function signatureFromRecords(
  records: Array<{ updatedAt?: Date | string }>,
): Signature {
  let maxUpdatedAt = 0;
  for (const r of records) {
    const t = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
    if (t > maxUpdatedAt) maxUpdatedAt = t;
  }
  return { count: records.length, maxUpdatedAt };
}

/** Returns the cached grouped registry if it still matches live collection
 *  state, else null (caller should rebuild). Never throws — a cache-layer
 *  failure must degrade to a normal scan, not break the dashboard. */
export async function readPersistentGroupedCache(): Promise<RegistrySOP[] | null> {
  try {
    const doc = await DashboardGroupedCache.findOne({ key: CACHE_KEY }).lean();
    if (!doc) return null;
    const live = await liveSignature();
    const stored: Signature = {
      count: doc.count,
      maxUpdatedAt: doc.maxUpdatedAt ? new Date(doc.maxUpdatedAt).getTime() : 0,
    };
    if (stored.count !== live.count || stored.maxUpdatedAt !== live.maxUpdatedAt) {
      return null;
    }
    return doc.data as RegistrySOP[];
  } catch (e) {
    console.error("[persistentGroupedCache] read failed:", e);
    return null;
  }
}

/** Drop persisted grouped rows so the next load recomputes from live records. */
export async function invalidatePersistentGroupedCache(): Promise<void> {
  try {
    await DashboardGroupedCache.deleteMany({
      key: { $in: [CACHE_KEY, ...LEGACY_CACHE_KEYS] },
    });
  } catch (e) {
    console.error("[persistentGroupedCache] invalidate failed:", e);
  }
}

/** Upserts the grouped registry plus the signature it was built from. */
export async function writePersistentGroupedCache(
  items: RegistrySOP[],
  signature: Signature,
): Promise<void> {
  try {
    await DashboardGroupedCache.updateOne(
      { key: CACHE_KEY },
      {
        $set: {
          data: items,
          count: signature.count,
          maxUpdatedAt: signature.maxUpdatedAt
            ? new Date(signature.maxUpdatedAt)
            : null,
          builtAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (e) {
    console.error("[persistentGroupedCache] write failed:", e);
  }
}
