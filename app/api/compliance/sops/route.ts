import { NextRequest, NextResponse } from "next/server";
import { getGroupedRegistryRows } from "@/lib/dashboardRegistrySource";
import { sortByDeptOrder } from "@/lib/sop-utils";
import { requireAuth } from "@/lib/withAuth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    const department = request.nextUrl.searchParams.get("department");
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    // Use the same grouped registry as the dashboard — one row per SOP family,
    // current version, with departments resolved during grouping.
    const grouped = await getGroupedRegistryRows();
    const active = grouped.filter((s) => !s.isObsolete);

    const allSops = active.map((s) => ({
      _id: s.id,
      identifier: s.identifier,
      name: s.name,
      department: s.department,
      version: s.version ?? "1.0",
      language: s.language ?? "English",
      location: s.location ?? "",
    }));

    const departments = sortByDeptOrder([
      ...new Set(allSops.map((s) => s.department).filter(Boolean)),
    ]);

    const filtered = department
      ? allSops.filter((s) => s.department === department)
      : allSops;

    const total = filtered.length;
    const sops =
      limit && limit > 0 && Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;

    return NextResponse.json({ success: true, sops, departments, total });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to fetch SOPs" },
      { status: 500 },
    );
  }
}
