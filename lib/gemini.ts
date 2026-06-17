import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

const DEFAULT_MODEL = "gemini-2.5-flash";

/** Models tried in order when the primary is overloaded or rate-limited. */
const MODEL_FALLBACK_CHAIN = [
  process.env.GEMINI_MODEL,
  DEFAULT_MODEL,
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-2.5-pro",
].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return apiKey;
}

function buildModel(system: string, modelName: string, jsonMode = false): GenerativeModel {
  const genAI = new GoogleGenerativeAI(getApiKey());
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: system,
    generationConfig: {
      maxOutputTokens: 16384,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function isRetryableGeminiError(error: unknown): boolean {
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
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await model.generateContent(user);
      const text = result.response.text();
      if (!text) throw new Error("No text response from Gemini");
      return text;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableGeminiError(error);
      if (!retryable || attempt === maxAttempts - 1) throw error;

      const delay = parseRetryDelayMs(error, attempt);
      console.warn(
        `[gemini] ${modelName} attempt ${attempt + 1}/${maxAttempts} — ${errorMessage(error).slice(0, 120)} — retry in ${Math.round(delay / 1000)}s`,
      );
      await sleep(delay);
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}

export async function generateJson<T>(system: string, user: string): Promise<T> {
  let lastError: unknown;

  for (const modelName of MODEL_FALLBACK_CHAIN) {
    for (let parseAttempt = 0; parseAttempt < 3; parseAttempt++) {
      try {
        const model = buildModel(system, modelName, true);
        const text = await generateWithModel(model, user, modelName);
        const parsed = parseJsonFromText<T>(text);
        if (modelName !== (process.env.GEMINI_MODEL ?? DEFAULT_MODEL)) {
          console.log(`[gemini] succeeded with fallback model: ${modelName}`);
        }
        return parsed;
      } catch (error) {
        lastError = error;
        if (isJsonParseError(error) && parseAttempt < 2) {
          console.warn(`[gemini] JSON parse failed on ${modelName} — retry ${parseAttempt + 2}/3`);
          await sleep(2_000 + parseAttempt * 1_500);
          continue;
        }
        if (!isRetryableGeminiError(error)) throw error;
        break; // try next model
      }
    }
    console.warn(`[gemini] model ${modelName} exhausted — trying next model`);
  }

  const msg = errorMessage(lastError);
  if (isRetryableGeminiError(lastError)) {
    throw new Error(
      `Gemini API is temporarily unavailable (high demand or rate limit). Wait a minute and retry. Details: ${msg.slice(0, 220)}`,
    );
  }
  throw lastError instanceof Error ? lastError : new Error(msg);
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
