import mongoose, { Schema, Document, Model } from "mongoose";

interface ITestQuestion {
  questionIndex: number;
  question: string;
  aiIcon: string;
  difficulty: "Easy" | "Medium" | "Hard";
  difficultyStars: "⭐" | "⭐⭐" | "⭐⭐⭐";
  options: string[];
  selectedAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
  sopReference: string;
}

export interface IMCQBankTestResult extends Document {
  userId: string;
  username: string;
  userFullName: string;
  mcqBankId: mongoose.Types.ObjectId;
  sopName: string;
  sopIdentifier: string;
  testName: string;
  questions: ITestQuestion[];
  totalQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  skippedQuestions: number;
  score: number;
  grade: "A+" | "A" | "B+" | "B" | "C" | "D" | "F";
  isPassed: boolean;
  passingScore: number;
  difficultyBreakdown: {
    easy: { correct: number; total: number };
    medium: { correct: number; total: number };
    hard: { correct: number; total: number };
  };
  timeTaken: number;
  startedAt: Date;
  completedAt: Date;
  attemptNumber: number;
  createdAt: Date;
  updatedAt: Date;
}

const TestQuestionSchema = new Schema(
  {
    questionIndex: { type: Number, required: true },
    question: { type: String, required: true },
    aiIcon: { type: String, default: "❓" },
    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], required: true },
    difficultyStars: { type: String, enum: ["⭐", "⭐⭐", "⭐⭐⭐"] },
    options: { type: [String], required: true },
    selectedAnswer: { type: String, default: "" },
    correctAnswer: { type: String, required: true },
    isCorrect: { type: Boolean, required: true },
    explanation: { type: String, default: "" },
    sopReference: { type: String, default: "" },
  },
  { _id: false },
);

const MCQBankTestResultSchema = new Schema<IMCQBankTestResult>(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true },
    userFullName: { type: String, required: true },
    mcqBankId: { type: Schema.Types.ObjectId, ref: "MCQBank", required: true },
    sopName: { type: String, required: true },
    sopIdentifier: { type: String, required: true },
    testName: { type: String, required: true },
    questions: { type: [TestQuestionSchema], required: true },
    totalQuestions: { type: Number, required: true },
    correctAnswers: { type: Number, required: true },
    incorrectAnswers: { type: Number, required: true },
    skippedQuestions: { type: Number, default: 0 },
    score: { type: Number, required: true },
    grade: { type: String, enum: ["A+", "A", "B+", "B", "C", "D", "F"], required: true },
    isPassed: { type: Boolean, required: true },
    passingScore: { type: Number, default: 70 },
    difficultyBreakdown: {
      easy: {
        correct: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      medium: {
        correct: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
      hard: {
        correct: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
      },
    },
    timeTaken: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: Date.now },
    attemptNumber: { type: Number, default: 1 },
  },
  { timestamps: true },
);

MCQBankTestResultSchema.index({ userId: 1 });
MCQBankTestResultSchema.index({ mcqBankId: 1 });
MCQBankTestResultSchema.index({ userId: 1, mcqBankId: 1 });

if (mongoose.models.MCQBankTestResult) delete mongoose.models.MCQBankTestResult;
const MCQBankTestResult: Model<IMCQBankTestResult> = mongoose.model<IMCQBankTestResult>(
  "MCQBankTestResult",
  MCQBankTestResultSchema,
);
export default MCQBankTestResult;
