import SOPActivity from "@/models/SOPActivity";
import { connectDB } from "@/lib/mongodb";

export interface LogActivityParams {
  sopId: string;
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
  fieldsChanged?: string[];
  previousValues?: Record<string, unknown>;
  updatedValues?: Record<string, unknown>;
  reason?: string;
  comments?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  systemGenerated?: boolean;
  requiresApproval?: boolean;
}

export async function logSOPActivity(params: LogActivityParams) {
  try {
    await connectDB();

    const activity = await SOPActivity.create({
      sopId: params.sopId,
      sopIdentifier: params.sopIdentifier,
      sopName: params.sopName,
      userId: params.userId,
      userName: params.userName,
      userRole: params.userRole,
      userDepartment: params.userDepartment,
      actionType: params.actionType,
      actionCategory: params.actionCategory,
      timestamp: new Date(),
      fieldsChanged: params.fieldsChanged,
      previousValues: params.previousValues,
      updatedValues: params.updatedValues,
      reason: params.reason,
      comments: params.comments,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      sessionId: params.sessionId,
      systemGenerated: params.systemGenerated || false,
      requiresApproval: params.requiresApproval || false,
    });

    return {
      success: true,
      activityId: activity._id.toString(),
      timestamp: activity.timestamp,
    };
  } catch (error: unknown) {
    console.error("Error logging SOP activity:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export function compareSOPVersions(
  previous: Record<string, unknown>,
  updated: Record<string, unknown>,
): {
  fieldsChanged: string[];
  previousValues: Record<string, unknown>;
  updatedValues: Record<string, unknown>;
} {
  const fieldsChanged: string[] = [];
  const previousValues: Record<string, unknown> = {};
  const updatedValues: Record<string, unknown> = {};

  const trackedFields = [
    "name",
    "identifier",
    "department",
    "owner",
    "version",
    "reviewDate",
    "expiryDate",
    "effectiveDate",
    "processArea",
    "guidelineReference",
    "remarks",
    "status",
  ];

  for (const field of trackedFields) {
    if (previous[field] !== updated[field]) {
      fieldsChanged.push(field);
      previousValues[field] = previous[field];
      updatedValues[field] = updated[field];
    }
  }

  return { fieldsChanged, previousValues, updatedValues };
}
