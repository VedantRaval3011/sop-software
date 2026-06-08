import type { ISOP } from "@/models/SOP";

export const PIPELINE_STAGES = [
  "idle",
  "mcq_generating",
  "similarity_checking",
  "compliance_checking",
  "compliance_fixing",
  "updating_platform",
  "approved",
  "failed",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

const STAGE_PROGRESS: Record<PipelineStage, number> = {
  idle: 0,
  mcq_generating: 20,
  similarity_checking: 45,
  compliance_checking: 55,
  compliance_fixing: 70,
  updating_platform: 90,
  approved: 100,
  failed: 0,
};

const DOCK_STAGES = [
  "mcq_generating",
  "similarity_checking",
  "compliance_fixing",
  "updating_platform",
] as const;

export function getPipelineProgress(status?: string): number {
  return STAGE_PROGRESS[(status as PipelineStage) ?? "idle"] ?? 0;
}

export function getPipelineStatusLabel(status?: string): string {
  switch (status) {
    case "mcq_generating":
      return "Generating MCQs";
    case "similarity_checking":
      return "Checking similarity";
    case "compliance_checking":
      return "Compliance checking";
    case "compliance_fixing":
      return "Compliance fixing";
    case "updating_platform":
      return "Updating platform";
    case "approved":
      return "Complete";
    case "failed":
      return "Failed";
    default:
      return "Idle";
  }
}

export function buildPipelineStatusResponse(identifier: string, sops: ISOP[]) {
  const active = sops.filter((s) => s.identifier.toUpperCase() === identifier.toUpperCase());
  const primary = active[0];
  const stage = (primary?.pipelineStatus ?? "idle") as PipelineStage;
  const progress = getPipelineProgress(stage);
  const isComplete = stage === "approved";
  const isFailed = stage === "failed";
  const isRunning = !isComplete && !isFailed && stage !== "idle";

  const stagesCompleted = DOCK_STAGES.map((key) => ({
    key,
    label: getPipelineStatusLabel(key),
    complete:
      stage === "approved" ||
      (STAGE_PROGRESS[stage] >= STAGE_PROGRESS[key] && stage !== "failed"),
    active: stage === key,
  }));

  const estimatedSecondsRemaining =
    !isRunning
      ? 0
      : Math.max(5, Math.round((100 - progress) * 1.5));

  return {
    identifier,
    stage,
    progress,
    status: isFailed ? "failed" : isComplete ? "done" : isRunning ? "running" : "idle",
    label: getPipelineStatusLabel(stage),
    estimatedSecondsRemaining,
    stages: stagesCompleted,
    mcqCount: active.reduce((sum, s) => sum + (s.mcqCount ?? 0), 0),
    languages: [...new Set(active.map((s) => s.language ?? "English"))],
  };
}

export async function advancePipeline(
  sopIds: string[],
  stage: PipelineStage,
  updateFn: (id: string, data: Partial<ISOP>) => Promise<void>,
) {
  for (const id of sopIds) {
    await updateFn(id, { pipelineStatus: stage });
  }
}

export function complianceStatusFromScore(score: number): "compliant" | "partial" | "non-compliant" {
  if (score >= 8) return "compliant";
  if (score >= 5) return "partial";
  return "non-compliant";
}
