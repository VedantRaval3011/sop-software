import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAuth } from "@/lib/withAuth";
import MCQGenJob from "@/models/MCQGenJob";

// Live progress for an MCQ generation/regeneration run. Polled by the MCQ Bank
// client while a row is generating. Returns 404 when no run has been started for
// the identifier (the client treats that as "idle").
export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const identifier = request.nextUrl.searchParams.get("identifier")?.trim();
    if (!identifier) {
      return NextResponse.json({ error: "identifier is required" }, { status: 400 });
    }

    const job = await MCQGenJob.findOne({ identifier }).lean();
    if (!job) {
      return NextResponse.json({ error: "No generation job found" }, { status: 404 });
    }

    return NextResponse.json({
      identifier: job.identifier,
      mode: job.mode,
      languageScope: job.languageScope ?? null,
      status: job.status,
      phase: job.phase,
      percent: job.percent,
      languages: job.languages,
      totalInserted: job.totalInserted,
      totalSkipped: job.totalSkipped,
      totalFailedBatches: job.totalFailedBatches,
      error: job.error ?? null,
      logs: job.logs ?? [],
      startedAt: job.startedAt,
      finishedAt: job.finishedAt ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load status" },
      { status: 500 },
    );
  }
}
