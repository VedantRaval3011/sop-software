import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import ComplianceAnalysis from "@/models/ComplianceAnalysis";
import { requireAuth } from "@/lib/withAuth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const sopId = request.nextUrl.searchParams.get("sopId");
    const guidelineId = request.nextUrl.searchParams.get("guidelineId");

    if (!sopId || !guidelineId) {
      return NextResponse.json(
        { error: "sopId and guidelineId are required" },
        { status: 400 },
      );
    }

    const analysis = await ComplianceAnalysis.findOne({ sopId, guidelineId })
      .sort({ analyzedAt: -1 })
      .lean();

    if (!analysis) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    return NextResponse.json({
      score: analysis.score,
      findings: analysis.findings,
      analyzedAt: analysis.analyzedAt,
      clauseCount: analysis.clauseCount,
      guidelineName: analysis.guidelineName,
      sopIdentifier: analysis.sopIdentifier,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch analysis" },
      { status: 500 },
    );
  }
}
