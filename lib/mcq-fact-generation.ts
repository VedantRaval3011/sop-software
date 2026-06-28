import type { ISOP } from "@/models/SOP";
import type { LlmProvider } from "@/lib/llm";
import { generateJson, isGeminiOverloadedError } from "@/lib/gemini";
import { generateOllamaJson } from "@/lib/ollama";
import { generateClaudeCliJson, getMcqClaudeModel } from "@/lib/claude-cli";
import { generateCodexCliJson, generateCodexCliMcqBatch, getMcqCodexModel } from "@/lib/codex-cli";
import { MCQ_BANK_CAP, type BankInputMcq } from "@/lib/mcq-bank-write";
import {
  MCQ_FACT_EXTRACT_SYSTEM,
  MCQ_FACT_MCQ_SYSTEM,
  MCQ_FACT_REPAIR_SYSTEM,
} from "@/lib/mcq-generation-prompts";
import {
  factsPerMcqBatch,
  maxFactRepairBatches,
  mcqContentLimitClaude,
  mcqContentLimitCodex,
} from "@/lib/mcq-generation-config";
import {
  batchFacts,
  createFactDedupState,
  factIdsAtCapacity,
  factsEligibleForReuse,
  formatExcludedFactIds,
  formatFactsForPrompt,
  isFactMcqAcceptable,
  normalizeKnowledgeFactId,
  parseFactsJson,
  pickReuseCategory,
  recordFactMcq,
  type FactDedupState,
  type FactMcq,
  type SopFact,
} from "@/lib/mcq-facts";
import { normalizeSopTextForMcq, MCQ_CONTENT_LIMIT, MCQ_CONTENT_LIMIT_OLLAMA } from "@/lib/mcq-source-text";
import type { ParsedMcq } from "@/lib/mcq-json-parse";
import { enrichMcqRationale } from "@/lib/mcq-rationale";
import {
  getMcqRunSignal,
  isMcqRunStopRequested,
} from "@/lib/mcq-run-control";

type GeneratedMcqLike = ParsedMcq;

type RunCtx = { overloadHits: number; failedBatches: number };

type BankDedupState = {
  questions: string[];
  refCounts: Map<string, number>;
  usedFactIds: Set<string>;
};

type BatchHandler = (p: {
  batchesDone: number;
  newMcqs: BankInputMcq[];
}) => Promise<{ bankTotal: number; insertedTexts: string[] }>;

type PushLog = (identifier: string, message: string) => Promise<void>;
type HaltCheck = (
  identifier: string,
  language: "English" | "Gujarati",
) => Promise<{ halt: boolean; reason: "cancel" | "cap" | null; bankTotal: number }>;
type HaltHandler = (
  identifier: string,
  language: "English" | "Gujarati",
  reason: "cancel" | "cap",
  bankTotal: number,
) => Promise<void>;
type ActiveBankCount = (identifier: string, language: "English" | "Gujarati") => Promise<number>;
type FetchMcqQuestions = (
  provider: LlmProvider | undefined,
  system: string,
  user: string,
  identifier: string,
  language: string,
  batchLabel: string,
) => Promise<GeneratedMcqLike[]>;
type CreativeFill = (
  identifier: string,
  sop: ISOP,
  language: "English" | "Gujarati",
  bankCountAtStart: number,
  dedupAtStart: BankDedupState,
  ctx: RunCtx,
  onBatchDone: BatchHandler,
  provider?: LlmProvider,
) => Promise<void>;

type LegacyFill = CreativeFill;

export interface FactGenerationDeps {
  pushLog: PushLog;
  shouldHaltGeneration: HaltCheck;
  handleGenerationHalt: HaltHandler;
  activeBankCount: ActiveBankCount;
  fetchMcqQuestions: FetchMcqQuestions;
  generateForLanguageLegacy: LegacyFill;
  generateForLanguageCreative: CreativeFill;
  toBankInput: (q: GeneratedMcqLike) => BankInputMcq;
}

class McqGenerationCancelledError extends Error {
  constructor() {
    super("Generation cancelled");
  }
}

async function callModelJson<T>(
  provider: LlmProvider | undefined,
  system: string,
  user: string,
  identifier: string,
  label: string,
  parse: (text: string) => T,
): Promise<T> {
  if (isMcqRunStopRequested(identifier)) throw new McqGenerationCancelledError();
  const signal = getMcqRunSignal(identifier);

  if (provider === "codex") {
    return generateCodexCliJson(system, user, parse, label, getMcqCodexModel(), {
      runKey: identifier,
      signal,
    });
  }
  if (provider === "claude") {
    const text = await generateClaudeCliJson<string>(
      system,
      user,
      getMcqClaudeModel(),
      { runKey: identifier, signal },
    );
    return parse(text);
  }
  if (provider === "ollama") {
    const result = await generateOllamaJson<unknown>(system, user);
    return parse(JSON.stringify(result));
  }
  const result = await generateJson<unknown>(system, user, { maxAttempts: 2, fastFail503: true });
  return parse(JSON.stringify(result));
}

function sopExcerptForFacts(sop: ISOP, provider?: LlmProvider): string {
  const limit =
    provider === "ollama"
      ? MCQ_CONTENT_LIMIT_OLLAMA
      : provider === "claude"
        ? mcqContentLimitClaude()
        : provider === "codex"
          ? mcqContentLimitCodex()
          : MCQ_CONTENT_LIMIT;
  return normalizeSopTextForMcq(sop.content).slice(0, limit);
}

function buildFactExtractionPrompt(
  language: string,
  sop: ISOP,
  excerpt: string,
): string {
  return `${language} · ${sop.identifier}

Extract every unique testable fact from this SOP.
Return a JSON array of facts (30–70 typical).

SOP:
${excerpt}`;
}

function buildFactMcqPrompt(
  language: string,
  sop: ISOP,
  facts: SopFact[],
): string {
  const lines = facts.map((f) => `- ${f.id} [${f.topic}] category=recall: ${f.fact}`);
  return `${language} · ${sop.identifier}

Generate exactly ONE MCQ per fact below (${facts.length} questions total).
Rules: one fact = one MCQ; never combine facts; include factId on each question.

Facts:
${lines.join("\n")}`;
}

function buildFactReusePrompt(
  language: string,
  sop: ISOP,
  facts: SopFact[],
  state: FactDedupState,
): string {
  const lines = facts.map((f) => {
    const cat = pickReuseCategory(f.id, state);
    return `- ${f.id} [${f.topic}] category=${cat}: ${f.fact}`;
  });
  return `${language} · ${sop.identifier}

These facts already have a recall question. Generate ONE additional MCQ per fact using the requested category (scenario or application — not another recall).
${facts.length} questions total.

Facts:
${lines.join("\n")}`;
}

function buildFactRepairPrompt(
  language: string,
  sop: ISOP,
  facts: SopFact[],
  excludedIds: Set<string>,
  need: number,
): string {
  const eligible = facts.filter((f) => !excludedIds.has(f.id)).slice(0, need);
  return `${language} · ${sop.identifier}

Generate exactly ${eligible.length} NEW MCQs — one per fact listed.
Do NOT use these fact IDs (already at capacity): ${formatExcludedFactIds(excludedIds) || "(none)"}

Facts:
${formatFactsForPrompt(eligible)}`;
}

function syncSeenFromInserted(seenQuestions: string[], insertedTexts: string[]): void {
  for (const t of insertedTexts) {
    if (!seenQuestions.includes(t)) seenQuestions.push(t);
  }
}

function asFactMcq(q: ParsedMcq | GeneratedMcqLike, fallbackTopic?: string): FactMcq {
  return {
    ...q,
    factId: q.factId ? normalizeKnowledgeFactId(q.factId) : undefined,
    topic: q.topic ?? fallbackTopic,
    questionCategory: q.questionCategory ?? "recall",
  };
}

async function extractSopFacts(
  provider: LlmProvider | undefined,
  identifier: string,
  language: string,
  sop: ISOP,
  excerpt: string,
  ctx: RunCtx,
  pushLog: PushLog,
): Promise<SopFact[]> {
  try {
    const facts = await callModelJson(
      provider,
      MCQ_FACT_EXTRACT_SYSTEM,
      buildFactExtractionPrompt(language, sop, excerpt),
      identifier,
      "fact-extract",
      (text) => parseFactsJson(text, "fact-extract"),
    );
    return facts;
  } catch (err) {
    ctx.failedBatches++;
    const msg = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
    await pushLog(identifier, `${language} · fact extraction failed — ${msg}`);
    if (provider !== "ollama" && provider !== "claude" && provider !== "codex" && isGeminiOverloadedError(err)) {
      throw err;
    }
    return [];
  }
}

async function generateMcqsForFactBatch(
  provider: LlmProvider | undefined,
  identifier: string,
  language: string,
  sop: ISOP,
  facts: SopFact[],
  system: string,
  user: string,
  batchLabel: string,
  fetchMcqQuestions: FetchMcqQuestions,
  ctx: RunCtx,
  pushLog: PushLog,
): Promise<FactMcq[]> {
  try {
    if (provider === "codex") {
      const signal = getMcqRunSignal(identifier);
      const raw = await generateCodexCliMcqBatch(system, user, getMcqCodexModel(), {
        runKey: identifier,
        signal,
      });
      return raw.map((q) => asFactMcq(q));
    }
    const questions = await fetchMcqQuestions(
      provider,
      system,
      user,
      identifier,
      language,
      batchLabel,
    );
    return questions.map((q) => asFactMcq(q));
  } catch (err) {
    ctx.failedBatches++;
    const msg = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
    await pushLog(identifier, `${language} · ${batchLabel} failed — ${msg}`);
    return [];
  }
}

function acceptFactMcqs(
  questions: FactMcq[],
  facts: SopFact[],
  seenQuestions: string[],
  factState: FactDedupState,
  insertRoom: number,
  toBankInput: (q: GeneratedMcqLike) => BankInputMcq,
): { candidates: BankInputMcq[]; factMcqs: FactMcq[] } {
  const factById = new Map(facts.map((f) => [normalizeKnowledgeFactId(f.id), f]));
  const candidates: BankInputMcq[] = [];
  const factMcqs: FactMcq[] = [];
  const batchSeen = [...seenQuestions];
  const batchState = {
    factUsage: new Map(factState.factUsage),
    factCategories: new Map(
      [...factState.factCategories.entries()].map(([k, v]) => [k, new Set(v)]),
    ),
    topicCounts: new Map(factState.topicCounts),
  };

  for (const q of questions) {
    if (candidates.length >= insertRoom) break;
    const fact = q.factId ? factById.get(normalizeKnowledgeFactId(q.factId)) : undefined;
    const base = asFactMcq(
      {
        ...q,
        topic: q.topic ?? fact?.topic,
      },
      fact?.topic,
    );
    const { explanation, sopReference } = enrichMcqRationale(
      base,
      fact ? { topic: fact.topic, fact: fact.fact } : undefined,
    );
    const enriched: FactMcq = { ...base, explanation, sopReference };
    if (!isFactMcqAcceptable(enriched, batchState, batchSeen)) continue;
    batchSeen.push(enriched.question);
    recordFactMcq(batchState, enriched);
    candidates.push(toBankInput(enriched));
    factMcqs.push(enriched);
  }

  return { candidates, factMcqs };
}

function commitInsertedFactMcqs(
  insertedTexts: string[],
  factMcqs: FactMcq[],
  factState: FactDedupState,
): void {
  const byQuestion = new Map(factMcqs.map((q) => [q.question, q]));
  for (const text of insertedTexts) {
    const q = byQuestion.get(text);
    if (q) recordFactMcq(factState, q);
  }
}

/** Fact-based pipeline: extract facts → one MCQ per fact → local dedup → small repair. */
export async function generateForLanguageFactBased(
  identifier: string,
  sop: ISOP,
  language: "English" | "Gujarati",
  bankCountAtStart: number,
  dedupAtStart: BankDedupState,
  ctx: RunCtx,
  onBatchDone: BatchHandler,
  deps: FactGenerationDeps,
  provider?: LlmProvider,
): Promise<void> {
  if (bankCountAtStart >= MCQ_BANK_CAP) return;

  const {
    pushLog,
    shouldHaltGeneration,
    handleGenerationHalt,
    activeBankCount,
    fetchMcqQuestions,
    generateForLanguageLegacy,
    generateForLanguageCreative,
    toBankInput,
  } = deps;

  let seenQuestions = [...dedupAtStart.questions];
  const factState = createFactDedupState();
  let bankTotal = bankCountAtStart;
  let batchNum = 0;

  const excerpt = sopExcerptForFacts(sop, provider);
  if (!excerpt) {
    await pushLog(identifier, `${language} · no readable SOP text — falling back to excerpt fill`);
    await generateForLanguageLegacy(
      identifier, sop, language, bankCountAtStart, dedupAtStart, ctx, onBatchDone, provider,
    );
    return;
  }

  await pushLog(identifier, `${language} · stage 1 — extracting unique facts`);
  const facts = await extractSopFacts(provider, identifier, language, sop, excerpt, ctx, pushLog);
  if (!facts.length) {
    await pushLog(
      identifier,
      `${language} · stage 1 failed — falling back to excerpt fill (fact JSON parse or Codex error)`,
    );
    await generateForLanguageLegacy(
      identifier, sop, language, bankCountAtStart, dedupAtStart, ctx, onBatchDone, provider,
    );
    return;
  }
  await pushLog(identifier, `${language} · extracted ${facts.length} unique facts`);

  const perBatch = factsPerMcqBatch(provider);

  // Stage 2: one MCQ per fact (recall)
  await pushLog(identifier, `${language} · stage 2 — generating one MCQ per fact`);
  for (const factBatch of batchFacts(facts, perBatch)) {
    const pre = await shouldHaltGeneration(identifier, language);
    bankTotal = pre.bankTotal;
    if (pre.halt && pre.reason) {
      await handleGenerationHalt(identifier, language, pre.reason, bankTotal);
      return;
    }

    batchNum++;
    const insertRoom = MCQ_BANK_CAP - bankTotal;
    if (insertRoom <= 0) return;

    const userPrompt = buildFactMcqPrompt(language, sop, factBatch);
    await pushLog(
      identifier,
      `${language} · fact batch ${batchNum} (${factBatch.length} facts) → ${bankTotal}/${MCQ_BANK_CAP}`,
    );

    const questions = await generateMcqsForFactBatch(
      provider,
      identifier,
      language,
      sop,
      factBatch,
      MCQ_FACT_MCQ_SYSTEM,
      userPrompt,
      `fact batch ${batchNum}`,
      fetchMcqQuestions,
      ctx,
      pushLog,
    );

    const { candidates, factMcqs } = acceptFactMcqs(
      questions,
      facts,
      seenQuestions,
      factState,
      insertRoom,
      toBankInput,
    );

    if (candidates.length === 0 && questions.length > 0) {
      await pushLog(identifier, `${language} · fact batch ${batchNum}: ${questions.length} parsed, 0 accepted (dedup)`);
    }

    const prev = bankTotal;
    const batchResult = await onBatchDone({ batchesDone: batchNum, newMcqs: candidates });
    bankTotal = batchResult.bankTotal;
    commitInsertedFactMcqs(batchResult.insertedTexts, factMcqs, factState);
    syncSeenFromInserted(seenQuestions, batchResult.insertedTexts);

    await pushLog(identifier, `${language} · fact batch ${batchNum}: +${bankTotal - prev} → ${bankTotal}/${MCQ_BANK_CAP}`);
  }

  bankTotal = await activeBankCount(identifier, language);
  if (bankTotal >= MCQ_BANK_CAP) return;

  // Stage 3: second question per fact (scenario/application) only after round 1
  const reuseFacts = factsEligibleForReuse(facts, factState).filter(
    (f) => (factState.factUsage.get(f.id) ?? 0) === 1,
  );
  if (reuseFacts.length > 0 && bankTotal < MCQ_BANK_CAP) {
    await pushLog(
      identifier,
      `${language} · stage 3 — second MCQ for ${reuseFacts.length} facts (scenario/application)`,
    );
    for (const factBatch of batchFacts(reuseFacts, perBatch)) {
      const pre = await shouldHaltGeneration(identifier, language);
      bankTotal = pre.bankTotal;
      if (pre.halt && pre.reason) {
        await handleGenerationHalt(identifier, language, pre.reason, bankTotal);
        return;
      }

      batchNum++;
      const insertRoom = MCQ_BANK_CAP - bankTotal;
      if (insertRoom <= 0) break;

      const userPrompt = buildFactReusePrompt(language, sop, factBatch, factState);
      const questions = await generateMcqsForFactBatch(
        provider,
        identifier,
        language,
        sop,
        factBatch,
        MCQ_FACT_MCQ_SYSTEM,
        userPrompt,
        `fact reuse ${batchNum}`,
        fetchMcqQuestions,
        ctx,
        pushLog,
      );

      const { candidates, factMcqs } = acceptFactMcqs(
        questions,
        facts,
        seenQuestions,
        factState,
        insertRoom,
        toBankInput,
      );

      const prev = bankTotal;
      const batchResult = await onBatchDone({ batchesDone: batchNum, newMcqs: candidates });
      bankTotal = batchResult.bankTotal;
      commitInsertedFactMcqs(batchResult.insertedTexts, factMcqs, factState);
      syncSeenFromInserted(seenQuestions, batchResult.insertedTexts);

      await pushLog(identifier, `${language} · fact reuse ${batchNum}: +${bankTotal - prev} → ${bankTotal}/${MCQ_BANK_CAP}`);
    }
  }

  bankTotal = await activeBankCount(identifier, language);

  // Stage 5: small repair batches for remaining gap
  const maxRepair = maxFactRepairBatches();
  for (let repair = 0; repair < maxRepair && bankTotal < MCQ_BANK_CAP; repair++) {
    const need = MCQ_BANK_CAP - bankTotal;
    const excluded = factIdsAtCapacity(factState);
    const eligible = facts.filter((f) => !excluded.has(f.id));
    if (!eligible.length) break;

    batchNum++;
    const batchSize = Math.min(need, perBatch, eligible.length);
    const userPrompt = buildFactRepairPrompt(language, sop, eligible, excluded, batchSize);

    await pushLog(
      identifier,
      `${language} · stage 5 repair ${repair + 1} — need ${need}, trying ${batchSize} facts`,
    );

    const questions = await generateMcqsForFactBatch(
      provider,
      identifier,
      language,
      sop,
      eligible.slice(0, batchSize),
      MCQ_FACT_REPAIR_SYSTEM,
      userPrompt,
      `fact repair ${repair + 1}`,
      fetchMcqQuestions,
      ctx,
      pushLog,
    );

    const { candidates, factMcqs } = acceptFactMcqs(
      questions,
      facts,
      seenQuestions,
      factState,
      batchSize,
      toBankInput,
    );

    if (!candidates.length) break;

    const prev = bankTotal;
    const batchResult = await onBatchDone({ batchesDone: batchNum, newMcqs: candidates });
    bankTotal = batchResult.bankTotal;
    commitInsertedFactMcqs(batchResult.insertedTexts, factMcqs, factState);
    syncSeenFromInserted(seenQuestions, batchResult.insertedTexts);

    await pushLog(identifier, `${language} · repair ${repair + 1}: +${bankTotal - prev} → ${bankTotal}/${MCQ_BANK_CAP}`);
  }

  bankTotal = await activeBankCount(identifier, language);
  if (bankTotal >= MCQ_BANK_CAP) return;

  await pushLog(
    identifier,
    `${language} · ${bankTotal}/${MCQ_BANK_CAP} after fact pipeline — creative fill for remainder`,
  );
  await generateForLanguageCreative(
    identifier,
    sop,
    language,
    bankTotal,
    { questions: seenQuestions, refCounts: new Map(), usedFactIds: new Set(factState.factUsage.keys()) },
    ctx,
    onBatchDone,
    provider,
  );
}
