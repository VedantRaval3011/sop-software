import { GoogleGenerativeAI } from "@google/generative-ai";

const DEFAULT_MODEL = "gemini-2.0-flash";

function getModel(system: string, jsonMode = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const modelName = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const genAI = new GoogleGenerativeAI(apiKey);

  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: system,
    generationConfig: {
      maxOutputTokens: 8192,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });
}

function parseJsonFromText<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Gemini response did not contain JSON");
    return JSON.parse(jsonMatch[0]) as T;
  }
}

export async function generateJson<T>(system: string, user: string): Promise<T> {
  const model = getModel(system, true);
  const result = await model.generateContent(user);
  const text = result.response.text();
  if (!text) throw new Error("No text response from Gemini");
  return parseJsonFromText<T>(text);
}

export async function* streamComplianceAnalysis(
  system: string,
  user: string,
): AsyncGenerator<string> {
  const model = getModel(system, false);
  const result = await model.generateContentStream(user);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

export { DEFAULT_MODEL as MODEL };
