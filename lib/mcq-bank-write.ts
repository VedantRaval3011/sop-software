import MCQBank, { type IMCQ, type DifficultyLevel } from "@/models/MCQBank";
import type { ISOP } from "@/models/SOP";
import { isSimilarQuestion } from "@/lib/similarity";

// Shape the generator produces (kept structural to avoid a circular import with
// lib/mcq-generation). Any object with these fields can be written to a bank.
export interface BankInputMcq {
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
}

const DIFFICULTY_MAP: Record<string, DifficultyLevel> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const STARS: Record<DifficultyLevel, "⭐" | "⭐⭐" | "⭐⭐⭐"> = {
  Easy: "⭐",
  Medium: "⭐⭐",
  Hard: "⭐⭐⭐",
};

const LETTER_INDEX: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * Map a generated MCQ to the MCQBank embedded shape.
 *
 * The bank's `correctAnswer` is stored as the option TEXT (not a letter) because
 * the viewer marks an option correct via `opt === mcq.correctAnswer`
 * (MCQViewerModal) and the LMS quiz resolves text → letter. Required string
 * fields (explanation/sopReference/aiIcon/correctAnswer) must be non-empty or
 * Mongoose `required` validation rejects the doc.
 */
export function toBankMcq(q: BankInputMcq, sopIdentifier: string): IMCQ {
  const options = [q.optionA, q.optionB, q.optionC, q.optionD].map((o) => (o ?? "").trim());
  const idx = LETTER_INDEX[q.correctAnswer] ?? 0;
  const difficulty = DIFFICULTY_MAP[String(q.difficulty).toLowerCase()] ?? "Medium";
  const correctText =
    options[idx] || options.find((o) => o.length > 0) || "N/A";
  return {
    aiIcon: "✨",
    question: (q.question ?? "").trim(),
    difficulty,
    difficultyStars: STARS[difficulty],
    options,
    correctAnswer: correctText,
    explanation: (q.explanation ?? "").trim() || "Refer to the SOP for details.",
    sopReference: (q.topic ?? "").trim() || sopIdentifier,
    optionVariants: [],
    isChecked: false,
    isReviewed: false,
    isSimilar: false,
  };
}

function difficultyDistribution(mcqs: { difficulty: DifficultyLevel }[]) {
  return {
    easy: mcqs.filter((m) => m.difficulty === "Easy").length,
    medium: mcqs.filter((m) => m.difficulty === "Medium").length,
    hard: mcqs.filter((m) => m.difficulty === "Hard").length,
  };
}

export interface BankWriteResult {
  bankId: string;
  inserted: number;
  skipped: number;
  total: number;
}

/**
 * Upsert generated MCQs into the SOP's MCQBank (one bank per SOP record +
 * language). New questions are deduped against the bank's existing questions
 * before appending, so re-running generation never produces near-duplicates.
 *
 * Returns the resulting bank id and counts. If nothing new survives dedup and no
 * bank exists yet, no empty bank is created (the schema requires ≥1 question).
 */
// Match by exact identifier + language (version-specific) rather than sopId, so
// pdf+docx records of the same SOP version share one bank — preventing duplicate
// banks that would double-count in the family-level stats fold. Different versions
// keep distinct identifiers and so keep distinct banks.
function identifierRegex(identifier: string): RegExp {
  return new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

/** Dedup a batch of generated MCQs against a running list, mapping survivors to
 *  the bank shape. Returns the new bank questions plus how many were skipped. */
function dedupToBank(
  generated: BankInputMcq[],
  identifier: string,
  against: string[],
): { toAdd: IMCQ[]; skipped: number } {
  const seen = [...against];
  const toAdd: IMCQ[] = [];
  let skipped = 0;
  for (const q of generated) {
    if (seen.some((eq) => isSimilarQuestion(q.question, eq))) {
      skipped++;
      continue;
    }
    seen.push(q.question);
    toAdd.push(toBankMcq(q, identifier));
  }
  return { toAdd, skipped };
}

export const SUPERSEDED_REASON = "Superseded by regenerated MCQs";

/**
 * Append generated MCQs to the SOP's ACTIVE bank (one per identifier + language),
 * deduping against what's already there. Creates the bank if none exists. Use for
 * "generate more" — it adds to the current set without archiving anything.
 */
export async function appendGeneratedToBank(
  sop: Pick<ISOP, "_id" | "name" | "identifier" | "department">,
  language: "English" | "Gujarati",
  generated: BankInputMcq[],
): Promise<BankWriteResult> {
  const idRegex = identifierRegex(sop.identifier);
  const bank = await MCQBank.findOne({ sopIdentifier: idRegex, language, isObsolete: { $ne: true } });
  const existingQuestions = bank ? bank.mcqs.map((m) => m.question) : [];
  const { toAdd, skipped } = dedupToBank(generated, sop.identifier, existingQuestions);

  if (!bank) {
    if (toAdd.length === 0) return { bankId: "", inserted: 0, skipped, total: 0 };
    const created = await MCQBank.create({
      sopId: sop._id,
      sopName: sop.name,
      sopIdentifier: sop.identifier,
      department: sop.department,
      language,
      mcqs: toAdd,
      totalQuestions: toAdd.length,
      generatedAt: new Date(),
      difficultyDistribution: difficultyDistribution(toAdd),
      aiModel: "gemini-2.5-flash",
    });
    return { bankId: String(created._id), inserted: toAdd.length, skipped, total: toAdd.length };
  }

  if (toAdd.length > 0) {
    bank.mcqs.push(...toAdd);
    bank.totalQuestions = bank.mcqs.length;
    bank.difficultyDistribution = difficultyDistribution(bank.mcqs);
    await bank.save();
  }
  return { bankId: String(bank._id), inserted: toAdd.length, skipped, total: bank.mcqs.length };
}

/**
 * Replace the SOP's active bank with a freshly generated set: the current active
 * bank(s) for this identifier + language are archived to the Obsolete MCQs section
 * (isObsolete=true, alongside old SOP-version MCQs), and a new active bank is
 * created from the generated questions. Use for full regeneration.
 *
 * If nothing usable is generated, the existing active bank is left untouched (we
 * never strand an SOP with zero active MCQs over an empty AI response).
 */
export async function replaceBankForSop(
  sop: Pick<ISOP, "_id" | "name" | "identifier" | "department">,
  language: "English" | "Gujarati",
  generated: BankInputMcq[],
): Promise<BankWriteResult> {
  const idRegex = identifierRegex(sop.identifier);
  const { toAdd, skipped } = dedupToBank(generated, sop.identifier, []);

  if (toAdd.length === 0) {
    const cur = await MCQBank.findOne({ sopIdentifier: idRegex, language, isObsolete: { $ne: true } })
      .select("_id totalQuestions")
      .lean();
    return { bankId: cur ? String(cur._id) : "", inserted: 0, skipped, total: cur?.totalQuestions ?? 0 };
  }

  // Archive the current active bank(s) to the Obsolete MCQs section (preserving
  // their review flags/history) before installing the new one.
  await MCQBank.updateMany(
    { sopIdentifier: idRegex, language, isObsolete: { $ne: true } },
    { $set: { isObsolete: true, obsoleteAt: new Date(), obsoleteReason: SUPERSEDED_REASON } },
  );

  const created = await MCQBank.create({
    sopId: sop._id,
    sopName: sop.name,
    sopIdentifier: sop.identifier,
    department: sop.department,
    language,
    mcqs: toAdd,
    totalQuestions: toAdd.length,
    generatedAt: new Date(),
    difficultyDistribution: difficultyDistribution(toAdd),
    aiModel: "gemini-2.5-flash",
  });
  return { bankId: String(created._id), inserted: toAdd.length, skipped, total: toAdd.length };
}
