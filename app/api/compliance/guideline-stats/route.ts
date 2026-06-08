import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import ComplianceAnalysis from "@/models/ComplianceAnalysis";
import Guideline from "@/models/Guideline";
import { requireAuth } from "@/lib/withAuth";

export async function GET() {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const [guidelines, analyses] = await Promise.all([
      Guideline.find({}).lean(),
      ComplianceAnalysis.find({}).lean(),
    ]);

    const byGuideline = guidelines.map((g) => {
      const related = analyses.filter((a) => a.guidelineId.toString() === g._id.toString());
      const avgScore =
        related.length > 0
          ? Math.round((related.reduce((s, a) => s + a.score, 0) / related.length) * 10) / 10
          : null;
      return {
        id: g._id.toString(),
        name: g.name,
        folder: g.folder,
        clauseCount: g.clauses.length,
        analysisCount: related.length,
        averageScore: avgScore,
        rating:
          avgScore === null ? "pending" : avgScore >= 8 ? "green" : avgScore >= 5 ? "amber" : "red",
      };
    });

    return NextResponse.json({ guidelines: byGuideline });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch guideline stats" },
      { status: 500 },
    );
  }
}
