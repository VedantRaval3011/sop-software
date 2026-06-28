import { NextResponse } from "next/server";
import { checkCodexCliHealth, getComplianceCodexModel, getMcqCodexModel } from "@/lib/codex-cli";
import { requireAuth } from "@/lib/withAuth";

/** Verify the server can reach the local Codex CLI and subscription auth. */
export async function GET() {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  const health = await checkCodexCliHealth();
  return NextResponse.json({
    success: health.ok,
    codex: {
      ...health,
      mcqModel: getMcqCodexModel(),
      complianceModel: getComplianceCodexModel(),
    },
  });
}
