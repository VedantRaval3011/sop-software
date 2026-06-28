import { spawn } from "child_process";
import { errorMessage, isJsonParseError, parseJsonFromText, sleep } from "@/lib/llm-utils";
import { registerMcqSubprocess, unregisterMcqSubprocess } from "@/lib/mcq-run-control";
import { parseMcqBatchJson, type ParsedMcq } from "@/lib/mcq-json-parse";

/** Default MCQ batch (25 questions + large SOP) often exceeds 2 minutes on Sonnet. */
const CLAUDE_CLI_TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 300_000;
const CLAUDE_CLI_MAX_ATTEMPTS = Number(process.env.CLAUDE_CLI_MAX_ATTEMPTS) || 2;

/** General Claude Code CLI tasks (non-MCQ). */
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
/** MCQ batches are structured JSON — Haiku is faster and uses fewer tokens per call. */
const DEFAULT_MCQ_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

export function getClaudeCliModel(): string {
  return process.env.CLAUDE_CLI_MODEL ?? DEFAULT_CLAUDE_MODEL;
}

export function getMcqClaudeModel(): string {
  return process.env.MCQ_CLAUDE_MODEL ?? DEFAULT_MCQ_CLAUDE_MODEL;
}

export interface ClaudeCliHealth {
  ok: boolean;
  model: string;
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
  authMethod?: string;
  orgName?: string;
  error?: string;
}

function runClaude(args: string[], stdin?: string, timeoutMs = 15_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Claude CLI timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Failed to start Claude CLI: ${err.message}. ` +
            "Install Claude Code and ensure 'claude' is on your PATH, then run: claude auth login",
        ),
      );
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    if (stdin !== undefined) {
      proc.stdin.write(stdin, "utf8");
    }
    proc.stdin.end();
  });
}

/** Verify the local Claude Code CLI is logged into the user's subscription. */
export async function checkClaudeCliHealth(): Promise<ClaudeCliHealth> {
  const model = getClaudeCliModel();
  try {
    const { stdout, stderr, code } = await runClaude(["auth", "status"], undefined, 15_000);
    if (code !== 0) {
      return {
        ok: false,
        model,
        loggedIn: false,
        error: stderr.trim() || `claude auth status exited with code ${code}`,
      };
    }

    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        ok: false,
        model,
        loggedIn: false,
        error: "Could not parse claude auth status output. Run: claude auth login",
      };
    }

    const status = JSON.parse(jsonMatch[0]) as {
      loggedIn?: boolean;
      email?: string;
      subscriptionType?: string;
      authMethod?: string;
      orgName?: string;
    };

    if (!status.loggedIn) {
      return {
        ok: false,
        model,
        loggedIn: false,
        error: "Not logged in. Run: claude auth login",
      };
    }

    return {
      ok: true,
      model,
      loggedIn: true,
      email: status.email,
      subscriptionType: status.subscriptionType,
      authMethod: status.authMethod,
      orgName: status.orgName,
    };
  } catch (error) {
    return {
      ok: false,
      model,
      loggedIn: false,
      error: errorMessage(error),
    };
  }
}

export type ClaudeCliJsonOptions = {
  /** MCQ run id — enables kill on cancel (PRCL17-05 ≡ PRCL17-5). */
  runKey?: string;
  signal?: AbortSignal;
};

/**
 * Calls the local `claude` CLI (Claude Code) in non-interactive print mode.
 *
 * The full prompt is written to the child process's stdin. We use shell:true
 * so Windows can resolve claude.cmd (npm global installs are .cmd wrappers).
 */
export async function generateClaudeCliJson<T>(
  system: string,
  user: string,
  modelOverride?: string,
  options?: ClaudeCliJsonOptions,
): Promise<T> {
  const prompt = `${system}\n\n${user}`;
  const model = modelOverride ?? getClaudeCliModel();
  let lastError: unknown;

  for (let attempt = 0; attempt < CLAUDE_CLI_MAX_ATTEMPTS; attempt++) {
    if (options?.signal?.aborted) {
      throw new Error("Generation cancelled");
    }
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const proc = spawn("claude", ["-p", "--model", model, "--output-format", "text"], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
        });

        if (options?.runKey) {
          registerMcqSubprocess(options.runKey, proc);
        }

        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (options?.runKey) unregisterMcqSubprocess(options.runKey);
          fn();
        };

        const onAbort = () => {
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
          finish(() => reject(new Error("Generation cancelled")));
        };

        if (options?.signal) {
          if (options.signal.aborted) {
            onAbort();
            return;
          }
          options.signal.addEventListener("abort", onAbort, { once: true });
        }

        const timer = setTimeout(() => {
          proc.kill();
          finish(() =>
            reject(
              new Error(
                `Claude CLI timed out after ${CLAUDE_CLI_TIMEOUT_MS / 1000}s (model: ${model}). ` +
                  "Increase CLAUDE_CLI_TIMEOUT_MS in .env.local or reduce SOP content size.",
              ),
            ),
          );
        }, CLAUDE_CLI_TIMEOUT_MS);

        proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        proc.on("error", (err: Error) => {
          finish(() =>
            reject(
              new Error(
                `Failed to start Claude CLI: ${err.message}. ` +
                  "Make sure Claude Code is installed and 'claude' is in your PATH.",
              ),
            ),
          );
        });

        proc.on("close", (code: number | null) => {
          if (options?.signal) {
            options.signal.removeEventListener("abort", onAbort);
          }
          if (code !== 0) {
            finish(() => reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 400)}`)));
          } else {
            finish(() => resolve(stdout));
          }
        });

        proc.stdin.write(prompt, "utf8");
        proc.stdin.end();
      });

      return parseJsonFromText<T>(text, "claude-cli");
    } catch (error) {
      lastError = error;
      if (attempt < CLAUDE_CLI_MAX_ATTEMPTS - 1) {
        const delay = 3_000;
        console.warn(
          `[claude-cli] attempt ${attempt + 1}/${CLAUDE_CLI_MAX_ATTEMPTS} failed (${model}) — ` +
            `${errorMessage(error).slice(0, 120)} — retry in ${delay / 1000}s`,
        );
        await sleep(delay);
        continue;
      }
      if (isJsonParseError(error)) {
        throw new Error(
          `Claude (${model}) returned invalid JSON for MCQ batch. ` +
            `Details: ${errorMessage(error).slice(0, 200)}`,
        );
      }
      throw error;
    }
  }

  throw lastError ?? new Error("Claude CLI request failed");
}

const MCQ_JSON_RETRY =
  "\n\nIMPORTANT: Your last reply had no usable questions. Return ONLY raw JSON with at least one question per clause. sopReference = bracketed clause id. correctAnswer = A, B, C, or D.";

function isMcqEmptyError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return isJsonParseError(error) || msg.includes("no usable") || msg.includes("empty");
}

function wrapMcqCliPrompt(system: string, user: string): string {
  return `${system}

${user}

Respond with ONLY raw JSON — no markdown fences or commentary.`;
}

/** Claude CLI for MCQ batches — uses salvage parser + JSON retry hint. */
export async function generateClaudeCliMcqBatch(
  system: string,
  user: string,
  modelOverride?: string,
  options?: ClaudeCliJsonOptions,
): Promise<ParsedMcq[]> {
  const model = modelOverride ?? getMcqClaudeModel();
  let lastError: unknown;
  let userBlock = user;

  for (let attempt = 0; attempt < CLAUDE_CLI_MAX_ATTEMPTS + 1; attempt++) {
    if (options?.signal?.aborted) throw new Error("Generation cancelled");
    try {
      const prompt = wrapMcqCliPrompt(system, userBlock);
      const text = await runClaudeCliPrompt(prompt, model, options);
      const questions = parseMcqBatchJson(text, "claude-cli-mcq");
      if (questions.length === 0) throw new SyntaxError("No usable MCQs in Claude response");
      return questions;
    } catch (error) {
      lastError = error;
      if (attempt < CLAUDE_CLI_MAX_ATTEMPTS && isMcqEmptyError(error)) {
        userBlock = user + MCQ_JSON_RETRY;
        await sleep(2000);
        continue;
      }
      throw new Error(
        `Claude (${model}) MCQ batch failed: ${errorMessage(lastError).slice(0, 220)}`,
      );
    }
  }

  throw lastError ?? new Error("Claude CLI MCQ request failed");
}

async function runClaudeCliPrompt(
  prompt: string,
  model: string,
  options?: ClaudeCliJsonOptions,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn("claude", ["-p", "--model", model, "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    if (options?.runKey) registerMcqSubprocess(options.runKey, proc);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options?.runKey) unregisterMcqSubprocess(options.runKey);
      fn();
    };

    const onAbort = () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      finish(() => reject(new Error("Generation cancelled")));
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      proc.kill();
      finish(() =>
        reject(
          new Error(
            `Claude CLI timed out after ${CLAUDE_CLI_TIMEOUT_MS / 1000}s (model: ${model}).`,
          ),
        ),
      );
    }, CLAUDE_CLI_TIMEOUT_MS);

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err: Error) => {
      finish(() => reject(new Error(`Failed to start Claude CLI: ${err.message}`)));
    });

    proc.on("close", (code: number | null) => {
      if (options?.signal) options.signal.removeEventListener("abort", onAbort);
      if (code !== 0) {
        finish(() => reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 400)}`)));
      } else {
        finish(() => resolve(stdout));
      }
    });

    proc.stdin.write(prompt, "utf8");
    proc.stdin.end();
  });
}
