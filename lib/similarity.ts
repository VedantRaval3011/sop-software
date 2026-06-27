/** Strip boilerplate and punctuation so near-duplicate MCQs compare fairly. */
export function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(according to (the )?sop|as per (the )?sop|in this sop|the sop states|per the sop)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      normalizeQuestionText(s)
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

/** Stricter than the legacy viewer flag — catches paraphrases and shared stems. */
export const SIMILARITY_THRESHOLD = 0.58;

/** Tighter thresholds used while generating MCQs — reject near-duplicates before they land in the bank. */
export const MCQ_GEN_SIMILARITY_THRESHOLD = 0.48;
export const MCQ_GEN_WORD_OVERLAP_THRESHOLD = 0.72;

/** Fraction of significant words from the shorter question found in the longer one. */
function wordOverlapRatio(a: string, b: string): number {
  const wordsA = normalizeQuestionText(a).split(/\s+/).filter((w) => w.length > 2);
  const wordsB = normalizeQuestionText(b).split(/\s+/).filter((w) => w.length > 2);
  if (wordsA.length < 4 || wordsB.length < 4) return 0;

  const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const longer = wordsA.length <= wordsB.length ? wordsB : wordsA;
  const longerSet = new Set(longer);
  const hits = shorter.filter((w) => longerSet.has(w)).length;
  return hits / shorter.length;
}

/** True when two MCQ question texts are duplicates or near-duplicates. */
export function isDuplicateMcqQuestion(
  newQ: string,
  existingQ: string,
  threshold = SIMILARITY_THRESHOLD,
  wordOverlapThreshold = 0.82,
): boolean {
  const a = normalizeQuestionText(newQ);
  const b = normalizeQuestionText(existingQ);
  if (!a || !b) return false;
  if (a === b) return true;
  if (wordOverlapRatio(newQ, existingQ) >= wordOverlapThreshold) return true;
  return jaccardSimilarity(newQ, existingQ) >= threshold;
}

/** Stricter duplicate check used during MCQ generation — keeps all 100 questions distinct. */
export function isDuplicateMcqQuestionForGeneration(newQ: string, existingQ: string): boolean {
  return isDuplicateMcqQuestion(
    newQ,
    existingQ,
    MCQ_GEN_SIMILARITY_THRESHOLD,
    MCQ_GEN_WORD_OVERLAP_THRESHOLD,
  );
}

/** @deprecated Use isDuplicateMcqQuestion — kept for any external callers. */
export function isSimilarQuestion(newQ: string, existingQ: string, threshold = SIMILARITY_THRESHOLD) {
  return isDuplicateMcqQuestion(newQ, existingQ, threshold);
}

export function normalizeSopReference(ref?: string | null): string {
  return (ref ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
