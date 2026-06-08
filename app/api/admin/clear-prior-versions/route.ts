import { NextResponse } from "next/server";
import { clearAllPriorVersionRecords } from "@/lib/clear-prior-versions";
import { requireAuth } from "@/lib/withAuth";

export async function POST() {
  const auth = await requireAuth(["admin"]);
  if (auth.error) return auth.error;

  try {
    const result = await clearAllPriorVersionRecords();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear prior versions" },
      { status: 500 },
    );
  }
}
