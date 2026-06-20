import SOP, { type ISOP } from "@/models/SOP";
import MCQBank from "@/models/MCQBank";
import { generateJson } from "@/lib/gemini";
import { invalidateDashboardSopsCache } from "@/lib/server-cache";
import { connectDB } from "@/lib/mongodb";
import { replaceBankForSop } from "@/lib/mcq-bank-write";

export interface GeneratedMCQ {
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
}

const MCQ_SYSTEM_PROMPT = `You are a pharmaceutical GMP training expert. Generate multiple-choice questions from the provided SOP text.
Return ONLY valid JSON with this shape:
{
  "questions": [
    {
      "question": "...",
      "optionA": "...",
      "optionB": "...",
      "optionC": "...",
      "optionD": "...",
      "correctAnswer": "A"|"B"|"C"|"D",
      "explanation": "...",
      "difficulty": "easy"|"medium"|"hard",
      "topic": "..."
    }
  ]
}
Rules:
- Cover all major topics in the document
- Difficulty mix: ~40% easy, ~40% medium, ~20% hard
- Questions must be answerable from the SOP text only
- No duplicate or near-duplicate questions`;

async function generateForLanguage(
  sop: ISOP,
  language: "English" | "Gujarati",
  count = 10,
): Promise<GeneratedMCQ[]> {
  const userPrompt = `Language: ${language}
SOP Identifier: ${sop.identifier}
Department: ${sop.department}
Generate exactly ${count} MCQs.

SOP CONTENT:
${sop.content.slice(0, 80000)}`;

  const result = await generateJson<{ questions: GeneratedMCQ[] }>(MCQ_SYSTEM_PROMPT, userPrompt);
  return result.questions ?? [];
}

/** Keep one representative SOP record per language (prefer the one with the most
 *  content) so we generate exactly one MCQ bank per (SOP family, language). */
function representativesByLanguage(sops: ISOP[]): Map<"English" | "Gujarati", ISOP> {
  const byLang = new Map<"English" | "Gujarati", ISOP>();
  for (const s of sops) {
    const lang = (s.language ?? "English") as "English" | "Gujarati";
    const cur = byLang.get(lang);
    if (!cur || (s.content?.length ?? 0) > (cur.content?.length ?? 0)) byLang.set(lang, s);
  }
  return byLang;
}

export async function runMcqGeneration(identifier: string): Promise<{
  identifier: string;
  totalApproved: number;
  totalRecycled: number;
}> {
  await connectDB();

  const sops = await SOP.find({ identifier: new RegExp(`^${identifier}$`, "i") });
  if (!sops.length) throw new Error(`SOP not found: ${identifier}`);

  const sopIds = sops.map((s) => s._id.toString());

  await SOP.updateMany(
    { _id: { $in: sopIds } },
    { pipelineStatus: "mcq_generating" },
  );

  let totalApproved = 0;
  let totalRecycled = 0;

  try {
    const reps = representativesByLanguage(sops);

    for (const [lang, sop] of reps) {
      if (!sop.content || sop.content.length < 50) continue;

      const generated = await generateForLanguage(sop, lang, 10);

      await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "similarity_checking" });

      // Write straight into the MCQ Bank (mcqbanks) — the single source the bank
      // UI, registry and LMS exams all read. The previous active bank is archived
      // to the Obsolete MCQs section and a fresh active bank is installed.
      const { inserted, skipped } = await replaceBankForSop(sop, lang, generated);
      totalApproved += inserted;
      totalRecycled += skipped;

      // Reflect this language's bank total on every record of this identifier+language
      // so the Dashboard "X questions" column stays in sync.
      const idRegex = new RegExp(`^${sop.identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
      const bankTotal = await MCQBank.findOne({ sopIdentifier: idRegex, language: lang })
        .select("totalQuestions")
        .lean();
      const langSopIds = sops
        .filter((s) => ((s.language ?? "English") as string) === lang)
        .map((s) => s._id);
      await SOP.updateMany(
        { _id: { $in: langSopIds } },
        { mcqCount: bankTotal?.totalQuestions ?? inserted },
      );
    }

    await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "updating_platform" });

    await SOP.updateMany(
      { _id: { $in: sopIds } },
      { pipelineStatus: "approved", status: "completed" },
    );

    invalidateDashboardSopsCache();
    return { identifier, totalApproved, totalRecycled };
  } catch (error) {
    await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "failed" });
    throw error;
  }
}

export async function triggerMcqGenerationAsync(identifier: string) {
  runMcqGeneration(identifier).catch((err) => {
    console.error(`MCQ generation failed for ${identifier}:`, err);
  });
}
