"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { bustDashboardCache } from "@/lib/cache";
import { useDashboardStore } from "@/lib/store/dashboard-store";

const STAGE_KEYS = [
  "mcq_generating",
  "similarity_checking",
  "compliance_fixing",
  "updating_platform",
] as const;

interface PipelineApiResponse {
  identifier: string;
  stage: string;
  progress: number;
  status: "running" | "done" | "failed";
  label: string;
  estimatedSecondsRemaining: number;
  stages: Array<{ key: string; label: string; complete: boolean; active: boolean }>;
}

export function PipelineDock({ onComplete }: { onComplete?: () => void }) {
  const { pipelineJobs, removePipelineJob, clearPipeline } = useDashboardStore();
  const [statuses, setStatuses] = useState<Record<string, PipelineApiResponse>>({});
  const completedRef = useRef(new Set<string>());

  useEffect(() => {
    const identifiers = [...new Set(pipelineJobs.map((j) => j.identifier))];
    if (!identifiers.length) return;

    let active = true;

    const poll = async () => {
      for (const identifier of identifiers) {
        try {
          const res = await fetch(`/api/sop/pipeline-status?identifier=${encodeURIComponent(identifier)}`);
          if (!res.ok) continue;
          const data = (await res.json()) as PipelineApiResponse;
          if (!active) return;
          setStatuses((s) => ({ ...s, [identifier]: data }));

          if (
            (data.status === "done" || data.stage === "approved") &&
            !completedRef.current.has(identifier)
          ) {
            completedRef.current.add(identifier);
            removePipelineJob(identifier);
          }
          if (data.status === "failed") {
            removePipelineJob(identifier);
          }
        } catch {
          /* ignore poll errors */
        }
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pipelineJobs, removePipelineJob]);

  useEffect(() => {
    if (pipelineJobs.length === 0 && completedRef.current.size > 0) {
      bustDashboardCache();
      onComplete?.();
      const timer = setTimeout(() => {
        clearPipeline();
        completedRef.current.clear();
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [pipelineJobs.length, onComplete, clearPipeline]);

  if (pipelineJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h4 className="text-xs font-bold text-slate-700">Pipeline Progress</h4>
        <button
          type="button"
          onClick={clearPipeline}
          className="text-[10px] text-slate-400 hover:text-slate-600"
        >
          Dismiss
        </button>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto p-3">
        {pipelineJobs.map((job) => {
          const live = statuses[job.identifier];
          const stage = live?.stage ?? job.stage;
          const progress = live?.progress ?? job.progress;
          const status = live?.status ?? job.status;

          return (
            <div key={job.id} className="rounded border border-slate-100 p-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold">{job.identifier}</span>
                <span className="text-slate-400">{job.language}</span>
                {status === "running" && <Loader2 className="h-3 w-3 animate-spin text-sky-500" />}
                {status === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                {status === "failed" && <XCircle className="h-3 w-3 text-red-500" />}
              </div>
              <p className="text-[9px] text-slate-500">{live?.label ?? stage}</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 flex gap-0.5">
                {STAGE_KEYS.map((key) => (
                  <div
                    key={key}
                    className={`h-1 flex-1 rounded ${
                      live?.stages?.find((s) => s.key === key)?.complete
                        ? "bg-sky-500"
                        : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              {live?.estimatedSecondsRemaining ? (
                <p className="mt-0.5 text-[9px] text-slate-400">
                  ~{live.estimatedSecondsRemaining}s remaining
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ToastNotification() {
  const { toast, dismissToast } = useDashboardStore();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, 8000);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
      {toast.message}
    </div>
  );
}
