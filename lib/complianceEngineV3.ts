import { generateJson } from "@/lib/gemini";
import type { ComplianceFinding, ComplianceAnalysisResult } from "@/lib/complianceEngine";
import { getScoreLabel } from "@/lib/complianceEngine";
import { calculateCompliancePercentage, formatConfidence, buildImpactAnalysis } from "@/lib/complianceFormatter";
import {
  cleanFindingText,
  buildProposedVerbiage,
  validateAllFindings,
} from "@/lib/ComplianceFindingValidator";
import { parseSopStructure, buildSectionSummary } from "@/lib/sopStructureParser";

export interface GuidelineClauseInput {
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
  guidelineName: string;
  folderName: string;
  pdfName?: string;
  guidelineId?: string;
}

// ── Department Intelligence ────────────────────────────────────────────────

const DEPT_KEYWORD_MAP: Record<string, string[]> = {
  store:        ["storage", "handling", "distribution", "packaging", "labeling", "temperature", "humidity", "expiry", "dispatch", "receipt", "warehouse", "inventory", "shelf life", "cool", "cold chain", "finished goods"],
  distribution: ["distribution", "transport", "delivery", "dispatch", "logistics", "chain of custody", "cold chain", "vehicle", "shipment"],
  manufacturing:["manufacture", "production", "batch", "process", "equipment", "validation", "in-process", "yield", "blending", "filling", "tabletting"],
  quality_ctrl: ["testing", "analysis", "specification", "sampling", "method", "instrument", "calibration", "out-of-specification", "oos", "laboratory", "qc"],
  quality_assu: ["audit", "review", "approval", "deviation", "capa", "change control", "validation", "self-inspection", "complaint", "recall", "qa"],
  documentation:["document", "record", "sop", "form", "revision", "controlled", "archive", "retention", "version"],
  hr_training:  ["training", "personnel", "qualification", "hygiene", "health", "gown", "gmp training", "competency"],
  equipment:    ["equipment", "maintenance", "calibration", "qualification", "cleaning", "preventive maintenance", "breakdown", "iq", "oq", "pq"],
  microbiology: ["microbiology", "sterility", "endotoxin", "bioburden", "environmental monitoring", "cleanroom"],
};

function buildContextKeywords(department: string, sopName: string, sopContent: string): Set<string> {
  const haystack = `${department} ${sopName} ${sopContent.slice(0, 3000)}`.toLowerCase();
  const matched = new Set<string>();

  for (const keywords of Object.values(DEPT_KEYWORD_MAP)) {
    for (const kw of keywords) {
      if (haystack.includes(kw)) matched.add(kw);
    }
  }

  const universal = ["gmp", "gdp", "gcp", "ich", "who", "fda", "eu gmp", "schedule m", "cgmp", "compliance", "regulatory", "quality"];
  for (const kw of universal) {
    if (haystack.includes(kw.toLowerCase())) matched.add(kw.toLowerCase());
  }

  return matched;
}

function scoreClauseRelevance(clause: GuidelineClauseInput, keywords: Set<string>): number {
  const text = `${clause.clauseTitle} ${clause.clauseText}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const occurrences = text.split(kw).length - 1;
    if (occurrences > 0) score += Math.min(occurrences, 3);
  }
  return score;
}

function clauseKey(c: { guidelineName?: string; clauseNumber?: string }): string {
  return `${c.guidelineName ?? ""}::${c.clauseNumber ?? ""}`;
}

function matchClause(
  batch: GuidelineClauseInput[],
  finding: Partial<ComplianceFinding> & { guidelineName?: string },
): GuidelineClauseInput | undefined {
  if (finding.guidelineName) {
    const byBoth = batch.find(
      (c) => c.clauseNumber === finding.clauseNumber && c.guidelineName === finding.guidelineName,
    );
    if (byBoth) return byBoth;
  }
  if (finding.clauseTitle) {
    const byTitle = batch.find(
      (c) => c.clauseTitle === finding.clauseTitle && (!finding.guidelineName || c.guidelineName === finding.guidelineName),
    );
    if (byTitle) return byTitle;
  }
  return batch.find((c) => c.clauseNumber === finding.clauseNumber);
}

function isBatchFailureError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes("json") || lower.includes("syntax") || lower.includes("truncat") || lower.includes("valid");
}

// ── Clause Selection ───────────────────────────────────────────────────────

const MAX_CLAUSES_PER_BATCH = 5;
const BATCH_DELAY_MS = 2_000;
const MAX_SOP_CHARS_PER_BATCH = 80_000;
const MAX_CLAUSE_TEXT_CHARS = 2_000;

/** Order clauses by department relevance but include ALL — never skip for coverage. */
function orderClausesForAnalysis(
  allClauses: GuidelineClauseInput[],
  keywords: Set<string>,
  maxTotal?: number,
): GuidelineClauseInput[] {
  const scored = allClauses.map((c) => ({
    clause: c,
    score: scoreClauseRelevance(c, keywords),
  }));

  scored.sort((a, b) => b.score - a.score);

  const limit = maxTotal && maxTotal > 0 ? Math.min(maxTotal, allClauses.length) : allClauses.length;
  const selected = scored.slice(0, limit).map((s) => s.clause);

  if (selected.length < allClauses.length && limit >= allClauses.length) {
    const seen = new Set(selected.map(clauseKey));
    for (const c of allClauses) {
      if (!seen.has(clauseKey(c))) selected.push(c);
    }
  }

  return selected;
}

// ── Gemini Analysis ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior pharmaceutical regulatory compliance auditor specializing in GMP, GDP, ICH, WHO, FDA, and EU guidelines.

Perform a rigorous LINE-BY-LINE compliance analysis of the indexed SOP against EACH guideline clause.

METHODOLOGY:
1. Scan indexed SOP lines (L001, L002, ...) for content that DIRECTLY addresses each clause's specific regulatory topic.
2. Cite ONLY lines that substantively implement the requirement — never tangential keyword matches.
3. FORBIDDEN: citing operational steps (valve checks, weighing, mixing, environmental monitoring) as evidence for data governance, ALCOA+, quality system, or framework-level requirements unless those lines explicitly discuss those topics.
4. FORBIDDEN: marking "partial" or "compliant" because SOP mentions "records", "verify", or "ensure" when the clause requires a specific regulatory concept (e.g. ALCOA+, data governance, change control, risk management).
5. sopTextSnippet: cite at most 1–2 lines that DIRECTLY address the requirement, or "Not Found".
6. If the SOP has no substantive coverage → non-compliant (not partial). If clause is outside SOP scope → not-applicable.
7. Base complianceLevel ONLY on substantive evidence — never assume or infer unstated content.
8. sopSectionAffected MUST use line references: "L042 [§4.2 Storage Conditions]" format.

CRITICAL OUTPUT RULES:
1. Return EXACTLY one finding per clause — same order as input. Do NOT skip clauses.
2. ALWAYS include "guidelineName" and "clauseNumber" in every finding.
3. guidelineRequirement MUST quote or paraphrase the actual clause requirement text.
4. sopTextSnippet MUST be verbatim from 1–2 DIRECTLY relevant SOP lines, or "Not Found" if absent. Never dump unrelated lines.
5. matchConfidence above 70 ONLY when substantive requirement coverage is demonstrated — not for keyword overlap.
6. Keep responses compact to avoid truncation:
   - "compliant": guidelineName, clauseNumber, clauseTitle, complianceLevel, matchConfidence, issueSeverity:"informational", sopSectionAffected, sopTextSnippet (required — must be substantively relevant)
   - "not-applicable": above + mismatchExplanation (≤15 words)
   - "partial": MUST include guidelineRequirement, sopTextSnippet, mismatchExplanation, impactAnalysis, suggestedAction, suggestedText
   - "non-compliant": same as partial with more detailed suggestedText
7. Return ONLY valid complete JSON — no markdown, no truncation.

JSON:
{
  "findings": [
    {
      "guidelineName": "string",
      "clauseNumber": "string",
      "clauseTitle": "string",
      "complianceLevel": "compliant" | "partial" | "non-compliant" | "not-applicable",
      "matchConfidence": number (0-100, use whole numbers like 85 not 0.85),
      "issueSeverity": "critical" | "major" | "minor" | "informational",
      "sopSectionAffected": "string (L### [§section] format)",
      "mismatchExplanation": "string (gap — what is missing in SOP)",
      "impactAnalysis": "string (audit/CAPA/regulatory risk if not fixed)",
      "guidelineRequirement": "string (exact requirement from guideline clause)",
      "suggestedAction": "string (one-line fix instruction)",
      "sopTextSnippet": "string (verbatim quoted text from SOP lines, or Not Found)",
      "suggestedText": "string (exact proposed SOP wording with section number — required for partial/non-compliant, never N/A)",
      "estimatedEffort": "low" | "medium" | "high"
    }
  ],
  "overallScore": number
}`;

function finalizeFinding(
  raw: Partial<ComplianceFinding> & { guidelineName?: string; impactAnalysis?: string } | undefined,
  clause: GuidelineClauseInput,
): ComplianceFinding {
  const requirement =
    raw?.guidelineRequirement?.trim() || clause.clauseText?.slice(0, 600) || clause.clauseTitle;
  const level = raw?.complianceLevel ?? "analysis-failed";
  const isActionable = level === "partial" || level === "non-compliant";

  const gap =
    raw?.mismatchExplanation?.trim() ||
    (isActionable
      ? `The SOP does not fully address ${clause.clauseTitle} as required by ${clause.guidelineName} Clause ${clause.clauseNumber}.`
      : "");

  const impact =
    raw?.impactAnalysis?.trim() ||
    (isActionable ? buildImpactAnalysis({ ...raw, clauseNumber: clause.clauseNumber, guidelineName: clause.guidelineName, mismatchExplanation: gap, issueSeverity: raw?.issueSeverity }, requirement) : "");

  const sopSection = cleanFindingText(raw?.sopSectionAffected);
  const sopSnippet = cleanFindingText(raw?.sopTextSnippet);
  const suggestedAction =
    cleanFindingText(raw?.suggestedAction) ||
    (isActionable
      ? `Add a step to address ${clause.clauseTitle} per ${clause.guidelineName} Clause ${clause.clauseNumber}.`
      : "");

  let suggestedText = cleanFindingText(raw?.suggestedText);
  if (isActionable && !suggestedText) {
    suggestedText = buildProposedVerbiage({
      suggestedAction,
      sopTextSnippet: sopSnippet,
      sopSectionAffected: sopSection,
      gap,
      clauseTitle: clause.clauseTitle,
      clauseNumber: clause.clauseNumber,
      guidelineName: clause.guidelineName,
    });
  }

  return {
    clauseNumber: raw?.clauseNumber ?? clause.clauseNumber,
    clauseTitle: raw?.clauseTitle ?? clause.clauseTitle,
    complianceLevel: level,
    matchConfidence: formatConfidence(raw?.matchConfidence ?? 0),
    issueSeverity: raw?.issueSeverity ?? (level === "non-compliant" ? "major" : "informational"),
    sopSectionAffected: sopSection || (isActionable ? "" : ""),
    mismatchExplanation: gap,
    sopTextSnippet: sopSnippet,
    guidelineRequirement: requirement,
    suggestedAction,
    suggestedText,
    impactAnalysis: impact,
    highlightedIssue: gap,
    estimatedEffort: raw?.estimatedEffort ?? "medium",
    guidelineName: raw?.guidelineName ?? clause.guidelineName,
    folderName: clause.folderName,
    guidelineId: clause.guidelineId,
  };
}

async function analyzeBatch(
  sopIdentifier: string,
  sopName: string,
  department: string,
  indexedSopContent: string,
  sectionSummary: string,
  batch: GuidelineClauseInput[],
  batchLabel: string,
): Promise<{ findings: ComplianceFinding[]; overallScore: number }> {
  const clausesBlock = batch
    .map(
      (c, idx) =>
        `#${idx + 1} [${c.clauseNumber}] GUIDELINE: ${c.guidelineName} | ${c.clauseTitle}\n${(c.clauseText ?? "").slice(0, MAX_CLAUSE_TEXT_CHARS)}`,
    )
    .join("\n\n");

  const sopBlock = indexedSopContent.slice(0, MAX_SOP_CHARS_PER_BATCH);

  const userPrompt = `DEPARTMENT: ${department}
SOP: ${sopIdentifier} — ${sopName}
BATCH: ${batchLabel} | ${batch.length} clauses

=== SOP SECTION MAP ===
${sectionSummary}

=== CLAUSES (analyze each in order — line-by-line against indexed SOP) ===
${clausesBlock}

=== INDEXED SOP CONTENT (scan every line L001+) ===
${sopBlock}

Return exactly ${batch.length} findings in the same order. Include guidelineName on every finding.
Quote verbatim SOP text with line references. Base judgments on evidence only.`;

  console.log(`[complianceV3] batch ${batchLabel}: sending ${batch.length} clauses, SOP ${sopBlock.length} chars`);

  const parsed = await generateJson<{
    findings: (ComplianceFinding & { guidelineName?: string; impactAnalysis?: string })[];
    overallScore: number;
  }>(SYSTEM_PROMPT, userPrompt);

  if (!Array.isArray(parsed.findings)) {
    throw new SyntaxError(`Batch ${batchLabel}: invalid findings array`);
  }

  console.log(`[complianceV3] batch ${batchLabel}: received ${parsed.findings.length} findings`);

  const usedKeys = new Set<string>();
  const enriched: ComplianceFinding[] = [];

  for (let i = 0; i < batch.length; i++) {
    const clause = batch[i];
    const raw = parsed.findings[i] ?? parsed.findings.find((f) => matchClause([clause], f));
    const matched = raw ? matchClause(batch, raw) ?? clause : clause;

    const key = clauseKey(matched);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);

    enriched.push(finalizeFinding(raw, matched));
  }

  // Fill any clauses Gemini skipped
  for (const clause of batch) {
    if (!usedKeys.has(clauseKey(clause))) {
      enriched.push(finalizeFinding(undefined, clause));
      enriched[enriched.length - 1].complianceLevel = "analysis-failed";
      enriched[enriched.length - 1].mismatchExplanation = "Clause was not returned by AI — retry analysis";
    }
  }

  return { findings: enriched, overallScore: parsed.overallScore ?? 0 };
}

/** On JSON/truncation failure, split batch in half and retry recursively. */
async function analyzeBatchResilient(
  sopIdentifier: string,
  sopName: string,
  department: string,
  indexedSopContent: string,
  sectionSummary: string,
  batch: GuidelineClauseInput[],
  batchLabel: string,
): Promise<{ findings: ComplianceFinding[]; overallScore: number }> {
  if (batch.length === 0) return { findings: [], overallScore: 0 };

  if (batch.length === 1) {
    try {
      return await analyzeBatch(
        sopIdentifier, sopName, department, indexedSopContent, sectionSummary, batch, batchLabel,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        findings: [{
          clauseNumber: batch[0].clauseNumber,
          clauseTitle: batch[0].clauseTitle,
          complianceLevel: "analysis-failed",
          matchConfidence: 0,
          issueSeverity: "informational",
          sopSectionAffected: "",
          mismatchExplanation: `Analysis failed: ${msg.slice(0, 100)}`,
          sopTextSnippet: "",
          guidelineRequirement: batch[0].clauseText?.slice(0, 600) ?? "",
          suggestedAction: "",
          suggestedText: "",
          estimatedEffort: "medium",
          guidelineName: batch[0].guidelineName,
          folderName: batch[0].folderName,
          guidelineId: batch[0].guidelineId,
        }],
        overallScore: 0,
      };
    }
  }

  try {
    return await analyzeBatch(
      sopIdentifier, sopName, department, indexedSopContent, sectionSummary, batch, batchLabel,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isBatchFailureError(msg)) throw err;

    console.warn(`[complianceV3] batch ${batchLabel} split (${batch.length} clauses) due to: ${msg.slice(0, 80)}`);
    const mid = Math.ceil(batch.length / 2);
    const left = await analyzeBatchResilient(
      sopIdentifier, sopName, department, indexedSopContent, sectionSummary,
      batch.slice(0, mid), `${batchLabel}a`,
    );
    await sleep(BATCH_DELAY_MS);
    const right = await analyzeBatchResilient(
      sopIdentifier, sopName, department, indexedSopContent, sectionSummary,
      batch.slice(mid), `${batchLabel}b`,
    );
    return {
      findings: [...left.findings, ...right.findings],
      overallScore: (left.overallScore + right.overallScore) / 2,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function computeScoreFromFindings(findings: ComplianceFinding[]): number {
  const applicable = findings.filter(
    (f) => f.complianceLevel !== "not-applicable" && f.complianceLevel !== "analysis-failed",
  );
  const compliant = applicable.filter((f) => f.complianceLevel === "compliant").length;
  const partial = applicable.filter((f) => f.complianceLevel === "partial").length;
  if (applicable.length === 0) return 0;
  const pct = calculateCompliancePercentage(compliant, partial, applicable.length);
  return Math.round(pct) / 10;
}

// ── Main Export ────────────────────────────────────────────────────────────

export async function analyzeSOPComplianceV3(request: {
  sopIdentifier: string;
  sopName: string;
  department: string;
  sopContent: string;
  guidelineClauses: GuidelineClauseInput[];
  /** Optional cap for testing; omit or 0 to analyze ALL clauses. */
  maxClauses?: number;
}): Promise<ComplianceAnalysisResult & { cached?: boolean }> {
  const startTime = Date.now();

  console.log(`[complianceV3] starting — SOP: ${request.sopIdentifier}, clauses available: ${request.guidelineClauses.length}`);

  if (!request.sopContent || request.sopContent.trim().length < 50) {
    return {
      findings: [],
      overallScore: 0,
      complianceStatus: "Non-Compliant",
      compliantCount: 0,
      partialCount: 0,
      nonCompliantCount: 0,
      totalGuidelinesChecked: 0,
      processingTimeMs: Date.now() - startTime,
    };
  }

  const parsedSop = parseSopStructure(request.sopContent);
  const sectionSummary = buildSectionSummary(parsedSop);
  const indexedSopContent = parsedSop.indexedContent || request.sopContent;

  console.log(
    `[complianceV3] parsed SOP — ${parsedSop.totalLines} lines, ${parsedSop.sections.length} sections`,
  );

  const contextKeywords = buildContextKeywords(request.department, request.sopName, request.sopContent);
  const selectedClauses = orderClausesForAnalysis(
    request.guidelineClauses,
    contextKeywords,
    request.maxClauses,
  );
  console.log(`[complianceV3] analyzing ${selectedClauses.length} of ${request.guidelineClauses.length} clauses (full coverage)`);

  const batches: GuidelineClauseInput[][] = [];
  for (let i = 0; i < selectedClauses.length; i += MAX_CLAUSES_PER_BATCH) {
    batches.push(selectedClauses.slice(i, i + MAX_CLAUSES_PER_BATCH));
  }

  const allFindings: ComplianceFinding[] = [];

  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await sleep(BATCH_DELAY_MS);
    const label = `${i + 1}/${batches.length}`;
    const batchResult = await analyzeBatchResilient(
      request.sopIdentifier,
      request.sopName,
      request.department,
      indexedSopContent,
      sectionSummary,
      batches[i],
      label,
    );
    allFindings.push(...batchResult.findings);
  }

  const validatedFindings = validateAllFindings(
    allFindings,
    selectedClauses,
    request.sopContent,
    parsedSop,
  );

  const compliantCount = validatedFindings.filter((f) => f.complianceLevel === "compliant").length;
  const partialCount = validatedFindings.filter((f) => f.complianceLevel === "partial").length;
  const nonCompliantCount = validatedFindings.filter((f) => f.complianceLevel === "non-compliant").length;
  const failedCount = validatedFindings.filter((f) => f.complianceLevel === "analysis-failed").length;
  const checkedCount = validatedFindings.length - failedCount;

  if (checkedCount === 0 && validatedFindings.length > 0) {
    throw new Error("Compliance analysis failed: all clauses failed to analyze. Please retry.");
  }

  const score = computeScoreFromFindings(validatedFindings);

  console.log(
    `[complianceV3] complete — ✓${compliantCount} ~${partialCount} ✗${nonCompliantCount} ⚠${failedCount} | score: ${score}/10 | validated ${validatedFindings.length} findings`,
  );

  return {
    findings: validatedFindings,
    overallScore: score,
    complianceStatus: getScoreLabel(score),
    compliantCount,
    partialCount,
    nonCompliantCount,
    totalGuidelinesChecked: selectedClauses.length,
    processingTimeMs: Date.now() - startTime,
  };
}
