import { NextResponse } from "next/server";
import { getLlmInfo } from "@/lib/llm";
import { requireAuth } from "@/lib/withAuth";

export async function GET() {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  return NextResponse.json({ success: true, llm: getLlmInfo() });
}
