/**
 * Terminal MCQ generator — runs the real generation flow for an SOP with verbose,
 * timestamped logs so you can watch the whole process. DRY RUN by default: it
 * calls Gemini and shows what would be produced, but does NOT write to the bank.
 * (Use the UI "Regenerate" button to actually persist — its [mcq-gen] logs stream
 * to the dev-server terminal.)
 *
 *   node --experimental-strip-types scripts/gen-mcqs-cli.ts QAMI38-06
 *   node --experimental-strip-types scripts/gen-mcqs-cli.ts QAMI38-06 --lang English --target 50 --batch 25
 */
import fs from "fs";
import mongoose from "mongoose";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = fs.readFileSync(".env.local", "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ── tiny arg parser ──────────────────────────────────────────────────────────
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const t0 = Date.now();
const log = (msg: string) => {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
  console.log(`[${s}s] ${msg}`);
};

// Mirrors lib/mcq-generation.contentQuality — prefer readable text over raw PDF.
function contentQuality(content?: string): number {
  if (!content) return 0;
  const c = content.trim();
  if (!c || c.startsWith("%PDF") || c.startsWith("[")) return 0;
  const r = (c.match(/[A-Za-z0-9 .,():;\/-]/g)?.length ?? 0) / c.length;
  return r < 0.6 ? 0 : c.length;
}

const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const SYSTEM = `You are a pharmaceutical GMP training expert. Generate multiple-choice questions from the provided SOP text.
Return ONLY valid JSON: { "questions": [ { "question","optionA","optionB","optionC","optionD","correctAnswer","explanation","difficulty","topic","sopReference" } ] }
Rules: difficulty mix ~40/40/20; answerable from the SOP only; no duplicates.
"sopReference" REQUIRED: cite the exact numbered clause as it appears (e.g. "4.6.1.4", "5.2.1"); only use a heading if the section has no number; never invent one.`;

interface GenMcq {
  question: string;
  difficulty?: string;
  sopReference?: string;
}

async function callModel(
  genAI: GoogleGenerativeAI,
  modelName: string,
  user: string,
): Promise<GenMcq[]> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM,
    generationConfig: { maxOutputTokens: 16384, responseMimeType: "application/json" },
  });
  const resp = (await model.generateContent(user)).response;
  let text = "";
  try {
    text = resp.text() ?? "";
  } catch {
    /* blocked */
  }
  if (!text) {
    const fr = resp.candidates?.[0]?.finishReason;
    throw new Error(`empty response (finishReason=${fr ?? "?"})`);
  }
  return JSON.parse(text).questions ?? [];
}

async function generateForLanguage(
  genAI: GoogleGenerativeAI,
  chain: string[],
  rep: any,
  language: string,
  target: number,
  batchSize: number,
): Promise<GenMcq[]> {
  const content: string = (rep.content ?? "").slice(0, 80000);
  const collected: GenMcq[] = [];
  const seen = new Set<string>();
  log(`▶ ${language}: source=${rep.fileType} ${content.length} chars (~${Math.round(content.length / 4)} tokens) · target ${target}`);

  const MAX_BATCHES = Math.ceil(target / batchSize) + 4;
  for (let b = 0; b < MAX_BATCHES && collected.length < target; b++) {
    const avoid = collected.length
      ? `\n\nDo NOT repeat these:\n- ${collected.slice(-20).map((q) => q.question).join("\n- ")}`
      : "";
    const user = `Language: ${language}\nSOP Identifier: ${rep.identifier}\nDepartment: ${rep.department}\nGenerate exactly ${batchSize} NEW unique MCQs.${avoid}\n\nSOP CONTENT:\n${content}`;

    let questions: GenMcq[] | null = null;
    for (const modelName of chain) {
      const started = Date.now();
      try {
        questions = await callModel(genAI, modelName, user);
        log(`  batch ${b + 1}: ${modelName} → ${questions.length} questions in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        break;
      } catch (e) {
        const msg = (e as Error).message;
        log(`  batch ${b + 1}: ${modelName} failed (${msg.slice(0, 80)}) — ${chain.indexOf(modelName) < chain.length - 1 ? "trying next model" : "no more models"}`);
      }
    }
    if (!questions) {
      log(`  batch ${b + 1}: all models failed — stopping ${language}`);
      break;
    }

    let added = 0;
    for (const q of questions) {
      if (!q?.question?.trim()) continue;
      const key = norm(q.question);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(q);
      added++;
    }
    log(`  batch ${b + 1}: +${added} new, ${questions.length - added} dup → total ${collected.length}/${target}`);
    if (added === 0) {
      log(`  batch ${b + 1}: all duplicates — stopping early`);
      break;
    }
  }

  // Summary for this language.
  const refs = collected.map((q) => q.sopReference).filter(Boolean);
  const diff = collected.reduce<Record<string, number>>((a, q) => {
    const d = String(q.difficulty ?? "?").toLowerCase();
    a[d] = (a[d] ?? 0) + 1;
    return a;
  }, {});
  log(`✓ ${language}: ${collected.length} unique MCQs · difficulty ${JSON.stringify(diff)}`);
  log(`  sample sopReferences: ${JSON.stringify(refs.slice(0, 15))}`);
  return collected;
}

async function main() {
  loadEnv();
  const identifier = process.argv[2];
  if (!identifier || identifier.startsWith("--")) {
    console.error("Usage: node --experimental-strip-types scripts/gen-mcqs-cli.ts <IDENTIFIER> [--lang English|Gujarati|both] [--target N] [--batch N]");
    process.exit(1);
  }
  const langArg = (arg("lang", "both") ?? "both").toLowerCase();
  const target = Number(arg("target", "100"));
  const batchSize = Number(arg("batch", "25"));

  await mongoose.connect(process.env.MONGODB_URI!);
  log(`Connected. Generating MCQs for ${identifier} (DRY RUN — no DB writes)`);

  const records = await mongoose.connection
    .collection("sops")
    .find({ identifier: { $regex: new RegExp(identifier.replace(/-/g, "-?"), "i") } })
    .toArray();
  log(`Found ${records.length} record(s) for ${identifier}`);

  // Pick best readable representative per language.
  const byLang = new Map<string, any>();
  for (const r of records as any[]) {
    const lang = r.language ?? "English";
    const cur = byLang.get(lang);
    if (!cur || contentQuality(r.content) > contentQuality(cur.content)) byLang.set(lang, r);
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const chain = [...new Set([
    process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
  ])];
  log(`Model chain: ${chain.join(" → ")}`);

  const wantLangs = langArg === "both" ? ["English", "Gujarati"] : [langArg === "gujarati" ? "Gujarati" : "English"];

  for (const lang of wantLangs) {
    const rep = byLang.get(lang);
    if (!rep) {
      log(`▶ ${lang}: no record — skipping`);
      continue;
    }
    if (contentQuality(rep.content) < 50) {
      log(`▶ ${lang}: content not readable (image-only PDF / failed extraction) — skipping. Upload a text DOCX/PDF and retry.`);
      continue;
    }
    await generateForLanguage(genAI, chain, rep, lang, target, batchSize);
  }

  log("Done (dry run). Use the UI Regenerate button to persist; its logs stream to the dev-server terminal.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
