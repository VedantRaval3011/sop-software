import {
  DEFAULT_FREE_COMPLIANCE_MODEL,
  DEFAULT_FREE_GEMINI_MODEL,
} from "@/lib/gemini-free-models";
import {
  generateGeminiComplianceJson,
  generateGeminiJson,
  isGeminiOverloadedError,
  streamGeminiComplianceAnalysis,
  type GeminiJsonOptions,
} from "@/lib/gemini-client";
import {
  checkOllamaHealth,
  generateOllamaComplianceJson,
  generateOllamaJson,
  getOllamaComplianceModel,
  getOllamaModel,
} from "@/lib/ollama";
import { generateClaudeCliJson, getClaudeCliModel, getMcqClaudeModel, checkClaudeCliHealth } from "@/lib/claude-cli";

export type LlmProvider = "gemini" | "ollama" | "claude";

export interface LlmInfo {
  provider: LlmProvider;
  model: string;
  complianceModel: string;
  label: string;
}

export function getProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? "claude").toLowerCase();
  if (provider === "ollama") return "ollama";
  if (provider === "claude") return "claude";
  return "gemini";
}

/** Compliance can use a different provider than MCQ generation. Defaults to Gemini
 *  even when MCQ uses Claude CLI — compliance does not run through Claude Code. */
export function getComplianceProvider(): LlmProvider {
  const override = process.env.LLM_COMPLIANCE_PROVIDER?.toLowerCase();
  if (override === "ollama" || override === "gemini" || override === "claude") {
    return override;
  }
  return "gemini";
}

function providerLabel(p: LlmProvider, role: "mcq" | "compliance"): { model: string; label: string } {
  if (p === "ollama") {
    const model = role === "compliance" ? getOllamaComplianceModel() : getOllamaModel();
    return { model, label: `Ollama (${model})` };
  }
  if (p === "claude") {
    const model = role === "mcq" ? getMcqClaudeModel() : getClaudeCliModel();
    return { model, label: `Claude CLI (${model})` };
  }
  const geminiModel =
    role === "compliance"
      ? (process.env.COMPLIANCE_GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_FREE_COMPLIANCE_MODEL)
      : (process.env.GEMINI_MODEL ?? DEFAULT_FREE_GEMINI_MODEL);
  return { model: geminiModel, label: `Gemini (${geminiModel})` };
}

export function getLlmInfo(): LlmInfo {
  const mcqProvider = getProvider();
  const complianceProvider = getComplianceProvider();
  const mcq = providerLabel(mcqProvider, "mcq");
  const compliance = providerLabel(complianceProvider, "compliance");

  if (mcqProvider === complianceProvider) {
    return {
      provider: complianceProvider,
      model: mcq.model,
      complianceModel: compliance.model,
      label: mcq.label,
    };
  }

  return {
    provider: complianceProvider,
    model: mcq.model,
    complianceModel: compliance.model,
    label: `MCQ: ${mcq.label} · Compliance: ${compliance.label}`,
  };
}

export async function generateJson<T>(
  system: string,
  user: string,
  options: GeminiJsonOptions = {},
  providerOverride?: LlmProvider,
): Promise<T> {
  const p = providerOverride ?? getProvider();
  if (p === "ollama") return generateOllamaJson<T>(system, user, 16_384);
  if (p === "claude") return generateClaudeCliJson<T>(system, user);
  return generateGeminiJson<T>(system, user, options);
}

export async function generateComplianceJson<T>(
  system: string,
  user: string,
  providerOverride?: LlmProvider,
  modelOverride?: string,
): Promise<T> {
  const p = providerOverride ?? getComplianceProvider();
  if (p === "ollama") return generateOllamaComplianceJson<T>(system, user);
  if (p === "claude") return generateClaudeCliJson<T>(system, user, modelOverride);
  return generateGeminiComplianceJson<T>(system, user);
}

export async function* streamComplianceAnalysis(
  system: string,
  user: string,
): AsyncGenerator<string> {
  if (getComplianceProvider() === "ollama") {
    throw new Error(
      "Streaming compliance analysis is not supported with Ollama. Set LLM_PROVIDER=gemini or use the V5 analyze endpoint.",
    );
  }
  yield* streamGeminiComplianceAnalysis(system, user);
}

export { checkOllamaHealth, checkClaudeCliHealth, isGeminiOverloadedError, DEFAULT_FREE_GEMINI_MODEL as MODEL };
export type { GeminiJsonOptions };
