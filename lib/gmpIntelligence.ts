/**
 * GMP Intelligence Layer
 * ----------------------
 * Encodes the regulatory expectations an experienced GMP auditor brings to a review,
 * independent of the exact wording in the uploaded guideline clauses.
 *
 * Two responsibilities:
 *  1. Detect the SOP topic(s) and derive the GMP expectations commonly associated with
 *     that topic (e.g. a validation SOP is expected to address Change Control, Risk
 *     Assessment, CAPA, Deviation Handling, Periodic Review, etc.).
 *  2. Detect cross-SOP references inside the SOP text so the engine can verify the
 *     referenced SOPs actually exist in the library (cross-SOP dependency validation).
 *
 * The detection is intentionally semantic/conceptual: it matches on a family of synonyms
 * rather than a single keyword, so an expectation is considered "addressed" even when the
 * SOP uses different wording.
 */

export type SopTopic =
  | "validation"
  | "cleaning"
  | "calibration"
  | "qualification"
  | "stability"
  | "analytical"
  | "change-control"
  | "deviation"
  | "capa"
  | "training"
  | "documentation"
  | "general";

export interface GmpExpectation {
  /** Short label shown to the reviewer. */
  id: string;
  title: string;
  /** Why a GMP auditor expects this for the detected topic. */
  rationale: string;
  /** Conceptual matchers — if ANY hits the SOP text, the expectation is "addressed". */
  matchers: RegExp[];
  /** Risk if entirely absent. */
  severity: "critical" | "major" | "minor";
}

const TOPIC_MATCHERS: { topic: SopTopic; patterns: RegExp[] }[] = [
  { topic: "validation", patterns: [/\bvalidation\b/i, /\bprocess\s+validation\b/i, /\bmedia\s+fill\b/i, /\brevalidation\b/i, /\bvalidation\s+protocol\b/i] },
  { topic: "cleaning", patterns: [/\bcleaning\s+validation\b/i, /\bclean(ing)?\b/i, /\bresidue\b/i, /\bswab\b/i] },
  { topic: "calibration", patterns: [/\bcalibration\b/i, /\binstrument\b/i, /\bcalibrat/i] },
  { topic: "qualification", patterns: [/\bqualification\b/i, /\b(iq|oq|pq|dq)\b/i, /\binstallation\s+qualification\b/i] },
  { topic: "stability", patterns: [/\bstability\b/i, /\bshelf\s*life\b/i, /\bclimatic\s+zone\b/i] },
  { topic: "analytical", patterns: [/\banalytical\s+method\b/i, /\bmethod\s+validation\b/i, /\bassay\b/i, /\bhplc\b/i] },
  { topic: "change-control", patterns: [/\bchange\s+control\b/i, /\bchange\s+management\b/i] },
  { topic: "deviation", patterns: [/\bdeviation\b/i, /\bnon[\s-]?conformance\b/i, /\bincident\b/i] },
  { topic: "capa", patterns: [/\bcapa\b/i, /\bcorrective\s+and\s+preventive\b/i] },
  { topic: "training", patterns: [/\btraining\b/i, /\bcompetenc/i, /\bqualification\s+of\s+personnel\b/i] },
  { topic: "documentation", patterns: [/\bdocumentation\b/i, /\bgood\s+documentation\b/i, /\brecord\s+retention\b/i] },
];

/** Detect the dominant GMP topic(s) of an SOP from its name + content. */
export function detectSopTopics(sopName: string, sopContent: string): SopTopic[] {
  const haystack = `${sopName} ${sopContent.slice(0, 6000)}`;
  const scored = TOPIC_MATCHERS.map(({ topic, patterns }) => {
    const score = patterns.reduce((s, re) => s + (haystack.match(re) ? 1 : 0), 0);
    return { topic, score };
  })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return ["general"];
  return scored.map((s) => s.topic);
}

// ── GMP Expectation Catalog ─────────────────────────────────────────────────

const VALIDATION_EXPECTATIONS: GmpExpectation[] = [
  { id: "change-control", title: "Change Control", rationale: "Validated states must be maintained through a formal change control process per EU GMP Annex 15 / ICH Q10.", matchers: [/\bchange\s+control\b/i, /\bchange\s+management\b/i, /\bchange\s+request\b/i], severity: "major" },
  { id: "risk-assessment", title: "Risk Assessment", rationale: "Validation scope and extent must be justified by a documented quality risk assessment (ICH Q9).", matchers: [/\brisk\s+assessment\b/i, /\bquality\s+risk\b/i, /\brisk\s+manag/i, /\bfmea\b/i, /\bhazop\b/i], severity: "major" },
  { id: "capa", title: "CAPA", rationale: "Validation failures must feed a Corrective and Preventive Action system.", matchers: [/\bcapa\b/i, /\bcorrective\s+and\s+preventive\b/i, /\bcorrective\s+action\b/i], severity: "major" },
  { id: "deviation", title: "Deviation Handling", rationale: "Excursions and protocol deviations must be handled via the deviation management system.", matchers: [/\bdeviation\b/i, /\bnon[\s-]?conformance\b/i, /\bexcursion\b/i], severity: "major" },
  { id: "investigation", title: "Investigation Requirements", rationale: "Out-of-specification / failed runs require a documented investigation and root-cause analysis.", matchers: [/\binvestigation\b/i, /\broot\s+cause\b/i, /\boos\b/i, /\bout[\s-]of[\s-]specification\b/i], severity: "major" },
  { id: "trending", title: "Trending", rationale: "Validation and monitoring data must be trended to detect drift over the lifecycle.", matchers: [/\btrend/i, /\bstatistical\s+analysis\b/i, /\bcontrol\s+chart\b/i], severity: "minor" },
  { id: "periodic-review", title: "Periodic Review", rationale: "Validated systems require periodic review to confirm the validated state is maintained.", matchers: [/\bperiodic\s+review\b/i, /\bannual\s+review\b/i, /\bre[\s-]?evaluation\b/i], severity: "minor" },
  { id: "documentation-retention", title: "Documentation Retention", rationale: "Validation records must be retained per the record retention policy.", matchers: [/\bretention\b/i, /\barchiv/i, /\brecord\s+keeping\b/i, /\bretain/i], severity: "minor" },
  { id: "lifecycle-validation", title: "Lifecycle Validation", rationale: "Validation must follow a lifecycle approach (design, qualification, continued verification) per Annex 15.", matchers: [/\blifecycle\b/i, /\bcontinued\s+process\s+verification\b/i, /\bongoing\s+verification\b/i, /\bstage\s+[123]\b/i], severity: "major" },
  { id: "vmp-alignment", title: "Validation Master Plan Alignment", rationale: "Activities must align with the site Validation Master Plan (VMP).", matchers: [/\bvalidation\s+master\s+plan\b/i, /\bvmp\b/i], severity: "minor" },
  { id: "training", title: "Training Requirements", rationale: "Personnel executing validation must be trained and qualified.", matchers: [/\btraining\b/i, /\bcompetenc/i, /\bqualified\s+personnel\b/i], severity: "minor" },
  { id: "requalification", title: "Requalification Requirements", rationale: "Equipment/processes require requalification at defined frequencies or after changes.", matchers: [/\brequalif/i, /\bre[\s-]?validation\b/i, /\bre[\s-]?qualif/i], severity: "major" },
];

const GENERIC_GMP_EXPECTATIONS: GmpExpectation[] = [
  { id: "change-control", title: "Change Control", rationale: "Changes affecting GMP activities must be assessed via change control.", matchers: [/\bchange\s+control\b/i, /\bchange\s+management\b/i], severity: "minor" },
  { id: "deviation", title: "Deviation Handling", rationale: "Deviations from the procedure must be documented and managed.", matchers: [/\bdeviation\b/i, /\bnon[\s-]?conformance\b/i], severity: "minor" },
  { id: "training", title: "Training Requirements", rationale: "Personnel performing the procedure must be trained.", matchers: [/\btraining\b/i, /\bcompetenc/i], severity: "minor" },
  { id: "documentation-retention", title: "Documentation & Records", rationale: "Records generated must be controlled and retained.", matchers: [/\brecord\b/i, /\bretention\b/i, /\bdocumentation\b/i], severity: "minor" },
];

/** Map detected topics to the GMP expectations an auditor would evaluate. */
export function getGmpExpectations(topics: SopTopic[]): GmpExpectation[] {
  const validationTopics: SopTopic[] = ["validation", "cleaning", "calibration", "qualification", "stability", "analytical"];
  if (topics.some((t) => validationTopics.includes(t))) {
    return VALIDATION_EXPECTATIONS;
  }
  return GENERIC_GMP_EXPECTATIONS;
}

export interface GmpExpectationResult {
  expectation: GmpExpectation;
  addressed: boolean;
  matchedText?: string;
}

/** Evaluate which GMP expectations the SOP addresses (semantic, not exact-wording). */
export function evaluateGmpExpectations(
  sopContent: string,
  topics: SopTopic[],
): GmpExpectationResult[] {
  const expectations = getGmpExpectations(topics);
  return expectations.map((expectation) => {
    let matchedText: string | undefined;
    for (const re of expectation.matchers) {
      const m = sopContent.match(re);
      if (m) {
        matchedText = extractContext(sopContent, m.index ?? 0);
        break;
      }
    }
    return { expectation, addressed: Boolean(matchedText), matchedText };
  });
}

function extractContext(text: string, index: number, radius = 120): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

// ── Cross-SOP Dependency Detection ──────────────────────────────────────────

export interface CrossSopReferenceType {
  type: string;
  /** Detect a reference to this SOP type inside the SOP text. */
  referencePattern: RegExp;
  /** Used to find the actual SOP in the library by name/identifier. */
  libraryMatch: RegExp;
}

export const CROSS_SOP_REFERENCE_TYPES: CrossSopReferenceType[] = [
  { type: "Change Control SOP", referencePattern: /change\s+control(?:\s+sop|\s+procedure)?/i, libraryMatch: /change\s+control/i },
  { type: "Deviation SOP", referencePattern: /deviation(?:\s+sop|\s+procedure|\s+management)?/i, libraryMatch: /deviation/i },
  { type: "CAPA SOP", referencePattern: /\bcapa(?:\s+sop|\s+procedure)?\b|corrective\s+and\s+preventive/i, libraryMatch: /\bcapa\b|corrective\s+and\s+preventive/i },
  { type: "Validation SOP", referencePattern: /validation(?:\s+sop|\s+procedure|\s+master\s+plan)?/i, libraryMatch: /validation/i },
  { type: "Training SOP", referencePattern: /training(?:\s+sop|\s+procedure)?/i, libraryMatch: /training/i },
  { type: "Risk Assessment SOP", referencePattern: /risk\s+assessment(?:\s+sop|\s+procedure)?|quality\s+risk\s+management/i, libraryMatch: /risk\s+assessment|quality\s+risk/i },
];

export interface DetectedCrossSopReference {
  type: string;
  referenceText: string;
  libraryMatch: RegExp;
}

/** Detect which dependency SOPs the SOP text references. */
export function detectCrossSopReferences(sopContent: string): DetectedCrossSopReference[] {
  const detected: DetectedCrossSopReference[] = [];
  for (const ref of CROSS_SOP_REFERENCE_TYPES) {
    const m = sopContent.match(ref.referencePattern);
    if (m) {
      detected.push({
        type: ref.type,
        referenceText: extractContext(sopContent, m.index ?? 0, 90),
        libraryMatch: ref.libraryMatch,
      });
    }
  }
  return detected;
}
