import {
  errorDetail,
  errorMessage,
  isConnectionError,
  isJsonParseError,
  parseJsonFromText,
  sleep,
} from "@/lib/llm-utils";

const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:14b";
const DEFAULT_TIMEOUT_MS = 300_000;
const COMPLIANCE_MIN_GAP_MS = 800;

let complianceQueueTail: Promise<void> = Promise.resolve();
let lastComplianceCallAt = 0;

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

export function getOllamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE).replace(/\/$/, "");
}

export function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
}

export function getOllamaComplianceModel(): string {
  return process.env.OLLAMA_COMPLIANCE_MODEL ?? getOllamaModel();
}

function getTimeoutMs(overrideMs?: number): number {
  if (overrideMs !== undefined && Number.isFinite(overrideMs) && overrideMs > 0) {
    return overrideMs;
  }
  const n = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function getComplianceTimeoutMs(): number {
  const compliance = Number(process.env.OLLAMA_COMPLIANCE_TIMEOUT_MS);
  if (Number.isFinite(compliance) && compliance > 0) return compliance;
  return getTimeoutMs(900_000);
}

function getComplianceMaxTokens(): number {
  const n = Number(process.env.OLLAMA_COMPLIANCE_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 4_096;
}

function getNumCtx(): number | undefined {
  const n = Number(process.env.OLLAMA_NUM_CTX);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function isTimeoutError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes("timed out");
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

function modelIsAvailable(installed: string[], model: string): boolean {
  const base = model.split(":")[0];
  return installed.some(
    (name) => name === model || name.startsWith(`${base}:`) || name.split(":")[0] === base,
  );
}

async function chatOnce(
  system: string,
  user: string,
  model: string,
  maxTokens: number,
  timeoutMs?: number,
): Promise<string> {
  const controller = new AbortController();
  const effectiveTimeout = getTimeoutMs(timeoutMs);
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        format: "json",
        stream: false,
        keep_alive: "30m",
        options: {
          num_predict: maxTokens,
          temperature: 0.2,
          ...(getNumCtx() ? { num_ctx: getNumCtx() } : {}),
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    if (data.error) throw new Error(`Ollama error: ${data.error}`);

    const text = data.message?.content?.trim();
    if (!text) throw new Error("No text response from Ollama");
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Ollama request timed out after ${effectiveTimeout}ms. Increase OLLAMA_COMPLIANCE_TIMEOUT_MS or reduce COMPLIANCE_MAX_CLAUSES_PER_BATCH.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithRetries(
  system: string,
  user: string,
  model: string,
  maxTokens: number,
  logPrefix: string,
  maxAttempts = 3,
  timeoutMs?: number,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await chatOnce(system, user, model, maxTokens, timeoutMs);
    } catch (error) {
      lastError = error;

      // Retrying the same oversized batch after a timeout just wastes more minutes.
      if (isTimeoutError(error)) throw error;

      if (isConnectionError(error)) {
        if (attempt >= maxAttempts - 1) {
          throw new Error(
            `Ollama connection failed at ${getOllamaBaseUrl()}. Ensure Ollama is running (ollama serve). Details: ${errorDetail(error).slice(0, 200)}`,
          );
        }
        const delay = 2_000 + attempt * 2_000;
        console.warn(
          `[${logPrefix}] connection error ${attempt + 1}/${maxAttempts} — retry in ${Math.round(delay / 1000)}s`,
        );
        await sleep(delay);
        continue;
      }

      if (attempt < maxAttempts - 1) {
        const delay = 2_000;
        console.warn(
          `[${logPrefix}] attempt ${attempt + 1}/${maxAttempts} failed — ${errorMessage(error).slice(0, 200)} — retry in ${Math.round(delay / 1000)}s`,
        );
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error("Ollama request failed");
}

export async function generateOllamaJson<T>(
  system: string,
  user: string,
  maxTokens = 16_384,
): Promise<T> {
  const model = getOllamaModel();
  const text = await generateWithRetries(system, user, model, maxTokens, "ollama");
  try {
    return parseJsonFromText<T>(text, "ollama");
  } catch (error) {
    if (isJsonParseError(error)) {
      throw new Error(
        `Ollama model ${model} returned invalid JSON. Try a model with stronger JSON output (e.g. qwen2.5:14b). Details: ${errorMessage(error).slice(0, 200)}`,
      );
    }
    throw error;
  }
}

export async function generateOllamaComplianceJson<T>(system: string, user: string): Promise<T> {
  return enqueueComplianceCall(async () => {
    const model = getOllamaComplianceModel();
    const startedAt = Date.now();
    console.log(
      `[ollama-compliance] sending to ${model} (${user.length} input chars, max ${getComplianceMaxTokens()} tokens, timeout ${getComplianceTimeoutMs()}ms)`,
    );
    const text = await generateWithRetries(
      system,
      user,
      model,
      getComplianceMaxTokens(),
      "ollama-compliance",
      1,
      getComplianceTimeoutMs(),
    );
    console.log(
      `[ollama-compliance] response received in ${Math.round((Date.now() - startedAt) / 1000)}s`,
    );
    try {
      return parseJsonFromText<T>(text, "ollama-compliance");
    } catch (error) {
      if (isJsonParseError(error)) {
        throw new Error(
          `Ollama compliance model ${model} returned invalid JSON. Reduce COMPLIANCE_MAX_CLAUSES_PER_BATCH or use a larger model. Details: ${errorMessage(error).slice(0, 200)}`,
        );
      }
      throw error;
    }
  });
}

export async function checkOllamaHealth(): Promise<{
  ok: boolean;
  models: string[];
  missingModels: string[];
  error?: string;
}> {
  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      return {
        ok: false,
        models: [],
        missingModels: [],
        error: `Ollama HTTP ${res.status} at ${getOllamaBaseUrl()}`,
      };
    }

    const data = (await res.json()) as OllamaTagsResponse;
    const models = (data.models ?? []).map((m) => m.name);
    const required = [...new Set([getOllamaModel(), getOllamaComplianceModel()])];
    const missingModels = required.filter((m) => !modelIsAvailable(models, m));

    return {
      ok: missingModels.length === 0,
      models,
      missingModels,
      error:
        missingModels.length > 0
          ? `Missing Ollama models: ${missingModels.join(", ")}. Run: ollama pull ${missingModels[0]}`
          : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      models: [],
      missingModels: [],
      error: `Cannot reach Ollama at ${getOllamaBaseUrl()}: ${errorMessage(error)}`,
    };
  }
}
