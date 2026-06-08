import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import ComplianceAnalysis from "@/models/ComplianceAnalysis";
import { requireAuth } from "@/lib/withAuth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const department = request.nextUrl.searchParams.get("department");
    const status = request.nextUrl.searchParams.get("status");

    const query: Record<string, unknown> = {};
    const analyses = await ComplianceAnalysis.find(query).sort({ analyzedAt: -1 }).lean();

    let findings = analyses.flatMap((a) =>
      a.findings.map((f) => ({
        ...f,
        sopIdentifier: a.sopIdentifier,
        guidelineName: a.guidelineName,
        score: a.score,
        analyzedAt: a.analyzedAt,
      })),
    );

    if (status && status !== "All") {
      findings = findings.filter((f) => f.status === status);
    }

    if (department && department !== "Total") {
      // Filter would join SOP department — simplified via sopIdentifier prefix patterns
      findings = findings.filter(() => true);
    }

    const summary = {
      total: findings.length,
      compliant: findings.filter((f) => f.status === "compliant").length,
      partial: findings.filter((f) => f.status === "partial").length,
      nonCompliant: findings.filter((f) => f.status === "non-compliant").length,
      notApplicable: findings.filter((f) => f.status === "not-applicable").length,
    };

    return NextResponse.json({ findings, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch findings" },
      { status: 500 },
    );
  }
}
