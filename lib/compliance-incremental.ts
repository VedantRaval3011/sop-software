import { generateComplianceJson } from "@/lib/llm";
import type { LlmProvider } from "@/lib/llm";
import ComplianceGapFinding, { type ResolutionStatus } from "@/models/ComplianceGapFinding";
import ComplianceReport from "@/models/ComplianceReport";
import {
  extractSectionText,
  getChangedSectionIds,
  getOrBuildComplianceStructure,
  type CachedParsedSop,
} from "@/lib/compliance-sop-cache";
import { computeOpenGapScore } from "@/lib/compliance-finding-store";
import { hashSopContent } from "@/lib/compliance-hashes";
import type { ISOP } from "@/models/SOP";

type IncrementalReviewResult = {
  reviewed: number;
  skipped: number;
  resolved: number;
  stillOpen: number;
  needsManualReview: number;
  overallScore: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  improvementCount: number;
};

type LlmResolution = {
  status: "resolved" | "partially-resolved" | "still-present" | "cannot-determine";
  reasoning: string;
  confidence: number;
};

async function reviewSingleGap(
  gap: {
    gapId: string;
    guidelineRequirement: string;
    evidenceGuidelineQuote: string;
    gapExplanation: string;
    sopSection: string;
    proposedVerbiage: string;
  },
  currentSectionText: string,
  provider?: LlmProvider,
): Promise<LlmResolution> {
  const system = `You are an experienced GMP compliance auditor performing incremental revalidation.
Given ONLY the guideline requirement and the current SOP section text, determine if a previously identified gap is now addressed.
Return ONLY valid JSON:
{
  "status": "resolved" | "partially-resolved" | "still-present" | "cannot-determine",
  "reasoning": "string (1-2 sentences citing evidence)",
  "confidence": number (0-100)
}
Use "resolved" only when the SOP section clearly addresses the requirement.
Use "still-present" when the original gap remains.
Do not invent requirements not in the guideline quote.`;

  const user = `ORIGINAL GAP:
${gap.gapExplanation}

GUIDELINE REQUIREMENT:
${gap.evidenceGuidelineQuote || gap.guidelineRequirement}

CURRENT SOP SECTION (${gap.sopSection}):
${currentSectionText.slice(0, 4000)}

SUGGESTED FIX (for reference only):
${gap.proposedVerbiage.slice(0, 1000)}`;

  try {
    return await generateComplianceJson<LlmResolution>(system, user, provider);
  } catch {
    return {
      status: "cannot-determine",
      reasoning: "Incremental review could not complete — manual review required.",
      confidence: 0,
    };
  }
}

function mapResolutionStatus(status: LlmResolution["status"]): ResolutionStatus {
  switch (status) {
    case "resolved":
      return "resolved";
    case "partially-resolved":
      return "partially-resolved";
    case "still-present":
      return "still-present";
    default:
      return "needs-manual-review";
  }
}

/**
 * Stage 3 — Incremental compliance review.
 * Only re-evaluates unresolved findings whose SOP sections changed.
 */
export async function runIncrementalComplianceReview(
  sop: Pick<ISOP, "_id" | "content" | "complianceStructureCache">,
  opts?: { provider?: LlmProvider; previousStructure?: CachedParsedSop["sectionHashes"] },
): Promise<IncrementalReviewResult> {
  const structure = await getOrBuildComplianceStructure(sop);
  const changedSections = opts?.previousStructure
    ? getChangedSectionIds(opts.previousStructure, structure.sectionHashes)
    : new Set(structure.sectionHashes.map((s) => s.sectionId));

  const unresolved = await ComplianceGapFinding.find({
    sopId: sop._id,
    resolved: false,
  }).lean();

  let reviewed = 0;
  let skipped = 0;
  let resolved = 0;
  let stillOpen = 0;
  let needsManualReview = 0;

  for (const gap of unresolved) {
    const sectionNum = (gap.sopSection || "").match(/(\d+(?:\.\d+)*)/)?.[1] ?? gap.sopSection;
    const sectionChanged =
      changedSections.size === 0 ||
      changedSections.has(sectionNum) ||
      changedSections.has(gap.sopSection);

    if (!sectionChanged) {
      skipped++;
      continue;
    }

    const sectionText = extractSectionText(structure.parsed, gap.sopSection);
    const currentHash = hashSopContent(sectionText);

    if (currentHash === gap.sopTextHash) {
      skipped++;
      continue;
    }

    reviewed++;
    const result = await reviewSingleGap(gap, sectionText, opts?.provider);
    const resolutionStatus = mapResolutionStatus(result.status);
    const isResolved = result.status === "resolved";

    await ComplianceGapFinding.updateOne(
      { gapId: gap.gapId },
      {
        $set: {
          sopSectionText: sectionText,
          sopTextHash: currentHash,
          resolutionStatus,
          resolved: isResolved,
          resolvedAt: isResolved ? new Date() : undefined,
          lastReviewedAt: new Date(),
          gapExplanation: isResolved
            ? `Resolved: ${result.reasoning}`
            : `${gap.gapExplanation}\n\nRevalidation (${new Date().toISOString().slice(0, 10)}): ${result.reasoning}`,
          confidenceScore: result.confidence,
        },
      },
    );

    if (isResolved) resolved++;
    else if (resolutionStatus === "needs-manual-review") needsManualReview++;
    else stillOpen++;
  }

  const allGaps = await ComplianceGapFinding.find({ sopId: sop._id }).lean();
  const scoreStats = computeOpenGapScore(allGaps);

  await ComplianceReport.updateOne(
    { sopId: sop._id },
    {
      $set: {
        overallScore: scoreStats.score,
        criticalCount: scoreStats.critical,
        majorCount: scoreStats.major,
        minorCount: scoreStats.minor,
        improvementCount: scoreStats.improvements,
        analyzedAt: new Date(),
      },
    },
  );

  return {
    reviewed,
    skipped,
    resolved,
    stillOpen,
    needsManualReview,
    overallScore: scoreStats.score,
    criticalCount: scoreStats.critical,
    majorCount: scoreStats.major,
    minorCount: scoreStats.minor,
    improvementCount: scoreStats.improvements,
  };
}
