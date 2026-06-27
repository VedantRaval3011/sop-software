/**
 * Server-side HTML cache for converted DOCX content.
 *
 * Shared by the docx-to-html route (read/write) and the upload flow
 * (invalidate-on-replace) so a re-uploaded DOCX never serves a previously
 * converted HTML body. Keyed by SHA-256 of the DOCX bytes (POST path) or by
 * token path/identifier/language (GET path). TTL: 30 minutes.
 */
const HTML_CACHE_TTL_MS = 30 * 60 * 1000;

interface HtmlCacheEntry {
  html: string;
  cachedAt: number;
}

const g = global as typeof global & { __docxHtmlCache?: Map<string, HtmlCacheEntry> };
if (!g.__docxHtmlCache) g.__docxHtmlCache = new Map();
const htmlCache = g.__docxHtmlCache;

export function getCachedDocxHtml(key: string): string | null {
  const entry = htmlCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > HTML_CACHE_TTL_MS) {
    htmlCache.delete(key);
    return null;
  }
  return entry.html;
}

export function setCachedDocxHtml(key: string, html: string): void {
  htmlCache.set(key, { html, cachedAt: Date.now() });
  if (htmlCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of htmlCache) {
      if (now - v.cachedAt > HTML_CACHE_TTL_MS) htmlCache.delete(k);
    }
  }
}

/** Build the GET cache key (token path + identifier + language). */
export function docxHtmlGetCacheKey(
  path: string | undefined,
  identifier: string | undefined,
  language: string | undefined,
): string {
  return `get::${path ?? ""}::${identifier ?? ""}::${language ?? ""}`;
}

/**
 * Drop every cached HTML entry whose key contains any of the given substrings
 * (typically a SOP identifier and/or stored file path). Called after a re-upload
 * so the next preview re-converts the new bytes instead of returning stale HTML.
 */
export function invalidateDocxHtmlCache(matches: Array<string | null | undefined>): number {
  const needles = matches.map((m) => (m || "").trim()).filter(Boolean);
  if (!needles.length) return 0;
  let removed = 0;
  for (const key of htmlCache.keys()) {
    if (needles.some((n) => key.includes(n))) {
      htmlCache.delete(key);
      removed++;
    }
  }
  return removed;
}
