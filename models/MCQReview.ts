import mongoose, { Schema, Document, Model } from "mongoose";

interface IQuestionSnapshot {
  aiIcon: string;
  question: string;
  difficulty: "Easy" | "Medium" | "Hard";
  difficultyStars: "⭐" | "⭐⭐" | "⭐⭐⭐";
  options: string[];
  correctAnswer: string;
  explanation: string;
  sopReference: string;
  optionVariants?: { text: string; isCorrect: boolean }[];
}

export interface IMCQReview extends Document {
  originalMcqBankId: mongoose.Types.ObjectId;
  originalQuestionIndex: number;
  sopId?: mongoose.Types.ObjectId;
  sopName: string;
  sopIdentifier: string;
  originalQuestion: IQuestionSnapshot;
  editedQuestion?: IQuestionSnapshot;
  reviewStatus: "pending" | "done";
  flaggedBy?: string;
  flaggedAt: Date;
  reviewNotes?: string;
  editedBy?: string;
  editedAt?: Date;
  markedDoneBy?: string;
  markedDoneAt?: Date;
  versionNumber: number;
  lastUpdatedVersion?: number;
  hasBeenRecycled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSnapshotSchema = new Schema(
  {
    aiIcon: { type: String, required: true },
    question: { type: String, required: true },
    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], required: true },
    difficultyStars: { type: String, enum: ["⭐", "⭐⭐", "⭐⭐⭐"], required: true },
    options: { type: [String], required: true },
    correctAnswer: { type: String, required: true },
    explanation: { type: String, required: true },
    sopReference: { type: String, required: true },
    optionVariants: [{ text: String, isCorrect: Boolean }],
  },
  { _id: false },
);

const MCQReviewSchema = new Schema<IMCQReview>(
  {
    originalMcqBankId: { type: Schema.Types.ObjectId, ref: "MCQBank", required: true },
    originalQuestionIndex: { type: Number, required: true },
    sopId: { type: Schema.Types.ObjectId, ref: "SOP" },
    sopName: { type: String, required: true },
    sopIdentifier: { type: String, required: true },
    originalQuestion: { type: QuestionSnapshotSchema, required: true },
    editedQuestion: { type: QuestionSnapshotSchema },
    reviewStatus: { type: String, enum: ["pending", "done"], default: "pending" },
    flaggedBy: { type: String },
    flaggedAt: { type: Date, default: Date.now },
    reviewNotes: { type: String },
    editedBy: { type: String },
    editedAt: { type: Date },
    markedDoneBy: { type: String },
    markedDoneAt: { type: Date },
    versionNumber: { type: Number, default: 1 },
    lastUpdatedVersion: { type: Number },
    hasBeenRecycled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

MCQReviewSchema.index({ sopId: 1 });
MCQReviewSchema.index({ sopIdentifier: 1 });
MCQReviewSchema.index({ reviewStatus: 1 });
MCQReviewSchema.index({ originalMcqBankId: 1, originalQuestionIndex: 1 });

if (mongoose.models.MCQReview) delete mongoose.models.MCQReview;
const MCQReview: Model<IMCQReview> = mongoose.model<IMCQReview>("MCQReview", MCQReviewSchema);
export default MCQReview;
