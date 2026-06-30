import crypto from "crypto";

/** Normalize text before hashing so whitespace changes don't invalidate caches. */
export function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function hashText(text: string, len = 24): string {
  return crypto.createHash("sha256").update(normalizeForHash(text)).digest("hex").slice(0, len);
}

export function hashSopContent(content: string): string {
  return hashText(content, 24);
}

export function hashGuidelineRequirement(requirement: string, clauseNumber?: string): string {
  return hashText(`${clauseNumber ?? ""}::${requirement}`, 24);
}

export function hashGuidelineSet(
  clauses: { guidelineId: string; clauseNumber: string; clauseText: string }[],
): string {
  const payload = clauses
    .map((c) => `${c.guidelineId}:${c.clauseNumber}:${hashText(c.clauseText, 12)}`)
    .sort()
    .join("|");
  return hashText(payload, 24);
}

/** Hash a single guideline's clause set — used for per-guideline cache invalidation. */
export function hashSingleGuideline(
  clauses: { clauseNumber: string; clauseText: string }[],
): string {
  const payload = clauses
    .map((c) => `${c.clauseNumber}:${hashText(c.clauseText, 12)}`)
    .sort()
    .join("|");
  return hashText(payload, 24);
}

/** Stable gap ID from sop + root cause + section + requirement. */
export function deriveGapId(
  sopId: string,
  rootCauseKey: string,
  sopSection: string,
  requirementHash: string,
): string {
  return hashText(`${sopId}::${rootCauseKey}::${sopSection}::${requirementHash}`, 16);
}
