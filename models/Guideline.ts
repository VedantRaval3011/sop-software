import mongoose, { Schema, Document, Model } from "mongoose";

export interface IGuidelineClause {
  number: string;
  title: string;
  text: string;
}

export interface IGuideline extends Document {
  name: string;
  folder: string;
  clauses: IGuidelineClause[];
  createdAt: Date;
  updatedAt: Date;
}

const GuidelineSchema = new Schema<IGuideline>(
  {
    name: { type: String, required: true, trim: true },
    folder: { type: String, required: true, trim: true, index: true },
    clauses: [
      {
        number: { type: String, required: true },
        title: { type: String, required: true },
        text: { type: String, required: true },
      },
    ],
  },
  { timestamps: true },
);

const Guideline: Model<IGuideline> =
  mongoose.models.Guideline || mongoose.model<IGuideline>("Guideline", GuidelineSchema);

export default Guideline;
