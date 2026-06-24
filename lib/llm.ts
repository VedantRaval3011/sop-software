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

export type LlmProvider = "gemini" | "ollama";

export interface LlmInfo {
  provider: LlmProvider;
  model: string;
  complianceModel: string;
  label: string;
}

export function getProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  return provider === "ollama" ? "ollama" : "gemini";
}

/** Compliance can use a different provider than MCQ generation. */
export function getComplianceProvider(): LlmProvider {
  const override = process.env.LLM_COMPLIANCE_PROVIDER?.toLowerCase();
  if (override === "ollama" || override === "gemini") {
    return override;
  }
  return getProvider();
}

export function getLlmInfo(): LlmInfo {
  const mcqProvider = getProvider();
  const complianceProvider = getComplianceProvider();

  if (mcqProvider === complianceProvider) {
    if (complianceProvider === "ollama") {
      const model = getOllamaModel();
      const complianceModel = getOllamaComplianceModel();
      return {
        provider: complianceProvider,
        model,
        complianceModel,
        label:
          model === complianceModel
            ? `Ollama (${model})`
            : `Ollama (compliance: ${complianceModel})`,
      };
    }

    const model = process.env.GEMINI_MODEL ?? DEFAULT_FREE_GEMINI_MODEL;
    const complianceModel =
      process.env.COMPLIANCE_GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_FREE_COMPLIANCE_MODEL;
    return {
      provider: complianceProvider,
      model,
      complianceModel,
      label:
        model === complianceModel
          ? `Gemini (${model})`
          : `Gemini (compliance: ${complianceModel})`,
    };
  }

  const mcqLabel =
    mcqProvider === "ollama"
      ? `Ollama (${getOllamaModel()})`
      : `Gemini (${process.env.GEMINI_MODEL ?? DEFAULT_FREE_GEMINI_MODEL})`;
  const complianceLabel =
    complianceProvider === "ollama"
      ? `Ollama (${getOllamaComplianceModel()})`
      : `Gemini (${process.env.COMPLIANCE_GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_FREE_COMPLIANCE_MODEL})`;

  return {
    provider: complianceProvider,
    model:
      mcqProvider === "ollama"
        ? getOllamaModel()
        : (process.env.GEMINI_MODEL ?? DEFAULT_FREE_GEMINI_MODEL),
    complianceModel:
      complianceProvider === "ollama"
        ? getOllamaComplianceModel()
        : (process.env.COMPLIANCE_GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_FREE_COMPLIANCE_MODEL),
    label: `MCQ: ${mcqLabel} · Compliance: ${complianceLabel}`,
  };
}

export async function generateJson<T>(
  system: string,
  user: string,
  options: GeminiJsonOptions = {},
): Promise<T> {
  if (getProvider() === "ollama") {
    return generateOllamaJson<T>(system, user, 16_384);
  }
  return generateGeminiJson<T>(system, user, options);
}

export async function generateComplianceJson<T>(system: string, user: string): Promise<T> {
  if (getComplianceProvider() === "ollama") {
    return generateOllamaComplianceJson<T>(system, user);
  }
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

export { checkOllamaHealth, isGeminiOverloadedError, DEFAULT_FREE_GEMINI_MODEL as MODEL };
export type { GeminiJsonOptions };
