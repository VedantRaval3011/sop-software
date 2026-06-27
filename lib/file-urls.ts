export function buildPreviewHref(filePath?: string | null): string {
  if (!filePath) return "#";
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) return filePath;
  if (filePath.startsWith("/")) return filePath;
  return `/${filePath}`;
}

/** Absolute HTTPS URL that Office Online can fetch (CDN URL or app file proxy). */
export function buildPublicFileUrl(filePath: string, origin: string): string {
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
    return filePath;
  }
  const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const base = origin.replace(/\/$/, "");
  return `${base}/api/sops/file?path=${encodeURIComponent(normalized)}`;
}

/** Microsoft Office Online embed URL for faithful DOCX/DOC rendering. */
export function buildOfficeOnlineEmbedUrl(filePath: string, origin: string): string {
  const publicUrl = buildPublicFileUrl(filePath, origin);
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(publicUrl)}`;
}

export function isOfficePreviewAvailable(filePath: string, origin: string): boolean {
  if (filePath.startsWith("https://")) return true;
  const host = origin.replace(/^https?:\/\//, "").split(":")[0];
  return host !== "localhost" && host !== "127.0.0.1";
}

export function buildCdnPath(
  department: string,
  identifier: string,
  language: string,
  fileType: string,
  filename: string,
): string {
  const lang = language === "Gujarati" ? "Gujarati" : "English";
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_").trim();
  return `/${safe(department)}/${safe(identifier)}/${lang}/${fileType}/${safe(filename)}`;
}

export function isCdnUrl(url: string): boolean {
  const cdnUrl = process.env.BUNNY_CDN_URL?.replace(/\/$/, "");
  return Boolean(cdnUrl && url.startsWith(cdnUrl));
}

/**
 * Append a content-version query param to a stored file URL.
 *
 * `buildCdnPath` is deterministic, so re-uploading a file overwrites the same
 * Bunny object at the same URL. Every cache layer keys on that URL — Bunny's CDN
 * edge, Google Docs Viewer, Office Online, and the browser — so a re-upload keeps
 * showing the stale old file. Stamping the URL with a hash of the bytes gives each
 * distinct version its own URL, forcing a cache miss everywhere on the next view.
 *
 * Keyed by the content checksum (not a timestamp) so re-uploading identical bytes
 * yields the same URL and doesn't churn caches needlessly.
 */
export function appendCdnCacheBuster(url: string, version: string): string {
  const u = (url || "").trim();
  const v = (version || "").trim().slice(0, 12);
  if (!u || !v) return u;
  // Already stamped with this exact version — leave it alone.
  if (new RegExp(`[?&]v=${v}(?:&|$)`).test(u)) return u;
  return u.includes("?") ? `${u}&v=${v}` : `${u}?v=${v}`;
}
