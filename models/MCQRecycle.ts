import mongoose, { Schema, Document, Model } from "mongoose";

export interface IMCQRecycle extends Document {
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  explanation: string;
  difficulty: string;
  topic: string;
  language: string;
  sopId?: mongoose.Types.ObjectId;
  identifier: string;
  department: string;
  similarityScore: number;
  replacedBy?: mongoose.Types.ObjectId;
  reason: string;
  createdAt: Date;
}

const MCQRecycleSchema = new Schema<IMCQRecycle>(
  {
    question: { type: String, required: true },
    optionA: String,
    optionB: String,
    optionC: String,
    optionD: String,
    correctAnswer: String,
    explanation: String,
    difficulty: String,
    topic: String,
    language: String,
    sopId: { type: Schema.Types.ObjectId, ref: "SOP" },
    identifier: { type: String, required: true, index: true },
    department: String,
    similarityScore: { type: Number, default: 0 },
    replacedBy: { type: Schema.Types.ObjectId, ref: "MCQ" },
    reason: { type: String, default: "similarity_duplicate" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const MCQRecycle: Model<IMCQRecycle> =
  mongoose.models.MCQRecycle ||
  mongoose.model<IMCQRecycle>("MCQRecycle", MCQRecycleSchema);

export default MCQRecycle;
