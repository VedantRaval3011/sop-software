/** Shared content policy for all MCQ generation paths (Claude, Codex, Gemini, Ollama). */
export const MCQ_CONTENT_RULES = `Questions that MUST NOT be generated (document metadata — not training value):
- SOP number, document identifier, version/revision number, effective/review dates
- Previous or superseded SOP number, revision history, or what changed between revisions
- Organization/company name unless operationally required to perform the procedure
- Page count, total sections, document layout, headers, footers, or formatting
- "What is in Section X?" or questions that only test section/annexure numbers or where text is located
- Annexure numbers unless the learner must pick the correct form during execution
- Duplicate or near-duplicate questions on the same concept

Prioritize instead:
- Procedural steps and correct sequence; roles and responsibilities
- Equipment, materials, parameters, acceptance criteria and limits
- Actions for deviations/abnormalities; safety, GMP, and compliance requirements
- Scenario-based application and the purpose behind critical steps`;

const JSON_RULES = `- correctAnswer is exactly one letter: A, B, C, or D (not option text)
- fact_id and learning_objective are REQUIRED on every question (internal — not shown to learners)
- Use double quotes for all strings; no trailing commas; no markdown
- Short options (one line each)`;

export const MCQ_RATIONALE_RULES = `Every question MUST include learner-facing rationale fields:

explanation (Pedagogical Rationale) — REQUIRED, 1–3 sentences:
- State WHY the correct option is right; name the correct option text in quotes.
- Tie the reasoning to a specific SOP rule, limit, role, or step.
- NEVER write "Refer to the SOP", "See the SOP", or similar placeholders.

sopReference (Technical SOP Context) — REQUIRED:
- A verbatim or near-verbatim quote from the SOP (≤45 words) that proves the answer.
- Prefix with section/clause when known (e.g. "4.2.1 — Daily cleaning shall be recorded…").
- NOT the document number or internal fact_id.`;

/** Single high-ROI uniqueness block — appended to MCQ generation prompts. */
export const MCQ_UNIQUENESS_SECTION = `## Uniqueness Requirements (VERY IMPORTANT)

Maximize coverage of UNIQUE knowledge points in the SOP.
A knowledge point is the single SOP fact being tested (purpose, scope, temperature limit, cleaning frequency, action on deviation, etc.).

Before each question:
1. Identify the ONE knowledge point being tested.
2. Assign a short unique fact_id (e.g. PURPOSE, TEMP_LIMIT_FREEZER, ACTION_ON_ABNORMAL_TEMP).
3. Include learning_objective — one sentence describing what is being tested.

Duplicate rules: two questions are duplicates if they share the same fact_id. Rewording, scenarios, names, or examples do NOT make a new question. Generate only ONE question per fact_id unless told otherwise.

Scenarios are encouraged only when they test a NEW fact_id. Prefer breadth over depth — cover untested facts first.

Self-check before returning: every fact_id is unique; no two questions share the same learning objective.`;

export const MCQ_QUESTION_JSON_EXAMPLE = `{"fact_id":"ACTION_ON_ABNORMAL_TEMP","learning_objective":"Action when abnormal temperature is observed","question":"string","optionA":"string","optionB":"string","optionC":"string","optionD":"string","correctAnswer":"A","difficulty":"medium","explanation":"string","sopReference":"string"}`;

export const MCQ_FACT_EXTRACT_SYSTEM = `You extract testable knowledge from pharmaceutical SOPs for training assessments.
Return ONLY valid JSON (no markdown).

Preferred schema:
{"facts":[{"fact_id":"TEMP_LIMIT_FREEZER","topic":"Limits","fact":"Freezer temperature must be maintained at -20°C or below."}]}

Legacy id format F001 is accepted. Prefer semantic fact_id (UPPER_SNAKE_CASE).
- Each fact = one unique, testable knowledge point; break compound statements apart.
- A typical SOP has 30–70 unique facts, not 100.
- Skip document metadata (SOP number, version, dates, page layout).

${MCQ_CONTENT_RULES}`;

export const MCQ_FACT_MCQ_SYSTEM = `You generate ONE multiple-choice question per SOP fact for training.
Return ONLY valid JSON (no markdown).

Schema:
{"questions":[{"fact_id":"F001","learning_objective":"string","questionCategory":"recall","question":"string","optionA":"string","optionB":"string","optionC":"string","optionD":"string","correctAnswer":"A","difficulty":"medium","topic":"string","explanation":"string","sopReference":"string"}]}

${JSON_RULES}
- One fact = one MCQ per batch. fact_id must match the fact id from the user message.
- questionCategory: recall | scenario | application (as requested).
- sopReference = SOP quote (NOT fact_id).

${MCQ_RATIONALE_RULES}

${MCQ_UNIQUENESS_SECTION}

${MCQ_CONTENT_RULES}`;

export const MCQ_FACT_REPAIR_SYSTEM = `Generate replacement MCQs for SOP training. Each question maps to exactly one provided fact.
Return ONLY valid JSON (no markdown).

{"questions":[${MCQ_QUESTION_JSON_EXAMPLE},"questionCategory":"scenario"]}

${JSON_RULES}
- Generate only NEW questions. Do NOT reuse excluded fact_ids.
- sopReference = SOP quote (not fact_id).

${MCQ_RATIONALE_RULES}

${MCQ_UNIQUENESS_SECTION}

${MCQ_CONTENT_RULES}`;

export const MCQ_CLAUSE_SYSTEM = `You are an MCQ generator for SOP training. Respond with ONLY a JSON object (no markdown).

Schema:
{"questions":[${MCQ_QUESTION_JSON_EXAMPLE}]}

${JSON_RULES}
- One question per requested clause; sopReference = quote from that clause plus clause id if shown

${MCQ_RATIONALE_RULES}

${MCQ_UNIQUENESS_SECTION}

${MCQ_CONTENT_RULES}`;

export const MCQ_LEGACY_SYSTEM = `You are an MCQ generator for SOP training. Output ONLY valid JSON (no markdown).

{"questions":[${MCQ_QUESTION_JSON_EXAMPLE}]}

${JSON_RULES}

${MCQ_RATIONALE_RULES}

${MCQ_UNIQUENESS_SECTION}

${MCQ_CONTENT_RULES}`;

export const MCQ_CREATIVE_RULES = `Creative fill — the bank is nearly full and standard questions are exhausted. Generate NEW questions that:
- Use realistic scenario stems grounded in this SOP (equipment readings, deviations, timing, roles)
- Test applied judgment: what to do next, who is responsible, cause-effect, why a step matters
- Vary difficulty and angle: operator action, supervisor escalation, documentation, safety/GMP
- Must NOT repeat or closely paraphrase any question in the avoid list
- Each scenario must use a NEW fact_id — still follow uniqueness rules`;

export const MCQ_CREATIVE_SYSTEM = `You are an MCQ generator for SOP training. The question bank is almost full — create CREATIVE, scenario-based questions. Output ONLY valid JSON (no markdown).

{"questions":[${MCQ_QUESTION_JSON_EXAMPLE}]}

${JSON_RULES}

${MCQ_RATIONALE_RULES}

${MCQ_UNIQUENESS_SECTION}

${MCQ_CREATIVE_RULES}

${MCQ_CONTENT_RULES}`;

export const MCQ_REPLACE_SYSTEM = `Generate replacement MCQ questions for SOP training. Return ONLY JSON:
{"questions":[${MCQ_QUESTION_JSON_EXAMPLE}]}

${JSON_RULES}

${MCQ_RATIONALE_RULES}

${MCQ_UNIQUENESS_SECTION}

${MCQ_CONTENT_RULES}`;

/** Reject questions that only test document metadata (safety net when the model ignores prompts). */
const METADATA_QUESTION = [
  /\bsop\s*(no\.?|number|code|identifier)\b/i,
  /\bdocument\s*(no\.?|number|identifier|id)\b/i,
  /\b(revision|version)\s*(no\.?|number)\b/i,
  /\beffective\s+date\b/i,
  /\breview\s+date\b/i,
  /\bsuperseded\b/i,
  /\brevision\s+history\b/i,
  /\bhow\s+many\s+pages?\b/i,
  /\bnumber\s+of\s+sections?\b/i,
  /\bwhat\s+is\s+(contained|found)\s+in\s+section\b/i,
  /\bwhich\s+section\s+(contains|includes|covers)\b/i,
  /\bwhere\s+(in\s+the\s+sop|is\s+this)\s+(found|located|mentioned)\b/i,
  /\bannexure\s+(no\.?|number)\b/i,
  /\bheader(s)?\s+(or|and)\s+footer/i,
];

export function isMetadataOnlyMcq(question: string): boolean {
  const q = question.trim();
  if (!q) return true;
  return METADATA_QUESTION.some((re) => re.test(q));
}
