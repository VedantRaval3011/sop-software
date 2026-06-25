import SOP, { type ISOP } from "@/models/SOP";
import MCQBank from "@/models/MCQBank";
import MCQGenJob, { type McqGenLanguage, type McqGenMode, type IMcqGenLangProgress } from "@/models/MCQGenJob";
import { generateJson, isGeminiOverloadedError } from "@/lib/gemini";
import { generateOllamaJson } from "@/lib/ollama";
import { generateClaudeCliJson, getMcqClaudeModel } from "@/lib/claude-cli";
import { DEFAULT_FREE_GEMINI_MODEL } from "@/lib/gemini-free-models";
import type { LlmProvider } from "@/lib/llm";
import { invalidateDashboardSopsCache } from "@/lib/server-cache";
import { connectDB } from "@/lib/mongodb";
import { appendGeneratedToBank, archiveBankForSop, MCQ_BANK_CAP } from "@/lib/mcq-bank-write";
import {
  MCQ_CONTENT_CHUNKS,
  MCQ_CONTENT_LIMIT,
  MCQ_CONTENT_LIMIT_OLLAMA,
  mcqPromptSopExcerpt,
  normalizeSopTextForMcq,
  scoreSopRecordForMcq,
} from "@/lib/mcq-source-text";
import { isDuplicateMcqQuestion, normalizeSopReference } from "@/lib/similarity";

/** Each SOP/language bank holds at most this many MCQs (see MCQ_BANK_CAP). */
export const MCQ_TARGET_PER_LANGUAGE = MCQ_BANK_CAP;
/** Gemini's 16K output cap can't fit ~100 MCQs in one response, so we generate in
 *  batches and accumulate (deduping) until the target is met. */
const MCQ_BATCH_SIZE = 25;
/** Allow extra batches when many model outputs are deduped away. */
const MCQ_MAX_BATCHES = 12;
/** Stop only after this many consecutive batches add zero new MCQs to the bank. */
const MCQ_MAX_EMPTY_BATCHES = 3;
/** Cap questions per SOP clause so batches spread across the document. */
const MAX_QUESTIONS_PER_CLAUSE = 2;
/** Recent question stems sent to the model — kept small to save tokens. */
const MCQ_AVOID_STEMS = 6;
const MCQ_AVOID_STEM_CHARS = 100;
/** Max clause refs listed in the avoid hint (token-cheap vs full question list). */
const MCQ_AVOID_MAX_CLAUSES = 35;
/** Abort the whole run after this many fully-overloaded (503) batches. Hammering
 *  an overloaded service just burns quota without producing MCQs. */
const MCQ_MAX_OVERLOAD_ABORT = 2;
/** Per-call retry budget for MCQ generation: a couple of quick tries, and bail
 *  fast on 503 so we don't trigger the escalating-backoff storm. */
const MCQ_GEN_OPTIONS = { maxAttempts: 2, fastFail503: true } as const;
/** Extra per-batch retries for Claude — batch 2+ often needs another try after timeouts. */
const CLAUDE_BATCH_ATTEMPTS = 3;

export interface GeneratedMCQ {
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
  /** The exact SOP section/clause the question is derived from, so users can trace
   *  it back to the source. Prefer the numbered clause (e.g. "4.6.1.4"); fall back
   *  to the section heading (e.g. "5.2 Responsibility") only when the SOP text has
   *  no number for that section. Shown in the viewer as "Technical SOP Context". */
  sopReference: string;
}

const MCQ_SYSTEM_PROMPT = `Pharma GMP training expert. From the SOP excerpt, return ONLY JSON:
{"questions":[{"question","optionA","optionB","optionC","optionD","correctAnswer":"A"|"B"|"C"|"D","explanation","difficulty":"easy"|"medium"|"hard","topic","sopReference"}]}
Rules: answerable from excerpt only; ~40% easy, ~40% medium, ~20% hard;
each question MUST test a different clause/topic — vary stems (who/what/when/why/how);
no paraphrases or rewordings of listed avoid stems/clauses;
sopReference = exact clause number from text (e.g. "4.6.1.4") or section heading if unnumbered.`;

function resolveMcqAiModel(provider?: LlmProvider): string {
  if (provider === "ollama") return "gemma3:12b";
  if (provider === "claude") return getMcqClaudeModel();
  return process.env.GEMINI_MODEL ?? DEFAULT_FREE_GEMINI_MODEL;
}

/** Thrown when the run aborts because the model service is overloaded (503). The
 *  caller maps it to a friendly "retry in a few minutes" job status. */
class OverloadAbortError extends Error {}

function ts(): string {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function pushLog(identifier: string, message: string): Promise<void> {
  const line = `[${ts()}] ${message}`;
  await MCQGenJob.updateOne(
    { identifier },
    { $push: { logs: { $each: [line], $slice: -30 } } },
  );
}

/** Mutable per-run bookkeeping shared across languages/batches. */
interface RunCtx {
  overloadHits: number;
  failedBatches: number;
}

function escapeId(identifier: string): RegExp {
  return new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

/** Overall completion: bank size toward the per-language cap. */
function overallPercent(langs: IMcqGenLangProgress[]): number {
  const totalTarget = langs.reduce((s, l) => s + (l.target || 0), 0) || 1;
  const done = langs.reduce((s, l) => s + Math.min(l.collected, l.target), 0);
  return Math.min(100, Math.round((done / totalTarget) * 100));
}

/** Normalize API/client language codes to the canonical bank language name. */
export function parseMcqLanguage(v: unknown): McqGenLanguage | undefined {
  if (v === "English" || v === "ENG" || v === "en") return "English";
  if (v === "Gujarati" || v === "GUJ" || v === "gu") return "Gujarati";
  return undefined;
}

async function hasActiveBankForLang(identifier: string, language: McqGenLanguage): Promise<boolean> {
  return Boolean(
    await MCQBank.exists({
      sopIdentifier: escapeId(identifier),
      language,
      isObsolete: { $ne: true },
    }),
  );
}

async function activeBankCount(identifier: string, language: "English" | "Gujarati"): Promise<number> {
  const bank = await MCQBank.findOne({
    sopIdentifier: escapeId(identifier),
    language,
    isObsolete: { $ne: true },
  })
    .select("mcqs")
    .lean();
  return bank?.mcqs?.length ?? 0;
}

interface BankDedupState {
  questions: string[];
  refCounts: Map<string, number>;
}

async function loadBankDedupState(
  identifier: string,
  language: "English" | "Gujarati",
): Promise<BankDedupState> {
  const bank = await MCQBank.findOne({
    sopIdentifier: escapeId(identifier),
    language,
    isObsolete: { $ne: true },
  })
    .select("mcqs.question mcqs.sopReference")
    .lean();

  const questions: string[] = [];
  const refCounts = new Map<string, number>();
  for (const m of bank?.mcqs ?? []) {
    if (m.question?.trim()) questions.push(m.question);
    const ref = normalizeSopReference(m.sopReference);
    if (ref) refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
  }
  return { questions, refCounts };
}

function recordAcceptedMcq(
  q: GeneratedMCQ,
  seenQuestions: string[],
  refCounts: Map<string, number>,
): void {
  seenQuestions.push(q.question);
  const ref = normalizeSopReference(q.sopReference);
  if (ref) refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
}

function syncInsertedMcqs(
  candidates: GeneratedMCQ[],
  insertedTexts: string[],
  seenQuestions: string[],
  refCounts: Map<string, number>,
  acceptedThisRun: GeneratedMCQ[],
): void {
  const pending = new Set(insertedTexts);
  for (const q of candidates) {
    if (!pending.has(q.question)) continue;
    pending.delete(q.question);
    recordAcceptedMcq(q, seenQuestions, refCounts);
    acceptedThisRun.push(q);
  }
}

function isAcceptableMcq(
  q: GeneratedMCQ,
  seenQuestions: string[],
  refCounts: Map<string, number>,
): boolean {
  if (!q?.question?.trim()) return false;
  if (seenQuestions.some((eq) => isDuplicateMcqQuestion(q.question, eq))) return false;
  const ref = normalizeSopReference(q.sopReference);
  if (ref && (refCounts.get(ref) ?? 0) >= MAX_QUESTIONS_PER_CLAUSE) return false;
  return true;
}

/** Token-cheap hint: clause list + a few short stems instead of full prior questions. */
function buildAvoidHint(
  accepted: GeneratedMCQ[],
): string {
  if (!accepted.length) return "";

  const refs = [...new Set(
    accepted
      .map((q) => (q.sopReference ?? "").trim())
      .filter(Boolean),
  )].slice(-MCQ_AVOID_MAX_CLAUSES);

  const refPart = refs.length
    ? `\nAlready-covered clauses (pick different sections): ${refs.join(", ")}`
    : "";

  const stems = accepted
    .slice(-MCQ_AVOID_STEMS)
    .map((q) => {
      const stem = q.question.replace(/\s+/g, " ").trim();
      return stem.length > MCQ_AVOID_STEM_CHARS
        ? `${stem.slice(0, MCQ_AVOID_STEM_CHARS)}…`
        : stem;
    });

  const stemPart = stems.length
    ? `\nAvoid similar stems:\n- ${stems.join("\n- ")}`
    : "";

  return refPart + stemPart;
}

/** Generate MCQs for one language in batches. Calls `onBatchDone` after every
 *  batch with the new unique questions so the caller can write them to the bank
 *  immediately — MCQs land in the DB after each batch, not at the end. */
async function generateForLanguage(
  sop: ISOP,
  language: "English" | "Gujarati",
  bankCountAtStart: number,
  dedupAtStart: BankDedupState,
  ctx: RunCtx,
  onBatchDone: (p: {
    batchesDone: number;
    newMcqs: GeneratedMCQ[];
  }) => Promise<{ bankTotal: number; insertedTexts: string[] }>,
  provider?: LlmProvider,
): Promise<void> {
  if (bankCountAtStart >= MCQ_BANK_CAP) return;

  const seenQuestions = [...dedupAtStart.questions];
  const refCounts = new Map(dedupAtStart.refCounts);
  const acceptedThisRun: GeneratedMCQ[] = [];
  let bankTotal = bankCountAtStart;
  let emptyBatchStreak = 0;

  const contentLimit = provider === "ollama" ? MCQ_CONTENT_LIMIT_OLLAMA : MCQ_CONTENT_LIMIT;
  const normalizedLen = normalizeSopTextForMcq(sop.content).length;
  const useChunks = normalizedLen > contentLimit;
  const providerLabel =
    provider === "ollama" ? "Ollama (gemma3:12b)" :
    provider === "claude" ? `Claude CLI (${getMcqClaudeModel()})` :
    "Gemini";

  for (let batch = 0; batch < MCQ_MAX_BATCHES && bankTotal < MCQ_BANK_CAP; batch++) {
    const batchNeed = Math.min(MCQ_BATCH_SIZE, MCQ_BANK_CAP - bankTotal);
    if (batchNeed <= 0) break;

    const avoid = buildAvoidHint(acceptedThisRun);
    const excerpt = mcqPromptSopExcerpt(sop.content, batch, contentLimit, MCQ_CONTENT_CHUNKS);
    const sectionNote = useChunks
      ? `\n(SOP section ${(batch % MCQ_CONTENT_CHUNKS) + 1}/${MCQ_CONTENT_CHUNKS} — focus on untested parts.)`
      : "";

    const userPrompt = `Language: ${language}
SOP: ${sop.identifier} · ${sop.department}
Generate exactly ${batchNeed} NEW unique MCQs — each from a different clause.${sectionNote}${avoid}

SOP TEXT:
${excerpt}`;

    await pushLog(
      sop.identifier,
      `${language} · batch ${batch + 1}/${MCQ_MAX_BATCHES} → querying ${providerLabel} (${bankTotal}/${MCQ_BANK_CAP} in bank)…`,
    );

    let questions: GeneratedMCQ[];
    try {
      let result: { questions: GeneratedMCQ[] } | undefined;
      const maxAttempts = provider === "claude" ? CLAUDE_BATCH_ATTEMPTS : 1;
      let lastBatchErr: unknown;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          if (provider === "ollama") {
            result = await generateOllamaJson<{ questions: GeneratedMCQ[] }>(MCQ_SYSTEM_PROMPT, userPrompt);
          } else if (provider === "claude") {
            result = await generateClaudeCliJson<{ questions: GeneratedMCQ[] }>(
              MCQ_SYSTEM_PROMPT,
              userPrompt,
              getMcqClaudeModel(),
            );
          } else {
            result = await generateJson<{ questions: GeneratedMCQ[] }>(MCQ_SYSTEM_PROMPT, userPrompt, MCQ_GEN_OPTIONS);
          }
          lastBatchErr = undefined;
          break;
        } catch (err) {
          lastBatchErr = err;
          if (provider === "claude" && attempt < maxAttempts - 1) {
            const errMsg = err instanceof Error ? err.message.slice(0, 100) : String(err).slice(0, 100);
            await pushLog(
              sop.identifier,
              `${language} · batch ${batch + 1} attempt ${attempt + 1} failed — retrying (${errMsg})`,
            );
            continue;
          }
          throw err;
        }
      }

      if (!result) throw lastBatchErr ?? new Error("MCQ batch failed");
      questions = result.questions ?? [];
    } catch (err) {
      ctx.failedBatches++;
      const errMsg = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      if (provider !== "ollama" && provider !== "claude" && isGeminiOverloadedError(err)) {
        ctx.overloadHits++;
        await pushLog(sop.identifier, `${language} · batch ${batch + 1}: Gemini overloaded (503) — hit ${ctx.overloadHits}/${MCQ_MAX_OVERLOAD_ABORT}`);
        console.warn(`[mcq-gen] ${sop.identifier} (${language}) batch ${batch + 1}: overloaded — ${ctx.overloadHits}/${MCQ_MAX_OVERLOAD_ABORT}`);
        if (ctx.overloadHits >= MCQ_MAX_OVERLOAD_ABORT) {
          throw new OverloadAbortError(
            "Gemini is overloaded (503). Aborted to avoid wasted API calls — please retry in a few minutes.",
          );
        }
        break;
      }
      await pushLog(sop.identifier, `${language} · batch ${batch + 1} failed — ${errMsg}`);
      console.error(`[mcq-gen] ${sop.identifier} (${language}) batch ${batch + 1} failed:`, err);
      break;
    }

    if (!questions.length) {
      await pushLog(sop.identifier, `${language} · batch ${batch + 1}: empty response — stopping`);
      break;
    }

    const candidates: GeneratedMCQ[] = [];
    const batchSeen = [...seenQuestions];
    const batchRefCounts = new Map(refCounts);
    for (const q of questions) {
      if (candidates.length >= batchNeed) break;
      if (!isAcceptableMcq(q, batchSeen, batchRefCounts)) continue;
      batchSeen.push(q.question);
      const ref = normalizeSopReference(q.sopReference);
      if (ref) batchRefCounts.set(ref, (batchRefCounts.get(ref) ?? 0) + 1);
      candidates.push(q);
    }

    const prevBankTotal = bankTotal;
    const batchResult = await onBatchDone({ batchesDone: batch + 1, newMcqs: candidates });
    bankTotal = batchResult.bankTotal;
    syncInsertedMcqs(
      candidates,
      batchResult.insertedTexts,
      seenQuestions,
      refCounts,
      acceptedThisRun,
    );
    const inserted = bankTotal - prevBankTotal;

    console.log(
      `[mcq-gen] ${sop.identifier} (${language}) batch ${batch + 1}: +${inserted} in bank (${candidates.length} candidates, ${bankTotal}/${MCQ_BANK_CAP})`,
    );

    if (bankTotal >= MCQ_BANK_CAP) {
      await pushLog(sop.identifier, `${language} · reached ${MCQ_BANK_CAP} MCQs — stopping`);
      break;
    }

    if (inserted === 0) {
      emptyBatchStreak++;
      await pushLog(
        sop.identifier,
        `${language} · batch ${batch + 1}: no new unique MCQs (${emptyBatchStreak}/${MCQ_MAX_EMPTY_BATCHES})`,
      );
      if (emptyBatchStreak >= MCQ_MAX_EMPTY_BATCHES) {
        await pushLog(sop.identifier, `${language} · too many duplicate batches — stopping at ${bankTotal}/${MCQ_BANK_CAP}`);
        break;
      }
      continue;
    }

    emptyBatchStreak = 0;
  }
}

/** Pick the best SOP record per language for generation (DOCX preferred over PDF). */
function representativesByLanguage(sops: ISOP[]): Map<"English" | "Gujarati", ISOP> {
  const byLang = new Map<"English" | "Gujarati", ISOP>();
  for (const s of sops) {
    const lang = (s.language ?? "English") as "English" | "Gujarati";
    const cur = byLang.get(lang);
    if (!cur || scoreSopRecordForMcq(s) > scoreSopRecordForMcq(cur)) byLang.set(lang, s);
  }
  return byLang;
}

/** Resolve generate-vs-regenerate (or honour an explicit "continue"), reset the
 *  progress job to "queued", and kick off the background run. The HTTP route
 *  awaits only this (fast) part; the client polls for live progress. */
export async function enqueueMcqGeneration(
  identifier: string,
  provider?: LlmProvider,
  modeOverride?: McqGenMode,
  languageScope?: McqGenLanguage,
): Promise<{
  identifier: string;
  mode: McqGenMode;
  languageScope?: McqGenLanguage;
  status: "queued";
}> {
  await connectDB();
  const idRegex = escapeId(identifier);
  const exists = await SOP.exists({ identifier: idRegex });
  if (!exists) throw new Error(`SOP not found: ${identifier}`);

  let mode: McqGenMode;
  if (modeOverride) {
    mode = modeOverride;
  } else if (languageScope) {
    const hasLang = await hasActiveBankForLang(identifier, languageScope);
    mode = hasLang ? "regenerate" : "generate";
  } else {
    const hasActive = await MCQBank.exists({ sopIdentifier: idRegex, isObsolete: { $ne: true } });
    mode = hasActive ? "regenerate" : "generate";
  }

  const inFlight = await MCQGenJob.findOne({ identifier, status: { $in: ["queued", "running"] } }).lean();
  if (inFlight) {
    throw new Error(`MCQ generation already in progress for ${identifier}`);
  }

  await MCQGenJob.findOneAndUpdate(
    { identifier },
    {
      $set: {
        identifier,
        mode,
        languageScope: languageScope ?? null,
        status: "queued",
        phase: "Queued",
        percent: 0,
        languages: [],
        totalInserted: 0,
        totalSkipped: 0,
        totalFailedBatches: 0,
        error: null,
        startedAt: new Date(),
        finishedAt: null,
      },
    },
    { upsert: true },
  );

  triggerMcqGenerationAsync(identifier, mode, provider, languageScope);
  return { identifier, mode, languageScope, status: "queued" };
}

export async function runMcqGeneration(
  identifier: string,
  modeArg?: McqGenMode,
  provider?: LlmProvider,
  languageScope?: McqGenLanguage,
): Promise<{ identifier: string; totalApproved: number; totalRecycled: number }> {
  await connectDB();

  const sops = await SOP.find({ identifier: escapeId(identifier) });
  if (!sops.length) {
    await MCQGenJob.findOneAndUpdate(
      { identifier },
      {
        $set: {
          identifier,
          mode: modeArg ?? "generate",
          status: "failed",
          phase: "SOP not found",
          error: `SOP not found: ${identifier}`,
          finishedAt: new Date(),
        },
      },
      { upsert: true },
    );
    throw new Error(`SOP not found: ${identifier}`);
  }

  const sopIds = sops.map((s) => s._id.toString());
  const idRegex = escapeId(identifier);

  // Authoritative mode: regenerate when an active bank already exists.
  let mode = modeArg;
  if (!mode) {
    const hasActive = await MCQBank.exists({ sopIdentifier: idRegex, isObsolete: { $ne: true } });
    mode = hasActive ? "regenerate" : "generate";
  }

  const reps = representativesByLanguage(sops);
  let eligible = [...reps.entries()].filter(([, sop]) => scoreSopRecordForMcq(sop) >= 50);
  if (languageScope) {
    eligible = eligible.filter(([lang]) => lang === languageScope);
  }

  // No language has readable text — the stored content is an image-only PDF or a
  // failed extraction. Generating from it just yields generic, ungrounded MCQs,
  // so fail fast with an actionable message instead of producing junk.
  if (!eligible.length) {
    await MCQGenJob.findOneAndUpdate(
      { identifier },
      {
        $set: {
          identifier,
          mode,
          languageScope: languageScope ?? null,
          status: "failed",
          phase: "No readable SOP content",
          percent: 0,
          error:
            languageScope
              ? `No readable ${languageScope} SOP text found (image-only PDF or failed extraction). Upload a text-based DOCX/PDF, then try again.`
              : "No readable SOP text found (the stored content is an image-only PDF or failed extraction). " +
                "Upload a text-based DOCX/PDF for this SOP, then regenerate.",
          finishedAt: new Date(),
        },
      },
      { upsert: true },
    );
    await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "failed" });
    throw new Error("No readable SOP content to generate from");
  }

  const langProgress: IMcqGenLangProgress[] = eligible.map(([lang]) => ({
    language: lang,
    status: "pending",
    batchesDone: 0,
    batchesTotal: MCQ_MAX_BATCHES,
    collected: 0,
    target: MCQ_BANK_CAP,
    inserted: 0,
    skipped: 0,
  }));

  const ctx: RunCtx = { overloadHits: 0, failedBatches: 0 };

  const persist = async (extra: Record<string, unknown> = {}) => {
    await MCQGenJob.updateOne(
      { identifier },
      {
        $set: {
          identifier,
          mode,
          languages: langProgress,
          percent: overallPercent(langProgress),
          totalFailedBatches: ctx.failedBatches,
          updatedAt: new Date(),
          ...extra,
        },
      },
      { upsert: true },
    );
  };

  await MCQGenJob.findOneAndUpdate(
    { identifier },
    {
      $set: {
        identifier,
        mode,
        languageScope: languageScope ?? null,
        status: "running",
        phase: mode === "regenerate" ? "Regenerating — starting…" : mode === "continue" ? "Continuing — starting…" : "Generating — starting…",
        percent: 0,
        languages: langProgress,
        totalInserted: 0,
        totalSkipped: 0,
        totalFailedBatches: 0,
        error: null,
        startedAt: new Date(),
        finishedAt: null,
      },
    },
    { upsert: true },
  );

  await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "mcq_generating" });

  const providerLabel =
    provider === "ollama" ? "Ollama (gemma3:12b)" :
    provider === "claude" ? `Claude CLI (${getMcqClaudeModel()})` :
    "Gemini";
  const langLabels = eligible.map(([lang]) => lang).join(" + ");
  await pushLog(identifier, `Starting ${mode} · ${langLabels} · provider: ${providerLabel}`);
  await pushLog(identifier, `Target: ${MCQ_BANK_CAP} MCQs/language · up to ${MCQ_MAX_BATCHES} batches of ${MCQ_BATCH_SIZE}`);

  let totalApproved = 0;
  let totalRecycled = 0;
  const verb = mode === "regenerate" ? "Regenerating" : mode === "continue" ? "Continuing" : "Generating";

  try {
    for (const lp of langProgress) {
      const sop = reps.get(lp.language)!;
      lp.status = "running";

      // For regenerate: archive the old bank upfront so new MCQs start landing
      // in a fresh bank immediately. "continue" skips this — it appends to the
      // existing bank without touching the old questions.
      if (mode === "regenerate") {
        const archived = await archiveBankForSop(sop, lp.language);
        if (archived > 0) {
          await pushLog(identifier, `${lp.language} · archived ${archived} existing bank(s) — generating fresh set`);
        }
      }

      let bankCountAtStart =
        mode === "regenerate" ? 0 : await activeBankCount(identifier, lp.language);
      const dedupAtStart =
        mode === "regenerate"
          ? { questions: [] as string[], refCounts: new Map<string, number>() }
          : await loadBankDedupState(identifier, lp.language);
      if (bankCountAtStart >= MCQ_BANK_CAP) {
        lp.status = "done";
        lp.collected = bankCountAtStart;
        await pushLog(identifier, `${lp.language} · already at ${MCQ_BANK_CAP} MCQs — skipping`);
        await persist({ totalInserted: totalApproved, totalSkipped: totalRecycled });
        continue;
      }

      await persist({ phase: `${verb} ${lp.language} — batch 0/${MCQ_MAX_BATCHES}` });

      const langSopIds = sops
        .filter((s) => ((s.language ?? "English") as string) === lp.language)
        .map((s) => s._id);

      await generateForLanguage(
        sop,
        lp.language,
        bankCountAtStart,
        dedupAtStart,
        ctx,
        async ({ batchesDone, newMcqs }) => {
          const { inserted: batchInserted, skipped: batchSkipped, total: bankTotal, insertedQuestions } =
            await appendGeneratedToBank(sop, lp.language, newMcqs, resolveMcqAiModel(provider));

          lp.batchesDone = batchesDone;
          lp.collected = bankTotal;
          lp.inserted += batchInserted;
          lp.skipped += batchSkipped;
          totalApproved += batchInserted;
          totalRecycled += batchSkipped;

          await pushLog(
            identifier,
            `${lp.language} · batch ${batchesDone} done — +${batchInserted} new → ${bankTotal}/${MCQ_BANK_CAP} in bank`,
          );
          await persist({
            phase: `${verb} ${lp.language} — batch ${batchesDone}/${MCQ_MAX_BATCHES} · ${bankTotal}/${MCQ_BANK_CAP} MCQs`,
            totalInserted: totalApproved,
            totalSkipped: totalRecycled,
          });

          await SOP.updateMany({ _id: { $in: langSopIds } }, { mcqCount: bankTotal });
          return { bankTotal, insertedTexts: insertedQuestions };
        },
        provider,
      );

      lp.status = "done";
      await pushLog(identifier, `${lp.language} · complete — ${lp.inserted} MCQs in bank, ${lp.skipped} skipped`);
      await persist({ totalInserted: totalApproved, totalSkipped: totalRecycled });
    }

    await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "updating_platform" });
    await SOP.updateMany(
      { _id: { $in: sopIds } },
      { pipelineStatus: "approved", status: "completed" },
    );

    await MCQGenJob.updateOne(
      { identifier },
      {
        $set: {
          status: "completed",
          phase: `Done — +${totalApproved} MCQs added (${mode})`,
          percent: 100,
          languages: langProgress,
          totalInserted: totalApproved,
          totalSkipped: totalRecycled,
          totalFailedBatches: ctx.failedBatches,
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    console.log(
      `[mcq-gen] ${identifier} ${mode} complete — inserted ${totalApproved}, skipped ${totalRecycled}, failed batches ${ctx.failedBatches}`,
    );
    invalidateDashboardSopsCache();
    return { identifier, totalApproved, totalRecycled };
  } catch (error) {
    const overloaded = error instanceof OverloadAbortError || isGeminiOverloadedError(error);
    await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "failed" });
    for (const lp of langProgress) if (lp.status === "running") lp.status = "failed";
    await MCQGenJob.updateOne(
      { identifier },
      {
        $set: {
          status: "failed",
          phase: overloaded ? "Aborted — service overloaded (503)" : "Failed",
          error: error instanceof Error ? error.message : String(error),
          languages: langProgress,
          totalInserted: totalApproved,
          totalSkipped: totalRecycled,
          totalFailedBatches: ctx.failedBatches,
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
    throw error;
  }
}

export function triggerMcqGenerationAsync(
  identifier: string,
  mode?: McqGenMode,
  provider?: LlmProvider,
  languageScope?: McqGenLanguage,
) {
  runMcqGeneration(identifier, mode, provider, languageScope).catch((err) => {
    console.error(`MCQ generation failed for ${identifier}:`, err);
  });
}
