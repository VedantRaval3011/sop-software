import type { RegistrySOP } from "@/lib/types";

export const DASHBOARD_CACHE_KEY = "sop-dashboard-cache-v2";
export const DASHBOARD_STATS_CACHE_KEY = "sop-dashboard-stats-v8";

/* ─── Server-side cache ──────────────────────────────────────────────────
 * Caches the expensive step — querying every SOP and grouping the records
 * into the registry shape. Filtering/sorting/paginating is cheap and runs
 * per-request on the cached array, so this single entry serves every query. */
let serverGroupedCache: { items: RegistrySOP[]; expiresAt: number } | null = null;
// While the registry is being (re)built, hold the promise so concurrent callers
// share one computation instead of each running the full SOP scan + grouping.
// The dashboard fires /api/sops and /api/sops/stats together on first load, so
// this single guard turns a double cold-start into one.
let serverGroupedInFlight: Promise<RegistrySOP[]> | null = null;
const SERVER_TTL_MS = 5 * 60 * 1000;

export function invalidateDashboardSopsCache() {
  serverGroupedCache = null;
  serverGroupedInFlight = null;
}

export function getServerGroupedCache(): RegistrySOP[] | null {
  if (!serverGroupedCache || serverGroupedCache.expiresAt < Date.now()) return null;
  return serverGroupedCache.items;
}

export function setServerGroupedCache(items: RegistrySOP[]) {
  serverGroupedCache = { items, expiresAt: Date.now() + SERVER_TTL_MS };
}

/**
 * Returns the cached grouped registry, building it via `build` on a miss. When
 * several requests miss at the same time they all await the same in-flight build
 * rather than each hammering the database independently.
 */
export async function getOrBuildServerGroupedCache(
  build: () => Promise<RegistrySOP[]>,
): Promise<RegistrySOP[]> {
  const cached = getServerGroupedCache();
  if (cached) return cached;
  if (serverGroupedInFlight) return serverGroupedInFlight;

  serverGroupedInFlight = (async () => {
    try {
      const items = await build();
      setServerGroupedCache(items);
      return items;
    } finally {
      serverGroupedInFlight = null;
    }
  })();

  return serverGroupedInFlight;
}

/* ─── Client-side cache ──────────────────────────────────────────────────
 * Stale-while-revalidate store in sessionStorage so the dashboard paints
 * instantly on navigation while fresh data is fetched in the background. */
export function clearClientDashboardCache() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
  sessionStorage.removeItem(DASHBOARD_STATS_CACHE_KEY);
  localStorage.removeItem(DASHBOARD_CACHE_KEY);
  localStorage.removeItem(DASHBOARD_STATS_CACHE_KEY);
}

export function readClientCache<T>(key: string, field: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, T>;
    return obj?.[field] ?? null;
  } catch {
    return null;
  }
}

export function writeClientCache(key: string, field: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(key);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    obj[field] = value;
    sessionStorage.setItem(key, JSON.stringify(obj));
  } catch {
    /* storage full or unavailable — caching is best-effort */
  }
}

export function bustDashboardCache() {
  invalidateDashboardSopsCache();
  clearClientDashboardCache();
}
