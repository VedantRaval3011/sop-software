import { getBunnyConfig, isBunnyConfigured } from "@/lib/validateEnv";
import { getBunnyCdnUrl } from "@/lib/bunnyStorage";
import {
  extractIdentifierFromFilename,
  departmentFromRelativePath,
} from "@/lib/sop-utils";
import { expandSopIdentifierVariants, normalizeSopIdentifierKey } from "@/lib/sopIdentifierNormalize";
import type { VersionFileFormat } from "@/lib/version-diagnostics";

export interface IndexedBunnyVersionFile {
  identifier: string;
  language: "English" | "Gujarati";
  fileType: VersionFileFormat;
  storagePath: string;
  fileUrl: string;
  fileName: string;
  department: string;
  lastChanged: string | null;
}

interface BunnyListEntry {
  ObjectName: string;
  IsDirectory: boolean;
  LastChanged?: string;
}

const LIST_TIMEOUT_MS = 12_000;
const SCAN_CONCURRENCY = 16;
const MAX_LISTINGS = 12_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedIndex: Map<string, IndexedBunnyVersionFile> | null = null;
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
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as BunnyListEntry[]) : [];
  } catch {
    return [];
  }
}

function looksLikeSopCode(segment: string): boolean {
  return /[A-Za-z]{2,}/.test(segment) && /\d/.test(segment);
}

function languageFromPath(fullPath: string): "English" | "Gujarati" | null {
  const parts = fullPath.split("/").map((p) => p.toLowerCase());
  if (parts.includes("gujarati") || parts.includes("guj")) return "Gujarati";
  if (parts.includes("english") || parts.includes("eng")) return "English";
  return null;
}

function fileTypeFromName(name: string): VersionFileFormat | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  return null;
}

export function bunnyVersionSlotKey(
  fileIdentifier: string,
  language: "English" | "Gujarati",
  fileType: VersionFileFormat,
): string {
  return `${normalizeSopIdentifierKey(fileIdentifier)}|${language}|${fileType}`;
}

function pickBetter(
  current: IndexedBunnyVersionFile | undefined,
  next: IndexedBunnyVersionFile,
): IndexedBunnyVersionFile {
  if (!current) return next;
  const curTs = current.lastChanged ? new Date(current.lastChanged).getTime() : 0;
  const nextTs = next.lastChanged ? new Date(next.lastChanged).getTime() : 0;
  return nextTs >= curTs ? next : current;
}

function indexFile(
  index: Map<string, IndexedBunnyVersionFile>,
  fullPath: string,
  entry: BunnyListEntry,
) {
  const fileType = fileTypeFromName(entry.ObjectName);
  if (!fileType) return;

  const language = languageFromPath(fullPath) ?? "English";
  const deptFromPath = departmentFromRelativePath(fullPath) ?? fullPath.split("/")[0] ?? "General";

  const identifiers = new Set<string>();
  const segments = fullPath.split("/");
  for (const seg of segments.slice(0, -1)) {
    if (looksLikeSopCode(seg)) {
      identifiers.add(normalizeSopIdentifierKey(seg));
    }
  }

  const stem = entry.ObjectName.replace(/\.[^.]+$/, "").replace(/[_-]\d{10,}$/, "");
  if (looksLikeSopCode(stem)) {
    identifiers.add(normalizeSopIdentifierKey(extractIdentifierFromFilename(stem)));
  }

  const parsed: IndexedBunnyVersionFile = {
    identifier: "",
    language,
    fileType,
    storagePath: fullPath,
    fileUrl: getBunnyCdnUrl(fullPath),
    fileName: entry.ObjectName,
    department: deptFromPath,
    lastChanged: entry.LastChanged ?? null,
  };

  for (const id of identifiers) {
    if (!id) continue;
    const key = bunnyVersionSlotKey(id, language, fileType);
    parsed.identifier = id;
    index.set(key, pickBetter(index.get(key), { ...parsed, identifier: id }));
  }
}

/** Parallel scan of Bunny storage — indexes every DOCX/PDF by SOP code + language + format. */
export async function buildBunnyVersionFileIndex(
  forceRefresh = false,
): Promise<Map<string, IndexedBunnyVersionFile>> {
  const now = Date.now();
  if (!forceRefresh && cachedIndex && now < cacheExpiresAt) {
    return cachedIndex;
  }

  const cfg = requireBunnyConfig();
  const index = new Map<string, IndexedBunnyVersionFile>();
  const queue: string[] = [""];
  let listings = 0;

  while (queue.length > 0 && listings < MAX_LISTINGS) {
    const batch = queue.splice(0, SCAN_CONCURRENCY);
    listings += batch.length;
    const results = await Promise.all(batch.map((dir) => listBunnyDir(cfg, dir)));

    for (let i = 0; i < batch.length; i++) {
      const dir = batch[i];
      for (const entry of results[i]) {
        const fullPath = dir ? `${dir}/${entry.ObjectName}` : entry.ObjectName;
        if (entry.IsDirectory) {
          queue.push(fullPath);
          continue;
        }
        indexFile(index, fullPath, entry);
      }
    }
  }

  cachedIndex = index;
  cacheExpiresAt = now + CACHE_TTL_MS;
  return index;
}

export function lookupBunnyVersionFile(
  index: Map<string, IndexedBunnyVersionFile>,
  fileIdentifier: string,
  language: "English" | "Gujarati",
  fileType: VersionFileFormat,
): IndexedBunnyVersionFile | null {
  for (const variant of expandSopIdentifierVariants(fileIdentifier)) {
    const hit = index.get(bunnyVersionSlotKey(variant, language, fileType));
    if (hit) return hit;
  }
  return null;
}

export function invalidateBunnyVersionIndexCache() {
  cachedIndex = null;
  cacheExpiresAt = 0;
}
