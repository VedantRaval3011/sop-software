import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import MCQ from "@/models/MCQ";
import MCQRecycle from "@/models/MCQRecycle";
import SOP from "@/models/SOP";
import { generateJson } from "@/lib/gemini";
import { isSimilarQuestion } from "@/lib/similarity";
import { invalidateDashboardSopsCache } from "@/lib/server-cache";
import { requireAuth } from "@/lib/withAuth";

const REPLACE_PROMPT = `Generate replacement MCQ questions that are NOT similar to the excluded questions.
Return JSON: { "questions": [{ "question", "optionA", "optionB", "optionC", "optionD", "correctAnswer", "explanation", "difficulty", "topic" }] }`;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const { identifier, language = "English", count = 3 } = await request.json();
    if (!identifier) {
      return NextResponse.json({ error: "identifier required" }, { status: 400 });
    }

    const sop = await SOP.findOne({
      identifier: new RegExp(`^${identifier}$`, "i"),
      language,
    });
    if (!sop) {
      return NextResponse.json({ error: "SOP not found" }, { status: 404 });
    }

    const existing = await MCQ.find({ identifier, language, status: "approved" })
      .select("question")
      .lean();
    const excluded = existing.map((e) => e.question).join("\n- ");

    const result = await generateJson<{ questions: Array<Record<string, string>> }>(
      REPLACE_PROMPT,
      `SOP content:\n${sop.content.slice(0, 40000)}\n\nExcluded similar questions:\n- ${excluded}\n\nGenerate ${count} new unique questions in ${language}.`,
    );

    const approved = [];
    for (const q of result.questions ?? []) {
      const duplicate = existing.some((e) => isSimilarQuestion(q.question, e.question));
      if (duplicate) {
        await MCQRecycle.create({
          ...q,
          identifier,
          language,
          sopId: sop._id,
          department: sop.department,
          similarityScore: 0.75,
          reason: "auto_replace_duplicate",
        });
        continue;
      }
      const doc = await MCQ.create({
        ...q,
        correctAnswer: q.correctAnswer as "A" | "B" | "C" | "D",
        difficulty: (q.difficulty as "easy" | "medium" | "hard") ?? "medium",
        language,
        sopId: sop._id,
        identifier,
        department: sop.department,
        status: "approved",
      });
      approved.push(doc);
    }

    const mcqCount = await MCQ.countDocuments({ identifier, status: "approved" });
    await SOP.updateMany({ identifier }, { mcqCount });
    invalidateDashboardSopsCache();

    return NextResponse.json({ replaced: approved.length, mcqCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generate more failed" },
      { status: 500 },
    );
  }
}
