"use client";

import { useEffect, useState } from "react";
import { Btn } from "./ui";

interface Finding {
  clause: string;
  title: string;
  status: string;
  severity: string;
  description: string;
  recommendation: string;
  confidence: number;
}

interface ComplianceFullViewerProps {
  sopId: string;
  guidelineId: string;
  onRerun?: () => void;
}

export function ComplianceGuidelineDetail({ sopId, guidelineId, onRerun }: ComplianceFullViewerProps) {
  const [data, setData] = useState<{
    score: number;
    findings: Finding[];
    analyzedAt: string;
    clauseCount: number;
    guidelineName: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState("All");
  const [severityFilter, setSeverityFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(
      `/api/compliance/guideline-detail?sopId=${encodeURIComponent(sopId)}&guidelineId=${encodeURIComponent(guidelineId)}`,
    )
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [sopId, guidelineId]);

  if (loading) return <p className="text-xs text-slate-500">Loading results...</p>;
  if (!data) return <p className="text-xs text-red-600">No analysis found.</p>;

  const scoreColor =
    data.score >= 8 ? "bg-emerald-500" : data.score >= 5 ? "bg-amber-500" : "bg-red-500";

  const filtered = data.findings.filter((f) => {
    if (statusFilter !== "All" && f.status !== statusFilter) return false;
    if (severityFilter !== "All" && f.severity !== severityFilter) return false;
    return true;
  });

  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold">Overall Score: {data.score.toFixed(1)}/10</span>
          <span className="text-slate-500">{data.guidelineName}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full ${scoreColor}`}
            style={{ width: `${(data.score / 10) * 100}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          {data.clauseCount} clauses · {data.findings.length} findings ·{" "}
          {new Date(data.analyzedAt).toLocaleString()}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded border border-slate-300 px-1 py-0.5 text-[10px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {["All", "compliant", "partial", "non-compliant", "not-applicable"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-slate-300 px-1 py-0.5 text-[10px]"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          {["All", "critical", "major", "minor", "informational"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {onRerun && (
          <Btn size="xs" onClick={onRerun}>
            Rerun
          </Btn>
        )}
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto">
        {filtered.map((f, i) => (
          <div key={`${f.clause}-${i}`} className="rounded border border-slate-200 p-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] uppercase">
                {f.severity}
              </span>
              <span className="font-semibold">
                {f.clause} — {f.title}
              </span>
              <span className="ml-auto text-[10px] text-slate-500">{f.status}</span>
            </div>
            <p className="mt-1 text-slate-700">{f.description}</p>
            <p className="mt-1 text-slate-500">Recommendation: {f.recommendation}</p>
            <p className="text-[10px] text-slate-400">
              Confidence: {(f.confidence * 100).toFixed(0)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
