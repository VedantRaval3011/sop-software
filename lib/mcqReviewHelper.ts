import { connectDB } from "@/lib/mongodb";
import MCQReview from "@/models/MCQReview";

export async function applyEditsToMCQs(mcqs: any[]): Promise<any[]> {
  if (!mcqs || mcqs.length === 0) return mcqs;

  try {
    await connectDB();
    const doneReviews = await MCQReview.find({
      reviewStatus: "done",
      editedQuestion: { $exists: true, $ne: null },
    }).lean();

    if (doneReviews.length === 0) return mcqs;

    const editMap = new Map<string, any>();
    for (const review of doneReviews) {
      const key = `${review.originalMcqBankId.toString()}:${review.originalQuestionIndex}`;
      editMap.set(key, review.editedQuestion);
    }

    return mcqs.map((mcq) => {
      const bankId = mcq.mcqBankId;
      if (!bankId) return mcq;
      const key = `${bankId}:${mcq.questionIndex}`;
      const edited = editMap.get(key);
      if (!edited) return mcq;
      return { ...mcq, ...edited, _isEdited: true };
    });
  } catch {
    return mcqs;
  }
}

export async function getReviewStats() {
  await connectDB();
  const [pending, done] = await Promise.all([
    MCQReview.countDocuments({ reviewStatus: "pending" }),
    MCQReview.countDocuments({ reviewStatus: "done" }),
  ]);
  return { pending, done, total: pending + done };
}

export async function buildEditMap(): Promise<Map<string, any>> {
  await connectDB();
  const doneReviews = await MCQReview.find({
    reviewStatus: "done",
    editedQuestion: { $exists: true, $ne: null },
  }).lean();
  const map = new Map<string, any>();
  for (const r of doneReviews) {
    map.set(`${r.originalMcqBankId.toString()}:${r.originalQuestionIndex}`, r.editedQuestion);
  }
  return map;
}

export function hasEditedVersion(
  mcqBankId: string,
  questionIndex: number,
  editMap: Map<string, any>,
): boolean {
  return editMap.has(`${mcqBankId}:${questionIndex}`);
}

export function getEditedQuestion(
  mcqBankId: string,
  questionIndex: number,
  editMap: Map<string, any>,
): any | null {
  return editMap.get(`${mcqBankId}:${questionIndex}`) || null;
}

export function applyEditToMCQ(mcq: any, editedQuestion: any): any {
  return { ...mcq, ...editedQuestion, _isEdited: true };
}
