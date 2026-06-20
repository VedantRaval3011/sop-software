import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");

function loadEnvFile() {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL ?? "qwen2.5:14b";
const complianceModel = process.env.OLLAMA_COMPLIANCE_MODEL ?? model;
const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) > 0
  ? Number(process.env.OLLAMA_TIMEOUT_MS)
  : 300_000;

function stripMarkdownFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function parseJson(text) {
  const cleaned = stripMarkdownFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Invalid JSON: ${cleaned.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
}

async function ollamaChat(system, user, chatModel, maxTokens) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        format: "json",
        stream: false,
        options: { num_predict: maxTokens, temperature: 0.2 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const text = data.message?.content?.trim();
    if (!text) throw new Error("Empty response from Ollama");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function modelAvailable(installed, name) {
  const base = name.split(":")[0];
  return installed.some(
    (m) => m === name || m.startsWith(`${base}:`) || m.split(":")[0] === base,
  );
}

console.log("Ollama smoke test");
console.log(`  base: ${baseUrl}`);
console.log(`  model: ${model}`);
console.log(`  compliance model: ${complianceModel}`);

try {
  const tagsRes = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!tagsRes.ok) {
    console.error(`FAIL: Ollama /api/tags returned HTTP ${tagsRes.status}`);
    process.exit(1);
  }
  const tags = await tagsRes.json();
  const installed = (tags.models ?? []).map((m) => m.name);
  console.log(`  installed models: ${installed.join(", ") || "(none)"}`);

  for (const required of [...new Set([model, complianceModel])]) {
    if (!modelAvailable(installed, required)) {
      console.error(`FAIL: model "${required}" is not installed. Run: ollama pull ${required}`);
      process.exit(1);
    }
  }
  console.log("OK: Ollama reachable and required models present");
} catch (error) {
  console.error(`FAIL: Cannot reach Ollama at ${baseUrl}: ${error.message}`);
  console.error("Ensure Ollama is running: ollama serve");
  process.exit(1);
}

const mcqSystem = `You are a pharmaceutical GMP training expert. Return ONLY valid JSON:
{"questions":[{"question":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A","explanation":"...","difficulty":"easy","topic":"..."}]}`;

const mcqUser = `Language: English
SOP Identifier: SOP-TEST-001
Generate exactly 2 MCQs from this SOP:

All personnel must wash hands before entering the production area. Gowning includes hair cover, mask, and gloves.`;

try {
  const mcqText = await ollamaChat(mcqSystem, mcqUser, model, 4096);
  const mcqJson = parseJson(mcqText);
  const count = mcqJson.questions?.length ?? 0;
  if (count < 1) throw new Error("No questions returned");
  console.log(`OK: MCQ generation returned ${count} question(s)`);
} catch (error) {
  console.error(`FAIL: MCQ generation — ${error.message}`);
  process.exit(1);
}

const complianceSystem = `You are a GMP auditor. Return ONLY valid JSON:
{"findings":[{"clauseNumber":"1.1","clauseTitle":"...","complianceLevel":"compliant"|"partial"|"non-compliant"|"not-applicable","finding":"...","evidenceFound":"","evidenceMissing":""}]}`;

const complianceUser = `SOP: Hand Hygiene Procedure
Clauses to screen:
1.1 Hand washing — Personnel shall wash hands before entering classified areas.
1.2 Gowning — Personnel shall wear appropriate gowning including hair cover.

Return exactly 2 findings in the same order.`;

try {
  const complianceText = await ollamaChat(
    complianceSystem,
    complianceUser,
    complianceModel,
    8192,
  );
  const complianceJson = parseJson(complianceText);
  const findings = complianceJson.findings?.length ?? 0;
  if (findings < 1) throw new Error("No findings returned");
  console.log(`OK: Compliance screening returned ${findings} finding(s)`);
} catch (error) {
  console.error(`FAIL: Compliance generation — ${error.message}`);
  process.exit(1);
}

console.log("\nAll Ollama smoke tests passed.");
