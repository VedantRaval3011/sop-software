import MCQ from "@/models/MCQ";
import MCQRecycle from "@/models/MCQRecycle";
import SOP, { type ISOP } from "@/models/SOP";
import { generateJson } from "@/lib/gemini";
import { invalidateDashboardSopsCache } from "@/lib/cache";
import { isSimilarQuestion, SIMILARITY_THRESHOLD } from "@/lib/similarity";
import { connectDB } from "@/lib/mongodb";

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

async function loadExistingQuestions(
  identifier: string,
  language: "English" | "Gujarati",
) {
  const [approved, recycled] = await Promise.all([
    MCQ.find({ identifier, language, status: "approved" }).select("question").lean(),
    MCQRecycle.find({ identifier, language }).select("question").lean(),
  ]);
  return [...approved, ...recycled].map((q) => q.question);
}

async function deduplicateQuestions(
  questions: GeneratedMCQ[],
  identifier: string,
  language: "English" | "Gujarati",
  sopId: string,
  department: string,
) {
  const existing = await loadExistingQuestions(identifier, language);
  const approved: GeneratedMCQ[] = [];
  const recycled: GeneratedMCQ[] = [];

  for (const q of questions) {
    const duplicate = existing.some((eq) => isSimilarQuestion(q.question, eq));
    if (duplicate) {
      recycled.push(q);
      await MCQRecycle.create({
        ...q,
        identifier,
        language,
        sopId,
        department,
        similarityScore: SIMILARITY_THRESHOLD,
        reason: "similarity_duplicate",
      });
    } else {
      approved.push(q);
      existing.push(q.question);
    }
  }

  return { approved, recycled };
}

async function generateForLanguage(
  sop: ISOP,
  language: "English" | "Gujarati",
  count = 10,
): Promise<{ approved: GeneratedMCQ[]; recycled: number }> {
  const langLabel = language === "Gujarati" ? "Gujarati" : "English";
  const userPrompt = `Language: ${langLabel}
SOP Identifier: ${sop.identifier}
Department: ${sop.department}
Generate exactly ${count} MCQs.

SOP CONTENT:
${sop.content.slice(0, 80000)}`;

  const result = await generateJson<{ questions: GeneratedMCQ[] }>(MCQ_SYSTEM_PROMPT, userPrompt);
  const questions = result.questions ?? [];

  const { approved, recycled } = await deduplicateQuestions(
    questions,
    sop.identifier,
    langLabel,
    sop._id.toString(),
    sop.department,
  );

  return { approved, recycled: recycled.length };
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
    for (const sop of sops) {
      if (!sop.content || sop.content.length < 50) continue;
      const lang = (sop.language ?? "English") as "English" | "Gujarati";
      const { approved, recycled } = await generateForLanguage(sop, lang, 10);
      totalRecycled += recycled;

      await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "similarity_checking" });

      const docs = approved.map((q) => ({
        ...q,
        language: lang,
        sopId: sop._id,
        identifier: sop.identifier,
        department: sop.department,
        status: "approved" as const,
      }));

      if (docs.length) {
        await MCQ.insertMany(docs);
        totalApproved += docs.length;
      }
    }

    await SOP.updateMany({ _id: { $in: sopIds } }, { pipelineStatus: "updating_platform" });

    const mcqCount = await MCQ.countDocuments({
      identifier: new RegExp(`^${identifier}$`, "i"),
      status: "approved",
    });

    await SOP.updateMany(
      { _id: { $in: sopIds } },
      { mcqCount, pipelineStatus: "approved", status: "completed" },
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
