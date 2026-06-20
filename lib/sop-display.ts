/**
 * Shared SOP No. / SOP Name display helpers.
 *
 * Used by the Main Dashboard's SOP Registry and the MCQ Bank Registry so the
 * SOP number and SOP name render in the EXACT same format in both modules.
 * Keep this as the single source of truth — do not duplicate the logic.
 */

import {
  expandSopIdentifierVariants,
  formatSopCodeDisplay,
  normalizeSopIdentifierKey,
} from "@/lib/sopIdentifierNormalize";

function stripRevisionSuffix(code: string): string {
  return String(code || "").toUpperCase().replace(/-\d+$/, "").trim();
}

/** Prefix variants to strip from titles (raw + zero-padded doc index). */
function titlePrefixCandidates(identifier: string): string[] {
  const out = new Set<string>();
  const formatted = formatSopCodeDisplay(identifier);
  if (formatted) out.add(formatted);
  const raw = String(identifier || "").trim().toUpperCase();
  if (raw) out.add(raw);
  const nk = normalizeSopIdentifierKey(raw);
  if (nk) out.add(nk);
  for (const variant of expandSopIdentifierVariants(identifier)) {
    out.add(formatSopCodeDisplay(variant));
    out.add(stripRevisionSuffix(variant));
    out.add(variant.toUpperCase());
  }
  return [...out].filter(Boolean);
}

/** Canonical SOP code with zero-padded document index (e.g. QCMI1-0 → QCMI01-0). */
export function displaySopCode(identifier: string): string {
  const trimmed = String(identifier || "").trim();
  if (!trimmed) return "";
  return formatSopCodeDisplay(trimmed);
}

/** SOP name with the leading SOP code stripped (e.g. "QCMI1-0 - Title" → "Title"). */
export function displaySopTitle(name: string, identifier: string): string {
  if (!name) return name;
  for (const code of titlePrefixCandidates(identifier)) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[\\s_-]");
    const stripped = name.replace(new RegExp(`^${escaped}[\\s_-]*`, "i"), "").trim();
    if (stripped && stripped !== name.trim()) return stripped;
  }
  return name;
}
