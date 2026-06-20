import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

const DEFAULT_MODEL = "gemini-2.5-flash";

/** Fast model for high-volume compliance batching (screening thousands of clauses). */
const DEFAULT_COMPLIANCE_MODEL = "gemini-2.5-flash-lite";

/** Models tried in order when the primary is overloaded or rate-limited. */
const MODEL_FALLBACK_CHAIN = [
  process.env.GEMINI_MODEL,
  DEFAULT_MODEL,
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-2.5-pro",
].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

/** Compliance audits — flash first (more reliable under load than lite). */
const COMPLIANCE_MODEL_CHAIN = [
  process.env.COMPLIANCE_GEMINI_MODEL,
  "gemini-2.5-flash",
  process.env.GEMINI_MODEL,
  DEFAULT_COMPLIANCE_MODEL,
  "gemini-flash-latest",
].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

/** Serialize compliance API calls — parallel bursts cause 503/timeout storms. */
let complianceQueueTail: Promise<void> = Promise.resolve();
let lastComplianceCallAt = 0;
const COMPLIANCE_MIN_GAP_MS = 400;

function is503Error(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return msg.includes("503") || msg.includes("high demand") || msg.includes("unavailable");
}

async function enqueueComplianceCall<T>(fn: () => Promise<T>): Promise<T> {
  const ticket = complianceQueueTail.then(async () => {
    const wait = COMPLIANCE_MIN_GAP_MS - (Date.now() - lastComplianceCallAt);
    if (wait > 0) await sleep(wait);
    lastComplianceCallAt = Date.now();
  });
  complianceQueueTail = ticket.catch(() => {});
  await ticket;
  return fn();
}

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return apiKey;
}

function buildModel(
  system: string,
  modelName: string,
  jsonMode = false,
  maxOutputTokens = 16384,
): GenerativeModel {
  const genAI = new GoogleGenerativeAI(getApiKey());
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: system,
    generationConfig: {
      maxOutputTokens,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Surface the underlying network cause (undici hides it in `error.cause`). */
function errorDetail(error: unknown): string {
  const parts: string[] = [errorMessage(error)];
  const cause = (error as { cause?: unknown })?.cause;
  if (cause) {
    const c = cause as { code?: string; message?: string; errno?: number };
    parts.push(`cause=${c.code ?? c.errno ?? ""} ${c.message ?? String(cause)}`.trim());
  }
  const status = (error as { status?: number })?.status;
  if (status) parts.push(`status=${status}`);
  return parts.join(" | ");
}

function isJsonParseError(error: unknown): boolean {
  const msg = errorMessage(error);
  return (
    error instanceof SyntaxError ||
    msg.includes("JSON") ||
    msg.includes("Unexpected token") ||
    msg.includes("Unexpected end")
  );
}

/**
 * A pure network/connection failure (no HTTP response). Retrying these 8× across
 * 5 fallback models is pointless — every model shares the same broken connection —
 * and it turns one unreachable batch into ~10 minutes of dead waiting. Detect them
 * so we can fail fast and abort the whole run early.
 */
function isConnectionError(error: unknown): boolean {
  if (typeof (error as { status?: number })?.status === "number") return false;
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? "";
  const blob = `${errorMessage(error)} ${cause?.message ?? ""} ${code}`.toLowerCase();
  if (
    /econnreset|econnrefused|etimedout|enotfound|eai_again|epipe|und_err|socket hang up|fetch failed|network|terminated|certificate/.test(
      blob,
    )
  ) {
    return true;
  }
  // SDK throws "Error fetching from <url>" with NO "[<status>]" bracket when the
  // underlying fetch itself threw (connection layer), vs "[503 ...]" for HTTP.
  const msg = errorMessage(error);
  return msg.includes("Error fetching from") && !/\[\d{3}\b/.test(msg);
}

/**
 * A 429 can mean two very different things:
 *  - transient rate limit  → worth retrying / switching models
 *  - account out of credit  → permanent until billing is topped up, so retrying
 *    (and trying other models on the same key) only wastes minutes.
 * Detect the billing variant so we can fail fast with an actionable message.
 */
function isCreditsDepletedError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return (
    msg.includes("credits are depleted") ||
    msg.includes("prepayment credits") ||
    msg.includes("billing account") ||
    msg.includes("insufficient credit") ||
    msg.includes("payment required")
  );
}

function isRetryableGeminiError(error: unknown): boolean {
  if (isCreditsDepletedError(error)) return false;
  const msg = errorMessage(error).toLowerCase();
  return (
    isJsonParseError(error) ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("500") ||
    msg.includes("too many requests") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("high demand") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded")
  );
}

function parseRetryDelayMs(error: unknown, attempt: number): number {
  const msg = errorMessage(error);
  const retryMatch = msg.match(/retry in ([\d.]+)s/i);
  if (retryMatch) return Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000;

  if (isJsonParseError(error)) return 2_000 + attempt * 1_500;

  const lower = msg.toLowerCase();
  if (lower.includes("503") || lower.includes("high demand") || lower.includes("unavailable")) {
    return Math.min(45_000, 5_000 + attempt * 5_000);
  }
  if (lower.includes("perday")) return 60_000;
  if (lower.includes("429") || lower.includes("quota")) return 35_000 + attempt * 3_000;
  return 10_000 + attempt * 4_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripMarkdownFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/** Salvage complete finding objects from truncated JSON responses. */
function extractCompleteObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const chunk = text.slice(start, i + 1);
        if (chunk.includes('"clauseNumber"') || chunk.includes('"complianceLevel"')) {
          try {
            objects.push(JSON.parse(chunk));
          } catch {
            /* skip malformed object */
          }
        }
        start = -1;
      }
    }
  }
  return objects;
}

function repairTruncatedJson(text: string): string {
  let s = stripMarkdownFences(text);
  const openBraces = (s.match(/\{/g) ?? []).length;
  const closeBraces = (s.match(/\}/g) ?? []).length;
  const openBrackets = (s.match(/\[/g) ?? []).length;
  const closeBrackets = (s.match(/\]/g) ?? []).length;

  // Trim dangling partial key/value at end
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, "");
  s = s.replace(/,\s*$/, "");

  if (openBrackets > closeBrackets) s += "]".repeat(openBrackets - closeBrackets);
  if (openBraces > closeBraces) s += "}".repeat(openBraces - closeBraces);
  return s;
}

function parseJsonFromText<T>(text: string): T {
  const cleaned = stripMarkdownFences(text);

  // 1. Direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* continue */
  }

  // 2. Extract outermost JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      try {
        return JSON.parse(repairTruncatedJson(jsonMatch[0])) as T;
      } catch {
        /* continue */
      }
    }
  }

  // 3. Salvage findings array from truncated response
  const objects = extractCompleteObjects(cleaned);
  if (objects.length > 0) {
    console.warn(`[gemini] salvaged ${objects.length} complete finding(s) from truncated JSON`);
    return { findings: objects, overallScore: 0 } as T;
  }

  throw new SyntaxError(`Gemini response was not valid JSON: ${cleaned.slice(0, 200)}`);
}

async function generateWithModel(
  model: GenerativeModel,
  user: string,
  modelName: string,
  maxAttempts = 8,
  /** Compliance mode: fail fast on 503 so we switch models instead of waiting minutes. */
  complianceMode = false,
): Promise<string> {
  let lastError: unknown;
  const effectiveMax = complianceMode ? Math.min(maxAttempts, 3) : maxAttempts;

  for (let attempt = 0; attempt < effectiveMax; attempt++) {
    try {
      const result = await model.generateContent(user);
      const text = result.response.text();
      if (!text) throw new Error("No text response from Gemini");
      return text;
    } catch (error) {
      lastError = error;

      // Billing/credit exhaustion is permanent until topped up — fail fast instead
      // of burning a 35s backoff per batch on an error that cannot recover.
      if (isCreditsDepletedError(error)) {
        throw new Error(
          `Gemini API billing exhausted: your prepayment credits are depleted. ` +
            `Add credits / enable billing for the project that owns GEMINI_API_KEY, then retry. ` +
            `Details: ${errorMessage(error).slice(0, 200)}`,
        );
      }

      // 503 high demand: one quick retry, then let the model chain switch.
      if (complianceMode && is503Error(error)) {
        if (attempt >= 1) throw error;
        console.warn(
          `[gemini] ${modelName} 503 high demand — retry once in 3s, then switch model`,
        );
        await sleep(3_000);
        continue;
      }

      // Connection failures: retry with backoff, then try the next model in the chain.
      if (isConnectionError(error)) {
        const connMax = complianceMode ? 2 : 5;
        if (attempt >= connMax) throw error;
        const delay = complianceMode ? 3_000 : 2_000 + attempt * 2_000;
        console.warn(
          `[gemini] ${modelName} connection error ${attempt + 1}/${connMax + 1} — ${errorDetail(error).slice(0, 200)} — retry in ${Math.round(delay / 1000)}s`,
        );
        await sleep(delay);
        continue;
      }

      const retryable = isRetryableGeminiError(error);
      if (!retryable || attempt === effectiveMax - 1) throw error;

      const delay = complianceMode && is503Error(error)
        ? 3_000
        : parseRetryDelayMs(error, attempt);
      console.warn(
        `[gemini] ${modelName} attempt ${attempt + 1}/${effectiveMax} — ${errorDetail(error).slice(0, 200)} — retry in ${Math.round(delay / 1000)}s`,
      );
      await sleep(delay);
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}

async function generateJsonWithChain<T>(
  system: string,
  user: string,
  chain: string[],
  maxOutputTokens: number,
  logPrefix: string,
  complianceMode = false,
): Promise<T> {
  let lastError: unknown;

  for (const modelName of chain) {
    for (let parseAttempt = 0; parseAttempt < (complianceMode ? 2 : 3); parseAttempt++) {
      try {
        const model = buildModel(system, modelName, true, maxOutputTokens);
        const text = await generateWithModel(model, user, modelName, 8, complianceMode);
        const parsed = parseJsonFromText<T>(text);
        if (modelName !== chain[0]) {
          console.log(`[${logPrefix}] succeeded with fallback model: ${modelName}`);
        }
        return parsed;
      } catch (error) {
        lastError = error;
        if (isConnectionError(error) || is503Error(error)) {
          console.warn(
            `[${logPrefix}] ${is503Error(error) ? "503" : "connection"} on ${modelName} — trying next model`,
          );
          break;
        }
        if (isJsonParseError(error) && parseAttempt < 1) {
          console.warn(`[${logPrefix}] JSON parse failed on ${modelName} — retry`);
          await sleep(2_000);
          continue;
        }
        if (!isRetryableGeminiError(error)) throw error;
        break;
      }
    }
    console.warn(`[${logPrefix}] model ${modelName} exhausted — trying next model`);
  }

  const msg = errorMessage(lastError);
  if (isConnectionError(lastError)) {
    throw new Error(
      `Gemini API connection failed after trying all models (likely too many parallel requests or a brief network outage). Wait 30 seconds and retry the analysis. Details: ${errorDetail(lastError).slice(0, 200)}`,
    );
  }
  if (isRetryableGeminiError(lastError)) {
    throw new Error(
      `Gemini API is temporarily unavailable (high demand or rate limit). Wait a minute and retry. Details: ${msg.slice(0, 220)}`,
    );
  }
  throw lastError instanceof Error ? lastError : new Error(msg);
}

export async function generateJson<T>(system: string, user: string): Promise<T> {
  return generateJsonWithChain<T>(system, user, MODEL_FALLBACK_CHAIN, 16384, "gemini");
}

/**
 * High-throughput JSON generation for compliance clause batching.
 * Requests are serialized with a minimum gap to avoid 503 storms.
 * Uses gemini-2.5-flash by default; fails fast on 503 and switches models.
 */
export async function generateComplianceJson<T>(system: string, user: string): Promise<T> {
  return enqueueComplianceCall(() =>
    generateJsonWithChain<T>(system, user, COMPLIANCE_MODEL_CHAIN, 32768, "compliance-gemini", true),
  );
}

export async function* streamComplianceAnalysis(
  system: string,
  user: string,
): AsyncGenerator<string> {
  const modelName = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const model = buildModel(system, modelName, false);
  const result = await model.generateContentStream(user);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

export { DEFAULT_MODEL as MODEL };
