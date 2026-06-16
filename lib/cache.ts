import type { RegistrySOP } from "@/lib/types";

export const DASHBOARD_CACHE_KEY = "sop-dashboard-cache-v3";
export const DASHBOARD_STATS_CACHE_KEY = "sop-dashboard-stats-v9";

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
// Short TTL bounds cross-container staleness. The in-memory cache is per-process,
// so a mutation on one serverless instance can't reach a sibling's warm cache — a
// long TTL there would keep serving the pre-mutation registry. With a 60s TTL the
// sibling revalidates quickly, and because revalidation goes through the persistent
// grouped cache (validated by a cheap collection signature), an expiry usually costs
// two light indexed queries, not a full re-scan. The mutating instance itself is
// always fresh: invalidateDashboardSopsCache() drops its cache outright.
const SERVER_TTL_MS = 60 * 1000;

export function invalidateDashboardSopsCache() {
  // Drop the cached registry entirely so the NEXT read rebuilds fresh.
  //
  // This used to keep the old items and mark them expired, so the cache would
  // serve stale-while-revalidate after a mutation. That was a workaround for the
  // old ~31s cold rebuild, but it had a correctness cost: right after marking an
  // SOP obsolete (or reviving it), the next refresh got the PRE-mutation registry
  // back — the change appeared to vanish — until a slow background rebuild caught
  // up minutes later. The rebuild is now fast (no DB-side sort + a persistent
  // grouped cache), so a blocking fresh rebuild is correct and cheap. The
  // persistent cache self-invalidates via its collection signature (the mutation
  // bumps updatedAt / changes the doc count), so the rebuild reads live data.
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
 * Returns the cached grouped registry, building it via `build` on a miss.
 *
 * Three tiers:
 *  1. Fresh  — TTL not yet expired → return immediately, no DB hit.
 *  2. Stale  — TTL expired but data exists (set by invalidateDashboardSopsCache
 *              after a mutation) → return the old data NOW so the caller gets a
 *              fast response, and kick off a background rebuild so the next
 *              request gets fresh data. No user ever waits 31s for a cold query.
 *  3. Cold   — null (first load or after bustDashboardCache) → must block and
 *              build. Concurrent callers share one in-flight promise.
 */
export async function getOrBuildServerGroupedCache(
  build: () => Promise<RegistrySOP[]>,
): Promise<RegistrySOP[]> {
  // Tier 1: fresh
  const fresh = getServerGroupedCache();
  if (fresh) return fresh;

  // Tier 2: stale — serve immediately, rebuild in background
  if (serverGroupedCache?.items.length) {
    if (!serverGroupedInFlight) {
      serverGroupedInFlight = (async () => {
        try {
          const items = await build();
          setServerGroupedCache(items);
          return items;
        } finally {
          serverGroupedInFlight = null;
        }
      })();
      serverGroupedInFlight.catch((e) =>
        console.error("[cache] Background registry rebuild failed:", e),
      );
    }
    return serverGroupedCache.items;
  }

  // Tier 3: cold — block until built
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
  // Hard reset — null the cache entirely so the next request does a cold rebuild.
  // Use this only for explicit user-triggered refreshes; mutations should call
  // invalidateDashboardSopsCache() instead so stale data can be served instantly.
  serverGroupedCache = null;
  serverGroupedInFlight = null;
  clearClientDashboardCache();
}
