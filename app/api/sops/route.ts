import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import {
  applyFilters,
  paginate,
  parseFiltersFromSearchParams,
  sopVersionFields,
} from "@/lib/sop-utils";
import { invalidateDashboardSopsCache } from "@/lib/cache";
import { loadGroupedRegistry } from "@/lib/dashboardRegistrySource";
import { requireAuth } from "@/lib/withAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    const filters = parseFiltersFromSearchParams(request.nextUrl.searchParams);
    const grouped = await loadGroupedRegistry();
    const filtered = applyFilters(grouped, filters);
    const { items, total } = paginate(filtered, filters.page, filters.limit);

    return NextResponse.json(
      { items, total, page: filters.page, limit: filters.limit },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GET /api/sops error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch SOPs" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const body = await request.json();
    const { sopBaseId, versionNum, version: resolvedVersion } = sopVersionFields(
      (body.identifier ?? "").trim(),
      body.version,
    );
    const sop = await SOP.create({ ...body, sopBaseId, versionNum, version: resolvedVersion });
    invalidateDashboardSopsCache();
    return NextResponse.json(sop, { status: 201 });
  } catch (error) {
    console.error("POST /api/sops error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create SOP" },
      { status: 500 },
    );
  }
}
