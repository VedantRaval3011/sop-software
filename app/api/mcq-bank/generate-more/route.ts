import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import MCQBank from "@/models/MCQBank";
import SOP from "@/models/SOP";
import { generateJson } from "@/lib/gemini";
import { appendGeneratedToBank, type BankInputMcq } from "@/lib/mcq-bank-write";
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

    // Exclude the questions already in this SOP's bank so the model produces new ones.
    const existingBank = await MCQBank.findOne({ sopId: sop._id, language }).select("mcqs.question").lean();
    const excluded = (existingBank?.mcqs ?? []).map((m) => m.question).join("\n- ");

    const result = await generateJson<{ questions: BankInputMcq[] }>(
      REPLACE_PROMPT,
      `SOP content:\n${sop.content.slice(0, 40000)}\n\nExcluded similar questions:\n- ${excluded}\n\nGenerate ${count} new unique questions in ${language}.`,
    );

    // appendGeneratedToBank dedups against the existing bank before appending.
    const { inserted, total } = await appendGeneratedToBank(sop, language, result.questions ?? []);

    await SOP.updateMany({ identifier, language }, { mcqCount: total });
    invalidateDashboardSopsCache();

    return NextResponse.json({ replaced: inserted, mcqCount: total });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generate more failed" },
      { status: 500 },
    );
  }
}
