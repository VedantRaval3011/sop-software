import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import Department from "@/models/Department";
import { buildDashboardStats, groupSOPRecords, sortByDeptOrder } from "@/lib/sop-utils";
import {
  getServerGroupedCache,
  setServerGroupedCache,
} from "@/lib/cache";
import { requireAuth } from "@/lib/withAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();

    let registry = getServerGroupedCache();
    if (!registry) {
      const records = await SOP.find({}).select("-content").lean();
      registry = groupSOPRecords(records as never[]);
      setServerGroupedCache(registry);
    }

    // Fetch persisted department names (empty departments created via the UI)
    const persistedDepts = (await Department.distinct("name")) as string[];

    const stats = buildDashboardStats(registry, persistedDepts);

    // departmentList = union of SOP-derived and persisted (for dropdowns)
    const sopDepts = registry.filter((r) => !r.isObsolete).map((r) => r.department);
    const departmentList = sortByDeptOrder([
      ...new Set([...sopDepts, ...persistedDepts]),
    ]);

    return NextResponse.json(
      { ...stats, departmentList },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GET /api/sops/stats error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
