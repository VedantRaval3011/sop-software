import { NextResponse } from "next/server";
import { checkClaudeCliHealth } from "@/lib/claude-cli";
import { requireAuth } from "@/lib/withAuth";

/** Verify the server can reach the local Claude Code CLI and which account is logged in. */
export async function GET() {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  const health = await checkClaudeCliHealth();
  return NextResponse.json({ success: health.ok, claude: health });
}
