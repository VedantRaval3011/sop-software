import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import { listActiveComplianceRunIds } from "@/lib/compliance-run-control";
import { requireAuth } from "@/lib/withAuth";
import mongoose from "mongoose";

/** GET /api/compliance/active — in-process compliance runs on this server. */
export async function GET() {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    const sopIds = listActiveComplianceRunIds();
    if (!sopIds.length) {
      return NextResponse.json({ success: true, active: false, runs: [] });
    }

    await connectDB();
    const objectIds = sopIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const sops = objectIds.length
      ? await SOP.find({ _id: { $in: objectIds } }).select("identifier name").lean()
      : [];

    const sopById = new Map(sops.map((s) => [s._id.toString(), s]));

    const runs = sopIds.map((sopId) => {
      const sop = sopById.get(sopId);
      return {
        sopId,
        identifier: sop?.identifier ?? sopId,
        name: sop?.name ?? "Unknown SOP",
      };
    });

    return NextResponse.json({ success: true, active: runs.length > 0, runs });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list active runs" },
      { status: 500 },
    );
  }
}
