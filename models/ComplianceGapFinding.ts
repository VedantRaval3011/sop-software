import mongoose, { Schema, Document, Model } from "mongoose";

export type ComplianceGapStatus =
  | "fully-compliant"
  | "partially-compliant"
  | "non-compliant"
  | "contradiction"
  | "improvement-opportunity"
  | "not-applicable";

export type GapType =
  | "missing-requirement"
  | "partial-requirement"
  | "contradiction"
  | "ambiguous-statement"
  | "improvement-opportunity";

export type ResolutionStatus =
  | "open"
  | "resolved"
  | "partially-resolved"
  | "still-present"
  | "cannot-determine"
  | "needs-manual-review";

export interface IComplianceGapFinding extends Document {
  gapId: string;
  sopId: mongoose.Types.ObjectId;
  reportId?: mongoose.Types.ObjectId;
  guidelineId?: mongoose.Types.ObjectId;
  guidelineName: string;
  folderName?: string;
  guidelineSection: string;
  guidelineSectionTitle?: string;
  guidelineRequirement: string;
  sopSection: string;
  sopSectionText: string;
  complianceStatus: ComplianceGapStatus;
  severity: "critical" | "major" | "minor" | "informational";
  gapType: GapType;
  gapExplanation: string;
  impactAnalysis?: string;
  operationalRisk?: string;
  auditRisk?: string;
  recommendedAction: string;
  proposedVerbiage: string;
  confidenceScore: number;
  evidenceGuidelineQuote: string;
  evidenceSopQuote: string;
  sopTextHash: string;
  requirementHash: string;
  rootCauseKey?: string;
  mergedGapIds?: string[];
  mergedClauseRefs?: string[];
  resolved: boolean;
  resolvedAt?: Date;
  resolutionStatus: ResolutionStatus;
  identifiedAt: Date;
  lastReviewedAt?: Date;
  lastAppliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ComplianceGapFindingSchema = new Schema<IComplianceGapFinding>(
  {
    gapId: { type: String, required: true, unique: true, index: true, trim: true },
    sopId: { type: Schema.Types.ObjectId, ref: "SOP", required: true, index: true },
    reportId: { type: Schema.Types.ObjectId, ref: "ComplianceReport", index: true },
    guidelineId: { type: Schema.Types.ObjectId, ref: "SOPGuideline" },
    guidelineName: { type: String, required: true, trim: true },
    folderName: { type: String, trim: true },
    guidelineSection: { type: String, required: true, trim: true },
    guidelineSectionTitle: { type: String, trim: true },
    guidelineRequirement: { type: String, required: true },
    sopSection: { type: String, required: true, trim: true, index: true },
    sopSectionText: { type: String, default: "" },
    complianceStatus: {
      type: String,
      enum: [
        "fully-compliant",
        "partially-compliant",
        "non-compliant",
        "contradiction",
        "improvement-opportunity",
        "not-applicable",
      ],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["critical", "major", "minor", "informational"],
      default: "minor",
      index: true,
    },
    gapType: {
      type: String,
      enum: [
        "missing-requirement",
        "partial-requirement",
        "contradiction",
        "ambiguous-statement",
        "improvement-opportunity",
      ],
      default: "missing-requirement",
    },
    gapExplanation: { type: String, default: "" },
    impactAnalysis: { type: String },
    operationalRisk: { type: String },
    auditRisk: { type: String },
    recommendedAction: { type: String, default: "" },
    proposedVerbiage: { type: String, default: "" },
    confidenceScore: { type: Number, min: 0, max: 100, default: 70 },
    evidenceGuidelineQuote: { type: String, default: "" },
    evidenceSopQuote: { type: String, default: "" },
    sopTextHash: { type: String, required: true, index: true },
    requirementHash: { type: String, required: true, index: true },
    rootCauseKey: { type: String, trim: true, index: true },
    mergedGapIds: { type: [String], default: undefined },
    mergedClauseRefs: { type: [String], default: undefined },
    resolved: { type: Boolean, default: false, index: true },
    resolvedAt: { type: Date },
    resolutionStatus: {
      type: String,
      enum: [
        "open",
        "resolved",
        "partially-resolved",
        "still-present",
        "cannot-determine",
        "needs-manual-review",
      ],
      default: "open",
      index: true,
    },
    identifiedAt: { type: Date, default: Date.now },
    lastReviewedAt: { type: Date },
    lastAppliedAt: { type: Date },
  },
  { timestamps: true },
);

ComplianceGapFindingSchema.index({ sopId: 1, resolved: 1, resolutionStatus: 1 });
ComplianceGapFindingSchema.index({ sopId: 1, requirementHash: 1, rootCauseKey: 1 });

if (process.env.NODE_ENV !== "production" && mongoose.models.ComplianceGapFinding) {
  delete mongoose.models.ComplianceGapFinding;
}

const ComplianceGapFinding: Model<IComplianceGapFinding> =
  mongoose.models.ComplianceGapFinding ||
  mongoose.model<IComplianceGapFinding>("ComplianceGapFinding", ComplianceGapFindingSchema);

export default ComplianceGapFinding;
