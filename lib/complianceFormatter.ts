import type { ComplianceFinding } from "@/lib/complianceEngine";

export function getComplianceStatusColor(status: string): string {
  switch (status) {
    case "Fully Compliant":
      return "text-emerald-600 bg-emerald-50 border-emerald-200";
    case "Partially Compliant":
      return "text-amber-600 bg-amber-50 border-amber-200";
    case "Non-Compliant":
      return "text-rose-600 bg-rose-50 border-rose-200";
    case "Analysis Failed":
      return "text-orange-600 bg-orange-50 border-orange-200";
    default:
      return "text-gray-600 bg-gray-50 border-gray-200";
  }
}

export function getComplianceLevelBadge(level: string): { label: string; className: string } {
  switch (level) {
    case "compliant":
      return { label: "Compliant", className: "bg-emerald-100 text-emerald-800 border-emerald-200" };
    case "partial":
      return { label: "Partial", className: "bg-amber-100 text-amber-800 border-amber-200" };
    case "non-compliant":
      return { label: "Non-Compliant", className: "bg-rose-100 text-rose-800 border-rose-200" };
    case "not-applicable":
      return { label: "N/A", className: "bg-slate-100 text-slate-600 border-slate-200" };
    default:
      return { label: "Failed", className: "bg-gray-100 text-gray-600 border-gray-200" };
  }
}

export function getSeverityBadge(severity: string): { label: string; className: string } {
  switch (severity) {
    case "critical":
      return { label: "Critical", className: "bg-red-100 text-red-800 border-red-300" };
    case "major":
      return { label: "Major", className: "bg-orange-100 text-orange-800 border-orange-300" };
    case "minor":
      return { label: "Minor", className: "bg-yellow-100 text-yellow-800 border-yellow-300" };
    default:
      return { label: "Info", className: "bg-blue-100 text-blue-800 border-blue-200" };
  }
}

export function formatConfidence(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value <= 1) return Math.round(value * 100);
  return Math.round(Math.min(100, value));
}

export function getComplianceLevelBorder(level: string): string {
  switch (level) {
    case "compliant":
      return "border-l-emerald-500";
    case "partial":
      return "border-l-amber-500";
    case "non-compliant":
      return "border-l-rose-500";
    case "not-applicable":
      return "border-l-slate-400";
    default:
      return "border-l-blue-400";
  }
}

export function getScoreColorClass(score: number): string {
  if (score >= 8) return "text-emerald-600";
  if (score >= 5) return "text-amber-600";
  return "text-rose-600";
}

function truncateAtSentenceBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  // Find the last sentence-ending punctuation followed by a space or end-of-slice
  const lastEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
    // also handle a sentence that ends right at the slice boundary
    slice.endsWith('.') || slice.endsWith('?') || slice.endsWith('!') ? slice.length - 1 : -1,
  );
  if (lastEnd > maxLength * 0.4) {
    return slice.slice(0, lastEnd + 1).trimEnd() + '…';
  }
  // No good sentence boundary — fall back to word boundary
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…';
}

export function buildImpactAnalysis(
  finding: {
    mismatchExplanation?: string;
    issueSeverity?: string;
    clauseNumber?: string;
    clauseTitle?: string;
    guidelineName?: string;
    folderName?: string;
    pdfName?: string;
    guidelineReference?: string;
    pageNumber?: string;
    paragraphNumber?: string;
    sopSectionAffected?: string;
  },
  requirement: string,
): string {
  const risk =
    finding.issueSeverity === "critical"
      ? "critical audit findings, product quality risk, or regulatory action"
      : finding.issueSeverity === "major"
        ? "audit findings, batch failure, or a mandatory Corrective and Preventive Action (CAPA)"
        : "documentation gaps during internal or regulatory inspection";

  // Build a precise, traceable source reference
  const docName = finding.pdfName || finding.folderName || finding.guidelineName || "the guideline";
  const clauseLabel = finding.clauseNumber
    ? `§ ${finding.clauseNumber}${finding.clauseTitle ? ` — "${finding.clauseTitle}"` : ""}`
    : "";

  // Prefer explicit guidelineReference if the AI already set it; otherwise compose from parts
  const baseRef = finding.guidelineReference && finding.guidelineReference !== `${finding.guidelineName} Clause ${finding.clauseNumber}`
    ? finding.guidelineReference
    : [docName, clauseLabel].filter(Boolean).join(", ");

  const locationParts: string[] = [];
  if (finding.pageNumber?.trim()) locationParts.push(`p. ${finding.pageNumber.trim()}`);
  if (finding.paragraphNumber?.trim()) locationParts.push(`¶ ${finding.paragraphNumber.trim()}`);

  const preciseSource = locationParts.length > 0
    ? `${baseRef} (${locationParts.join(", ")})`
    : baseRef;

  // SOP section where the gap exists
  const sopSection = finding.sopSectionAffected?.trim();

  // Build as discrete points separated by \n so the UI can render them as bullets
  const points: string[] = [];
  points.push(`Risk: This may result in ${risk}.`);
  points.push(`Source: ${preciseSource}`);
  if (requirement) {
    points.push(`Requirement: "${truncateAtSentenceBoundary(requirement, 500)}"`);
  }
  if (sopSection && sopSection !== "Not Found" && sopSection !== "N/A") {
    points.push(`Gap in: SOP ${sopSection}`);
  }
  points.push("Must be explicitly demonstrated in the SOP text.");

  return points.join("\n");
}

export function calculateCompliancePercentage(
  compliant: number,
  partial: number,
  total: number,
): number {
  if (total === 0) return 0;
  return Math.round(((compliant + partial * 0.5) / total) * 100);
}

export function groupFindingsBySection(findings: ComplianceFinding[]): Map<string, ComplianceFinding[]> {
  const map = new Map<string, ComplianceFinding[]>();
  for (const f of findings) {
    const section = f.sopSectionAffected || "General";
    const key = extractSectionKey(section);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return map;
}

function extractSectionKey(section: string): string {
  const match = String(section).match(/(\d[\d.]*)/);
  return match ? match[1] : String(section).trim() || "General";
}

export function sortFindingsByPriority(findings: ComplianceFinding[]): ComplianceFinding[] {
  const severityOrder: Record<string, number> = { critical: 0, major: 1, minor: 2, informational: 3 };
  const levelOrder: Record<string, number> = { "non-compliant": 0, partial: 1, compliant: 2, "not-applicable": 3, "analysis-failed": 4 };
  return [...findings].sort((a, b) => {
    const levelDiff = (levelOrder[a.complianceLevel] ?? 5) - (levelOrder[b.complianceLevel] ?? 5);
    if (levelDiff !== 0) return levelDiff;
    return (severityOrder[a.issueSeverity] ?? 4) - (severityOrder[b.issueSeverity] ?? 4);
  });
}
