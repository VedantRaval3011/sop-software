'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X,
  RefreshCw,
  BookOpen,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  Filter,
  Clock,
  ExternalLink,
  PlusCircle,
} from 'lucide-react';

export interface StoredComplianceResult {
  sopNo: string;
  sopName: string;
  findings: any[];
  overallScore: number;
  clausesAnalyzed: number;
  guidelineDocumentsUsed: number;
  guidelineIds?: string[];
  runAt?: string;
  source?: 'dashboard-wizard' | 'compliance-section';
}

interface Props {
  result: StoredComplianceResult;
  onClose: () => void;
  onRerun: () => void;
  initialFilterStatus?: 'all' | 'compliant' | 'partial' | 'non-compliant' | 'not-applicable';
  initialFilterSeverity?: 'all' | 'critical' | 'major' | 'minor' | 'informational';
}

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertCircle,
    border: 'border-l-rose-500',
    bg: 'bg-rose-50',
    badge: 'bg-rose-100 text-rose-700 border-rose-300',
    label: 'Critical',
  },
  major: {
    icon: AlertTriangle,
    border: 'border-l-orange-500',
    bg: 'bg-orange-50',
    badge: 'bg-orange-100 text-orange-700 border-orange-300',
    label: 'Major',
  },
  minor: {
    icon: AlertTriangle,
    border: 'border-l-amber-400',
    bg: 'bg-amber-50',
    badge: 'bg-amber-100 text-amber-700 border-amber-300',
    label: 'Minor',
  },
  informational: {
    icon: Info,
    border: 'border-l-blue-400',
    bg: 'bg-blue-50',
    badge: 'bg-blue-100 text-blue-700 border-blue-300',
    label: 'Info',
  },
};

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  compliant: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Compliant' },
  partial: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Partial' },
  'non-compliant': { bg: 'bg-red-100', text: 'text-red-800', label: 'Non-Compliant' },
  'not-applicable': { bg: 'bg-gray-100', text: 'text-gray-600', label: 'N/A' },
  'analysis-failed': { bg: 'bg-gray-200', text: 'text-gray-500', label: 'Failed' },
};

const SEVERITY_ORDER = ['critical', 'major', 'minor', 'informational'];

function getScoreColor(score: number) {
  if (score >= 8) return { bar: 'bg-emerald-500', text: 'text-emerald-700', label: 'Fully Compliant' };
  if (score >= 5) return { bar: 'bg-amber-400',   text: 'text-amber-700',   label: 'Partially Compliant' };
  return { bar: 'bg-rose-500', text: 'text-rose-700', label: 'Non-Compliant' };
}

function FindingCard({ finding }: { finding: any }) {
  const [expanded, setExpanded] = useState(false);
  const sev   = (finding.issueSeverity || 'informational') as keyof typeof SEVERITY_CONFIG;
  const lvl   = String(finding.complianceLevel || 'not-applicable');
  const sevCfg   = SEVERITY_CONFIG[sev] ?? SEVERITY_CONFIG.informational;
  const statusCfg = STATUS_CONFIG[lvl] ?? STATUS_CONFIG['not-applicable'];
  const Icon = sevCfg.icon;

  return (
    <div className={`rounded-lg border ${sevCfg.border} border-l-4 bg-white shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden`}>
      {/* Header row — always visible */}
      <div className={`flex flex-wrap items-start gap-3 p-4 ${sevCfg.bg} cursor-pointer`} onClick={() => setExpanded(v => !v)}>
        <div className={`rounded-lg p-1.5 ${sevCfg.bg.replace('50', '100')}`}>
          <Icon className="h-4 w-4 text-current" style={{ color: sevCfg.border.split('-')[2] === 'rose' ? '#f43f5e' : sevCfg.border.split('-')[2] === 'orange' ? '#f97316' : sevCfg.border.split('-')[2] === 'amber' ? '#ca8a04' : '#3b82f6' }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${sevCfg.badge}`}>
              {sevCfg.label}
            </span>
            <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${statusCfg.bg} ${statusCfg.text}`}>
              {statusCfg.label}
            </span>
            <span className="text-[10px] text-gray-500 ml-auto shrink-0">
              {finding.guidelineName} • {finding.clauseNumber}
            </span>
          </div>

          {/* Guideline requirement — always visible */}
          <p className="text-sm font-semibold text-gray-900 leading-snug">
            {(() => { const t = String(finding.guidelineRequirement || finding.clauseTitle || ''); return t.length > 250 ? t.slice(0, 250) + '…' : t; })()}
          </p>
        </div>

        {/* Confidence + expand toggle */}
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded-md border border-gray-200">
            <span className="text-[12px] font-bold text-emerald-600">{finding.matchConfidence}%</span>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
            className="rounded-md p-1 text-gray-400 hover:bg-white hover:text-gray-700 transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4 bg-white">
          {/* Traceability block */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <p className="text-[11px] font-bold uppercase text-slate-700 mb-2.5 tracking-wider">📍 Guideline Source</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="text-gray-700">
                  <span className="text-[10px] font-semibold text-slate-600 block">Document</span>
                  <span className="text-xs text-gray-900 font-medium">{finding.guidelineName || 'N/A'}</span>
                </div>
                {finding.guidelineId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(`/api/guidelines/upload?serve=${finding.guidelineId}`, '_blank');
                    }}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200 transition-colors"
                    title="Open guideline PDF"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View
                  </button>
                )}
              </div>
              <div>
                <span className="text-[10px] font-semibold text-slate-600 block">Clause</span>
                <span className="text-xs text-gray-900 font-mono">{finding.clauseNumber || 'N/A'}</span>
              </div>
              {finding.clauseTitle && (
                <div>
                  <span className="text-[10px] font-semibold text-slate-600 block">Heading</span>
                  <span className="text-xs text-gray-900">{finding.clauseTitle}</span>
                </div>
              )}
              {finding.clauseText && (
                <div>
                  <span className="text-[10px] font-semibold text-slate-600 block">Exact Requirement</span>
                  <p className="text-xs text-gray-800 leading-relaxed border-l-2 border-slate-300 pl-2 italic">
                    "{(() => { const t = String(finding.clauseText || ''); return t.length > 400 ? t.slice(0, 400) + '…' : t; })()}"
                  </p>
                </div>
              )}
              {finding.sopSectionAffected && finding.sopSectionAffected !== 'N/A' && (
                <div>
                  <span className="text-[10px] font-semibold text-slate-600 block">SOP Section to Update</span>
                  <span className="text-xs text-gray-900 font-medium">{finding.sopSectionAffected}</span>
                </div>
              )}
            </div>
          </div>

          {/* SOP snippet */}
          {finding.sopTextSnippet && (
            <div className="rounded-lg bg-purple-50 border border-purple-150 p-3">
              <p className="text-[11px] font-bold uppercase text-purple-700 mb-2 tracking-wider">📋 Current SOP Text</p>
              <p className="text-sm text-purple-900 leading-relaxed italic border-l-2 border-purple-400 pl-3">
                "{finding.sopTextSnippet}"
                {finding.sopSectionAffected && finding.sopSectionAffected !== 'N/A' && (
                  <span className="ml-2 not-italic font-semibold text-purple-700">— {finding.sopSectionAffected}</span>
                )}
              </p>
            </div>
          )}

          {/* Gap */}
          {finding.mismatchExplanation && (
            <div className="rounded-lg bg-amber-50 border border-amber-150 p-3">
              <p className="text-[11px] font-bold uppercase text-amber-700 mb-2 tracking-wider">⚠️ Gap Identified</p>
              <p className="text-sm text-amber-900 leading-relaxed">{finding.mismatchExplanation}</p>
            </div>
          )}

          {/* Highlighted issue */}
          {finding.highlightedIssue && finding.highlightedIssue !== finding.mismatchExplanation && (
            <div className="rounded-lg bg-orange-50 border border-orange-150 p-3">
              <p className="text-[11px] font-bold uppercase text-orange-700 mb-2 tracking-wider">🔍 Specific Issue</p>
              <p className="text-sm text-orange-900 leading-relaxed">{finding.highlightedIssue}</p>
            </div>
          )}

          {/* Suggested action */}
          {finding.suggestedAction && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
              <p className="text-[11px] font-bold uppercase text-emerald-700 mb-2 tracking-wider">✓ Suggested Action</p>
              <p className="text-sm text-emerald-900 leading-relaxed mb-2">{finding.suggestedAction}</p>
              {finding.suggestedText && (
                <div className="rounded bg-white border border-emerald-200 p-3 overflow-auto max-h-48">
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-emerald-800">
                    {finding.suggestedText}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Footer metadata */}
          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-gray-100">
            <div className="text-[11px]">
              <span className="text-gray-500">Effort:</span>
              <span className="ml-1.5 font-semibold text-gray-700 px-2 py-0.5 bg-gray-100 rounded">{finding.estimatedEffort}</span>
            </div>
            <div className="text-[11px]">
              <span className="text-gray-500">Priority:</span>
              <span className="ml-1.5 font-semibold text-gray-700 px-2 py-0.5 bg-gray-100 rounded">{finding.priority}/5</span>
            </div>
            {finding.pdfName && (
              <div className="text-[11px] ml-auto truncate">
                <span className="text-gray-500">Source:</span>
                <span className="ml-1.5 font-semibold text-gray-700">{finding.pdfName}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ComplianceFullViewer({
  result,
  onClose,
  onRerun,
  initialFilterStatus = 'all',
  initialFilterSeverity = 'all',
}: Props) {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [newGuidelines, setNewGuidelines] = useState<{ _id: string; name: string; folderName: string }[]>([]);

  useEffect(() => {
    setFilterStatus(initialFilterStatus);
    setFilterSeverity(initialFilterSeverity);
  }, [initialFilterSeverity, initialFilterStatus, result.sopNo, result.runAt]);

  // Detect guidelines added after this result was run
  useEffect(() => {
    if (!result.guidelineIds || result.guidelineIds.length === 0) {
      setNewGuidelines([]);
      return;
    }
    const checkedIds = new Set(result.guidelineIds);
    fetch('/api/guidelines/upload?summary=true')
      .then(r => r.json())
      .then(data => {
        const allGuidelines: { _id: string; name: string; folderName: string }[] =
          Array.isArray(data.guidelines) ? data.guidelines : [];
        setNewGuidelines(allGuidelines.filter(g => g._id && !checkedIds.has(String(g._id))));
      })
      .catch(() => {});
  }, [result.guidelineIds]);

  const scoreColor = getScoreColor(result.overallScore);

  const cCount = result.findings.filter(f => f.complianceLevel === 'compliant').length;
  const pCount = result.findings.filter(f => f.complianceLevel === 'partial').length;
  const nCount = result.findings.filter(f => f.complianceLevel === 'non-compliant').length;
  const naCount = result.findings.filter(f => f.complianceLevel === 'not-applicable').length;

  const criticalCount = result.findings.filter(f => f.issueSeverity === 'critical').length;
  const majorCount    = result.findings.filter(f => f.issueSeverity === 'major').length;

  const sorted = useMemo(() => {
    return [...result.findings].sort((a, b) => {
      const ai = SEVERITY_ORDER.indexOf(a.issueSeverity || 'informational');
      const bi = SEVERITY_ORDER.indexOf(b.issueSeverity || 'informational');
      return ai - bi;
    });
  }, [result.findings]);

  const visible = useMemo(() => {
    return sorted.filter(f => {
      const statusOk   = filterStatus   === 'all' || f.complianceLevel === filterStatus;
      const severityOk = filterSeverity === 'all' || f.issueSeverity   === filterSeverity;
      return statusOk && severityOk;
    });
  }, [sorted, filterStatus, filterSeverity]);

  const runAtDisplay = result.runAt
    ? new Date(result.runAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-gray-50">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <BookOpen className="h-4 w-4 text-white shrink-0" />
            <h1 className="text-sm font-bold text-white truncate">
              Guideline Compliance Report
            </h1>
          </div>
          <p className="text-xs text-blue-100 truncate">{result.sopNo} — {result.sopName}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {runAtDisplay && (
              <p className="flex items-center gap-1 text-[10px] text-blue-200">
                <Clock className="h-3 w-3" /> {runAtDisplay}
              </p>
            )}
            {result.source === 'compliance-section' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 border border-purple-400/40 px-2 py-0.5 text-[9px] font-semibold text-purple-100">
                📋 Engine
              </span>
            )}
            {result.source === 'dashboard-wizard' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 border border-blue-400/40 px-2 py-0.5 text-[9px] font-semibold text-blue-100">
                ✦ Wizard
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onRerun}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 border border-white/20 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-run
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Score summary bar ────────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white px-4 py-2">
        {/* Score + Progress in one row */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
          {/* Score badge */}
          <div className={`flex items-center gap-2 rounded-lg p-2 w-fit ${
            scoreColor.bar === 'bg-emerald-500' ? 'bg-emerald-50' :
            scoreColor.bar === 'bg-amber-400' ? 'bg-amber-50' :
            'bg-rose-50'
          }`}>
            <div>
              <p className="text-[9px] font-bold uppercase text-gray-600 tracking-wider">Score</p>
              <div className="flex items-baseline gap-0.5">
                <span className={`text-2xl font-black tabular-nums ${scoreColor.text}`}>
                  {result.overallScore}
                </span>
                <span className={`text-[10px] font-semibold ${scoreColor.text}`}>/10</span>
              </div>
            </div>
            <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${scoreColor.bar} text-white whitespace-nowrap`}>
              {scoreColor.label}
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex-1">
            <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${scoreColor.bar}`}
                style={{ width: `${Math.min(100, result.overallScore * 10)}%` }}
              />
            </div>
            <p className="text-[9px] text-gray-500 font-medium mt-0.5">
              <span className="font-semibold text-gray-700">{Math.round(result.overallScore * 10)}%</span> compliance achieved
            </p>
          </div>
        </div>

        {/* Stats grid - small and compact */}
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          <div className="rounded-lg bg-emerald-50 p-1.5 text-center">
            <p className="text-base font-bold text-emerald-700">{cCount}</p>
            <p className="text-[8px] text-emerald-600 font-semibold mt-0.5">Compliant</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-1.5 text-center">
            <p className="text-base font-bold text-amber-700">{pCount}</p>
            <p className="text-[8px] text-amber-600 font-semibold mt-0.5">Partial</p>
          </div>
          <div className="rounded-lg bg-red-50 p-1.5 text-center">
            <p className="text-base font-bold text-red-700">{nCount}</p>
            <p className="text-[8px] text-red-600 font-semibold mt-0.5">Non-Compliant</p>
          </div>
          <div className="rounded-lg bg-gray-100 p-1.5 text-center">
            <p className="text-base font-bold text-gray-700">{naCount}</p>
            <p className="text-[8px] text-gray-600 font-semibold mt-0.5">N/A</p>
          </div>
        </div>

        {/* Meta information - clear and concise */}
        <div className="flex flex-wrap items-center gap-2 text-[10px] border-t border-gray-100 pt-2">
          <div>
            <span className="text-gray-600">Total Clauses:</span>
            <span className="ml-1 font-bold text-gray-900">{result.clausesAnalyzed}</span>
          </div>
          <span className="text-gray-300">•</span>
          <div>
            <span className="text-gray-600">Guidelines Used:</span>
            <span className="ml-1 font-bold text-gray-900">{result.guidelineDocumentsUsed}</span>
          </div>
          {(criticalCount > 0 || majorCount > 0) && (
            <>
              <span className="text-gray-300">•</span>
              <div>
                <span className="text-gray-600">Severity:</span>
                {criticalCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded font-semibold text-[9px]">
                    {criticalCount} Critical
                  </span>
                )}
                {majorCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded font-semibold text-[9px]">
                    {majorCount} Major
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-gray-600 shrink-0" />
          <span className="text-[10px] font-bold uppercase text-gray-700 tracking-wider">Filter:</span>
        </div>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 font-medium hover:border-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        >
          <option value="all">All Statuses</option>
          <option value="compliant">✓ Compliant</option>
          <option value="partial">~ Partial</option>
          <option value="non-compliant">✗ Non-Compliant</option>
          <option value="not-applicable">— N/A</option>
        </select>

        {/* Severity filter */}
        <select
          value={filterSeverity}
          onChange={e => setFilterSeverity(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 font-medium hover:border-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        >
          <option value="all">All Severities</option>
          <option value="critical">🔴 Critical</option>
          <option value="major">🟠 Major</option>
          <option value="minor">🟡 Minor</option>
          <option value="informational">ℹ️ Informational</option>
        </select>

        {/* Results count */}
        <div className="ml-auto px-2 py-1 rounded-md bg-blue-50 border border-blue-200">
          <span className="text-xs font-semibold text-blue-900">
            {visible.length} <span className="text-blue-700">of {result.findings.length}</span>
          </span>
        </div>
      </div>

      {/* ── New guidelines banner ────────────────────────────────────── */}
      {newGuidelines.length > 0 && (
        <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <PlusCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-800">
              {newGuidelines.length} new guideline{newGuidelines.length > 1 ? 's' : ''} added since this report was run
            </p>
            <p className="text-[10px] text-amber-700 mt-0.5 truncate">
              {newGuidelines.slice(0, 3).map(g => g.folderName || g.name).join(', ')}
              {newGuidelines.length > 3 && ` +${newGuidelines.length - 3} more`}
            </p>
          </div>
          <button
            type="button"
            onClick={onRerun}
            className="shrink-0 px-2.5 py-1 rounded-md bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-700 transition-colors whitespace-nowrap"
          >
            Re-run with all
          </button>
        </div>
      )}

      {/* ── Findings list ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 bg-gray-50">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-24">
            {result.findings.length === 0 ? (
              <>
                <div className="rounded-full bg-emerald-100 p-4">
                  <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                </div>
                <p className="text-lg font-bold text-gray-900">No compliance issues found</p>
                <p className="text-sm text-gray-600 text-center max-w-sm">
                  Great news! This SOP appears to be fully compliant with all selected guidelines. Click Re-run to analyse again with different guidelines.
                </p>
              </>
            ) : (
              <>
                <div className="rounded-full bg-gray-200 p-4">
                  <Filter className="h-12 w-12 text-gray-500" />
                </div>
                <p className="text-lg font-bold text-gray-900">No findings match your filters</p>
                <p className="text-sm text-gray-600 text-center max-w-sm">
                  Try adjusting your filter criteria to see more results.
                </p>
                <button
                  type="button"
                  onClick={() => { setFilterStatus('all'); setFilterSeverity('all'); }}
                  className="mt-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  Clear Filters
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4 max-w-6xl mx-auto pb-8">
            {visible.map((f, i) => (
              <FindingCard key={i} finding={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
