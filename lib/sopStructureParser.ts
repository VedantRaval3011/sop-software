export type SopSectionType =
  | "purpose"
  | "scope"
  | "responsibility"
  | "procedure"
  | "record"
  | "reference"
  | "definition"
  | "revision"
  | "general";

export interface SopLine {
  lineNumber: number;
  text: string;
  sectionId?: string;
  sectionTitle?: string;
  sectionType?: SopSectionType;
}

export interface SopSection {
  id: string;
  title: string;
  type: SopSectionType;
  lineStart: number;
  lineEnd: number;
}

export interface ParsedSop {
  lines: SopLine[];
  sections: SopSection[];
  indexedContent: string;
  totalLines: number;
}

const SECTION_HEADING_RE =
  /^(\d+(?:\.\d+)*)\s*[.:)\-–—]?\s*(.+?)(?:\s*[-–—:]\s*)?$/i;

const SECTION_TYPE_RULES: { type: SopSectionType; keywords: RegExp[] }[] = [
  { type: "purpose", keywords: [/\bpurpose\b/i, /\bobjective\b/i, /\baim\b/i] },
  { type: "scope", keywords: [/\bscope\b/i, /\bapplicability\b/i, /\bcoverage\b/i] },
  {
    type: "responsibility",
    keywords: [/\bresponsibilit/i, /\baccountabilit/i, /\bauthorit/i, /\brole\b/i],
  },
  {
    type: "procedure",
    keywords: [/\bprocedure\b/i, /\bprocess\b/i, /\bmethod\b/i, /\bstep\b/i, /\binstruction/i],
  },
  { type: "record", keywords: [/\brecord\b/i, /\bform\b/i, /\blog\b/i, /\bregister\b/i, /\bannex/i] },
  {
    type: "reference",
    keywords: [/\breference\b/i, /\brelated\s+document/i, /\bassociated\s+document/i],
  },
  { type: "definition", keywords: [/\bdefinition/i, /\babbreviation/i, /\bglossary\b/i] },
  { type: "revision", keywords: [/\brevision\b/i, /\bhistory\b/i, /\bchange\s+control/i] },
];

function classifySectionType(title: string): SopSectionType {
  for (const rule of SECTION_TYPE_RULES) {
    if (rule.keywords.some((re) => re.test(title))) return rule.type;
  }
  return "general";
}

function formatLineRef(n: number): string {
  return `L${String(n).padStart(3, "0")}`;
}

function isSectionHeading(line: string): { id: string; title: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return null;

  const numbered = trimmed.match(SECTION_HEADING_RE);
  if (numbered) {
    const id = numbered[1];
    const title = numbered[2].trim();
    if (title.length >= 2 && title.length <= 80) return { id, title };
  }

  const allCaps = trimmed.match(/^([A-Z][A-Z0-9\s/&-]{2,50})$/);
  if (allCaps) return { id: "", title: allCaps[1].trim() };

  return null;
}

/** Parse SOP content into numbered lines and detected sections for line-by-line compliance analysis. */
export function parseSopStructure(content: string): ParsedSop {
  const rawLines = content.split(/\r?\n/);
  const lines: SopLine[] = [];
  const sections: SopSection[] = [];

  let currentSection: SopSection | null = null;
  let lineNumber = 0;

  for (const raw of rawLines) {
    const text = raw.trimEnd();
    if (!text.trim()) continue;

    lineNumber++;
    const heading = isSectionHeading(text);

    if (heading) {
      if (currentSection) {
        currentSection.lineEnd = lineNumber - 1;
        sections.push(currentSection);
      }

      const sectionId = heading.id || String(sections.length + 1);
      currentSection = {
        id: sectionId,
        title: heading.title,
        type: classifySectionType(heading.title),
        lineStart: lineNumber,
        lineEnd: lineNumber,
      };
    }

    lines.push({
      lineNumber,
      text,
      sectionId: currentSection?.id,
      sectionTitle: currentSection?.title,
      sectionType: currentSection?.type,
    });
  }

  if (currentSection) {
    currentSection.lineEnd = lineNumber;
    sections.push(currentSection);
  }

  const indexedContent = lines
    .map((l) => {
      const sectionTag = l.sectionId ? ` [§${l.sectionId} ${l.sectionTitle ?? ""}]` : "";
      return `${formatLineRef(l.lineNumber)}${sectionTag}: ${l.text}`;
    })
    .join("\n");

  return { lines, sections, indexedContent, totalLines: lines.length };
}

/** Build a compact section summary for the analysis prompt. */
export function buildSectionSummary(parsed: ParsedSop): string {
  if (!parsed.sections.length) return "No numbered sections detected — analyze all lines.";
  return parsed.sections
    .map(
      (s) =>
        `§${s.id} ${s.title} (${s.type}) — lines ${formatLineRef(s.lineStart)}–${formatLineRef(s.lineEnd)}`,
    )
    .join("\n");
}

/** Extract line numbers referenced in a finding field (e.g. "L042" or "L042-L045"). */
export function extractLineRefs(text: string): number[] {
  const refs: number[] = [];
  const rangeRe = /L(\d{3})\s*[-–]\s*L(\d{3})/gi;
  const singleRe = /L(\d{3})/gi;

  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(text)) !== null) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    for (let i = start; i <= end; i++) refs.push(i);
  }

  while ((m = singleRe.exec(text)) !== null) {
    refs.push(parseInt(m[1], 10));
  }

  return [...new Set(refs)].sort((a, b) => a - b);
}

/** Get concatenated text for specific line numbers. */
export function getLinesText(parsed: ParsedSop, lineNumbers: number[]): string {
  const set = new Set(lineNumbers);
  return parsed.lines
    .filter((l) => set.has(l.lineNumber))
    .map((l) => l.text)
    .join(" ");
}
