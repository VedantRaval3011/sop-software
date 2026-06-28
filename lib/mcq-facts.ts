import {
  extractCompleteObjects,
  extractJsonPayload,
  repairTruncatedJson,
  stripMarkdownFences,
} from "@/lib/llm-utils";
import { isMetadataOnlyMcq } from "@/lib/mcq-generation-prompts";
import { isDuplicateMcqQuestionForGeneration } from "@/lib/similarity";
import type { ParsedMcq } from "@/lib/mcq-json-parse";

export interface SopFact {
  id: string;
  topic: string;
  fact: string;
}

export type McqQuestionCategory = "recall" | "scenario" | "application";

export interface FactMcq extends ParsedMcq {
  factId?: string;
  questionCategory?: McqQuestionCategory;
}

export const MAX_QUESTIONS_PER_FACT = 2;
export const MAX_QUESTIONS_PER_TOPIC = 2;

const FACT_ID_NUMERIC_RE = /^F\d{3,}$/i;
const FACT_ID_SEMANTIC_RE = /^[A-Z][A-Z0-9_]{2,}$/;

export function isFactId(value: string): boolean {
  const v = value.trim();
  return FACT_ID_NUMERIC_RE.test(v) || FACT_ID_SEMANTIC_RE.test(v);
}

/** Normalize internal fact_id for dedup (never stored in the bank). */
export function normalizeKnowledgeFactId(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^F\d+$/i.test(s)) {
    const n = s.replace(/^F/i, "");
    return `F${String(Number(n) || n).padStart(3, "0")}`;
  }
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sanitizeJsonCandidate(text: string): string {
  return text
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function normalizeFactId(raw: unknown, index: number): string {
  const norm = normalizeKnowledgeFactId(raw);
  if (norm) return norm;
  return `F${String(index + 1).padStart(3, "0")}`;
}

function normalizeFactRow(raw: Record<string, unknown>, index: number): SopFact | null {
  const fact = String(raw.fact ?? raw.text ?? raw.statement ?? "").trim();
  if (fact.length < 5) return null;
  const topic = String(raw.topic ?? raw.section ?? raw.area ?? "General").trim() || "General";
  const id = normalizeFactId(raw.fact_id ?? raw.factId ?? raw.id, index);
  return { id, topic, fact };
}

function collectRawFacts(parsed: unknown): Record<string, unknown>[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    return parsed.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  if (typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const facts = obj.facts ?? obj.items ?? obj.data;
  if (Array.isArray(facts)) {
    return facts.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  return [];
}

/** Parse fact-extraction JSON — array or {"facts":[...]}. */
export function parseFactsJson(text: string, logPrefix = "mcq-facts"): SopFact[] {
  const cleaned = extractJsonPayload(stripMarkdownFences(text.trim()));
  const candidates = [cleaned, sanitizeJsonCandidate(cleaned)];

  for (const candidate of candidates) {
    for (const attempt of [candidate, repairTruncatedJson(candidate)]) {
      try {
        const parsed = JSON.parse(attempt);
        const raw = collectRawFacts(parsed);
        const facts = raw
          .map((row, i) => normalizeFactRow(row, i))
          .filter((f): f is SopFact => f !== null);
        if (facts.length > 0) return dedupeFactsByText(facts);
      } catch {
        /* try next */
      }
    }

    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(sanitizeJsonCandidate(arrayMatch[0]));
        if (Array.isArray(parsed)) {
          const facts = parsed
            .map((row, i) => normalizeFactRow(row as Record<string, unknown>, i))
            .filter((f): f is SopFact => f !== null);
          if (facts.length > 0) return dedupeFactsByText(facts);
        }
      } catch {
        /* try salvage */
      }
    }
  }

  const salvaged = extractCompleteObjects(cleaned);
  const fromObjects = salvaged
    .filter((o) => o && typeof o === "object" && ("fact" in (o as object) || "text" in (o as object)))
    .map((o, i) => normalizeFactRow(o as Record<string, unknown>, i))
    .filter((f): f is SopFact => f !== null);

  if (fromObjects.length > 0) {
    console.warn(`[${logPrefix}] salvaged ${fromObjects.length} fact(s) from malformed JSON`);
    return dedupeFactsByText(fromObjects);
  }

  throw new SyntaxError(`Fact extraction response was not valid JSON: ${cleaned.slice(0, 280)}`);
}

function dedupeFactsByText(facts: SopFact[]): SopFact[] {
  const seen = new Set<string>();
  const out: SopFact[] = [];
  for (const f of facts) {
    const key = f.fact.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export function normalizeQuestionCategory(raw: unknown): McqQuestionCategory {
  const s = String(raw ?? "recall").toLowerCase();
  if (s.includes("scenario")) return "scenario";
  if (s.includes("application") || s.includes("apply")) return "application";
  return "recall";
}

export function readFactIdFromMcq(raw: Record<string, unknown>): string {
  return normalizeKnowledgeFactId(raw.fact_id ?? raw.factId);
}

export interface FactDedupState {
  factUsage: Map<string, number>;
  factCategories: Map<string, Set<McqQuestionCategory>>;
  topicCounts: Map<string, number>;
}

export function createFactDedupState(): FactDedupState {
  return {
    factUsage: new Map(),
    factCategories: new Map(),
    topicCounts: new Map(),
  };
}

function topicKey(topic: string): string {
  return topic.trim().toLowerCase() || "general";
}

export function recordFactMcq(state: FactDedupState, q: FactMcq): void {
  const factId = q.factId ? normalizeKnowledgeFactId(q.factId) : "";
  if (factId) {
    state.factUsage.set(factId, (state.factUsage.get(factId) ?? 0) + 1);
    const cats = state.factCategories.get(factId) ?? new Set<McqQuestionCategory>();
    cats.add(q.questionCategory ?? "recall");
    state.factCategories.set(factId, cats);
  }
  const tk = topicKey(q.topic ?? q.sopReference ?? "");
  state.topicCounts.set(tk, (state.topicCounts.get(tk) ?? 0) + 1);
}

/** Local duplicate check — zero tokens. */
export function isFactMcqAcceptable(
  q: FactMcq,
  state: FactDedupState,
  seenQuestions: string[],
): boolean {
  if (!q?.question?.trim()) return false;
  if (isMetadataOnlyMcq(q.question)) return false;
  if (seenQuestions.some((eq) => isDuplicateMcqQuestionForGeneration(q.question, eq))) return false;

  const factId = q.factId ? normalizeKnowledgeFactId(q.factId) : "";
  const category = q.questionCategory ?? "recall";

  if (factId) {
    const usage = state.factUsage.get(factId) ?? 0;
    if (usage >= MAX_QUESTIONS_PER_FACT) return false;
    const cats = state.factCategories.get(factId);
    if (cats?.has(category)) return false;
  }

  const tk = topicKey(q.topic ?? q.sopReference ?? "");
  if ((state.topicCounts.get(tk) ?? 0) >= MAX_QUESTIONS_PER_TOPIC) return false;

  return true;
}

export function factIdsAtCapacity(state: FactDedupState): Set<string> {
  const out = new Set<string>();
  for (const [id, count] of state.factUsage) {
    if (count >= MAX_QUESTIONS_PER_FACT) out.add(id);
  }
  return out;
}

export function factsEligibleForReuse(
  facts: SopFact[],
  state: FactDedupState,
): SopFact[] {
  return facts.filter((f) => (state.factUsage.get(f.id) ?? 0) < MAX_QUESTIONS_PER_FACT);
}

export function pickReuseCategory(factId: string, state: FactDedupState): McqQuestionCategory {
  const used = state.factCategories.get(factId) ?? new Set<McqQuestionCategory>();
  if (!used.has("scenario")) return "scenario";
  if (!used.has("application")) return "application";
  return "recall";
}

export function batchFacts<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export function formatFactsForPrompt(facts: SopFact[]): string {
  return facts
    .map((f) => `- fact_id=${f.id} [${f.topic}]: ${f.fact}`)
    .join("\n");
}

export function formatExcludedFactIds(ids: Iterable<string>): string {
  const list = [...ids];
  if (!list.length) return "";
  return list.join(", ");
}
