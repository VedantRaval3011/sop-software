import type { ComplianceFinding } from "@/lib/complianceEngine";

/**
 * Detects when cited SOP text is only tangentially related to a guideline requirement
 * (e.g. "verify records" cited as evidence for ALCOA+ / data governance).
 */

const GENERIC_PHARMA_WORDS = new Set([
  "record", "records", "verify", "ensure", "document", "documents", "procedure",
  "procedures", "batch", "shall", "must", "sop", "quality", "control", "monitor",
  "monitoring", "check", "review", "responsible", "department", "manufacturing",
  "process", "step", "steps", "during", "before", "after", "complete", "completed",
  "performed", "perform", "maintain", "follow", "applicable", "relevant", "related",
  "accordance", "compliance", "requirement", "requirements", "activity", "activities",
  "operation", "operational", "equipment", "area", "areas", "product", "material",
  "materials", "storage", "handling", "preparation", "production", "validation",
  "report", "reports", "form", "forms", "log", "logs", "entry", "entries", "sign",
  "signed", "date", "name", "number", "reference", "section", "annex", "appendix",
  "note", "notes", "action", "corrective", "preventive", "capa", "deviation",
  "routine", "non-routine", "intervention", "interventions", "valve", "tank",
  "weight", "gross", "recheck", "tag", "closed", "open", "medium", "growth",
  "environmental", "pressure", "differential", "solubility", "promotion",
]);

/** Requirement topics that demand explicit SOP language — not generic record-keeping. */
const TOPIC_ALIGNMENT_RULES: {
  requirementPattern: RegExp;
  snippetMustMatch: RegExp;
  label: string;
}[] = [
  {
    requirementPattern: /data\s+govern|data\s+integrity|metadata|electronic\s+record|audit\s+trail/i,
    snippetMustMatch: /data\s+govern|data\s+integrity|metadata|electronic\s+record|audit\s+trail|alcoa|lifecycle\s+of\s+data/i,
    label: "data governance / data integrity",
  },
  {
    requirementPattern: /alcoa\+?|attributable|legible|contemporaneous|enduring|available.*accurate/i,
    snippetMustMatch: /alcoa|attributable|legible|contemporaneous|original|accurate|complete|consistent|enduring|available|data\s+integrity/i,
    label: "ALCOA+ data reliability principles",
  },
  {
    requirementPattern: /quality\s+risk\s+manag|ich\s+q9|risk\s+assessment/i,
    snippetMustMatch: /risk\s+(assess|manag|analy)|ich\s+q9|quality\s+risk|fmea|hazop/i,
    label: "quality risk management",
  },
  {
    requirementPattern: /change\s+control|change\s+manag/i,
    snippetMustMatch: /change\s+control|change\s+manag|change\s+request|impact\s+assess/i,
    label: "change control",
  },
  {
    requirementPattern: /validation\s+(master\s+)?plan|vmp\b/i,
    snippetMustMatch: /validation\s+(master\s+)?plan|\bvmp\b/i,
    label: "validation master plan",
  },
  {
    requirementPattern: /training\s+(program|record|matrix)|competenc/i,
    snippetMustMatch: /training|competenc|qualification\s+of\s+personnel/i,
    label: "training and competency",
  },
  {
    requirementPattern: /self[\s-]?inspection|internal\s+audit/i,
    snippetMustMatch: /self[\s-]?inspection|internal\s+audit/i,
    label: "self-inspection / internal audit",
  },
  {
    requirementPattern: /complaint\s+(handling|management)|product\s+recall/i,
    snippetMustMatch: /complaint|recall/i,
    label: "complaints or recall",
  },
  {
    requirementPattern: /computer\s+system|csv\b|21\s*cfr\s+part\s+11|electronic\s+signature/i,
    snippetMustMatch: /computer\s+system|csv\b|21\s*cfr|electronic\s+signature|part\s+11/i,
    label: "computer system validation",
  },
];


function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function extractPhrases(text: string): string[] {
  const phrases: string[] = [];
  const bigramRe = /\b([a-z][a-z0-9-]+(?:\s+[a-z][a-z0-9-]+)+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = bigramRe.exec(text)) !== null) {
    const phrase = m[1].toLowerCase().trim();
    if (phrase.length >= 6 && !isGenericPhrase(phrase)) phrases.push(phrase);
  }
  return [...new Set(phrases)];
}

function isGenericPhrase(phrase: string): boolean {
  const words = phrase.split(/\s+/);
  return words.every((w) => GENERIC_PHARMA_WORDS.has(w) || w.length <= 3);
}

function extractDiscriminativeTerms(requirement: string, clauseTitle: string): string[] {
  const combined = `${clauseTitle} ${requirement}`;
  const terms = new Set<string>();

  for (const phrase of extractPhrases(combined)) {
    terms.add(phrase);
  }

  for (const word of tokenize(combined)) {
    if (word.length >= 5 && !GENERIC_PHARMA_WORDS.has(word)) {
      terms.add(word);
    }
  }

  return [...terms];
}

/** Split a multi-line snippet into individual cited lines. */
export function splitSnippetLines(snippet: string): string[] {
  if (!snippet?.trim()) return [];

  const parts = snippet.split(/(?:^|\n)\s*L\d{3}\s*(?:\[§[^\]]*\])?\s*:?\s*/i).filter(Boolean);
  if (parts.length > 1) return parts.map((p) => p.trim()).filter(Boolean);

  if (snippet.includes("\n")) {
    return snippet.split(/\n+/).map((l) => l.replace(/^L\d{3}\s*(?:\[§[^\]]*\])?\s*:?\s*/i, "").trim()).filter(Boolean);
  }

  return [snippet.trim()];
}

export interface SemanticRelevanceResult {
  score: number;
  isRelevant: boolean;
  relevantLines: string[];
  rejectedLines: string[];
  reason?: string;
}

/**
 * Score how substantively SOP evidence addresses the guideline requirement (0–100).
 * Rejects tangential matches where only generic words overlap.
 */
export function assessSemanticRelevance(
  requirement: string,
  clauseTitle: string,
  snippet: string,
): SemanticRelevanceResult {
  if (!snippet?.trim() || isNotFoundSnippet(snippet)) {
    return { score: 0, isRelevant: false, relevantLines: [], rejectedLines: [], reason: "No SOP evidence cited." };
  }

  const reqText = `${clauseTitle} ${requirement}`;

  for (const rule of TOPIC_ALIGNMENT_RULES) {
    if (rule.requirementPattern.test(reqText) && !rule.snippetMustMatch.test(snippet)) {
      const lines = splitSnippetLines(snippet);
      const relevantLines = lines.filter((l) => rule.snippetMustMatch.test(l));
      if (relevantLines.length === 0) {
        return {
          score: 12,
          isRelevant: false,
          relevantLines: [],
          rejectedLines: lines,
          reason: `Cited SOP text does not address ${rule.label}. Operational mentions of "records" or "verify" are not sufficient.`,
        };
      }
    }
  }

  const reqTerms = extractDiscriminativeTerms(requirement, clauseTitle);
  const lines = splitSnippetLines(snippet);

  if (reqTerms.length === 0) {
    return { score: 50, isRelevant: true, relevantLines: lines, rejectedLines: [] };
  }

  const relevantLines: string[] = [];
  const rejectedLines: string[] = [];

  for (const line of lines) {
    const lineLower = line.toLowerCase();
    const matched = reqTerms.filter((t) => lineLower.includes(t));
    const nonGenericMatched = matched.filter((t) => {
      const words = t.split(/\s+/);
      return words.some((w) => !GENERIC_PHARMA_WORDS.has(w));
    });

    const lineScore =
      reqTerms.length > 0 ? (nonGenericMatched.length / Math.min(reqTerms.length, 8)) * 100 : 0;

    if (lineScore >= 25 || (nonGenericMatched.length >= 2)) {
      relevantLines.push(line);
    } else {
      rejectedLines.push(line);
    }
  }

  if (relevantLines.length === 0) {
    const wholeSnippetLower = snippet.toLowerCase();
    const wholeMatched = reqTerms.filter((t) => wholeSnippetLower.includes(t));
    const nonGenericWhole = wholeMatched.filter((t) => {
      const words = t.split(/\s+/);
      return words.some((w) => !GENERIC_PHARMA_WORDS.has(w));
    });

    if (nonGenericWhole.length === 0) {
      return {
        score: 10,
        isRelevant: false,
        relevantLines: [],
        rejectedLines: lines,
        reason:
          "Cited SOP lines share only generic words (e.g. records, verify, ensure) and do not substantively address the specific regulatory requirement.",
      };
    }
  }

  const score = relevantLines.length > 0
    ? Math.min(95, Math.round((relevantLines.length / Math.max(lines.length, 1)) * 70 + (relevantLines.length > 0 ? 20 : 0)))
    : 15;

  return {
    score,
    isRelevant: score >= 35 && relevantLines.length > 0,
    relevantLines,
    rejectedLines,
    reason: rejectedLines.length > 0 && relevantLines.length === 0
      ? "All cited SOP lines were rejected as tangentially related to the requirement."
      : undefined,
  };
}

function isNotFoundSnippet(snippet: string): boolean {
  return /^(not\s+found|n\/a|none|—|-)$/i.test(snippet.trim());
}

/** Apply semantic validation — downgrade false positives and strip junk citations. */
export function applySemanticValidation(
  complianceLevel: ComplianceFinding["complianceLevel"],
  matchConfidence: number,
  requirement: string,
  clauseTitle: string,
  sopTextSnippet: string,
  mismatchExplanation: string,
): {
  complianceLevel: ComplianceFinding["complianceLevel"];
  matchConfidence: number;
  sopTextSnippet: string;
  mismatchExplanation: string;
} {
  if (complianceLevel === "not-applicable" || complianceLevel === "analysis-failed") {
    return { complianceLevel, matchConfidence, sopTextSnippet, mismatchExplanation };
  }

  const relevance = assessSemanticRelevance(requirement, clauseTitle, sopTextSnippet);

  if (complianceLevel === "compliant" || complianceLevel === "partial") {
    if (!relevance.isRelevant) {
      const explanation = [
        mismatchExplanation,
        relevance.reason ??
          "Evidence rejected: cited SOP content does not substantively address this guideline requirement.",
      ]
        .filter(Boolean)
        .join(" ");

      return {
        complianceLevel: "non-compliant",
        matchConfidence: Math.min(matchConfidence, relevance.score, 40),
        sopTextSnippet: relevance.relevantLines.length > 0
          ? relevance.relevantLines.join("\n")
          : "Not Found",
        mismatchExplanation: explanation,
      };
    }

    const cleanedSnippet = relevance.relevantLines.join("\n");
    const cappedConfidence = Math.min(matchConfidence, relevance.score + 15);

    if (complianceLevel === "partial" && relevance.score < 50) {
      return {
        complianceLevel: "non-compliant",
        matchConfidence: Math.min(cappedConfidence, 45),
        sopTextSnippet: cleanedSnippet || sopTextSnippet,
        mismatchExplanation: [
          mismatchExplanation,
          "Partial compliance downgraded: cited evidence is too weak to demonstrate substantive coverage.",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    return {
      complianceLevel,
      matchConfidence: cappedConfidence,
      sopTextSnippet: cleanedSnippet || sopTextSnippet,
      mismatchExplanation,
    };
  }

  return { complianceLevel, matchConfidence, sopTextSnippet, mismatchExplanation };
}
