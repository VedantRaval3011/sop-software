import mongoose, { Document, Schema } from "mongoose";

export interface ISOPActivity extends Document {
  sopId: mongoose.Types.ObjectId;
  sopIdentifier: string;
  sopName: string;
  userId: string;
  userName: string;
  userRole: string;
  userDepartment?: string;
  actionType:
    | "created"
    | "updated"
    | "reviewed"
    | "approved"
    | "rejected"
    | "downloaded"
    | "viewed"
    | "expired"
    | "deleted"
    | "restored"
    | "merged";
  actionCategory: "lifecycle" | "content" | "access" | "compliance" | "administrative";
  timestamp: Date;
  fieldsChanged?: string[];
  previousValues?: Record<string, unknown>;
  updatedValues?: Record<string, unknown>;
  reason?: string;
  comments?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  requiresApproval?: boolean;
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedBy?: string;
  approvedAt?: Date;
  systemGenerated: boolean;
  relatedActivityId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SOPActivitySchema = new Schema<ISOPActivity>(
  {
    sopId: { type: Schema.Types.ObjectId, ref: "SOP", required: true, index: true },
    sopIdentifier: { type: String, required: true, index: true },
    sopName: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    userRole: { type: String, required: true, index: true },
    userDepartment: { type: String, index: true },
    actionType: {
      type: String,
      enum: [
        "created",
        "updated",
        "reviewed",
        "approved",
        "rejected",
        "downloaded",
        "viewed",
        "expired",
        "deleted",
        "restored",
        "merged",
      ],
      required: true,
      index: true,
    },
    actionCategory: {
      type: String,
      enum: ["lifecycle", "content", "access", "compliance", "administrative"],
      required: true,
      index: true,
    },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
    fieldsChanged: [String],
    previousValues: Schema.Types.Mixed,
    updatedValues: Schema.Types.Mixed,
    reason: String,
    comments: String,
    ipAddress: String,
    userAgent: String,
    sessionId: String,
    requiresApproval: { type: Boolean, default: false },
    approvalStatus: { type: String, enum: ["pending", "approved", "rejected"] },
    approvedBy: String,
    approvedAt: Date,
    systemGenerated: { type: Boolean, default: false },
    relatedActivityId: { type: Schema.Types.ObjectId, ref: "SOPActivity" },
  },
  { timestamps: true, collection: "sop_activities" },
);

SOPActivitySchema.index({ timestamp: -1 });
SOPActivitySchema.index({ sopId: 1, timestamp: -1 });
SOPActivitySchema.index({ userId: 1, timestamp: -1 });

const SOPActivity =
  mongoose.models.SOPActivity || mongoose.model<ISOPActivity>("SOPActivity", SOPActivitySchema);

export default SOPActivity;
