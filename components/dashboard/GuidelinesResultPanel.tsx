'use client';

import { X, RefreshCw, BookOpen } from 'lucide-react';

// ── same colour maps as GuidelinesComplianceWizard ──────────────────────────
const SEVERITY_COLORS: Record<string, string> = {
  critical:      'border-l-rose-500 bg-rose-50/60',
  major:         'border-l-orange-500 bg-orange-50/60',
  minor:         'border-l-amber-400 bg-amber-50/60',
  informational: 'border-l-blue-400 bg-blue-50/60',
};

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  'compliant':        { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Compliant' },
  'partial':          { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'Partially Compliant' },
  'non-compliant':    { bg: 'bg-red-100',     text: 'text-red-800',     label: 'Non-Compliant' },
  'not-applicable':   { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Not Applicable' },
  'analysis-failed':  { bg: 'bg-gray-200',    text: 'text-gray-500',    label: 'Failed' },
};

export interface ComplianceResult {
  sopNo: string;
  sopName: string;
  findings: any[];
  overallScore: number;
  clausesAnalyzed: number;
  guidelineDocumentsUsed: number;
  runAt: string;
  guidelineIds?: string[];
  source?: "dashboard-wizard" | "compliance-section";
  summary?: string;
  recommendations?: unknown[];
}

type Props = {
  result: ComplianceResult;
  onClose: () => void;
  onRerun: () => void;
};

export default function GuidelinesResultPanel({ result, onClose, onRerun }: Props) {
  const findings = Array.isArray(result.findings) ? result.findings : [];

  const cCount = findings.filter((f) => f.complianceLevel === 'compliant').length;
  const pCount = findings.filter((f) => f.complianceLevel === 'partial').length;
  const nCount = findings.filter((f) => f.complianceLevel === 'non-compliant').length;

  const runDate = new Date(result.runAt).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-3 backdrop-blur-[2px]">
      <div
        className="flex max-h-[min(92vh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-panel-title"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-3">
          <div className="min-w-0">
            <h2 id="result-panel-title" className="text-base font-bold text-gray-900">
              Guideline compliance review
            </h2>
            <p className="mt-0.5 text-[11px] text-gray-600">
              {result.sopNo} — {result.sopName.length > 60 ? `${result.sopName.slice(0, 60)}…` : result.sopName}
            </p>
            <p className="mt-0.5 text-[10px] text-gray-400">
              Last run: {runDate} · {result.guidelineDocumentsUsed} guideline doc{result.guidelineDocumentsUsed !== 1 ? 's' : ''} · {result.clausesAnalyzed} clauses
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="space-y-3">
            {/* Score bar */}
            <div className="flex items-center gap-4 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5">
              <div className="text-2xl font-black text-indigo-700">
                {result.overallScore}
                <span className="text-sm font-normal text-indigo-400">/10</span>
              </div>
              <div className="text-[11px] text-indigo-600">
                <strong>{result.clausesAnalyzed}</strong> clauses ·{' '}
                <strong>{result.guidelineDocumentsUsed}</strong> guideline docs
              </div>
              <div className="ml-auto flex gap-1.5 text-[10px] font-bold">
                <span className="rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-700">{cCount} ✓ Compliant</span>
                <span className="rounded px-1.5 py-0.5 bg-amber-100 text-amber-700">{pCount} ~ Partial</span>
                <span className="rounded px-1.5 py-0.5 bg-red-100 text-red-700">{nCount} ✗ Non-Compliant</span>
              </div>
            </div>

            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">
              Findings ({findings.length})
            </h3>

            {findings.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500">No findings available. Re-run the analysis.</p>
            ) : (
              <div className="space-y-3">
                {findings.map((f, i) => {
                  const sev = String(f.issueSeverity || 'informational');
                  const lvl = String(f.complianceLevel || 'not-applicable');
                  const borderClass = SEVERITY_COLORS[sev] ?? SEVERITY_COLORS.informational;
                  const statusStyle = STATUS_STYLE[lvl] ?? STATUS_STYLE['not-applicable'];
                  return (
                    <div key={i} className={`rounded-xl border-l-4 ${borderClass} p-3 space-y-1.5 text-xs shadow-sm`}>
                      {/* Header row */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                        <span className="text-[10px] font-bold uppercase text-gray-500">{sev}</span>
                        <span className="ml-auto text-[10px] text-gray-400">
                          {f.guidelineName} · {f.clauseNumber}
                        </span>
                      </div>

                      {/* Guideline requirement */}
                      <p className="font-semibold text-gray-800 leading-snug">
                        {(() => { const r = String(f.guidelineRequirement || f.clauseTitle || ''); return r.length > 300 ? r.slice(0, 300) + '…' : r; })()}
                      </p>

                      {/* SOP text snippet */}
                      {f.sopTextSnippet ? (
                        <p className="italic text-gray-500 border-l-2 border-gray-300 pl-2 text-[11px]">
                          &ldquo;{f.sopTextSnippet}&rdquo;
                          {f.sopSectionAffected && f.sopSectionAffected !== 'N/A' && (
                            <span className="ml-1 not-italic font-bold text-gray-400">— {f.sopSectionAffected}</span>
                          )}
                        </p>
                      ) : null}

                      {/* Gap */}
                      {f.mismatchExplanation ? (
                        <p className="text-amber-900 text-[11px]">
                          <span className="font-bold">Gap: </span>{f.mismatchExplanation}
                        </p>
                      ) : null}

                      {/* Highlighted issue */}
                      {f.highlightedIssue && f.highlightedIssue !== f.mismatchExplanation ? (
                        <p className="text-orange-800 text-[11px]">
                          <span className="font-bold">Issue: </span>{f.highlightedIssue}
                        </p>
                      ) : null}

                      {/* Suggested action */}
                      {f.suggestedAction ? (
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-2 space-y-1">
                          <p className="font-black text-emerald-800 text-[10px] uppercase tracking-wider">
                            Suggested Action
                          </p>
                          <p className="text-emerald-900 text-[11px] leading-relaxed">{f.suggestedAction}</p>
                          {f.suggestedText ? (
                            <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-emerald-800 bg-white/80 rounded px-2 py-1 border border-emerald-100">
                              {f.suggestedText}
                            </pre>
                          ) : null}
                        </div>
                      ) : null}

                      {/* Confidence + effort */}
                      <div className="flex items-center gap-3 text-[10px] text-gray-400 pt-0.5">
                        <span>Confidence: <strong className="text-emerald-600">{f.matchConfidence}%</strong></span>
                        <span>Effort: <strong>{f.estimatedEffort}</strong></span>
                        <span>Priority: <strong>{f.priority}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRerun}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50"
            >
              <BookOpen className="h-3.5 w-3.5" />
              New review
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRerun}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-evaluate
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200/80"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
