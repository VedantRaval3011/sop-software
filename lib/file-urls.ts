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
