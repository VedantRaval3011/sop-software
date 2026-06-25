import { sopFamilyGroupKey } from '@/lib/sop-utils';
import {
  expandSopIdentifierVariants,
  normalizeSopIdentifierKey,
  sopBaseDisplayFromIdentifier,
  sopFamilyCodesMatch,
  sopFamilyKeyFromIdentifier,
} from '@/lib/sopIdentifierNormalize';

export type McqLangStat = { totalQuestions: number; approvedCount: number };
export type McqLangStatEntry = { eng: McqLangStat; guj: McqLangStat };

function familyKeyFromNormalizedIdentifier(normalized: string): string {
  const fam = sopFamilyKeyFromIdentifier(normalized);
  if (fam) return fam;
  const withRev = normalized.includes('-') ? normalized : `${normalized}-0`;
  const famFromDoc = sopFamilyKeyFromIdentifier(normalizeSopIdentifierKey(withRev));
  if (famFromDoc) return famFromDoc;
  return sopFamilyGroupKey({ identifier: withRev });
}

/** Same family key the MCQ bank uses (MAGE04-5 ≡ MAGE4-5 ≡ MAGE04 → MAGE:4). */
export function familyKeyForMcqIdentifier(identifier: string): string {
  const raw = String(identifier || '').trim();
  if (!raw) return '';
  return familyKeyFromNormalizedIdentifier(normalizeSopIdentifierKey(raw.toUpperCase()));
}

export function familyKeyForDbBase(
  base: string,
  dbBaseToFamKey?: Map<string, string>,
): string {
  const b = String(base || '').trim();
  if (!b) return '';
  const fromMap = dbBaseToFamKey?.get(b);
  if (fromMap) return fromMap;
  return familyKeyFromNormalizedIdentifier(
    normalizeSopIdentifierKey((b.includes('-') ? b : `${b}-0`).toUpperCase()),
  );
}

function isGujaratiMcqLanguage(language: string | null | undefined): boolean {
  const lang = String(language || '').trim().toLowerCase();
  return lang === 'gujarati' || lang === 'guj';
}

export function buildMcqStatMapsFromAgg(
  mcqAgg: Array<{
    sopIdentifier: string;
    language: string | null;
    totalQuestions: number;
    approvedCount: number;
  }>,
): {
  mcqLangStatMap: Map<string, McqLangStatEntry>;
  mcqStatMap: Map<string, McqLangStat>;
} {
  const mcqLangStatMap = new Map<string, McqLangStatEntry>();
  const mcqStatMap = new Map<string, McqLangStat>();
  for (const row of mcqAgg) {
    const famKey = familyKeyForMcqIdentifier(row.sopIdentifier);
    if (!famKey) continue;
    const isGuj = isGujaratiMcqLanguage(row.language);
    const total = row.totalQuestions || 0;
    const approved = row.approvedCount || 0;
    if (!mcqLangStatMap.has(famKey)) {
      mcqLangStatMap.set(famKey, {
        eng: { totalQuestions: 0, approvedCount: 0 },
        guj: { totalQuestions: 0, approvedCount: 0 },
      });
    }
    const entry = mcqLangStatMap.get(famKey)!;
    const slot = isGuj ? entry.guj : entry.eng;
    slot.totalQuestions += total;
    slot.approvedCount += approved;
    const combined = mcqStatMap.get(famKey) || { totalQuestions: 0, approvedCount: 0 };
    combined.totalQuestions += total;
    combined.approvedCount += approved;
    mcqStatMap.set(famKey, combined);
  }
  return { mcqLangStatMap, mcqStatMap };
}

export function lookupMcqLangStat(
  base: string,
  dbBaseToFamKey: Map<string, string>,
  mcqLangStatMap: Map<string, McqLangStatEntry>,
): McqLangStatEntry | undefined {
  return mcqLangStatMap.get(familyKeyForDbBase(base, dbBaseToFamKey));
}

export function lookupMcqCombinedStat(
  base: string,
  dbBaseToFamKey: Map<string, string>,
  mcqStatMap: Map<string, McqLangStat>,
): McqLangStat {
  return mcqStatMap.get(familyKeyForDbBase(base, dbBaseToFamKey)) || {
    totalQuestions: 0,
    approvedCount: 0,
  };
}

/** Mirror sopStatusByCode under Excel / padded code variants (NAGE04 → NAGE4). */
export function aliasSopStatusByCode<T extends Record<string, unknown>>(
  sopStatusByCode: Record<string, T>,
  dbBaseSet: Iterable<string>,
  excelToDbBase: Map<string, string>,
  stripVer: (c: string) => string,
): void {
  for (const base of dbBaseSet) {
    const status = sopStatusByCode[base];
    if (!status) continue;
    const aliases = new Set<string>();
    aliases.add(sopBaseDisplayFromIdentifier(base));
    aliases.add(sopBaseDisplayFromIdentifier(`${base}-0`));
    for (const seed of [base, `${base}-0`]) {
      for (const variant of expandSopIdentifierVariants(seed)) {
        const stripped = stripVer(variant);
        if (stripped) aliases.add(stripped);
      }
    }
    for (const a of aliases) {
      if (a && !sopStatusByCode[a]) sopStatusByCode[a] = status;
    }
  }
  for (const [excelCode, dbBase] of excelToDbBase) {
    const status = sopStatusByCode[dbBase];
    if (status && !sopStatusByCode[excelCode]) sopStatusByCode[excelCode] = status;
  }
}

/** Resolve sopStatusByCode across padded / Excel / revision variants. */
export function resolveSopStatusFromMap<T>(
  sopCode: string,
  sopStatusByCode: Record<string, T> | undefined,
  stripVer: (c: string) => string,
): T | undefined {
  if (!sopStatusByCode) return undefined;
  const stripped = stripVer(String(sopCode || '').trim());
  const direct =
    sopStatusByCode[sopCode] ||
    sopStatusByCode[stripped] ||
    sopStatusByCode[sopBaseDisplayFromIdentifier(stripped)];
  if (direct) return direct;
  for (const [key, status] of Object.entries(sopStatusByCode)) {
    if (sopFamilyCodesMatch(stripped, key)) return status;
  }
  return undefined;
}
