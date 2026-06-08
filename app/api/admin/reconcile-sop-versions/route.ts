import { NextResponse } from "next/server";
import { reconcileSopVersions } from "@/lib/reconcile-sop-versions";
import { requireAuth } from "@/lib/withAuth";

export async function POST() {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    const result = await reconcileSopVersions();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reconcile SOP versions" },
      { status: 500 },
    );
  }
}
