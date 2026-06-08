import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Guideline from "@/models/Guideline";
import { requireAuth } from "@/lib/withAuth";

export async function GET() {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const guidelines = await Guideline.find({}).sort({ folder: 1, name: 1 }).lean();
    const folders = guidelines.reduce<Record<string, typeof guidelines>>((acc, g) => {
      if (!acc[g.folder]) acc[g.folder] = [];
      acc[g.folder].push(g);
      return acc;
    }, {});
    return NextResponse.json({ guidelines, folders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch guidelines" },
      { status: 500 },
    );
  }
}
