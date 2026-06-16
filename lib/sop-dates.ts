import { addMonths, isValid, parse } from "date-fns";

export type ExtractedSopDates = {
  effectiveDate?: Date;
  reviewDate?: Date;
  nextReviewDate?: Date;
  /** Latest "Date of Revision" from the Revision History table. */
  revisionDate?: Date;
  validityMonths?: number;
};

export type ResolvedSopDates = {
  effectiveDate?: Date;
  reviewDate?: Date;
  expiryDate?: Date;
  validityPeriod?: number;
};

const DATE_TOKEN =
  /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[.,\s-]+\d{2,4}|\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*-\d{2,4})/i;

const PARSE_FORMATS = [
  "dd/MM/yyyy",
  "d/M/yyyy",
  "dd-MM-yyyy",
  "d-M-yyyy",
  "dd.MM.yyyy",
  "d.M.yyyy",
  "dd MMM yyyy",
  "d MMM yyyy",
  "dd-MMM-yyyy",
  "d-MMM-yyyy",
  "dd MMMM yyyy",
  "d MMMM yyyy",
] as const;

function normalizeDateToken(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/, (_, d, m, y) => `${d}/${m}/20${y}`);
}

export function parseFlexibleSopDate(raw: string): Date | null {
  const token = normalizeDateToken(raw);
  if (!token) return null;

  for (const fmt of PARSE_FORMATS) {
    const parsed = parse(token, fmt, new Date());
    if (isValid(parsed) && parsed.getFullYear() >= 1990 && parsed.getFullYear() <= 2100) {
      return parsed;
    }
  }

  const fallback = new Date(token);
  if (isValid(fallback) && fallback.getFullYear() >= 1990 && fallback.getFullYear() <= 2100) {
    return fallback;
  }
  return null;
}

function firstDateInText(text: string): Date | null {
  const match = text.match(DATE_TOKEN);
  if (!match?.[1]) return null;
  return parseFlexibleSopDate(match[1]);
}

function matchLabeledDate(
  content: string,
  labelPattern: RegExp,
  opts?: { exclude?: RegExp },
): Date | null {
  const inline = content.match(
    new RegExp(`(?:${labelPattern.source})[:\\s\\t.-]*${DATE_TOKEN.source}`, "i"),
  );
  if (inline && !(opts?.exclude && opts.exclude.test(inline[0]))) {
    const datePart = inline[0].replace(labelPattern, "").replace(/^[\s:.\t-]+/, "");
    const parsed = firstDateInText(datePart);
    if (parsed) return parsed;
  }

  const lines = content.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (opts?.exclude?.test(line)) continue;
    if (!labelPattern.test(line)) continue;

    const onSameLine = firstDateInText(line.replace(labelPattern, "").replace(/^[\s:.\t-]+/, ""));
    if (onSameLine) return onSameLine;

    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = firstDateInText(lines[j]);
      if (next) return next;
      if (lines[j].length > 40 && !DATE_TOKEN.test(lines[j])) break;
    }
  }

  return null;
}

/**
 * Pull the most recent date from the document's Revision History table.
 *
 * These SOP documents almost never carry an inline "Review Date: dd/mm/yyyy";
 * instead each revision is listed in a "Revision History" table with a
 * "Date of Revision" column. The latest such date is the current version's
 * effective date — the authoritative anchor the expiry is derived from.
 */
function extractLatestRevisionDate(content: string): Date | null {
  const anchor = content.search(/revision\s*history|date\s*of\s*revision/i);
  if (anchor < 0) return null;

  const region = content.slice(anchor);
  const tokenRe = new RegExp(DATE_TOKEN.source, "gi");
  // Ignore typo dates far in the future (a revision is never long-dated ahead).
  const cutoff = addMonths(new Date(), 24);

  let latest: Date | null = null;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(region)) !== null) {
    const parsed = parseFlexibleSopDate(match[0]);
    if (!parsed || parsed > cutoff) continue;
    if (!latest || parsed > latest) latest = parsed;
  }
  return latest;
}

function extractValidityMonths(content: string): number | undefined {
  const match = content.match(
    /(?:validity|review\s*period|revised?\s*after|re[-\s]?review)\s*(?:period)?\s*[:.\t]?\s*(\d{1,2})\s*months?/i,
  );
  if (!match?.[1]) return undefined;
  const months = parseInt(match[1], 10);
  return months > 0 && months <= 120 ? months : undefined;
}

/** Page-header table dates (EFF. DATE / REVIEW DT.) — authoritative for version vs review. */
function extractHeaderTableDates(content: string): Pick<ExtractedSopDates, "effectiveDate" | "reviewDate"> {
  const header = content.slice(0, 3000);
  const eff = header.match(/\bEFF\.?\s*DATE\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/i);
  const rev = header.match(/\bREVIEW\s*DT\.?\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/i);
  return {
    effectiveDate: eff?.[1] ? (parseFlexibleSopDate(eff[1]) ?? undefined) : undefined,
    reviewDate: rev?.[1] ? (parseFlexibleSopDate(rev[1]) ?? undefined) : undefined,
  };
}

/** Pull effective / review / next-review dates from extracted DOCX text. */
export function extractSopDatesFromContent(content: string): ExtractedSopDates {
  if (!content || content.startsWith("[")) return {};

  const headerDates = extractHeaderTableDates(content);

  const nextReviewDate =
    matchLabeledDate(content, /next\s*review\s*date|date\s*of\s*next\s*review/i) ??
    matchLabeledDate(content, /next\s*review/i);

  const reviewDate =
    headerDates.reviewDate ??
    matchLabeledDate(
      content,
      // English "review date / REVIEW DT." and Gujarati "ફેર ચકાસણી તારીખ".
      /review\s*\/\s*expiry\s*date|review\s*date|review\s*dt\.?|date\s*of\s*review|ફેર\s*ચકાસણી\s*તારીખ/i,
      { exclude: /next\s*review/i },
    );

  const effectiveDate =
    headerDates.effectiveDate ??
    matchLabeledDate(
      content,
      // English "effective date / EFF. DATE" and Gujarati "લાગુ પડેલ તારીખ".
      /effective\s*date|eff\.?\s*date|date\s*of\s*effect(?:ive|iveness)|implementation\s*date|લાગુ\s*પડેલ\s*તારીખ/i,
    );

  const revisionDate = extractLatestRevisionDate(content);

  const validityMonths = extractValidityMonths(content);

  return {
    effectiveDate: effectiveDate ?? undefined,
    reviewDate: reviewDate ?? undefined,
    nextReviewDate: nextReviewDate ?? undefined,
    revisionDate: revisionDate ?? undefined,
    validityMonths,
  };
}

/** Map document dates to DB fields. Expiry follows the doc review / next-review date. */
export function resolveSopDatesFromContent(content: string): ResolvedSopDates {
  const extracted = extractSopDatesFromContent(content);
  const validityPeriod = extracted.validityMonths ?? 24;

  // The latest "Date of Revision" is the authoritative effective date for the
  // current version; a labeled "Effective Date" wins if the document carries one.
  const effectiveDate = extracted.effectiveDate ?? extracted.revisionDate;

  // A review / next-review date must fall AFTER the effective date — a review can
  // never precede the version it reviews. SOP headers occasionally carry a typo'd
  // review year (e.g. QAGE01-10: EFF. DATE 31/10/2025 / REVIEW DT. 30/10/2025,
  // where the review year should read 2027), which would otherwise be stored as a
  // review/expiry date earlier than the SOP's own effective date. Discard such
  // impossible values so expiry is recomputed from effective + validity below.
  const afterEffective = (d?: Date): Date | undefined =>
    d && (!effectiveDate || d > effectiveDate) ? d : undefined;

  let expiryDate = afterEffective(extracted.nextReviewDate);
  let reviewDate = afterEffective(extracted.reviewDate);

  if (!expiryDate && reviewDate) {
    const now = new Date();
    if (reviewDate > now) {
      // Future review date = the document's stated next-review / expiry date.
      expiryDate = reviewDate;
    } else {
      // Past review date = the date the SOP was last reviewed (effectively its
      // version date). Compute the actual expiry by adding the validity period
      // from the best available anchor date.
      const anchor = effectiveDate ?? reviewDate;
      expiryDate = addMonths(anchor, validityPeriod);
    }
  }

  if (!expiryDate && effectiveDate) {
    expiryDate = addMonths(effectiveDate, validityPeriod);
    reviewDate = reviewDate ?? expiryDate;
  }

  return {
    effectiveDate,
    reviewDate,
    expiryDate,
    validityPeriod: expiryDate ? validityPeriod : undefined,
  };
}

export function sopDatesToDbFields(dates: ResolvedSopDates): {
  effectiveDate?: Date;
  reviewDate?: Date;
  expiryDate?: Date;
  validityPeriod?: number;
  nextReviewDate?: Date;
} {
  const fields: {
    effectiveDate?: Date;
    reviewDate?: Date;
    expiryDate?: Date;
    validityPeriod?: number;
    nextReviewDate?: Date;
  } = {};

  if (dates.effectiveDate) fields.effectiveDate = dates.effectiveDate;
  if (dates.reviewDate) fields.reviewDate = dates.reviewDate;
  if (dates.expiryDate) {
    fields.expiryDate = dates.expiryDate;
    fields.nextReviewDate = dates.expiryDate;
  }
  if (dates.validityPeriod) fields.validityPeriod = dates.validityPeriod;

  return fields;
}
