export const DASHBOARD_CACHE_KEY = "sop-dashboard-cache-v1";
export const DASHBOARD_STATS_CACHE_KEY = "sop-dashboard-stats-v1";

let serverSopsCache: { payload: string; expiresAt: number } | null = null;
const SERVER_TTL_MS = 30_000;

export function invalidateDashboardSopsCache() {
  serverSopsCache = null;
}

export function getServerSopsCache(queryKey: string) {
  if (!serverSopsCache || serverSopsCache.expiresAt < Date.now()) return null;
  if (serverSopsCache.payload.startsWith(queryKey)) {
    return serverSopsCache.payload.slice(queryKey.length);
  }
  return null;
}

export function setServerSopsCache(queryKey: string, json: string) {
  serverSopsCache = {
    payload: queryKey + json,
    expiresAt: Date.now() + SERVER_TTL_MS,
  };
}

export function clearClientDashboardCache() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
  sessionStorage.removeItem(DASHBOARD_STATS_CACHE_KEY);
  localStorage.removeItem(DASHBOARD_CACHE_KEY);
  localStorage.removeItem(DASHBOARD_STATS_CACHE_KEY);
}

export function bustDashboardCache() {
  invalidateDashboardSopsCache();
  clearClientDashboardCache();
}
