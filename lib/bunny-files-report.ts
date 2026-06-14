import { getBunnyConfig, isBunnyConfigured } from "@/lib/validateEnv";

export interface BunnyFileEntry {
  path: string;
  fileName: string;
  folder: string;
  extension: string;
  sizeBytes: number | null;
  lastChanged: string | null;
  cdnUrl: string;
}

export interface BunnyFilesReport {
  files: BunnyFileEntry[];
  totalFiles: number;
  totalDirectories: number;
  truncated: boolean;
  scannedAt: string;
  cached: boolean;
}

interface BunnyListEntry {
  ObjectName: string;
  IsDirectory: boolean;
  LastChanged?: string;
  Length?: number;
}

const LIST_TIMEOUT_MS = 15_000;
const SCAN_CONCURRENCY = 16;
const MAX_LISTINGS = 12_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedReport: BunnyFilesReport | null = null;
let cacheExpiresAt = 0;

function requireBunnyConfig() {
  if (!isBunnyConfigured()) {
    throw new Error("Bunny CDN is not configured");
  }
  return getBunnyConfig();
}

async function listBunnyDir(
  cfg: ReturnType<typeof getBunnyConfig>,
  dirPath: string,
): Promise<BunnyListEntry[]> {
  const clean = dirPath.replace(/^\/+|\/+$/g, "");
  const url = clean
    ? `https://${cfg.hostname}/${cfg.storageZone}/${clean}/`
    : `https://${cfg.hostname}/${cfg.storageZone}/`;
  try {
    const res = await fetch(url, {
      headers: { AccessKey: cfg.apiKey },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[bunny-files] list failed", res.status, url);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as BunnyListEntry[]) : [];
  } catch (err) {
    console.error("[bunny-files] list error", url, err);
    return [];
  }
}

function toFileEntry(
  cfg: ReturnType<typeof getBunnyConfig>,
  fullPath: string,
  entry: BunnyListEntry,
): BunnyFileEntry {
  const fileName = entry.ObjectName;
  const slash = fullPath.lastIndexOf("/");
  const folder = slash >= 0 ? fullPath.slice(0, slash) : "";
  const ext = fileName.includes(".") ? (fileName.split(".").pop()?.toLowerCase() ?? "") : "";
  return {
    path: fullPath,
    fileName,
    folder,
    extension: ext,
    sizeBytes: typeof entry.Length === "number" && entry.Length > 0 ? entry.Length : null,
    lastChanged: entry.LastChanged ?? null,
    cdnUrl: `${cfg.cdnUrl}/${fullPath}`,
  };
}

/** Parallel scan of Bunny storage — returns a flat list of files only. */
export async function listAllBunnyFiles(forceRefresh = false): Promise<BunnyFilesReport> {
  const now = Date.now();
  if (!forceRefresh && cachedReport && now < cacheExpiresAt) {
    return { ...cachedReport, cached: true };
  }

  const cfg = requireBunnyConfig();
  const files: BunnyFileEntry[] = [];
  const queue: string[] = [""];
  let listings = 0;
  let totalDirectories = 0;
  let truncated = false;

  while (queue.length > 0 && listings < MAX_LISTINGS) {
    const batch = queue.splice(0, SCAN_CONCURRENCY);
    listings += batch.length;

    const results = await Promise.all(batch.map((dir) => listBunnyDir(cfg, dir)));

    for (let i = 0; i < batch.length; i++) {
      const dir = batch[i];
      for (const entry of results[i]) {
        const fullPath = dir ? `${dir}/${entry.ObjectName}` : entry.ObjectName;
        if (entry.IsDirectory) {
          totalDirectories++;
          queue.push(fullPath);
          continue;
        }
        files.push(toFileEntry(cfg, fullPath, entry));
      }
    }
  }

  if (queue.length > 0) truncated = true;

  files.sort((a, b) => a.path.localeCompare(b.path));

  const report: BunnyFilesReport = {
    files,
    totalFiles: files.length,
    totalDirectories,
    truncated,
    scannedAt: new Date().toISOString(),
    cached: false,
  };

  cachedReport = report;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return report;
}

export function invalidateBunnyFilesCache() {
  cachedReport = null;
  cacheExpiresAt = 0;
}
