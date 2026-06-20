/**
 * Compliance Engine V5 — Structured Regulatory Audit
 * --------------------------------------------------
 * Implements a true GMP/QA compliance auditing methodology rather than a generic
 * document-similarity review. Pipeline:
 *
 *   SOP Parsing
 *   → Requirement Mapping (guideline clauses)
 *   → Evidence Matching (evidence found / evidence missing, source traceability)
 *   → Gap Analysis (auditor-grade: missing / weak / ambiguous / incomplete)
 *   → GMP Intelligence Layer (expectations beyond literal clause wording)
 *   → Cross-SOP Dependency Validation
 *   → Duplicate Finding Prevention
 *   → Finding Classification + Risk Classification
 *   → Transparent Compliance Scoring
 *   → Traceability Matrix
 *   → Dashboard Analytics
 *
 * Built on the resilient batching/AI infrastructure proven in V3.
 */

import { generateComplianceJson } from "@/lib/gemini";
import {
  getScoreLabel,
  type AuditCompleteness,
  type ComplianceFinding,
  type ComplianceAnalysisResult,
  type CrossSopDependency,
  type RiskLevel,
  type TraceabilityMatrixEntry,
} from "@/lib/complianceEngine";
import { formatConfidence, buildImpactAnalysis } from "@/lib/complianceFormatter";
import {
  cleanFindingText,
  buildProposedVerbiage,
  validateAllFindings,
} from "@/lib/ComplianceFindingValidator";
import { parseSopStructure, buildSectionSummary } from "@/lib/sopStructureParser";
import {
  applyAuditorStandards,
  classifyAll,
  computeWeightedScoreBreakdown,
  sortByRisk,
} from "@/lib/complianceClassification";
import {
  detectCrossSopReferences,
  detectSopTopics,
  evaluateGmpExpectations,
  type GmpExpectationResult,
} from "@/lib/gmpIntelligence";

export interface GuidelineClauseInput {
  clauseNumber: string;
  clauseTitle: string;
  clauseText: string;
  guidelineName: string;
  folderName: string;
  pdfName?: string;
  guidelineId?: string;
}

export interface SopLibraryEntry {
  identifier: string;
  name: string;
  isObsolete?: boolean;
  expiryDate?: Date | string | null;
}

// ── Tuning (target: full-library audit in ~5–10 min per SOP) ────────────────
//
// Two levers keep this both THOROUGH and FAST:
//  1. SMALL screening batches (40 clauses) so the model genuinely scrutinises every
//     clause instead of rubber-stamping 100-at-a-time as "compliant" — small batches
//     are what made the earlier per-clause engine surface rich, meaningful findings.
//  2. PIPELINED concurrency. The global Gemini queue (lib/gemini.ts) already throttles
//     SENDS to one per 400ms, but lets responses overlap. With concurrency=1 the engine
//     idly waits ~6-10s for each response before sending the next, so a big library took
//     20+ min. At concurrency 4 the engine was still leaving send capacity idle (8s ÷ 4 ≈
//     2s/batch vs the 0.4s send floor), so workers were raised to keep the pipeline full
//     without exceeding the send rate (so no 503 burst), cutting wall-clock time further.
// Minimal JSON for compliant/N/A keeps each call fast; full detail only on gaps.

const MAX_CLAUSES_PER_BATCH = 40;
const MAX_CLAUSES_DEEP_BATCH = 8;
/**
 * Safety cap on phase-2 deep enrichment. A thorough screening pass legitimately
 * surfaces many gaps; deep-enrich the most material ones (sorted by severity) and
 * let the remainder keep their screening-level detail so runtime stays bounded.
 */
const MAX_DEEP_GAP_CLAUSES = 120;
/**
 * Pipelined workers. The 400ms send-gap in lib/gemini.ts is the true rate limit and is
 * preserved regardless of worker count — these workers only overlap response latency so
 * the pipeline stays full. Keep moderate (not 20+) to avoid a 503 pile-up if the API slows.
 */
const BATCH_CONCURRENCY = 8;
const DEEP_BATCH_CONCURRENCY = 6;
const BATCH_DELAY_MS = 300;
const MAX_SOP_CHARS_PER_BATCH = 55_000;
const MAX_CLAUSE_TEXT_CHARS = 350;
const MAX_CLAUSE_TEXT_DEEP = 1_500;

/** Fast screening prompt — compact JSON, but tuned to surface every genuine gap, not rubber-stamp "compliant". */
const SCREENING_PROMPT = `You are an experienced GMP/QA regulatory auditor (EU GMP, WHO, FDA, PIC/S, ICH) performing a defensible clause-by-clause gap assessment.
Screen EVERY clause against the indexed SOP. Return EXACTLY one finding per clause, in the same order. If the batch has N clauses, return N findings.

HOW REAL SOP-vs-GUIDELINE ASSESSMENT WORKS — be honest, not optimistic:
A single SOP rarely FULLY satisfies the specific requirement of an external regulatory clause. Most APPLICABLE clauses are "partial" (the SOP touches the topic but does not fully evidence the specific requirement) or "non-compliant" (applicable but absent). "compliant" is the EXCEPTION — reserve it for clauses the SOP explicitly and completely satisfies with cited text. Do NOT mark a clause "compliant" just because the topic is mentioned in passing.

CLASSIFY EACH CLAUSE (decide applicability FIRST, then compliance):
1. "not-applicable" — the clause's requirement is genuinely outside this SOP's purpose/scope (e.g. a sterile-manufacturing clause for a documentation SOP). Give a ≤12-word reason. Do NOT over-use this to dodge real gaps — if the topic is within scope, it is applicable.
2. "non-compliant" — requirement is applicable but the SOP provides NO substantive supporting evidence anywhere.
3. "partial" — the SOP addresses the topic but does NOT fully meet the clause's SPECIFIC requirement (missing element, vague wording, no responsibility/record/trigger/acceptance-criterion, generic mention only). This is the MOST COMMON outcome for applicable clauses — capture it whenever coverage is incomplete.
4. "compliant" — the SOP explicitly and fully satisfies the specific requirement, with a real cited SOP line as proof.

DISCIPLINE (defensible findings only):
- Search the ENTIRE indexed SOP before concluding. Cite the SOP line you relied on.
- A generic mention of "records / verify / ensure / as per procedure" is NOT evidence for a specific regulatory concept (ALCOA+, change control, risk assessment, data integrity, validation lifecycle). Treat such clauses as "partial" or "non-compliant".
- No speculation ("may", "appears", "could", "seems"). Every gap must name the specific missing element in evidenceMissing.

SCREENING OUTPUT (compact JSON):
- "compliant" / "not-applicable": guidelineName, clauseNumber, clauseTitle, guidelineReference, applicability, scopeOwner, complianceLevel, matchConfidence, requirementCriticality, issueSeverity, sopSectionAffected, sopTextSnippet (≤1 line or "Not Found"), evidenceFound, evidenceMissing ("None" if compliant). For not-applicable add mismatchExplanation ≤12 words. OMIT all other fields.
- "partial" / "non-compliant": above PLUS guidelineRequirement (≤1 line — the specific requirement), mismatchExplanation (≤1 line — the concrete gap), evidenceMissing (the specific missing element). Set issueSeverity and requirementCriticality honestly (critical/major/minor).

Return ONLY valid JSON: {"findings":[...]} with exactly N findings.`;

// ── Auditor System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an experienced GMP/QA regulatory auditor (EU GMP, WHO, FDA, PIC/S, ICH).
You are performing a COMPLETE, DEFENSIBLE CLAUSE-BY-CLAUSE COMPLIANCE AUDIT that must withstand QA challenge and regulatory inspection.

COMPLETENESS IS MANDATORY:
- Evaluate EVERY clause you are given — never skip a clause, never merge clauses, never stop early.
- Return EXACTLY one independent finding for EVERY clause in the batch, in the same order. If the batch has N clauses, return N findings.
- Each clause is judged on its own evidence. Do NOT collapse similar clauses into a single observation.
- Evidence > Assumption. Applicability > Generic comparison. But coverage of all clauses is non-negotiable.

MANDATORY METHOD (requirement-first):
1. Identify the EXACT requirement of the clause.
2. Decide applicability to THIS SOP's scope: "applicable" | "partially-applicable" | "not-applicable".
3. Search the ENTIRE indexed SOP for evidence before concluding anything — never assume absence after one section.
4. Only then judge compliance.

APPLICABILITY (rule 2):
- If the requirement is outside this SOP's purpose/scope → complianceLevel "not-applicable", applicability "not-applicable", give the reason in mismatchExplanation. Do NOT raise a gap and do NOT reduce the score.

NO-ASSUMPTION POLICY (rule 3) — FORBIDDEN:
- Speculative findings ("may be inadequate", "appears incomplete", "could be weak", "possibly insufficient", "seems", "likely").
- Every gap MUST cite a concrete Guideline Requirement + specific Missing SOP Evidence. If evidence exists ANYWHERE in the SOP, do NOT raise the finding.

SCOPE OWNERSHIP (rule 4):
- Decide who owns the topic: "current-sop" | "referenced-sop" | "department-procedure" | "quality-system".
- If the topic is governed by a dedicated referenced SOP (e.g. Change Control, Deviation, CAPA), do NOT penalise this SOP. Mark "compliant" (or "not-applicable") with scopeOwner "referenced-sop" and note that the reference must be verified — do NOT create a non-compliant gap against this SOP for it.

NON-COMPLIANT CRITERIA (rule 5) — mark "non-compliant" ONLY when ALL are true:
  (a) requirement is applicable, AND (b) requirement is genuinely missing, AND (c) NO supporting evidence exists anywhere in the SOP.
Otherwise use "partial" (some evidence, gap remains) or "not-applicable". Do NOT mark non-compliant merely because wording is not explicit.

EVIDENCE FIELDS:
- "evidenceFound": what the SOP DOES provide (verbatim/paraphrase) or "None".
- "evidenceMissing": the specific element still required, or "None" when compliant.
- "sopTextSnippet": 1-2 verbatim SOP lines, or "Not Found".
- "sopSectionAffected": "L042 [§4.2 Title]"; "pageNumber"/"paragraphNumber" only if inferable, else "".
- Do NOT credit generic mentions of "records/verify/ensure" as evidence for a specific regulatory concept.

REQUIREMENT IMPORTANCE & REASONING (for weighted scoring + auditor panel):
- "requirementCriticality": inherent importance of the requirement independent of compliance — "critical" | "major" | "minor".
- "whyApplies": why this requirement applies to this SOP.
- "whyEvidenceInsufficient": precisely why the cited SOP evidence is insufficient (empty when compliant).
- "issueSeverity": "critical" | "major" | "minor" | "informational" (informational for compliant/NA).
- "rootCause": short concept tag (e.g. "change-control", "risk-assessment", "lifecycle-validation") so duplicate gaps merge into one.

OUTPUT COMPACTNESS (critical — large audits must finish in minutes, not hours):
- "compliant" and "not-applicable": REQUIRED fields only — guidelineName, clauseNumber, clauseTitle, guidelineReference, applicability, scopeOwner, complianceLevel, matchConfidence, requirementCriticality, issueSeverity, sopSectionAffected, sopTextSnippet (≤1 line), evidenceFound, evidenceMissing ("None" when compliant). OMIT impactAnalysis, suggestedAction, suggestedText, whyApplies, whyEvidenceInsufficient, mismatchExplanation (unless not-applicable — then ≤15 words).
- "partial" and "non-compliant": include ALL fields below with concise but complete gap analysis (impactAnalysis ≤2 sentences, suggestedText ≤4 sentences).

Generate one complete, evidence-backed finding for EVERY clause — never skip, never merge, never summarise remaining clauses. Return EXACTLY one finding per clause, same order, as valid complete JSON only:
{
  "findings": [
    {
      "guidelineName": "string",
      "clauseNumber": "string",
      "clauseTitle": "string",
      "guidelineReference": "string",
      "applicability": "applicable" | "partially-applicable" | "not-applicable",
      "scopeOwner": "current-sop" | "referenced-sop" | "department-procedure" | "quality-system",
      "complianceLevel": "compliant" | "partial" | "non-compliant" | "not-applicable",
      "matchConfidence": number (0-100),
      "requirementCriticality": "critical" | "major" | "minor",
      "issueSeverity": "critical" | "major" | "minor" | "informational",
      "sopSectionAffected": "string (L### [§section])",
      "pageNumber": "string",
      "paragraphNumber": "string",
      "guidelineRequirement": "string (the actual requirement)",
      "evidenceFound": "string",
      "evidenceMissing": "string",
      "sopTextSnippet": "string (verbatim, or Not Found)",
      "whyApplies": "string",
      "whyEvidenceInsufficient": "string",
      "mismatchExplanation": "string (factual reason for the gap — NO speculation)",
      "impactAnalysis": "string (audit/CAPA/regulatory risk)",
      "suggestedAction": "string (one-line fix)",
      "suggestedText": "string (insertion-ready SOP wording in the SOP's own style, with section number — required for partial/non-compliant)",
      "rootCause": "string",
      "estimatedEffort": "low" | "medium" | "high"
    }
  ]
}`;

function clauseKey(c: { guidelineName?: string; clauseNumber?: string }): string {
  return `${c.guidelineName ?? ""}::${c.clauseNumber ?? ""}`;
}

function matchClause(
  batch: GuidelineClauseInput[],
  finding: { clauseNumber?: string; clauseTitle?: string; guidelineName?: string },
): GuidelineClauseInput | undefined {
  if (finding.guidelineName) {
    const byBoth = batch.find(
      (c) => c.clauseNumber === finding.clauseNumber && c.guidelineName === finding.guidelineName,
    );
    if (byBoth) return byBoth;
  }
  if (finding.clauseTitle) {
    const byTitle = batch.find((c) => c.clauseTitle === finding.clauseTitle);
    if (byTitle) return byTitle;
  }
  return batch.find((c) => c.clauseNumber === finding.clauseNumber);
}

function isBatchFailureError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes("json") || lower.includes("syntax") || lower.includes("truncat") || lower.includes("valid");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type RawFinding = Partial<ComplianceFinding> & {
  guidelineName?: string;
  guidelineReference?: string;
  evidenceFound?: string;
  evidenceMissing?: string;
  pageNumber?: string;
  paragraphNumber?: string;
  rootCause?: string;
  applicability?: ComplianceFinding["applicability"];
  scopeOwner?: ComplianceFinding["scopeOwner"];
  requirementCriticality?: ComplianceFinding["requirementCriticality"];
  whyApplies?: string;
  whyEvidenceInsufficient?: string;
};

const VALID_APPLICABILITY = new Set(["applicable", "partially-applicable", "not-applicable"]);
const VALID_SCOPE_OWNER = new Set([
  "current-sop",
  "referenced-sop",
  "department-procedure",
  "quality-system",
  "unknown",
]);
const VALID_CRITICALITY = new Set(["critical", "major", "minor"]);

function finalizeFinding(raw: RawFinding | undefined, clause: GuidelineClauseInput): ComplianceFinding {
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
    (isActionable
      ? buildImpactAnalysis(
          {
            mismatchExplanation: gap,
            issueSeverity: raw?.issueSeverity,
            clauseNumber: clause.clauseNumber,
            guidelineName: clause.guidelineName,
          },
          requirement,
        )
      : "");

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

  const evidenceMissing =
    cleanFindingText(raw?.evidenceMissing) ||
    (isActionable ? gap : "");

  return {
    clauseNumber: raw?.clauseNumber ?? clause.clauseNumber,
    clauseTitle: raw?.clauseTitle ?? clause.clauseTitle,
    complianceLevel: level,
    matchConfidence: formatConfidence(raw?.matchConfidence ?? 0),
    issueSeverity: raw?.issueSeverity ?? (level === "non-compliant" ? "major" : "informational"),
    sopSectionAffected: sopSection,
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
    findingType: "guideline-clause",
    guidelineReference:
      cleanFindingText(raw?.guidelineReference) || `${clause.guidelineName} Clause ${clause.clauseNumber}`,
    evidenceFound: cleanFindingText(raw?.evidenceFound),
    evidenceMissing,
    pageNumber: (raw?.pageNumber ?? "").toString().trim(),
    paragraphNumber: (raw?.paragraphNumber ?? "").toString().trim(),
    rootCauseKey: (raw?.rootCause ?? "").toString().trim().toLowerCase(),
    applicability: VALID_APPLICABILITY.has(raw?.applicability ?? "")
      ? raw?.applicability
      : undefined,
    scopeOwner: VALID_SCOPE_OWNER.has(raw?.scopeOwner ?? "") ? raw?.scopeOwner : undefined,
    requirementCriticality: VALID_CRITICALITY.has(raw?.requirementCriticality ?? "")
      ? raw?.requirementCriticality
      : undefined,
    whyApplies: cleanFindingText(raw?.whyApplies),
    whyEvidenceInsufficient: cleanFindingText(raw?.whyEvidenceInsufficient),
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
  options?: { deep?: boolean },
): Promise<ComplianceFinding[]> {
  const clauseLimit = options?.deep ? MAX_CLAUSE_TEXT_DEEP : MAX_CLAUSE_TEXT_CHARS;
  const clausesBlock = batch
    .map(
      (c, idx) =>
        `#${idx + 1} [${c.clauseNumber}] GUIDELINE: ${c.guidelineName} | ${c.clauseTitle}\n${(c.clauseText ?? "").slice(0, clauseLimit)}`,
    )
    .join("\n\n");

  const sopBlock = indexedSopContent.slice(0, MAX_SOP_CHARS_PER_BATCH);

  const userPrompt = `DEPARTMENT: ${department}
SOP: ${sopIdentifier} — ${sopName}
BATCH: ${batchLabel} | ${batch.length} clauses${options?.deep ? " | DEEP GAP ENRICHMENT" : " | SCREENING"}

=== SOP SECTION MAP ===
${sectionSummary}

=== CLAUSES (audit each in order against the indexed SOP) ===
${clausesBlock}

=== INDEXED SOP CONTENT (scan every line L001+) ===
${sopBlock}

Return exactly ${batch.length} findings in the same order. Include guidelineName, evidenceFound and evidenceMissing on every finding.${
    options?.deep
      ? " These are confirmed gaps — provide FULL impactAnalysis, suggestedAction, suggestedText, whyApplies, and whyEvidenceInsufficient for each."
      : ""
  }`;

  const parsed = await generateComplianceJson<{ findings: RawFinding[] }>(
    options?.deep ? SYSTEM_PROMPT : SCREENING_PROMPT,
    userPrompt,
  );

  if (!Array.isArray(parsed.findings)) {
    throw new SyntaxError(`Batch ${batchLabel}: invalid findings array`);
  }

  const usedKeys = new Set<string>();
  const enriched: ComplianceFinding[] = [];

  for (let i = 0; i < batch.length; i++) {
    const clause = batch[i];
    const raw = parsed.findings[i] ?? parsed.findings.find((f) => matchClause([clause], f));
    const matched = raw ? (matchClause(batch, raw) ?? clause) : clause;
    const key = clauseKey(matched);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    enriched.push(finalizeFinding(raw, matched));
  }

  for (const clause of batch) {
    if (!usedKeys.has(clauseKey(clause))) {
      const f = finalizeFinding(undefined, clause);
      f.complianceLevel = "analysis-failed";
      f.mismatchExplanation = "Clause was not returned by AI — retry analysis";
      enriched.push(f);
    }
  }

  return enriched;
}

async function analyzeBatchResilient(
  sopIdentifier: string,
  sopName: string,
  department: string,
  indexedSopContent: string,
  sectionSummary: string,
  batch: GuidelineClauseInput[],
  batchLabel: string,
  options?: { deep?: boolean },
): Promise<ComplianceFinding[]> {
  if (batch.length === 0) return [];

  try {
    return await analyzeBatch(
      sopIdentifier, sopName, department, indexedSopContent, sectionSummary, batch, batchLabel, options,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (batch.length === 1 || !isBatchFailureError(msg)) {
      if (batch.length === 1) {
        const f = finalizeFinding(undefined, batch[0]);
        f.complianceLevel = "analysis-failed";
        f.mismatchExplanation = `Analysis failed: ${msg.slice(0, 100)}`;
        return [f];
      }
      throw err;
    }

    const mid = Math.ceil(batch.length / 2);
    const left = await analyzeBatchResilient(
      sopIdentifier, sopName, department, indexedSopContent, sectionSummary, batch.slice(0, mid), `${batchLabel}a`, options,
    );
    await sleep(BATCH_DELAY_MS);
    const right = await analyzeBatchResilient(
      sopIdentifier, sopName, department, indexedSopContent, sectionSummary, batch.slice(mid), `${batchLabel}b`, options,
    );
    return [...left, ...right];
  }
}

/** Phase 2 — full auditor-grade detail for every confirmed gap. */
function needsDeepEnrichment(level: ComplianceFinding["complianceLevel"]): boolean {
  return level === "partial" || level === "non-compliant" || level === "analysis-failed";
}

/** Run many batches in parallel with a fixed worker pool. */
async function runBatchesParallel(
  batches: GuidelineClauseInput[][],
  concurrency: number,
  phase: "screen" | "deep",
  ctx: {
    sopIdentifier: string;
    sopName: string;
    department: string;
    indexedSopContent: string;
    sectionSummary: string;
  },
): Promise<ComplianceFinding[]> {
  if (!batches.length) return [];

  const results: ComplianceFinding[][] = new Array(batches.length);
  let completed = 0;
  let nextIndex = 0;
  const runStart = Date.now();
  const deep = phase === "deep";

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= batches.length) return;
      const label = `${phase} ${i + 1}/${batches.length}`;
      const t0 = Date.now();
      try {
        results[i] = await analyzeBatchResilient(
          ctx.sopIdentifier,
          ctx.sopName,
          ctx.department,
          ctx.indexedSopContent,
          ctx.sectionSummary,
          batches[i],
          label,
          { deep },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[complianceV5] ${label} failed — marking ${batches[i].length} clauses as analysis-failed: ${msg.slice(0, 200)}`);
        results[i] = batches[i].map((clause) => {
          const f = finalizeFinding(undefined, clause);
          f.complianceLevel = "analysis-failed";
          f.mismatchExplanation = `Batch failed (${msg.slice(0, 120)}) — retry analysis`;
          return f;
        });
      }
      completed++;
      console.log(
        `[complianceV5] ${label} done in ${Math.round((Date.now() - t0) / 1000)}s ` +
          `(${completed}/${batches.length} ${phase}, elapsed ${Math.round((Date.now() - runStart) / 1000)}s)`,
      );
    }
  };

  const poolSize = Math.min(concurrency, batches.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results.flat();
}

// ── GMP Intelligence findings ───────────────────────────────────────────────

function buildGmpFindings(
  results: GmpExpectationResult[],
  sopName: string,
): ComplianceFinding[] {
  return results
    .filter((r) => !r.addressed)
    .map((r) => {
      const exp = r.expectation;
      return {
        clauseNumber: `GMP-${exp.id}`,
        clauseTitle: `GMP Expectation: ${exp.title}`,
        complianceLevel: "non-compliant" as const,
        matchConfidence: 60,
        issueSeverity: exp.severity,
        sopSectionAffected: "",
        mismatchExplanation: `An experienced GMP auditor expects this SOP to address ${exp.title}. ${exp.rationale} No substantive coverage was found in the SOP.`,
        sopTextSnippet: "Not Found",
        guidelineRequirement: `${exp.title} — ${exp.rationale}`,
        suggestedAction: `Add a section addressing ${exp.title} to align "${sopName}" with GMP expectations.`,
        suggestedText: `Add a clause describing how ${exp.title.toLowerCase()} is managed for the activities covered by this SOP, including responsibilities, triggers, and the records generated.`,
        impactAnalysis: `Absence of ${exp.title} is a common regulatory audit observation and may result in a finding or mandatory CAPA.`,
        highlightedIssue: `Missing GMP expectation: ${exp.title}`,
        estimatedEffort: "medium" as const,
        guidelineName: "GMP Intelligence Layer",
        folderName: "GMP Expectations",
        findingType: "gmp-expectation" as const,
        guidelineReference: `GMP Expectation — ${exp.title}`,
        evidenceFound: "",
        evidenceMissing: exp.title,
        rootCauseKey: exp.id,
      };
    });
}

// ── Cross-SOP dependency validation ─────────────────────────────────────────

function validateCrossSopDependencies(
  sopContent: string,
  sopLibrary: SopLibraryEntry[],
): { dependencies: CrossSopDependency[]; findings: ComplianceFinding[] } {
  const references = detectCrossSopReferences(sopContent);
  const dependencies: CrossSopDependency[] = [];
  const findings: ComplianceFinding[] = [];

  for (const ref of references) {
    const matches = sopLibrary.filter(
      (s) => ref.libraryMatch.test(s.name) || ref.libraryMatch.test(s.identifier),
    );
    const active = matches.filter((s) => !s.isObsolete);
    const expired = matches.filter((s) => {
      if (!s.expiryDate) return false;
      const d = new Date(s.expiryDate);
      return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
    });

    let status: CrossSopDependency["status"] = "missing";
    let riskLevel: RiskLevel = "Major";
    let note = "";
    let matched: SopLibraryEntry | undefined;

    if (active.length > 0 && expired.length < active.length) {
      status = "available";
      riskLevel = "Improvement";
      matched = active[0];
      note = `Referenced ${ref.type} is present in the SOP library (${matched.identifier}).`;
    } else if (matches.length > 0 && active.length === 0) {
      status = "obsolete";
      riskLevel = "Major";
      matched = matches[0];
      note = `Referenced ${ref.type} exists but all versions are marked obsolete (${matched.identifier}).`;
    } else if (expired.length > 0 && active.length === 0) {
      status = "expired";
      riskLevel = "Major";
      matched = expired[0];
      note = `Referenced ${ref.type} is past its expiry date (${matched.identifier}).`;
    } else {
      status = "missing";
      riskLevel = "Major";
      note = `Referenced ${ref.type} could not be found in the SOP library. Reviewer must confirm it exists and is current.`;
    }

    dependencies.push({
      referencedType: ref.type,
      referenceText: ref.referenceText,
      found: status === "available",
      status,
      matchedSopIdentifier: matched?.identifier,
      matchedSopName: matched?.name,
      riskLevel,
      note,
    });

    if (status !== "available") {
      findings.push({
        clauseNumber: `XREF-${ref.type.replace(/\s+/g, "-")}`,
        clauseTitle: `Cross-SOP Dependency: ${ref.type}`,
        complianceLevel: "non-compliant",
        matchConfidence: 70,
        issueSeverity: "major",
        sopSectionAffected: "",
        mismatchExplanation: note,
        sopTextSnippet: ref.referenceText,
        guidelineRequirement: `This SOP references ${ref.type}; the referenced procedure must exist, be current, and be retrievable.`,
        suggestedAction: `Confirm the referenced ${ref.type} exists, is effective (not obsolete/expired), and cite its document number.`,
        suggestedText: `Update the reference to cite the current effective ${ref.type} (document number and version).`,
        impactAnalysis: `Dangling or obsolete cross-references are a documentation-control audit risk and can invalidate the procedure chain.`,
        highlightedIssue: note,
        estimatedEffort: "low",
        guidelineName: "Cross-SOP Dependency Validation",
        folderName: "Cross-SOP Dependencies",
        findingType: "cross-sop-dependency",
        guidelineReference: `Documentation Control — ${ref.type}`,
        evidenceFound: ref.referenceText,
        evidenceMissing: `Verified current ${ref.type} in SOP library`,
        rootCauseKey: "documentation-retention",
      });
    }
  }

  return { dependencies, findings };
}

// ── Traceability matrix ─────────────────────────────────────────────────────

function levelToMatrixStatus(level: ComplianceFinding["complianceLevel"]): TraceabilityMatrixEntry["complianceStatus"] {
  switch (level) {
    case "compliant": return "Compliant";
    case "partial": return "Partial";
    case "non-compliant": return "Non-Compliant";
    case "not-applicable": return "Not Applicable";
    default: return "Not Analyzed";
  }
}

function buildTraceabilityMatrix(
  clauses: GuidelineClauseInput[],
  findings: ComplianceFinding[],
): TraceabilityMatrixEntry[] {
  const byKey = new Map<string, ComplianceFinding>();
  for (const f of findings) {
    if (f.findingType && f.findingType !== "guideline-clause") continue;
    byKey.set(clauseKey(f), f);
  }

  return clauses.map((c) => {
    const f = byKey.get(clauseKey(c));
    const applicable = !!f && f.complianceLevel !== "not-applicable" && f.complianceLevel !== "analysis-failed";
    return {
      clauseNumber: c.clauseNumber,
      clauseTitle: c.clauseTitle,
      clauseText: (c.clauseText ?? "").slice(0, 400),
      guidelineName: c.guidelineName,
      folderName: c.folderName,
      applicable,
      complianceStatus: f ? levelToMatrixStatus(f.complianceLevel) : "Not Analyzed",
      supportingSopSection: f?.sopSectionAffected || "",
      confidenceScore: f?.matchConfidence ?? 0,
    };
  });
}

// ── Main Export ──────────────────────────────────────────────────────────────

export async function analyzeSOPComplianceV5(request: {
  sopIdentifier: string;
  sopName: string;
  department: string;
  sopContent: string;
  guidelineClauses: GuidelineClauseInput[];
  sopLibrary?: SopLibraryEntry[];
}): Promise<ComplianceAnalysisResult> {
  const startTime = Date.now();

  if (!request.sopContent || request.sopContent.trim().length < 50) {
    return emptyResult(startTime);
  }

  const parsedSop = parseSopStructure(request.sopContent);
  const sectionSummary = buildSectionSummary(parsedSop);
  const indexedSopContent = parsedSop.indexedContent || request.sopContent;

  const batchCtx = {
    sopIdentifier: request.sopIdentifier,
    sopName: request.sopName,
    department: request.department,
    indexedSopContent,
    sectionSummary,
  };

  // Phase 1 — fast screening: every clause, compact JSON, lite model, large parallel batches.
  const screenBatches: GuidelineClauseInput[][] = [];
  for (let i = 0; i < request.guidelineClauses.length; i += MAX_CLAUSES_PER_BATCH) {
    screenBatches.push(request.guidelineClauses.slice(i, i + MAX_CLAUSES_PER_BATCH));
  }

  console.log(
    `[complianceV5] ${request.sopIdentifier}: phase 1 screening — ${request.guidelineClauses.length} clauses in ${screenBatches.length} batches (serialized, model: flash)`,
  );

  const screeningFindings = await runBatchesParallel(
    screenBatches,
    BATCH_CONCURRENCY,
    "screen",
    batchCtx,
  );

  const findingByKey = new Map<string, ComplianceFinding>();
  for (const f of screeningFindings) {
    findingByKey.set(clauseKey(f), f);
  }

  // Phase 2 — deep enrichment only for confirmed gaps (partial / non-compliant / failed).
  // Prioritise the most material gaps (non-compliant + critical/major first) and cap the
  // number deep-enriched so a thorough screening pass can't blow the runtime budget. Gaps
  // beyond the cap keep their screening-level detail (still a complete, actionable finding).
  const severityRank: Record<string, number> = { critical: 0, major: 1, minor: 2, informational: 3 };
  const gapClauses = request.guidelineClauses
    .map((c) => ({ c, f: findingByKey.get(clauseKey(c)) }))
    .filter((x): x is { c: GuidelineClauseInput; f: ComplianceFinding } => !!x.f && needsDeepEnrichment(x.f.complianceLevel))
    .sort((a, b) => {
      const levelA = a.f.complianceLevel === "non-compliant" ? 0 : a.f.complianceLevel === "partial" ? 1 : 2;
      const levelB = b.f.complianceLevel === "non-compliant" ? 0 : b.f.complianceLevel === "partial" ? 1 : 2;
      if (levelA !== levelB) return levelA - levelB;
      return (severityRank[a.f.issueSeverity ?? "minor"] ?? 2) - (severityRank[b.f.issueSeverity ?? "minor"] ?? 2);
    })
    .slice(0, MAX_DEEP_GAP_CLAUSES)
    .map((x) => x.c);

  if (gapClauses.length > 0) {
    const deepBatches: GuidelineClauseInput[][] = [];
    for (let i = 0; i < gapClauses.length; i += MAX_CLAUSES_DEEP_BATCH) {
      deepBatches.push(gapClauses.slice(i, i + MAX_CLAUSES_DEEP_BATCH));
    }

    console.log(
      `[complianceV5] ${request.sopIdentifier}: phase 2 deep enrichment — ${gapClauses.length} gap clauses in ${deepBatches.length} batches`,
    );

    const deepFindings = await runBatchesParallel(
      deepBatches,
      DEEP_BATCH_CONCURRENCY,
      "deep",
      batchCtx,
    );

    for (const f of deepFindings) {
      findingByKey.set(clauseKey(f), f);
    }
  }

  // Preserve original clause order for traceability and scoring.
  const clauseFindings: ComplianceFinding[] = request.guidelineClauses.map((c) => {
    const existing = findingByKey.get(clauseKey(c));
    if (existing) return existing;
    const f = finalizeFinding(undefined, c);
    f.complianceLevel = "analysis-failed";
    f.mismatchExplanation = "Clause was not returned by AI — retry analysis";
    return f;
  });

  // 2. Evidence validation (verifies cited SOP text, downgrades false positives).
  const validatedClauseFindings = validateAllFindings(
    clauseFindings,
    request.guidelineClauses,
    request.sopContent,
    parsedSop,
    { identifier: request.sopIdentifier, name: request.sopName },
  );

  // 3. Traceability matrix is built from the full clause set (every clause reviewed).
  const traceabilityMatrix = buildTraceabilityMatrix(request.guidelineClauses, validatedClauseFindings);

  // 4. GMP Intelligence Layer — expectations beyond literal clause wording.
  const topics = detectSopTopics(request.sopName, request.sopContent);
  const gmpResults = evaluateGmpExpectations(request.sopContent, topics);
  const gmpFindings = buildGmpFindings(gmpResults, request.sopName);

  // 5. Cross-SOP dependency validation.
  const { dependencies, findings: crossSopFindings } = validateCrossSopDependencies(
    request.sopContent,
    request.sopLibrary ?? [],
  );

  // 6. Classify (applicability + category + risk + evidence strength + reasoning).
  const classified = classifyAll([...validatedClauseFindings, ...gmpFindings, ...crossSopFindings]);

  // 7. Auditor standard — keep EVERY clause evaluation; only demote speculative
  //    gaps to advisory so the score stays defensible. Nothing is dropped or merged:
  //    every applicable clause remains an independent, traceable finding.
  const defensible = applyAuditorStandards(classified);

  // 8. Risk-based prioritization (Critical first) — no de-duplication so that each
  //    clause keeps its own finding for full clause-by-clause traceability.
  const sorted = sortByRisk(defensible);

  // 10. Weighted, recalibrated scoring (one minor gap can't collapse the score).
  const scoreBreakdown = computeWeightedScoreBreakdown(sorted);
  const score = scoreBreakdown.score;

  const compliantCount = sorted.filter((f) => f.complianceLevel === "compliant").length;
  const partialCount = sorted.filter((f) => f.complianceLevel === "partial").length;
  const nonCompliantCount = sorted.filter((f) => f.complianceLevel === "non-compliant").length;
  const notApplicableCount = sorted.filter((f) => f.complianceLevel === "not-applicable").length;
  const criticalCount = sorted.filter((f) => f.findingCategory === "Critical Non-Compliance").length;
  const majorCount = sorted.filter((f) => f.findingCategory === "Major Gap").length;
  const minorCount = sorted.filter((f) => f.findingCategory === "Minor Gap").length;
  const improvementCount = sorted.filter((f) => f.findingCategory === "Improvement Opportunity").length;
  const bestPracticeCount = sorted.filter((f) => f.findingCategory === "Best Practice Recommendation").length;

  const analyzedClauses = traceabilityMatrix.filter((e) => e.complianceStatus !== "Not Analyzed").length;
  const clauseCoveragePct = request.guidelineClauses.length
    ? Math.round((analyzedClauses / request.guidelineClauses.length) * 100)
    : 0;

  // Audit completeness report — proves the WHOLE guideline library was reviewed.
  const auditCompleteness = buildAuditCompleteness({
    guidelineClauses: request.guidelineClauses,
    findings: sorted,
    parsedSop,
    clauseCoveragePct,
    overallScore: score,
    compliantCount,
    partialCount,
    nonCompliantCount,
    notApplicableCount,
    criticalCount,
    majorCount,
    minorCount,
    improvementCount,
    bestPracticeCount,
  });

  return {
    findings: sorted,
    overallScore: score,
    complianceStatus: getScoreLabel(score),
    compliantCount,
    partialCount,
    nonCompliantCount,
    notApplicableCount,
    totalGuidelinesChecked: request.guidelineClauses.length,
    processingTimeMs: Date.now() - startTime,
    criticalCount,
    majorCount,
    minorCount,
    improvementCount,
    bestPracticeCount,
    clauseCoveragePct,
    scoreBreakdown,
    traceabilityMatrix,
    crossSopDependencies: dependencies,
    auditCompleteness,
    analysisEngineVersion: "v5",
  };
}

/**
 * Build the audit completeness report shown at the top of every compliance report.
 * It lets reviewers confirm that the entire guideline library — every guideline,
 * every chapter, every clause — was evaluated.
 */
function buildAuditCompleteness(input: {
  guidelineClauses: GuidelineClauseInput[];
  findings: ComplianceFinding[];
  parsedSop: ReturnType<typeof parseSopStructure>;
  clauseCoveragePct: number;
  overallScore: number;
  compliantCount: number;
  partialCount: number;
  nonCompliantCount: number;
  notApplicableCount: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  improvementCount: number;
  bestPracticeCount: number;
}): AuditCompleteness {
  const guidelineNames = new Set<string>();
  const chapters = new Set<string>();
  for (const c of input.guidelineClauses) {
    if (c.guidelineName) guidelineNames.add(c.guidelineName);
    // Chapter = leading integer of the clause number (e.g. "4.2.1" → "4").
    const chapter = (c.clauseNumber ?? "").trim().match(/^\d+/)?.[0];
    chapters.add(`${c.guidelineName}::${chapter ?? c.clauseNumber ?? "?"}`);
  }

  const clauseFindings = input.findings.filter(
    (f) => !f.findingType || f.findingType === "guideline-clause",
  );
  const notApplicableClauses = clauseFindings.filter(
    (f) => f.complianceLevel === "not-applicable",
  ).length;
  const applicableClauses = clauseFindings.filter(
    (f) => f.complianceLevel !== "not-applicable" && f.complianceLevel !== "analysis-failed",
  ).length;

  // SOP coverage — fraction of SOP sections cited as evidence by at least one finding.
  const totalSections = input.parsedSop.sections.length;
  const citedSections = new Set<string>();
  for (const f of input.findings) {
    const ref = (f.sopSectionAffected ?? "").trim();
    if (!ref || /^not\s+found$/i.test(ref)) continue;
    const sectionId = ref.match(/§\s*([\w.]+)/)?.[1] ?? ref.match(/(\d+(?:\.\d+)*)/)?.[1];
    if (sectionId) citedSections.add(sectionId);
  }
  const sopCoveragePct = totalSections
    ? Math.min(100, Math.round((citedSections.size / totalSections) * 100))
    : 0;

  return {
    totalGuidelinesReviewed: guidelineNames.size,
    totalChaptersReviewed: chapters.size,
    totalClausesReviewed: input.guidelineClauses.length,
    applicableClauses,
    notApplicableClauses,
    compliantCount: input.compliantCount,
    partialCount: input.partialCount,
    nonCompliantCount: input.nonCompliantCount,
    criticalFindings: input.criticalCount,
    majorFindings: input.majorCount,
    minorFindings: input.minorCount,
    improvementOpportunities: input.improvementCount + input.bestPracticeCount,
    clauseCoveragePct: input.clauseCoveragePct,
    sopCoveragePct,
    overallScore: input.overallScore,
  };
}

function emptyResult(startTime: number): ComplianceAnalysisResult {
  return {
    findings: [],
    overallScore: 0,
    complianceStatus: "Non-Compliant",
    compliantCount: 0,
    partialCount: 0,
    nonCompliantCount: 0,
    notApplicableCount: 0,
    totalGuidelinesChecked: 0,
    processingTimeMs: Date.now() - startTime,
    criticalCount: 0,
    majorCount: 0,
    minorCount: 0,
    improvementCount: 0,
    bestPracticeCount: 0,
    clauseCoveragePct: 0,
    scoreBreakdown: {
      totalApplicableRequirements: 0,
      compliantCount: 0,
      partialCount: 0,
      nonCompliantCount: 0,
      improvementCount: 0,
      notApplicableCount: 0,
      formula: "No analyzable SOP content.",
      score: 0,
    },
    traceabilityMatrix: [],
    crossSopDependencies: [],
    auditCompleteness: {
      totalGuidelinesReviewed: 0,
      totalChaptersReviewed: 0,
      totalClausesReviewed: 0,
      applicableClauses: 0,
      notApplicableClauses: 0,
      compliantCount: 0,
      partialCount: 0,
      nonCompliantCount: 0,
      criticalFindings: 0,
      majorFindings: 0,
      minorFindings: 0,
      improvementOpportunities: 0,
      clauseCoveragePct: 0,
      sopCoveragePct: 0,
      overallScore: 0,
    },
    analysisEngineVersion: "v5",
  };
}
