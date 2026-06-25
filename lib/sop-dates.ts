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

export type SopHeaderDateValidationError =
  | "missing_effective_label"
  | "missing_review_label"
  | "empty_effective"
  | "empty_review"
  | "invalid_effective"
  | "invalid_review"
  | "review_before_effective";

export type SopHeaderDateValidation = {
  valid: boolean;
  errors: SopHeaderDateValidationError[];
  effectiveDate?: Date;
  reviewDate?: Date;
};

const HEADER_STOP_LABEL =
  /\b(?:EFF\.?\s*DATE|REVIEW\s*DT\.?|SUPERSEDES|PAGE\s*NO\.?|SOP\s*NO\.?|DEPARTMENT|SUBJECT|PREPARED\s*BY|લાગુ?\s*પડેલ?|ફેર\s*ચકાસણી|રદ\s*કરેલ|વિષય)\b/i;

const NON_DATE_VALUES = /^(?:nil|na|n\/a|-|—|--|\.|none)$/i;

const HEADER_LABEL_PAIRS: Array<{
  effective: RegExp;
  review: RegExp;
}> = [
  { effective: /\bEFF\.?\s*DATE\b/i, review: /\bREVIEW\s*DT\.?\b/i },
  {
    // Real-world Gujarati SOP headers vary: some drop the ુ matra on "લાગ",
    // omit the trailing લ of "પડેલ", and run the words together with no spaces
    // (e.g. "લાગુપડેતારીખ", "લાગ પડેલ તારીખ"). Keep those two chars optional.
    effective: /લાગુ?\s*પડેલ?\s*તારીખ/i,
    review: /ફેર\s*ચકાસણી\s*તારીખ/i,
  },
];

function peelHeaderValue(header: string, label: RegExp): { found: boolean; raw: string } {
  const idx = header.search(label);
  if (idx < 0) return { found: false, raw: "" };

  const after = header.slice(idx).replace(label, "").replace(/^[\s:.]+/, "");
  let raw = after.slice(0, 80);
  const stop = raw.search(HEADER_STOP_LABEL);
  if (stop >= 0) raw = raw.slice(0, stop);
  return { found: true, raw: raw.trim() };
}

function parseHeaderDateValue(raw: string): Date | null {
  if (!raw || NON_DATE_VALUES.test(raw.trim())) return null;
  const token = raw.match(DATE_TOKEN)?.[0];
  if (!token) return null;
  return parseFlexibleSopDate(token);
}

function headerLabelPairsForLanguage(language: "English" | "Gujarati") {
  if (language === "English") return [HEADER_LABEL_PAIRS[0]];
  return HEADER_LABEL_PAIRS;
}

/**
 * Strict validation of the page-header EFF. DATE / REVIEW DT. pair (or Gujarati
 * equivalents). Used to flag prior-version DOCX files with missing, empty, or
 * illogical dates.
 */
export function validateSopHeaderDates(
  content: string,
  language: "English" | "Gujarati" = "English",
): SopHeaderDateValidation {
  if (!content || content.startsWith("[")) {
    return {
      valid: false,
      errors: ["missing_effective_label", "missing_review_label"],
    };
  }

  const header = content.slice(0, 4000);
  const errors: SopHeaderDateValidationError[] = [];

  let effectiveRaw: string | undefined;
  let reviewRaw: string | undefined;
  let pairFound = false;

  for (const pair of headerLabelPairsForLanguage(language)) {
    const eff = peelHeaderValue(header, pair.effective);
    const rev = peelHeaderValue(header, pair.review);
    if (!eff.found || !rev.found) continue;
    pairFound = true;
    effectiveRaw = eff.raw;
    reviewRaw = rev.raw;
    break;
  }

  if (!pairFound) {
    const primary = headerLabelPairsForLanguage(language)[0];
    if (!peelHeaderValue(header, primary.effective).found) {
      errors.push("missing_effective_label");
    }
    if (!peelHeaderValue(header, primary.review).found) {
      errors.push("missing_review_label");
    }
    return { valid: false, errors };
  }

  if (!effectiveRaw) errors.push("empty_effective");
  if (!reviewRaw) errors.push("empty_review");

  const effectiveDate = effectiveRaw ? parseHeaderDateValue(effectiveRaw) : null;
  const reviewDate = reviewRaw ? parseHeaderDateValue(reviewRaw) : null;

  if (effectiveRaw && !effectiveDate) errors.push("invalid_effective");
  if (reviewRaw && !reviewDate) errors.push("invalid_review");

  if (effectiveDate && reviewDate && reviewDate < effectiveDate) {
    errors.push("review_before_effective");
  }

  return {
    valid: errors.length === 0,
    errors,
    effectiveDate: effectiveDate ?? undefined,
    reviewDate: reviewDate ?? undefined,
  };
}

export function sopHeaderDatesValid(
  content: string,
  language: "English" | "Gujarati" = "English",
): boolean {
  return validateSopHeaderDates(content, language).valid;
}

const HEADER_DATE_ERROR_MESSAGES: Record<SopHeaderDateValidationError, string> = {
  missing_effective_label:
    "EFF. DATE (or Gujarati લાગુ પડેલ તારીખ) not found in the page header",
  missing_review_label:
    "REVIEW DT. (or Gujarati ફેર ચકાસણી તારીખ) not found in the page header",
  empty_effective: "EFF. DATE is empty",
  empty_review: "REVIEW DT. is empty",
  invalid_effective: "EFF. DATE is not a valid date",
  invalid_review: "REVIEW DT. is not a valid date",
  review_before_effective: "REVIEW DT. must be on or after EFF. DATE",
};

/** Human-readable upload / UI message for header date validation failures. */
export function formatSopHeaderDateErrors(errors: SopHeaderDateValidationError[]): string {
  return errors.map((e) => HEADER_DATE_ERROR_MESSAGES[e]).join("; ");
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
      // English "effective date / EFF. DATE" and Gujarati "લાગુ પડેલ તારીખ"
      // (ુ matra and trailing લ optional — see HEADER_LABEL_PAIRS).
      /effective\s*date|eff\.?\s*date|date\s*of\s*effect(?:ive|iveness)|implementation\s*date|લાગુ?\s*પડેલ?\s*તારીખ/i,
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
