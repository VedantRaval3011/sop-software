import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import type { EditSOPPayload } from "@/lib/types";
import {
  applyRegistryUpdate,
  buildEditFormData,
  markRegistryObsolete,
  sopFamilyIdentifierRegex,
} from "@/lib/sop-utils";
import { invalidateDashboardSopsCache } from "@/lib/cache";
import { requireAuth } from "@/lib/withAuth";

type RouteContext = { params: Promise<{ identifier: string }> };

async function loadGroup(identifier: string) {
  await connectDB();
  return SOP.find({ identifier: sopFamilyIdentifierRegex(identifier) });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    const { identifier } = await context.params;
    const group = await loadGroup(decodeURIComponent(identifier));
    if (!group.length) {
      return NextResponse.json({ error: "SOP not found" }, { status: 404 });
    }
    return NextResponse.json(buildEditFormData(group));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch SOP" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    const { identifier } = await context.params;
    const group = await loadGroup(decodeURIComponent(identifier));
    if (!group.length) {
      return NextResponse.json({ error: "SOP not found" }, { status: 404 });
    }

    const body = (await request.json()) as EditSOPPayload;
    if (!body.name?.trim() || !body.department?.trim() || !body.identifier?.trim()) {
      return NextResponse.json(
        { error: "Name, department, and SOP number are required" },
        { status: 400 },
      );
    }

    await applyRegistryUpdate(group, body);
    invalidateDashboardSopsCache();
    const refreshed = await loadGroup(body.identifier.trim());
    return NextResponse.json(buildEditFormData(refreshed));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update SOP" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    const { identifier } = await context.params;
    const group = await loadGroup(decodeURIComponent(identifier));
    if (!group.length) {
      return NextResponse.json({ error: "SOP not found" }, { status: 404 });
    }

    await markRegistryObsolete(group);
    invalidateDashboardSopsCache();
    return NextResponse.json({ success: true, identifier: group[0].identifier });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete SOP" },
      { status: 500 },
    );
  }
}
