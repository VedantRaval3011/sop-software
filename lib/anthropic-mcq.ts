import Anthropic from "@anthropic-ai/sdk";
import { errorMessage, isJsonParseError, sleep } from "@/lib/llm-utils";
import { getMcqClaudeModel } from "@/lib/claude-cli";
import { normalizeRawMcq, parseMcqBatchJson, type ParsedMcq } from "@/lib/mcq-json-parse";

const MAX_ATTEMPTS = 3;

const MCQ_BATCH_TOOL: Anthropic.Tool = {
  name: "submit_mcq_batch",
  description: "Submit one multiple-choice question per requested SOP clause",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            optionA: { type: "string" },
            optionB: { type: "string" },
            optionC: { type: "string" },
            optionD: { type: "string" },
            correctAnswer: { type: "string", description: "Single letter: A, B, C, or D" },
            difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            sopReference: { type: "string", description: "Exact clause id from the user message" },
          },
          required: ["question", "optionA", "optionB", "optionC", "optionD", "correctAnswer", "sopReference"],
        },
      },
    },
    required: ["questions"],
  },
};

const JSON_RETRY_HINT =
  "\n\nIMPORTANT: Your previous reply had no usable questions. Return at least one MCQ per clause. sopReference must equal the bracketed clause id. correctAnswer must be A, B, C, or D only.";

function getApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

export function anthropicMcqApiAvailable(): boolean {
  return Boolean(getApiKey());
}

function isMcqEmptyError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return (
    isJsonParseError(error) ||
    msg.includes("no usable") ||
    msg.includes("empty") ||
    msg.includes("no mcqs")
  );
}

function questionsFromToolUse(message: Anthropic.Message): ParsedMcq[] | null {
  for (const block of message.content) {
    if (block.type !== "tool_use" || block.name !== "submit_mcq_batch") continue;
    const input = block.input as { questions?: unknown[] };
    const raw = (input?.questions ?? []).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
    const questions = raw.map(normalizeRawMcq).filter((q): q is ParsedMcq => q !== null);
    if (questions.length > 0) return questions;
    throw new SyntaxError("Tool returned empty or unusable questions array");
  }
  return null;
}

function stitchPrefillJson(tail: string): string {
  const t = tail.trim();
  if (!t) return "{}";
  if (t.startsWith("{")) return t;
  return `{${t}`;
}

function questionsFromTextPrefill(tail: string): ParsedMcq[] {
  const text = stitchPrefillJson(tail);
  const questions = parseMcqBatchJson(text, "anthropic-mcq");
  if (questions.length === 0) {
    throw new SyntaxError("Parsed JSON contained no usable MCQs");
  }
  return questions;
}

/** Direct Anthropic Messages API — structured tool output with JSON fallback. */
export async function generateAnthropicMcqBatch(
  system: string,
  user: string,
  modelOverride?: string,
  signal?: AbortSignal,
): Promise<ParsedMcq[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — add it to .env.local or use Claude CLI fallback.");
  }

  const model = modelOverride ?? getMcqClaudeModel();
  const client = new Anthropic({ apiKey });
  let lastError: unknown;
  let userContent = user;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error("Generation cancelled");
    try {
      const toolMessage = await client.messages.create(
        {
          model,
          max_tokens: 6144,
          system,
          tools: [MCQ_BATCH_TOOL],
          tool_choice: { type: "tool", name: "submit_mcq_batch" },
          messages: [{ role: "user", content: userContent }],
        },
        signal ? { signal } : undefined,
      );

      const fromTool = questionsFromToolUse(toolMessage);
      if (fromTool?.length) return fromTool;

      throw new SyntaxError("Tool response contained no usable MCQs");
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1 && isMcqEmptyError(error)) {
        userContent = user + JSON_RETRY_HINT;
        await sleep(800);
        continue;
      }
      // Last resort on final attempt: JSON prefill (one extra call only when tool path failed).
      if (attempt === MAX_ATTEMPTS - 1 && isMcqEmptyError(error)) {
        try {
          const jsonMessage = await client.messages.create(
            {
              model,
              max_tokens: 6144,
              system: `${system}\n\nOutput ONLY valid JSON. No markdown.`,
              messages: [
                { role: "user", content: userContent },
                { role: "assistant", content: "{" },
              ],
            },
            signal ? { signal } : undefined,
          );
          const tail = jsonMessage.content
            .filter((block): block is Anthropic.TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("\n");
          return questionsFromTextPrefill(tail);
        } catch {
          /* fall through */
        }
      }
      throw new Error(`Anthropic MCQ call failed (${model}): ${errorMessage(error)}`);
    }
  }

  throw lastError ?? new Error("Anthropic MCQ call failed");
}

/** @deprecated Use generateAnthropicMcqBatch for MCQ generation. */
export async function generateAnthropicMcqJson<T>(
  system: string,
  user: string,
  modelOverride?: string,
  signal?: AbortSignal,
): Promise<T> {
  const questions = await generateAnthropicMcqBatch(system, user, modelOverride, signal);
  return { questions } as T;
}
