import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAuth } from "@/lib/withAuth";
import { runMcqGeneration } from "@/lib/mcq-generation";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const body = await request.json();
    const identifier = body.identifier?.trim();
    if (!identifier) {
      return NextResponse.json({ error: "identifier is required" }, { status: 400 });
    }

    const result = await runMcqGeneration(identifier);
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/sop/generate-mcqs error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MCQ generation failed" },
      { status: 500 },
    );
  }
}
