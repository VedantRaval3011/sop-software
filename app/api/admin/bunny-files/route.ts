import { NextRequest, NextResponse } from "next/server";
import { listAllBunnyFiles } from "@/lib/bunny-files-report";
import { requireAuth } from "@/lib/withAuth";
import { isBunnyConfigured } from "@/lib/validateEnv";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin"]);
  if (auth.error) return auth.error;

  if (!isBunnyConfigured()) {
    return NextResponse.json({ error: "Bunny CDN is not configured" }, { status: 500 });
  }

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    const report = await listAllBunnyFiles(refresh);
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list Bunny files" },
      { status: 500 },
    );
  }
}
