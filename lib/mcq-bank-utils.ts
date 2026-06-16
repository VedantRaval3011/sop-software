import type { RegistrySOP } from "@/lib/types";
import { sopFamilyGroupKey } from "@/lib/sop-utils";

// ── Subcategory prefix → canonical department (aligned with Dashboard / TM) ──
export const MCQ_SUBCAT_TO_DEPT: Record<string, string> = {
  QAGE: "QA", ANNE: "QA",
  QCGE: "QC", QAIC: "QC", QAIO: "QC",
  QAMI: "Microbiology", QCMI: "Microbiology",
  PRAA: "Production", PRCL: "Production", PRED: "Production",
  PREO: "Production", PREP: "Production", PRGE: "Production",
  PRMA: "Production", PRPA: "Production",
  BSGE: "Store", STCL: "Store", STGE: "Store",
  STOP: "Store", STPA: "Store", STRM: "Store",
  MAGE: "Engineering and Maintenance", PREG: "Engineering and Maintenance",
  PEGE: "Personnel",
};

export const MCQ_DEPARTMENT_ORDER = [
  "QA", "QC", "Microbiology", "Production",
  "Store", "Engineering and Maintenance", "Personnel",
];

export function mcqDeptFromIdentifier(id?: string | null): string {
  if (!id) return "Other";
  const up = id.toUpperCase().trim();
  const m = up.match(/^([A-Z]{2,6})\d/);
  if (m && MCQ_SUBCAT_TO_DEPT[m[1]]) return MCQ_SUBCAT_TO_DEPT[m[1]];
  for (let len = 6; len >= 2; len--) {
    const pfx = up.slice(0, len);
    if (MCQ_SUBCAT_TO_DEPT[pfx]) return MCQ_SUBCAT_TO_DEPT[pfx];
  }
  return "Other";
}

export function mcqNormalizeDeptName(raw?: string | null): string {
  if (!raw) return "Other";
  const lower = raw.toLowerCase().trim();
  if (/\bqa\b|quality.?assur/.test(lower)) return "QA";
  if (/\bqc\b|quality.?cont/.test(lower)) return "QC";
  if (/micro/.test(lower)) return "Microbiology";
  if (/engineer|maint/.test(lower)) return "Engineering and Maintenance";
  if (/person|\bhr\b/.test(lower)) return "Personnel";
  if (/store/.test(lower)) return "Store";
  if (/prod/.test(lower)) return "Production";
  return "Other";
}

export function mcqResolveDept(identifier: string, storedDept?: string | null): string {
  const fromId = mcqDeptFromIdentifier(identifier);
  if (fromId !== "Other") return fromId;
  return mcqNormalizeDeptName(storedDept);
}

export interface ActiveSopFamily {
  dept: string;
  languages: Set<string>;
  processAreas: Set<string>;
  name: string;
  identifier: string;
}

/** Active SOP families keyed by {@link sopFamilyGroupKey} — same universe as the Dashboard. */
export function buildActiveSopFamilyMap(rows: RegistrySOP[]): Map<string, ActiveSopFamily> {
  const map = new Map<string, ActiveSopFamily>();
  for (const row of rows) {
    if (row.isObsolete) continue;
    const famKey = sopFamilyGroupKey(row);
    const dept = mcqResolveDept(row.identifier, row.department);
    if (dept === "Other") continue;
    if (!map.has(famKey)) {
      map.set(famKey, {
        dept,
        languages: new Set<string>(),
        processAreas: new Set<string>(),
        name: row.name,
        identifier: row.identifier,
      });
    }
    const entry = map.get(famKey)!;
    if (row.language === "ENG" || row.language === "ENG-GUJ") entry.languages.add("English");
    if (row.language === "GUJ" || row.language === "ENG-GUJ") entry.languages.add("Gujarati");
  }
  return map;
}

export interface AggregatedMcqFamily {
  famKey: string;
  identifier: string;
  sopName: string;
  dept: string;
  totalQ: number;
  checkedQ: number;
  reviewedQ: number;
  similarQ: number;
  hasEn: boolean;
  hasGu: boolean;
  lastUpdated: Date | null;
  banks: { id: string; langCode: "ENG" | "GUJ" }[];
}

export interface RawMcqBankAgg {
  _id: unknown;
  sopIdentifier: string;
  sopName?: string;
  department?: string;
  language: string;
  totalQuestions: number;
  checkedCount: number;
  reviewedCount: number;
  similarCount: number;
  updatedAt?: Date;
}

/** Collapse raw MCQ bank rows into one entry per SOP family key. */
export function aggregateMcqBanksByFamily(rawBanks: RawMcqBankAgg[]): Map<string, AggregatedMcqFamily> {
  const map = new Map<string, AggregatedMcqFamily>();
  for (const b of rawBanks) {
    const rawId = (b.sopIdentifier ?? "").trim();
    const famKey = sopFamilyGroupKey({ identifier: rawId });
    const dept = mcqResolveDept(rawId, b.department);
    if (dept === "Other") continue;
    if (!map.has(famKey)) {
      map.set(famKey, {
        famKey,
        identifier: rawId,
        sopName: b.sopName ?? rawId,
        dept,
        totalQ: 0,
        checkedQ: 0,
        reviewedQ: 0,
        similarQ: 0,
        hasEn: false,
        hasGu: false,
        lastUpdated: null,
        banks: [],
      });
    }
    const e = map.get(famKey)!;
    e.totalQ += b.totalQuestions;
    e.checkedQ += b.checkedCount;
    e.reviewedQ += b.reviewedCount;
    e.similarQ += b.similarCount;
    if ((b.language ?? "").toLowerCase() === "gujarati") e.hasGu = true;
    else e.hasEn = true;
    if (b._id) e.banks.push({
      id: String(b._id),
      langCode: (b.language ?? "").toLowerCase() === "gujarati" ? "GUJ" : "ENG",
    });
    const ts = b.updatedAt ? new Date(b.updatedAt) : null;
    if (ts && (!e.lastUpdated || ts > e.lastUpdated)) e.lastUpdated = ts;
    if (b.sopName) e.sopName = b.sopName;
  }
  return map;
}

/** MCQ families with no matching active SOP in the Dashboard registry. */
export function findObsoleteMcqFamilies(
  activeFamilies: Map<string, ActiveSopFamily>,
  mcqFamilies: Map<string, AggregatedMcqFamily>,
): AggregatedMcqFamily[] {
  const obsolete: AggregatedMcqFamily[] = [];
  for (const [famKey, bank] of mcqFamilies) {
    if (!activeFamilies.has(famKey)) obsolete.push(bank);
  }
  return obsolete.sort((a, b) => a.identifier.localeCompare(b.identifier));
}
