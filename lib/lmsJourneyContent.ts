import { connectDB } from '@/lib/mongodb';
import {
  getOrBuildLmsCache,
  lmsServerKeys,
  lmsServerTtl,
} from '@/lib/lmsCache';
import SOP from '@/models/SOP';
import MCQBank from '@/models/MCQBank';

function toArray(val: string | string[] | undefined | null): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val.filter(Boolean) : [val];
}

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

/** Shared SOP content for a journey — identical for every learner. */
export async function getJourneyContent(sopCode: string): Promise<JourneyContent> {
  return getOrBuildLmsCache(
    lmsServerKeys.journeyContent(sopCode),
    lmsServerTtl.journeyContent,
    async () => {
      await connectDB();

      const sop = await SOP.findOne({
        $or: [
          { identifier: sopCode },
          { sopBaseId: sopCode },
          { identifier: new RegExp(`^${sopCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') },
        ],
        isObsolete: { $ne: true },
      })
        .sort({ versionNum: -1, uploadedAt: -1 })
        .select('name identifier sopBaseId department fileUrl fileType mediaLinks sopDocuments mcqCount')
        .lean();

      const escaped = sopCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bankDocs = await MCQBank.find({
        sopIdentifier: { $regex: new RegExp(`^${escaped}`, 'i') },
        isObsolete: { $ne: true },
        language: 'English',
      }).select('totalQuestions').lean();
      const mcqCount = bankDocs.reduce((sum, b) => sum + (b.totalQuestions || 0), 0);

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
    },
  );
}
