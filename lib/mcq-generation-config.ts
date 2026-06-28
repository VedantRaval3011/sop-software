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
  provider?: LlmProvider,
): boolean {
  if (!mcqFastFillEnabled()) return false;
  // Codex CLI is slow per call — always use bulk excerpt fill (not clause-by-clause).
  if (provider === "codex") {
    return mode === "continue" || bankAtStart > 0 || gap >= 1;
  }
  if (mcqClausePhaseEnabled() && mode === "generate" && bankAtStart === 0) return false;
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
  if (provider === "codex") {
    return Number(process.env.MCQ_CLAUSES_PER_CALL_CODEX) || 5;
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
  if (provider === "codex") {
    return Math.min(Number(process.env.MCQ_LEGACY_BATCH_CODEX) || 20, room);
  }
  if (provider === "ollama") {
    return Math.min(Number(process.env.MCQ_LEGACY_BATCH_OLLAMA) || 20, room);
  }
  return Math.min(Number(process.env.MCQ_LEGACY_BATCH_GEMINI) || 25, room);
}

export function maxLegacyBatches(gap = 100, batchSize = 12): number {
  const envCap = Number(process.env.MCQ_MAX_LEGACY_BATCHES) || 0;
  // Plan enough rounds to reach 100 even when batches yield few MCQs after dedup.
  const conservativeYield = Math.max(1, Math.floor(batchSize * 0.5));
  const estimated = Math.ceil(gap / conservativeYield) + 4;
  const hardCap = 40;
  if (envCap > 0) return Math.min(hardCap, Math.max(envCap, estimated));
  return Math.min(hardCap, Math.max(12, estimated));
}

/** Smaller batches in creative fill — easier to land unique scenario questions near the cap. */
export function creativeBatchSize(provider?: LlmProvider, gap = 10): number {
  const room = Math.max(1, gap);
  if (room <= 5) return room;
  return Math.min(legacyBatchSize(provider, gap), 8);
}

export function maxCreativeBatches(gap = 10): number {
  const envCap = Number(process.env.MCQ_MAX_CREATIVE_BATCHES) || 0;
  const estimated = Math.max(10, gap * 4);
  const hardCap = 24;
  if (envCap > 0) return Math.min(hardCap, Math.max(envCap, estimated));
  return Math.min(hardCap, estimated);
}

export function mcqContentLimitClaude(): number {
  return Number(process.env.MCQ_CONTENT_LIMIT_CLAUDE) || 6_000;
}

export function mcqContentLimitCodex(): number {
  return Number(process.env.MCQ_CONTENT_LIMIT_CODEX) || 6_000;
}

/** Fact-based MCQ pipeline (extract facts → one MCQ per fact). Default on for Codex. */
export function shouldUseFactPipeline(provider?: LlmProvider): boolean {
  const v = process.env.MCQ_USE_FACT_PIPELINE?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  if (v === "1" || v === "true" || v === "yes") return true;
  return provider === "codex";
}

/** Facts sent per MCQ-generation API call in the fact pipeline. */
export function factsPerMcqBatch(provider?: LlmProvider): number {
  if (provider === "codex") {
    return Number(process.env.MCQ_FACTS_PER_BATCH_CODEX) || 15;
  }
  return Number(process.env.MCQ_FACTS_PER_BATCH) || 15;
}

/** Max small repair rounds at end of fact pipeline. */
export function maxFactRepairBatches(): number {
  return Number(process.env.MCQ_MAX_FACT_REPAIR_BATCHES) || 4;
}
