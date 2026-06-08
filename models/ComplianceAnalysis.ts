import mongoose, { Schema, Document, Model } from "mongoose";

export interface IComplianceFinding {
  clause: string;
  title: string;
  status: "compliant" | "partial" | "non-compliant" | "not-applicable";
  severity: "critical" | "major" | "minor" | "informational";
  description: string;
  recommendation: string;
  confidence: number;
}

export interface IComplianceAnalysis extends Document {
  sopId: mongoose.Types.ObjectId;
  sopIdentifier: string;
  guidelineId: mongoose.Types.ObjectId;
  guidelineName: string;
  score: number;
  findings: IComplianceFinding[];
  clauseCount: number;
  analyzedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ComplianceAnalysisSchema = new Schema<IComplianceAnalysis>(
  {
    sopId: { type: Schema.Types.ObjectId, ref: "SOP", required: true, index: true },
    sopIdentifier: { type: String, required: true, index: true },
    guidelineId: { type: Schema.Types.ObjectId, ref: "Guideline", required: true },
    guidelineName: { type: String, required: true },
    score: { type: Number, required: true, min: 0, max: 10 },
    findings: [
      {
        clause: String,
        title: String,
        status: {
          type: String,
          enum: ["compliant", "partial", "non-compliant", "not-applicable"],
        },
        severity: {
          type: String,
          enum: ["critical", "major", "minor", "informational"],
        },
        description: String,
        recommendation: String,
        confidence: Number,
      },
    ],
    clauseCount: { type: Number, default: 0 },
    analyzedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

ComplianceAnalysisSchema.index({ sopId: 1, guidelineId: 1 });

const ComplianceAnalysis: Model<IComplianceAnalysis> =
  mongoose.models.ComplianceAnalysis ||
  mongoose.model<IComplianceAnalysis>("ComplianceAnalysis", ComplianceAnalysisSchema);

export default ComplianceAnalysis;
