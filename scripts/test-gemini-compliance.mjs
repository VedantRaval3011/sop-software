import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

const apiKey = process.env.GEMINI_API_KEY;
const modelName =
  process.env.COMPLIANCE_GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";

const FREE_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite-preview-09-2025",
  "gemini-2.5-pro",
];

if (!FREE_MODELS.includes(modelName)) {
  console.error(`FAIL: ${modelName} is not a configured free-tier model`);
  process.exit(1);
}

if (!apiKey) {
  console.error("FAIL: GEMINI_API_KEY not found in .env.local");
  process.exit(1);
}

const systemPrompt = `You are a GMP/QA auditor. Screen each clause against the SOP. Return EXACTLY one finding per clause, same order.
Return ONLY valid JSON: {"findings":[{"guidelineName","clauseNumber","clauseTitle","complianceLevel","evidenceFound","evidenceMissing","sopTextSnippet"}]}`;

const userPrompt = `DEPARTMENT: Quality Assurance
SOP: SOP-HYG-001 — Hand Hygiene Procedure
BATCH: test-1 | 3 clauses | SCREENING

CLAUSES:
#1 [4.1] GUIDELINE: EU GMP Annex 1 | Hand washing
Personnel shall wash hands before entering classified areas.

#2 [4.2] GUIDELINE: EU GMP Annex 1 | Gowning
Personnel shall wear appropriate gowning including hair cover, mask, and gloves.

#3 [5.1] GUIDELINE: EU GMP Annex 1 | Sterile filtration validation
Sterile filters shall be validated prior to use in aseptic processing.

SOP EXCERPT:
4.1 All personnel must wash hands with approved soap for at least 20 seconds before entering Grade B areas.
4.2 Gowning includes hair cover, beard cover where applicable, mask, and sterile gloves.
4.3 Hand hygiene records shall be maintained in the batch manufacturing record.

Return exactly 3 findings in JSON.`;

console.log(`Testing Gemini compliance (free tier only)`);
console.log(`  primary model: ${modelName}`);
console.log(`  allowed free models: ${FREE_MODELS.join(", ")}`);

const started = Date.now();
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: modelName,
  systemInstruction: systemPrompt,
  generationConfig: {
    maxOutputTokens: 4096,
    responseMimeType: "application/json",
  },
});

try {
  const result = await model.generateContent(userPrompt);
  const text = result.response.text();
  const elapsed = Math.round((Date.now() - started) / 1000);

  if (!text) {
    console.error("FAIL: Empty response from Gemini");
    process.exit(1);
  }

  const parsed = JSON.parse(text);
  const findings = parsed.findings ?? [];
  console.log(`OK: Response in ${elapsed}s with ${findings.length} finding(s)`);
  console.log(JSON.stringify(parsed, null, 2));
} catch (error) {
  const elapsed = Math.round((Date.now() - started) / 1000);
  console.error(`FAIL after ${elapsed}s: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
