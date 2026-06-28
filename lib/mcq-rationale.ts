/** Pedagogical rationale + SOP source text for generated MCQs. */

const PLACEHOLDER_EXPLANATION =
  /^(refer to the sop|see the sop|consult the sop|check the sop|as per (the )?sop|per the sop)\b/i;

const WEAK_SOP_REF =
  /^(unknown|n\/a|topic|general|sop|refer to sop)$/i;

export function isWeakExplanation(text: string | undefined | null): boolean {
  const s = (text ?? "").trim();
  if (!s) return true;
  if (s.length < 25) return true;
  return PLACEHOLDER_EXPLANATION.test(s);
}

export function isWeakSopReference(text: string | undefined | null): boolean {
  const s = (text ?? "").trim();
  if (!s) return true;
  if (WEAK_SOP_REF.test(s)) return true;
  if (/^F\d{3,}$/i.test(s)) return true;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(s) && !/\d+\.\d+/.test(s)) return true;
  if (/^\*[^*]+\*$/.test(s) && s.length < 40) return true;
  if (s.length < 12 && !/\d+\.\d+/.test(s)) return true;
  return false;
}

function correctOptionText(q: {
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
}): string {
  const map: Record<string, string> = {
    A: q.optionA,
    B: q.optionB,
    C: q.optionC,
    D: q.optionD,
  };
  return (map[q.correctAnswer.toUpperCase()] ?? "").trim();
}

export interface McqRationaleInput {
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  explanation?: string;
  sopReference?: string;
  topic?: string;
}

export interface FactRationaleContext {
  topic: string;
  fact: string;
}

/** Ensure explanation and sopReference are useful for learners — not placeholders. */
export function enrichMcqRationale(
  q: McqRationaleInput,
  fact?: FactRationaleContext,
): { explanation: string; sopReference: string } {
  const correct = correctOptionText(q);
  const topic = fact?.topic ?? q.topic?.trim();

  let explanation = (q.explanation ?? "").trim();
  if (isWeakExplanation(explanation)) {
    if (correct && fact?.fact) {
      explanation =
        `The correct answer is "${correct}" because the SOP states that ${fact.fact.replace(/\.$/, "")}.`;
    } else if (correct && topic) {
      explanation =
        `The correct answer is "${correct}" because it aligns with the SOP requirement for ${topic}.`;
    } else if (correct) {
      explanation =
        `The correct answer is "${correct}" — it is the only option consistent with the SOP procedure described in the source text.`;
    } else {
      explanation =
        "This answer follows the procedure and limits defined in the SOP for this step.";
    }
  }

  let sopReference = (q.sopReference ?? "").trim();
  if (isWeakSopReference(sopReference)) {
    if (fact?.fact) {
      const prefix = fact.topic ? `${fact.topic} — ` : "";
      sopReference = `${prefix}"${fact.fact}"`;
    } else if (topic) {
      sopReference = topic;
    } else if (correct) {
      sopReference = `Procedure requirement supporting answer: "${correct}"`;
    } else {
      sopReference = "See the governing SOP section for this procedure step.";
    }
  }

  return { explanation, sopReference };
}
