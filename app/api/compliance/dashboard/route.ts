import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import ComplianceReport from "@/models/ComplianceReport";
import { requireAuth } from "@/lib/withAuth";

export const maxDuration = 60;

/**
 * Compliance Dashboard Analytics.
 * Aggregates stored reports into organisation-wide, department-wise and SOP-wise
 * regulatory metrics for trend analysis and the dashboard upgrade.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const department = request.nextUrl.searchParams.get("department");
    const query: Record<string, unknown> = { analysisStatus: "completed" };
    if (department && department !== "all") query.department = department;

    const reports = await ComplianceReport.find(query)
      .select(
        "sopIdentifier sopName department overallScore complianceStatus compliantCount partialCount " +
          "nonCompliantCount notApplicableCount criticalCount majorCount minorCount improvementCount " +
          "bestPracticeCount clauseCoveragePct totalGuidelinesChecked scoreBreakdown analyzedAt",
      )
      .sort({ analyzedAt: -1 })
      .lean();

    let totalApplicable = 0;
    let totalCompliant = 0;
    let totalPartial = 0;
    let totalNonCompliant = 0;
    let totalImprovement = 0;
    let totalCritical = 0;
    let totalMajor = 0;
    let totalMinor = 0;
    let totalRequirementsEvaluated = 0;
    let coverageAccum = 0;

    const deptMap = new Map<
      string,
      { department: string; sopCount: number; scoreSum: number; compliant: number; partial: number; nonCompliant: number; critical: number; major: number; minor: number; improvement: number }
    >();

    const sopStats: {
      sopIdentifier: string;
      sopName: string;
      department: string;
      overallScore: number;
      complianceStatus: string;
      compliantCount: number;
      partialCount: number;
      nonCompliantCount: number;
      criticalCount: number;
      majorCount: number;
      minorCount: number;
      improvementCount: number;
      clauseCoveragePct: number;
      analyzedAt: Date;
    }[] = [];

    for (const r of reports) {
      const applicable = r.scoreBreakdown?.totalApplicableRequirements ??
        (r.compliantCount + r.partialCount + r.nonCompliantCount);
      const critical = r.criticalCount ?? 0;
      const major = r.majorCount ?? 0;
      const minor = r.minorCount ?? 0;
      const improvement = r.improvementCount ?? 0;

      totalApplicable += applicable;
      totalCompliant += r.compliantCount;
      totalPartial += r.partialCount;
      totalNonCompliant += r.nonCompliantCount;
      totalImprovement += improvement;
      totalCritical += critical;
      totalMajor += major;
      totalMinor += minor;
      totalRequirementsEvaluated += r.totalGuidelinesChecked ?? 0;
      coverageAccum += r.clauseCoveragePct ?? 0;

      const d = deptMap.get(r.department) ?? {
        department: r.department,
        sopCount: 0,
        scoreSum: 0,
        compliant: 0,
        partial: 0,
        nonCompliant: 0,
        critical: 0,
        major: 0,
        minor: 0,
        improvement: 0,
      };
      d.sopCount += 1;
      d.scoreSum += r.overallScore ?? 0;
      d.compliant += r.compliantCount;
      d.partial += r.partialCount;
      d.nonCompliant += r.nonCompliantCount;
      d.critical += critical;
      d.major += major;
      d.minor += minor;
      d.improvement += improvement;
      deptMap.set(r.department, d);

      sopStats.push({
        sopIdentifier: r.sopIdentifier,
        sopName: r.sopName,
        department: r.department,
        overallScore: r.overallScore ?? 0,
        complianceStatus: r.complianceStatus,
        compliantCount: r.compliantCount,
        partialCount: r.partialCount,
        nonCompliantCount: r.nonCompliantCount,
        criticalCount: critical,
        majorCount: major,
        minorCount: minor,
        improvementCount: improvement,
        clauseCoveragePct: r.clauseCoveragePct ?? 0,
        analyzedAt: r.analyzedAt,
      });
    }

    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    const summary = {
      reportCount: reports.length,
      totalRequirementsEvaluated,
      totalApplicableRequirements: totalApplicable,
      clauseCoveragePct: reports.length ? Math.round(coverageAccum / reports.length) : 0,
      compliancePct: pct(totalCompliant, totalApplicable),
      partialCompliancePct: pct(totalPartial, totalApplicable),
      gapPct: pct(totalNonCompliant, totalApplicable),
      criticalFindingsCount: totalCritical,
      majorFindingsCount: totalMajor,
      minorFindingsCount: totalMinor,
      improvementOpportunitiesCount: totalImprovement,
      averageScore: reports.length
        ? Math.round((sopStats.reduce((s, r) => s + r.overallScore, 0) / reports.length) * 10) / 10
        : 0,
    };

    const departmentStats = [...deptMap.values()]
      .map((d) => ({
        department: d.department,
        sopCount: d.sopCount,
        averageScore: d.sopCount ? Math.round((d.scoreSum / d.sopCount) * 10) / 10 : 0,
        compliantCount: d.compliant,
        partialCount: d.partial,
        nonCompliantCount: d.nonCompliant,
        criticalCount: d.critical,
        majorCount: d.major,
        minorCount: d.minor,
        improvementCount: d.improvement,
      }))
      .sort((a, b) => a.averageScore - b.averageScore);

    return NextResponse.json({
      success: true,
      summary,
      departmentStats,
      sopStats: sopStats.sort((a, b) => a.overallScore - b.overallScore),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to build dashboard" },
      { status: 500 },
    );
  }
}
