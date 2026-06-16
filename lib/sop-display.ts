/**
 * Shared SOP No. / SOP Name display helpers.
 *
 * Used by the Main Dashboard's SOP Registry and the MCQ Bank Registry so the
 * SOP number and SOP name render in the EXACT same format in both modules.
 * Keep this as the single source of truth — do not duplicate the logic.
 */

/** Canonical SOP code without trailing noise (e.g. "QAGE01-11_ENG" → "QAGE01-11"). */
export function displaySopCode(identifier: string): string {
  const match = identifier.match(/^([A-Z]+\d+[-]\d+)/i);
  if (match) return match[1].toUpperCase();
  const seg = identifier.split("_")[0];
  return /^[A-Z]{2,}\d/i.test(seg) ? seg.toUpperCase() : identifier;
}

/** SOP name with the leading SOP code stripped (e.g. "QAGE01-11 - Title" → "Title"). */
export function displaySopTitle(name: string, identifier: string): string {
  const code = displaySopCode(identifier);
  const codePattern = code.replace(/[-]/g, String.raw`[\s_-]`);
  const stripped = name.replace(new RegExp(`^${codePattern}[\\s_-]*`, "i"), "").trim();
  return stripped || name;
}
