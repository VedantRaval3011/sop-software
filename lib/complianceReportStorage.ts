import ComplianceReport from "@/models/ComplianceReport";
import type {
  AuditCompleteness,
  ComplianceFinding,
  ComplianceScoreBreakdown,
  CrossSopDependency,
  TraceabilityMatrixEntry,
} from "@/lib/complianceEngine";
import { computeWeightedScoreBreakdown } from "@/lib/complianceClassification";
import mongoose from "mongoose";

function isObjectId(value?: string): boolean {
  return !!value && mongoose.Types.ObjectId.isValid(value);
}

export async function saveComplianceReport(data: {
  sopId: string;
  sopIdentifier: string;
  sopName: string;
  sopVersion?: string;
  department: string;
  findings: (ComplianceFinding & { guidelineId?: string; folderName?: string })[];
  overallScore: number;
  complianceStatus: string;
  // structured regulatory audit output (V5)
  scoreBreakdown?: ComplianceScoreBreakdown;
  traceabilityMatrix?: TraceabilityMatrixEntry[];
  crossSopDependencies?: CrossSopDependency[];
  auditCompleteness?: AuditCompleteness;
  clauseCoveragePct?: number;
  analysisEngineVersion?: string;
  // accepted but not stored — callers may still pass these
  sopContentLength?: number;
  processingTimeMs?: number;
  guidelinesUsed?: unknown;
}) {
  const compliantCount = data.findings.filter((f) => f.complianceLevel === "compliant").length;
  const partialCount = data.findings.filter((f) => f.complianceLevel === "partial").length;
  const nonCompliantCount = data.findings.filter((f) => f.complianceLevel === "non-compliant").length;
  const notApplicableCount = data.findings.filter((f) => f.complianceLevel === "not-applicable").length;

  // Transparent weighted score — V3 uses its own formula; V5 uses classification weights.
  const isV3Engine = data.analysisEngineVersion?.startsWith("v3");
  const breakdown = data.scoreBreakdown ?? computeWeightedScoreBreakdown(data.findings);
  const scoreFromFindings = isV3Engine
    ? data.overallScore
    : breakdown.totalApplicableRequirements > 0
      ? breakdown.score
      : data.overallScore;

  const criticalCount = data.findings.filter((f) => f.findingCategory === "Critical Non-Compliance").length;
  const majorCount = data.findings.filter((f) => f.findingCategory === "Major Gap").length;
  const minorCount = data.findings.filter((f) => f.findingCategory === "Minor Gap").length;
  const improvementCount = data.findings.filter((f) => f.findingCategory === "Improvement Opportunity").length;
  const bestPracticeCount = data.findings.filter((f) => f.findingCategory === "Best Practice Recommendation").length;

  const reportData = {
    sopId: new mongoose.Types.ObjectId(data.sopId),
    sopIdentifier: data.sopIdentifier,
    sopName: data.sopName,
    sopVersion: data.sopVersion ?? "1.0",
    department: data.department,
    analysisStatus: "completed" as const,
    analysisCompletedAt: new Date(),
    overallScore: scoreFromFindings,
    complianceStatus: data.complianceStatus as never,
    totalGuidelinesChecked: data.findings.length,
    compliantCount,
    partialCount,
    nonCompliantCount,
    notApplicableCount,
    criticalCount,
    majorCount,
    minorCount,
    improvementCount,
    bestPracticeCount,
    clauseCoveragePct: data.clauseCoveragePct ?? data.auditCompleteness?.clauseCoveragePct ?? 0,
    analysisEngineVersion: data.analysisEngineVersion ?? "v5",
    scoreBreakdown: breakdown,
    auditCompleteness: data.auditCompleteness,
    traceabilityMatrix: data.traceabilityMatrix ?? [],
    crossSopDependencies: data.crossSopDependencies ?? [],
    findings: data.findings.map((f) => ({
      guidelineId: isObjectId(f.guidelineId) ? new mongoose.Types.ObjectId(f.guidelineId) : undefined,
      guidelineName: f.guidelineName ?? "",
      folderName: f.folderName ?? "",
      clauseNumber: f.clauseNumber,
      clauseTitle: f.clauseTitle,
      complianceLevel: f.complianceLevel,
      matchConfidence: f.matchConfidence,
      issueSeverity: f.issueSeverity,
      sopSectionAffected: f.sopSectionAffected,
      mismatchExplanation: f.mismatchExplanation,
      sopTextSnippet: f.sopTextSnippet,
      guidelineRequirement: f.guidelineRequirement,
      suggestedAction: f.suggestedAction,
      suggestedText: f.suggestedText,
      impactAnalysis: f.impactAnalysis ?? "",
      estimatedEffort: f.estimatedEffort,
      findingCategory: f.findingCategory,
      riskLevel: f.riskLevel,
      guidelineReference: f.guidelineReference,
      evidenceFound: f.evidenceFound ?? "",
      evidenceMissing: f.evidenceMissing ?? "",
      evidenceStrength: f.evidenceStrength,
      pageNumber: f.pageNumber ?? "",
      paragraphNumber: f.paragraphNumber ?? "",
      requiresManualReview: f.requiresManualReview ?? false,
      findingType: f.findingType ?? "guideline-clause",
      rootCauseKey: f.rootCauseKey ?? "",
      mergedClauseRefs: f.mergedClauseRefs,
      applicability: f.applicability,
      requirementCriticality: f.requirementCriticality,
      scopeOwner: f.scopeOwner,
      whyApplies: f.whyApplies ?? "",
      whyEvidenceInsufficient: f.whyEvidenceInsufficient ?? "",
      whyScoreReduced: f.whyScoreReduced ?? "",
    })),
    analyzedAt: new Date(),
  };

  return ComplianceReport.findOneAndUpdate(
    { sopId: new mongoose.Types.ObjectId(data.sopId) },
    { $set: reportData },
    { upsert: true, new: true },
  );
}

export async function getComplianceReport(sopId: string) {
  return ComplianceReport.findOne({ sopId: new mongoose.Types.ObjectId(sopId) }).lean();
}

export async function getAllComplianceReports(limit = 100) {
  return ComplianceReport.find({})
    .sort({ analyzedAt: -1 })
    .limit(limit)
    .select("-findings")
    .lean();
}

export async function deleteComplianceReport(reportId: string) {
  return ComplianceReport.findByIdAndDelete(reportId);
}
