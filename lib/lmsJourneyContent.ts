import { connectDB } from '@/lib/mongodb';
import {
  getOrBuildLmsCache,
  lmsServerKeys,
  lmsServerTtl,
  peekLmsServerCache,
  primeLmsServerCache,
} from '@/lib/lmsCache';
import SOP from '@/models/SOP';
import MCQBank from '@/models/MCQBank';

function toArray(val: string | string[] | undefined | null): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val.filter(Boolean) : [val];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripVersion(code: string): string {
  return String(code || '').toUpperCase().replace(/-\d+$/, '').trim();
}

type SopLean = {
  name: string;
  identifier: string;
  sopBaseId?: string;
  department: string;
  fileUrl?: string;
  fileType?: string;
  mediaLinks?: {
    videos?: { en?: string | string[]; gu?: string | string[] };
    slides?: { en?: string | string[]; gu?: string | string[] };
  };
  versionNum?: number;
  uploadedAt?: Date;
};

export interface JourneyContent {
  sop: {
    name: string;
    identifier: string;
    sopBaseId?: string;
    department: string;
    fileUrl?: string;
    fileType?: string;
    mcqCount: number;
  } | null;
  availableStepIds: string[];
  videosEn: string[];
  videosGu: string[];
  slidesEn: string[];
  slidesGu: string[];
  sopPdfUrl: string | null;
  sopFileType: 'pdf' | 'docx';
  mcqCount: number;
}

function buildJourneyContent(sop: SopLean | null, mcqCount: number): JourneyContent {
  const videosEn = sop ? toArray(sop.mediaLinks?.videos?.en) : [];
  const videosGu = sop ? toArray(sop.mediaLinks?.videos?.gu) : [];
  const slidesEn = sop ? toArray(sop.mediaLinks?.slides?.en) : [];
  const slidesGu = sop ? toArray(sop.mediaLinks?.slides?.gu) : [];
  const sopPdfUrl = sop?.fileUrl || null;

  const availableStepIds: string[] = [];
  if (videosEn.length > 0) availableStepIds.push('videoEn');
  if (videosGu.length > 0) availableStepIds.push('videoGu');
  if (sopPdfUrl) availableStepIds.push('sopPdf');
  if (slidesEn.length > 0) availableStepIds.push('slidesEn');
  if (slidesGu.length > 0) availableStepIds.push('slidesGu');
  if (mcqCount > 0) availableStepIds.push('quiz');

  return {
    sop: sop
      ? {
          name: sop.name,
          identifier: sop.identifier,
          sopBaseId: sop.sopBaseId,
          department: sop.department,
          fileUrl: sop.fileUrl,
          fileType: sop.fileType,
          mcqCount,
        }
      : null,
    availableStepIds,
    videosEn,
    videosGu,
    slidesEn,
    slidesGu,
    sopPdfUrl,
    sopFileType: sop?.fileType === 'docx' ? 'docx' : 'pdf',
    mcqCount,
  };
}

function sopRank(sop: SopLean): number {
  const version = sop.versionNum ?? 0;
  const uploaded = sop.uploadedAt ? new Date(sop.uploadedAt).getTime() : 0;
  return version * 1e15 + uploaded;
}

function sopMatchesCode(sop: SopLean, code: string): boolean {
  const codeUpper = code.toUpperCase();
  const id = String(sop.identifier || '').toUpperCase();
  const baseId = String(sop.sopBaseId || stripVersion(sop.identifier || '')).toUpperCase();
  return id === codeUpper || baseId === codeUpper || id.startsWith(codeUpper);
}

function mcqCountForCode(
  code: string,
  bankDocs: Array<{ sopIdentifier?: string; totalQuestions?: number }>,
): number {
  const re = new RegExp(`^${escapeRegex(code)}`, 'i');
  let total = 0;
  for (const bank of bankDocs) {
    if (re.test(String(bank.sopIdentifier || ''))) total += bank.totalQuestions || 0;
  }
  return total;
}

/** Resolve journey content for many SOP codes in two bulk DB queries. */
export async function getJourneyContentBatch(
  sopCodes: Iterable<string>,
): Promise<Map<string, JourneyContent>> {
  const unique = [...new Set([...sopCodes].filter(Boolean))];
  const result = new Map<string, JourneyContent>();
  const missing: string[] = [];

  for (const code of unique) {
    const cached = peekLmsServerCache<JourneyContent>(lmsServerKeys.journeyContent(code));
    if (cached) result.set(code, cached);
    else missing.push(code);
  }

  if (missing.length === 0) return result;

  await connectDB();

  const sopOr = missing.flatMap((code) => [
    { identifier: code },
    { sopBaseId: code },
    { identifier: { $regex: new RegExp(`^${escapeRegex(code)}`, 'i') } },
  ]);

  const [sopRows, bankDocs] = await Promise.all([
    SOP.find({ isObsolete: { $ne: true }, $or: sopOr })
      .select('name identifier sopBaseId department fileUrl fileType mediaLinks versionNum uploadedAt')
      .lean<SopLean[]>(),
    MCQBank.find({
      isObsolete: { $ne: true },
      language: 'English',
      $or: missing.map((code) => ({
        sopIdentifier: { $regex: new RegExp(`^${escapeRegex(code)}`, 'i') },
      })),
    })
      .select('sopIdentifier totalQuestions')
      .lean<Array<{ sopIdentifier?: string; totalQuestions?: number }>>(),
  ]);

  for (const code of missing) {
    let best: SopLean | null = null;
    let bestRank = -1;
    for (const sop of sopRows) {
      if (!sopMatchesCode(sop, code)) continue;
      const rank = sopRank(sop);
      if (rank > bestRank) {
        best = sop;
        bestRank = rank;
      }
    }

    const content = buildJourneyContent(best, mcqCountForCode(code, bankDocs));
    result.set(code, content);
    primeLmsServerCache(
      lmsServerKeys.journeyContent(code),
      content,
      lmsServerTtl.journeyContent,
    );
  }

  return result;
}

/** Shared SOP content for a journey — identical for every learner. */
export async function getJourneyContent(sopCode: string): Promise<JourneyContent> {
  return getOrBuildLmsCache(
    lmsServerKeys.journeyContent(sopCode),
    lmsServerTtl.journeyContent,
    async () => {
      const batch = await getJourneyContentBatch([sopCode]);
      return batch.get(sopCode) ?? buildJourneyContent(null, 0);
    },
  );
}
