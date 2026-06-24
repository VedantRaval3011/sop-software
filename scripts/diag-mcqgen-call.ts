/** Reproduce ONE MCQ generation batch for an SOP across the model chain, printing
 *  finishReason / blockReason / text length so we can see WHY a response is empty
 *  and which model actually returns text. Makes real API calls (one per model).
 *    node --experimental-strip-types scripts/diag-mcqgen-call.ts [IDENTIFIER]
 */
import fs from "fs";
import mongoose from "mongoose";
import { GoogleGenerativeAI } from "@google/generative-ai";

function loadEnv() {
  const env = fs.readFileSync(".env.local", "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SYSTEM = `You are a pharmaceutical GMP training expert. Generate multiple-choice questions from the provided SOP text.
Return ONLY valid JSON with this shape:
{ "questions": [ { "question","optionA","optionB","optionC","optionD","correctAnswer","explanation","difficulty","topic","sopReference" } ] }
Rules:
- Difficulty mix ~40/40/20. Answerable from the SOP only. No duplicates.
- "sopReference" REQUIRED: cite the exact numbered clause (e.g. "4.6.1.4"); only use a heading if the section has no number.`;

async function main() {
  loadEnv();
  await mongoose.connect(process.env.MONGODB_URI!);
  const arg = process.argv[2] ?? "QAMI38-06";
  const col = mongoose.connection.collection("sops");
  const records = await col
    .find({ identifier: { $regex: new RegExp(arg.replace(/-/g, "-?"), "i") }, language: "English" })
    .toArray();

  if (!records.length) {
    console.log(`No English records for ${arg}`);
    await mongoose.disconnect();
    return;
  }
  // Mirror representativesByLanguage: prefer READABLE content (reject raw %PDF /
  // placeholder), not merely the longest record.
  const quality = (c?: string): number => {
    if (!c) return 0;
    const t = c.trim();
    if (!t || t.startsWith("%PDF") || t.startsWith("[")) return 0;
    const r = (t.match(/[A-Za-z0-9 .,():;\/-]/g)?.length ?? 0) / t.length;
    return r < 0.6 ? 0 : t.length;
  };
  const rep = (records as any[]).sort((a, b) => quality(b.content) - quality(a.content))[0];
  const content: string = (rep.content ?? "").slice(0, 80000);
  console.log(`SOP ${rep.identifier} English — ${rep.fileType}, readable content ${content.length} chars\n`);

  const user = `Language: English
SOP Identifier: ${rep.identifier}
Department: ${rep.department}
Generate exactly 25 NEW unique MCQs covering different details of the SOP.

SOP CONTENT:
${content}`;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const chain = [
    process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
  ];

  for (const modelName of [...new Set(chain)]) {
    process.stdout.write(`\n--- ${modelName} ---\n`);
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM,
        generationConfig: { maxOutputTokens: 16384, responseMimeType: "application/json" },
      });
      const result = await model.generateContent(user);
      const resp = result.response;
      const cand = resp.candidates?.[0];
      let text = "";
      try {
        text = resp.text() ?? "";
      } catch (e) {
        console.log(`  resp.text() threw: ${(e as Error).message.slice(0, 120)}`);
      }
      console.log(`  finishReason=${cand?.finishReason ?? "?"}  blockReason=${resp.promptFeedback?.blockReason ?? "-"}`);
      console.log(`  safetyRatings=${JSON.stringify(cand?.safetyRatings ?? [])}`);
      console.log(`  text length=${text.length}`);
      if (text) {
        let n = 0;
        try {
          n = (JSON.parse(text).questions ?? []).length;
        } catch {
          n = -1;
        }
        console.log(`  parsed questions=${n}`);
        try {
          const refs = (JSON.parse(text).questions ?? []).map((q: any) => q.sopReference);
          console.log(`  sopReferences: ${JSON.stringify(refs.slice(0, 12))}`);
        } catch {
          /* ignore */
        }
        console.log(`  head: ${text.slice(0, 160).replace(/\s+/g, " ")}`);
      }
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
