import type { LlmProvider } from "@/lib/llm";
import { anthropicMcqApiAvailable } from "@/lib/anthropic-mcq";

/** Bulk excerpt fill is ~5–10× faster than one API call per clause. Default: on. */
export function mcqFastFillEnabled(): boolean {
  const v = process.env.MCQ_FAST_FILL?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  if (v === "1" || v === "true" || v === "yes") return true;
  return true;
}

/** Clause-wise phase (slower, more targeted). Only when fast fill is off and fresh generate. */
export function mcqClausePhaseEnabled(): boolean {
  const v = process.env.MCQ_USE_CLAUSE_PHASE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function shouldUseFastFill(
  mode: "generate" | "regenerate" | "continue",
  bankAtStart: number,
  gap: number,
): boolean {
  if (!mcqFastFillEnabled()) return false;
  if (mcqClausePhaseEnabled() && mode === "generate" && bankAtStart === 0) return false;
  // Continue, top-up, or any run that mainly needs to reach 100 → bulk excerpts.
  return mode === "continue" || bankAtStart > 0 || gap >= 10;
}

export function clausesPerCall(provider?: LlmProvider): number {
  const base = Number(process.env.MCQ_CLAUSES_PER_CALL) || 15;
  if (provider === "claude") {
    if (anthropicMcqApiAvailable()) {
      return Number(process.env.MCQ_CLAUSES_PER_CALL_API) || 12;
    }
    return Number(process.env.MCQ_CLAUSES_PER_CALL_CLI) || 5;
  }
  return base;
}

/** MCQs requested per legacy/excerpt API call. */
export function legacyBatchSize(provider?: LlmProvider, gap = 100): number {
  const room = Math.max(1, gap);
  if (provider === "claude") {
    if (anthropicMcqApiAvailable()) {
      return Math.min(Number(process.env.MCQ_LEGACY_BATCH_API) || 40, room);
    }
    return Math.min(Number(process.env.MCQ_LEGACY_BATCH_CLI) || 15, room);
  }
  if (provider === "ollama") {
    return Math.min(Number(process.env.MCQ_LEGACY_BATCH_OLLAMA) || 20, room);
  }
  return Math.min(Number(process.env.MCQ_LEGACY_BATCH_GEMINI) || 25, room);
}

export function maxLegacyBatches(): number {
  return Number(process.env.MCQ_MAX_LEGACY_BATCHES) || 8;
}

export function mcqContentLimitClaude(): number {
  return Number(process.env.MCQ_CONTENT_LIMIT_CLAUDE) || 6_000;
}
