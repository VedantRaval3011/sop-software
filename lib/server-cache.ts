import type { RegistrySOP } from "@/lib/types";
import { invalidatePersistentGroupedCache } from "@/lib/persistentGroupedCache";

/* ─── Server-side grouped-registry cache ─────────────────────────────────
 * Must not be imported from client components — persistentGroupedCache uses
 * mongoose. Client code should import from @/lib/cache instead. */
let serverGroupedCache: { items: RegistrySOP[]; expiresAt: number } | null = null;
let serverGroupedInFlight: Promise<RegistrySOP[]> | null = null;
const SERVER_TTL_MS = 60 * 1000;

export function invalidateDashboardSopsCache() {
  serverGroupedCache = null;
  serverGroupedInFlight = null;
  void invalidatePersistentGroupedCache();
}

export function getServerGroupedCache(): RegistrySOP[] | null {
  if (!serverGroupedCache || serverGroupedCache.expiresAt < Date.now()) return null;
  return serverGroupedCache.items;
}

export function setServerGroupedCache(items: RegistrySOP[]) {
  serverGroupedCache = { items, expiresAt: Date.now() + SERVER_TTL_MS };
}

export async function getOrBuildServerGroupedCache(
  build: () => Promise<RegistrySOP[]>,
): Promise<RegistrySOP[]> {
  const fresh = getServerGroupedCache();
  if (fresh) return fresh;

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

export function bustServerDashboardCache() {
  serverGroupedCache = null;
  serverGroupedInFlight = null;
  void invalidatePersistentGroupedCache();
}
