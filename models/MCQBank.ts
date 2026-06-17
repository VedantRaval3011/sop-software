import mongoose, { Schema, Document, Model } from "mongoose";

export type DifficultyLevel = "Easy" | "Medium" | "Hard";

export interface IOptionVariant {
  text: string;
  isCorrect: boolean;
}

export interface IMCQ {
  aiIcon: string;
  question: string;
  difficulty: DifficultyLevel;
  difficultyStars: "⭐" | "⭐⭐" | "⭐⭐⭐";
  options: string[];
  correctAnswer: string;
  explanation: string;
  sopReference: string;
  optionVariants: IOptionVariant[];
  isChecked?: boolean;
  isReviewed?: boolean;
  isSimilar?: boolean;
}

export interface IMCQBank extends Document {
  sopId: mongoose.Types.ObjectId;
  sopName: string;
  sopIdentifier: string;
  department: string;
  folderDepartment?: string;
  folderSubcategory?: string;
  mcqs: IMCQ[];
  generatedAt: Date;
  totalQuestions: number;
  difficultyDistribution: { easy: number; medium: number; hard: number };
  aiModel?: string;
  language?: "English" | "Gujarati";
  isObsolete?: boolean;
  obsoleteAt?: Date;
  obsoleteReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OptionVariantSchema = new Schema<IOptionVariant>(
  { text: { type: String, required: true }, isCorrect: { type: Boolean, required: true } },
  { _id: false },
);

const MCQSchema = new Schema<IMCQ>(
  {
    aiIcon: { type: String, required: true },
    question: { type: String, required: true },
    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], required: true },
    difficultyStars: { type: String, enum: ["⭐", "⭐⭐", "⭐⭐⭐"], required: true },
    options: {
      type: [String],
      required: true,
      validate: { validator: (v: string[]) => v.length === 4, message: "Exactly 4 options required" },
    },
    correctAnswer: { type: String, required: true },
    explanation: { type: String, required: true },
    sopReference: { type: String, required: true },
    optionVariants: { type: [OptionVariantSchema], default: [] },
    isChecked: { type: Boolean, default: false },
    isReviewed: { type: Boolean, default: false },
    isSimilar: { type: Boolean, default: false },
  },
  { _id: false },
);

const MCQBankSchema = new Schema<IMCQBank>(
  {
    sopId: { type: Schema.Types.ObjectId, ref: "SOP", required: true },
    sopName: { type: String, required: true },
    sopIdentifier: { type: String, required: true },
    department: { type: String, required: true, default: "General" },
    folderDepartment: { type: String },
    folderSubcategory: { type: String },
    mcqs: {
      type: [MCQSchema],
      required: true,
      validate: { validator: (v: IMCQ[]) => v.length >= 1 && v.length <= 500, message: "MCQs must be 1–500" },
    },
    generatedAt: { type: Date, default: Date.now },
    totalQuestions: { type: Number, required: true },
    difficultyDistribution: {
      easy: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      hard: { type: Number, default: 0 },
    },
    aiModel: { type: String, default: "gemini-2.5-flash" },
    language: { type: String, enum: ["English", "Gujarati"], default: "English" },
    isObsolete: { type: Boolean, default: false },
    obsoleteAt: { type: Date },
    obsoleteReason: { type: String },
  },
  { timestamps: true },
);

MCQBankSchema.pre("save", function () {
  if (this.mcqs) this.totalQuestions = this.mcqs.length;
});

MCQBankSchema.index({ sopId: 1 });
MCQBankSchema.index({ sopId: 1, language: 1 });
MCQBankSchema.index({ sopIdentifier: 1 });
MCQBankSchema.index({ department: 1 });
MCQBankSchema.index({ folderDepartment: 1 });
MCQBankSchema.index({ folderDepartment: 1, folderSubcategory: 1 });

if (mongoose.models.MCQBank) delete mongoose.models.MCQBank;
const MCQBank: Model<IMCQBank> = mongoose.model<IMCQBank>("MCQBank", MCQBankSchema);
export default MCQBank;
