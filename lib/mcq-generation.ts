import SOP, { type ISOP } from "@/models/SOP";
import MCQBank from "@/models/MCQBank";
import MCQGenJob, { type McqGenMode, type IMcqGenLangProgress } from "@/models/MCQGenJob";
import { generateJson, isGeminiOverloadedError } from "@/lib/gemini";
import { invalidateDashboardSopsCache } from "@/lib/server-cache";
import { connectDB } from "@/lib/mongodb";
import { replaceBankForSop } from "@/lib/mcq-bank-write";
import { isSimilarQuestion } from "@/lib/similarity";

/** Each SOP/language bank must hold at least this many MCQs. */
export const MCQ_TARGET_PER_LANGUAGE = 100;
/** Gemini's 16K output cap can't fit ~100 MCQs in one response, so we generate in
 *  batches and accumulate (deduping) until the target is met. */
const MCQ_BATCH_SIZE = 25;
/** Safety cap so a model that keeps returning near-duplicates can't loop forever
 *  (8 × 25 = up to 200 generated to net 100 unique). */
const MCQ_MAX_BATCHES = 8;
/** How many recent questions to show the model as "avoid these" context. Kept
 *  small on purpose — the previous value (60) bloated input tokens every batch
 *  while local dedup already guarantees uniqueness. */
const MCQ_AVOID_WINDOW = 20;
/** Abort the whole run after this many fully-overloaded (503) batches. Hammering
 *  an overloaded service just burns quota without producing MCQs. */
const MCQ_MAX_OVERLOAD_ABORT = 2;
/** Per-call retry budget for MCQ generation: a couple of quick tries, and bail
 *  fast on 503 so we don't trigger the escalating-backoff storm. */
const MCQ_GEN_OPTIONS = { maxAttempts: 2, fastFail503: true } as const;

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

const MCQ_SYSTEM_PROMPT = `You are a pharmaceutical GMP training expert. Generate multiple-choice questions from the provided SOP text.
Return ONLY valid JSON with this shape:
{
  "questions": [
    {
      "question": "...",
      "optionA": "...",
      "optionB": "...",
      "optionC": "...",
      "optionD": "...",
      "correctAnswer": "A"|"B"|"C"|"D",
      "explanation": "...",
      "difficulty": "easy"|"medium"|"hard",
      "topic": "...",
      "sopReference": "..."
    }
  ]
}
Rules:
- Cover all major topics in the document
- Difficulty mix: ~40% easy, ~40% medium, ~20% hard
- Questions must be answerable from the SOP text only
- No duplicate or near-duplicate questions
- "sopReference" is REQUIRED for every question: cite the exact SOP section/clause
  the question is derived from. Use the numbered clause exactly as it appears in
  the text (e.g. "4.6.1.4", "5.2.1"). Only if that section has no number in the
  text, use its heading (e.g. "Responsibility"). Never leave it blank or invent a
  number that is not present in the SOP text.`;

/** Thrown when the run aborts because the model service is overloaded (503). The
 *  caller maps it to a friendly "retry in a few minutes" job status. */
class OverloadAbortError extends Error {}

/** Mutable per-run bookkeeping shared across languages/batches. */
interface RunCtx {
  overloadHits: number;
  failedBatches: number;
}

function escapeId(identifier: string): RegExp {
  return new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

/** Overall completion driven by how close each language is to its target. */
function overallPercent(langs: IMcqGenLangProgress[]): number {
  const totalTarget = langs.reduce((s, l) => s + (l.target || 0), 0) || 1;
  const done = langs.reduce((s, l) => s + Math.min(l.collected, l.target), 0);
  return Math.min(100, Math.round((done / totalTarget) * 100));
}

/** Generate at least `target` unique MCQs for one language, in batches. Each batch
 *  is told which questions already exist (a small recent window) so the model
 *  produces fresh ones; survivors are deduped locally. Reports progress per batch
 *  and stops early when a batch yields no new uniques (saves API calls). */
async function generateForLanguage(
  sop: ISOP,
  language: "English" | "Gujarati",
  target: number,
  ctx: RunCtx,
  onProgress: (p: { batchesDone: number; collected: number }) => Promise<void>,
): Promise<GeneratedMCQ[]> {
  const collected: GeneratedMCQ[] = [];
  const content = sop.content.slice(0, 80000);

  for (let batch = 0; batch < MCQ_MAX_BATCHES && collected.length < target; batch++) {
    const avoid = collected.length
      ? `\n\nThese questions already exist — do NOT repeat or rephrase any of them:\n- ${collected
          .slice(-MCQ_AVOID_WINDOW)
          .map((q) => q.question)
          .join("\n- ")}`
      : "";

    const userPrompt = `Language: ${language}
SOP Identifier: ${sop.identifier}
Department: ${sop.department}
Generate exactly ${MCQ_BATCH_SIZE} NEW unique MCQs covering different details of the SOP.${avoid}

SOP CONTENT:
${content}`;

    let questions: GeneratedMCQ[];
    try {
      const result = await generateJson<{ questions: GeneratedMCQ[] }>(
        MCQ_SYSTEM_PROMPT,
        userPrompt,
        MCQ_GEN_OPTIONS,
      );
      questions = result.questions ?? [];
    } catch (err) {
      ctx.failedBatches++;
      // A 503/overload means the service is busy. Don't keep hammering it — count
      // the hit and abort the whole run once we've seen enough.
      if (isGeminiOverloadedError(err)) {
        ctx.overloadHits++;
        console.warn(
          `[mcq-gen] ${sop.identifier} (${language}) batch ${batch + 1}: service overloaded (503) — hit ${ctx.overloadHits}/${MCQ_MAX_OVERLOAD_ABORT}`,
        );
        if (ctx.overloadHits >= MCQ_MAX_OVERLOAD_ABORT) {
          throw new OverloadAbortError(
            "Gemini is overloaded (503). Aborted to avoid wasted API calls — please retry in a few minutes.",
          );
        }
        break;
      }
      // Other errors (rate limit / parse / connection) — keep the good partial set.
      console.error(`[mcq-gen] ${sop.identifier} (${language}) batch ${batch + 1} failed:`, err);
      break;
    }

    if (!questions.length) break;

    let added = 0;
    for (const q of questions) {
      if (!q?.question?.trim()) continue;
      if (collected.some((c) => isSimilarQuestion(q.question, c.question))) continue;
      collected.push(q);
      added++;
    }

    await onProgress({ batchesDone: batch + 1, collected: collected.length });
    console.log(
      `[mcq-gen] ${sop.identifier} (${language}) batch ${batch + 1}/${MCQ_MAX_BATCHES}: +${added} new (total ${collected.length}/${target})`,
    );

    // The model is recycling questions it was told to avoid — further batches
    // would just cost API calls for near-duplicates. Stop here.
    if (added === 0) {
      console.log(`[mcq-gen] ${sop.identifier} (${language}) batch ${batch + 1}: all duplicates — stopping early`);
      break;
    }
  }

  return collected;
}

/** Score a record's content for generation usefulness. Raw PDF bytes (image-only
 *  PDFs stored unextracted) and placeholder strings are useless to the model — a
 *  short clean DOCX must win over a giant binary PDF blob. Returns 0 for unusable
 *  content; otherwise the readable length (so the most complete text wins). */
function contentQuality(content?: string): number {
  if (!content) return 0;
  const c = content.trim();
  // "%PDF" = raw, unextracted PDF; "[" = a placeholder like "[image-only PDF…]".
  if (!c || c.startsWith("%PDF") || c.startsWith("[")) return 0;
  const readable = (c.match(/[A-Za-z0-9 .,():;\/-]/g)?.length ?? 0) / c.length;
  if (readable < 0.6) return 0; // mostly binary/garbage extraction
  return c.length;
}

/** Keep one representative SOP record per language — the one with the best
 *  READABLE content (not merely the longest, which would pick a raw image-only
 *  PDF over a clean DOCX) so we generate one MCQ bank per (SOP family, language). */
function representativesByLanguage(sops: ISOP[]): Map<"English" | "Gujarati", ISOP> {
  const byLang = new Map<"English" | "Gujarati", ISOP>();
  for (const s of sops) {
    const lang = (s.language ?? "English") as "English" | "Gujarati";
    const cur = byLang.get(lang);
    if (!cur || contentQuality(s.content) > contentQuality(cur.content)) byLang.set(lang, s);
  }
  return byLang;
}

/** Resolve generate-vs-regenerate, reset the progress job to "queued", and kick
 *  off the background run. The HTTP route awaits only this (fast) part, then the
 *  client polls the job status — so the request never blocks on generation. */
export async function enqueueMcqGeneration(identifier: string): Promise<{
  identifier: string;
  mode: McqGenMode;
  status: "queued";
}> {
  await connectDB();
  const idRegex = escapeId(identifier);
  const exists = await SOP.exists({ identifier: idRegex });
  if (!exists) throw new Error(`SOP not found: ${identifier}`);

  const hasActive = await MCQBank.exists({ sopIdentifier: idRegex, isObsolete: { $ne: true } });
  const mode: McqGenMode = hasActive ? "regenerate" : "generate";

  await MCQGenJob.findOneAndUpdate(
    { identifier },
    {
      $set: {
        identifier,
        mode,
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

  triggerMcqGenerationAsync(identifier, mode);
  return { identifier, mode, status: "queued" };
}

export async function runMcqGeneration(
  identifier: string,
  modeArg?: McqGenMode,
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
  const eligible = [...reps.entries()].filter(([, sop]) => contentQuality(sop.content) >= 50);

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
          status: "failed",
          phase: "No readable SOP content",
          percent: 0,
          error:
            "No readable SOP text found (the stored content is an image-only PDF or failed extraction). " +
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
    target: MCQ_TARGET_PER_LANGUAGE,
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
        status: "running",
        phase: mode === "regenerate" ? "Regenerating — starting…" : "Generating — starting…",
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

  let totalApproved = 0;
  let totalRecycled = 0;
  const verb = mode === "regenerate" ? "Regenerating" : "Generating";

  try {
    for (const lp of langProgress) {
      const sop = reps.get(lp.language)!;
      lp.status = "running";
      await persist({ phase: `${verb} ${lp.language} — batch 0/${MCQ_MAX_BATCHES}` });

      const collected = await generateForLanguage(
        sop,
        lp.language,
        MCQ_TARGET_PER_LANGUAGE,
        ctx,
        async (p) => {
          lp.batchesDone = p.batchesDone;
          lp.collected = p.collected;
          await persist({
            phase: `${verb} ${lp.language} — batch ${p.batchesDone}/${MCQ_MAX_BATCHES} (${p.collected} MCQs)`,
          });
        },
      );

      await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "similarity_checking" });
      await persist({ phase: `Saving ${lp.language} bank (${collected.length} MCQs)…` });

      // replaceBankForSop archives the current active bank to Obsolete MCQs and
      // installs a fresh one. If nothing usable was generated it leaves the
      // existing bank untouched (no data loss on an overloaded run).
      const { inserted, skipped } = await replaceBankForSop(sop, lp.language, collected);
      lp.inserted = inserted;
      lp.skipped = skipped;
      lp.status = "done";
      totalApproved += inserted;
      totalRecycled += skipped;

      // Reflect this language's bank total on every record of this identifier+language
      // so the Dashboard "X questions" column stays in sync.
      const bankTotal = await MCQBank.findOne({ sopIdentifier: idRegex, language: lp.language })
        .select("totalQuestions")
        .lean();
      const langSopIds = sops
        .filter((s) => ((s.language ?? "English") as string) === lp.language)
        .map((s) => s._id);
      await SOP.updateMany(
        { _id: { $in: langSopIds } },
        { mcqCount: bankTotal?.totalQuestions ?? inserted },
      );

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
          phase: `Done — ${totalApproved} MCQs (${mode})`,
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

export function triggerMcqGenerationAsync(identifier: string, mode?: McqGenMode) {
  runMcqGeneration(identifier, mode).catch((err) => {
    console.error(`MCQ generation failed for ${identifier}:`, err);
  });
}
