import { spawn } from "child_process";
import { errorMessage, isJsonParseError, parseJsonFromText, sleep } from "@/lib/llm-utils";

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

/**
 * Calls the local `claude` CLI (Claude Code) in non-interactive print mode.
 *
 * The full prompt is written to the child process's stdin. We use shell:true
 * so Windows can resolve claude.cmd (npm global installs are .cmd wrappers).
 */
export async function generateClaudeCliJson<T>(system: string, user: string, modelOverride?: string): Promise<T> {
  const prompt = `${system}\n\n${user}`;
  const model = modelOverride ?? getClaudeCliModel();
  let lastError: unknown;

  for (let attempt = 0; attempt < CLAUDE_CLI_MAX_ATTEMPTS; attempt++) {
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const proc = spawn("claude", ["-p", "--model", model, "--output-format", "text"], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
        });

        let stdout = "";
        let stderr = "";

        const timer = setTimeout(() => {
          proc.kill();
          reject(
            new Error(
              `Claude CLI timed out after ${CLAUDE_CLI_TIMEOUT_MS / 1000}s (model: ${model}). ` +
                "Increase CLAUDE_CLI_TIMEOUT_MS in .env.local or reduce SOP content size.",
            ),
          );
        }, CLAUDE_CLI_TIMEOUT_MS);

        proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        proc.on("error", (err: Error) => {
          clearTimeout(timer);
          reject(
            new Error(
              `Failed to start Claude CLI: ${err.message}. ` +
                "Make sure Claude Code is installed and 'claude' is in your PATH.",
            ),
          );
        });

        proc.on("close", (code: number | null) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 400)}`));
          } else {
            resolve(stdout);
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
