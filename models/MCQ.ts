import mongoose, { Schema, Document, Model } from "mongoose";

export interface IMCQ extends Document {
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
  language: "English" | "Gujarati";
  sopId: mongoose.Types.ObjectId;
  identifier: string;
  department: string;
  status: "draft" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}

const MCQSchema = new Schema<IMCQ>(
  {
    question: { type: String, required: true },
    optionA: { type: String, required: true },
    optionB: { type: String, required: true },
    optionC: { type: String, required: true },
    optionD: { type: String, required: true },
    correctAnswer: { type: String, enum: ["A", "B", "C", "D"], required: true },
    explanation: { type: String, default: "" },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
    topic: { type: String, default: "" },
    language: { type: String, enum: ["English", "Gujarati"], required: true },
    sopId: { type: Schema.Types.ObjectId, ref: "SOP", required: true },
    identifier: { type: String, required: true, index: true },
    department: { type: String, required: true },
    status: { type: String, enum: ["draft", "approved", "rejected"], default: "draft" },
  },
  { timestamps: true },
);

MCQSchema.index({ identifier: 1, language: 1, status: 1 });

const MCQ: Model<IMCQ> = mongoose.models.MCQ || mongoose.model<IMCQ>("MCQ", MCQSchema);

export default MCQ;
