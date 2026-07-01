'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronRight, ChevronLeft, Loader2, BookOpen, AlertCircle, Eye, ChevronDown, ChevronUp, Minus, CheckCircle2, Clock, Terminal } from 'lucide-react';
import { buildRealSopPickerOptions, type RegistrySopOption } from '@/lib/registrySopPickerOptions';

type GuidelineSummary = {
  _id: string;
  name?: string;
  folderName?: string;
  pdfName?: string;
  guidelineType?: string;
  category?: string;
  createdAt?: string;
};

type Props = {
  open: boolean;
  minimized?: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  registryRows: any[];
  presetSop?: { _id: string; sopNo: string } | null;
  onResult?: (sopNo: string, sopName: string, result: any) => void;
  onAnalysisStart?: (sopNo: string) => void;
  prefetchedGuidelines?: any[] | null;
};

// ── severity / status colour maps (same as compliance engine) ──────────────
const SEVERITY_COLORS: Record<string, string> = {
  critical:      'border-l-rose-500 bg-rose-50/60',
  major:         'border-l-orange-500 bg-orange-50/60',
  minor:         'border-l-amber-400 bg-amber-50/60',
  informational: 'border-l-blue-400 bg-blue-50/60',
};

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  'compliant':       { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Compliant' },
  'partial':         { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'Partially Compliant' },
  'non-compliant':   { bg: 'bg-red-100',     text: 'text-red-800',     label: 'Non-Compliant' },
  'not-applicable':  { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Not Applicable' },
  'analysis-failed': { bg: 'bg-gray-200',    text: 'text-gray-500',    label: 'Failed' },
};

// ── Shared progress panel (used in both step-1 preset path and step-2) ──────
function AnalysisProgressPanel({
  elapsed,
  logs,
  logsEndRef,
  onMinimize,
}: {
  elapsed: number;
  logs: { time: number; text: string; done?: boolean }[];
  logsEndRef: React.RefObject<HTMLDivElement | null>;
  onMinimize?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600 shrink-0" />
          <div>
            <p className="text-sm font-bold text-indigo-900">AI analysis running…</p>
            <p className="text-[11px] text-indigo-600">Typically 1–3 minutes depending on clause count</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-white border border-indigo-200 px-3 py-1 text-sm font-mono font-bold text-indigo-700 shadow-sm">
          <Clock className="h-3.5 w-3.5" />
          {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-950 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2">
          <Terminal className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-[10px] font-mono font-semibold text-gray-400 uppercase tracking-wider">Analysis Log</span>
          <span className="ml-auto text-[10px] font-mono text-gray-600">{logs.length} events</span>
        </div>
        <div className="max-h-64 overflow-y-auto px-3 py-2 space-y-1 font-mono text-[11px]">
          {logs.map((log, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="shrink-0 text-gray-600 tabular-nums w-10 text-right">
                +{String(Math.floor(log.time / 60)).padStart(2,'0')}:{String(log.time % 60).padStart(2,'0')}
              </span>
              {log.done
                ? <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
                : <span className="text-indigo-400 shrink-0">›</span>
              }
              <span className={log.done ? 'text-emerald-400' : 'text-gray-200'}>{log.text}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="w-10" />
            <span className="text-indigo-400">›</span>
            <span className="inline-block w-1.5 h-3 bg-indigo-400 animate-pulse" />
          </div>
          <div ref={logsEndRef} />
        </div>
      </div>

      {onMinimize && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[11px] text-amber-800">
            You can close this panel — analysis continues in the background
          </p>
          <button
            type="button"
            onClick={onMinimize}
            className="ml-3 shrink-0 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200 transition-colors"
          >
            <Minus className="h-3 w-3" />
            Minimize
          </button>
        </div>
      )}
    </div>
  );
}

export default function GuidelinesComplianceWizard({
  open,
  minimized,
  onClose,
  onMinimize,
  registryRows,
  presetSop,
  onResult,
  onAnalysisStart,
  prefetchedGuidelines,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [guidelines, setGuidelines] = useState<GuidelineSummary[]>([]);
  const [guidelinesLoading, setGuidelinesLoading] = useState(false);
  const [guidelinesError, setGuidelinesError] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sopOptions = useMemo(() => buildRealSopPickerOptions(registryRows), [registryRows]);
  const [sopSearch, setSopSearch] = useState('');
  const [selectedSopId, setSelectedSopId] = useState<string | null>(null);

  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewFindings, setReviewFindings] = useState<any[]>([]);
  const [reviewMeta, setReviewMeta] = useState<{
    overallScore: number;
    guidelineDocumentsUsed: number;
    clausesAnalyzed: number;
  } | null>(null);

  // ── Progress tracking ────────────────────────────────────────────────────
  const [analysisLogs, setAnalysisLogs] = useState<{ time: number; text: string; done?: boolean }[]>([]);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const analysisStartRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const pushLog = (text: string, done = false) => {
    const time = analysisStartRef.current ? Math.floor((Date.now() - analysisStartRef.current) / 1000) : 0;
    setAnalysisLogs((prev) => [...prev, { time, text, done }]);
  };

  const startTimer = () => {
    analysisStartRef.current = Date.now();
    setAnalysisElapsed(0);
    setAnalysisLogs([]);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setAnalysisElapsed(Math.floor((Date.now() - (analysisStartRef.current ?? Date.now())) / 1000));
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  useEffect(() => () => stopTimer(), []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [analysisLogs]);

  const reset = useCallback(() => {
    setStep(1);
    setSelectedIds(new Set());
    setFolderFilter('');
    setTypeFilter('');
    setCategoryFilter('');
    setSopSearch('');
    setSelectedSopId(presetSop?._id ?? null);
    setReviewLoading(false);
    setReviewError(null);
    setReviewFindings([]);
    setReviewMeta(null);
  }, [presetSop?._id]);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, presetSop?._id, reset]);

  // Load guideline list with client-side caching
  useEffect(() => {
    if (!open) return;

    // If prefetched data is already available, use it instantly
    if (prefetchedGuidelines) {
      setGuidelines(prefetchedGuidelines);
      setGuidelinesLoading(false);
      return;
    }

    // Fallback: fetch directly (first open before dashboard prefetch completed)
    let cancelled = false;
    (async () => {
      setGuidelinesLoading(true);
      setGuidelinesError(null);
      try {
        const cacheKey = 'guidelines_list_cache';
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw) {
            const { data, timestamp } = JSON.parse(raw);
            if (Date.now() - timestamp < 5 * 60 * 1000 && Array.isArray(data)) {
              if (!cancelled) { setGuidelines(data); setGuidelinesLoading(false); }
              return;
            }
          }
        } catch { /* ignore */ }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        try {
          const res = await fetch('/api/guidelines/upload?summary=true', { signal: controller.signal });
          clearTimeout(timeoutId);
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j.success) throw new Error(j.error || `Failed to load guidelines (${res.status})`);
          const list = Array.isArray(j.guidelines) ? (j.guidelines as GuidelineSummary[]) : [];
          if (!cancelled) {
            try { localStorage.setItem(cacheKey, JSON.stringify({ data: list, timestamp: Date.now() })); } catch { /* quota */ }
            setGuidelines(list);
          }
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          if ((fetchErr as any)?.name === 'AbortError') throw new Error('Guidelines load timed out. Server may be slow.');
          throw fetchErr;
        }
      } catch (e) {
        if (!cancelled) setGuidelinesError((e as Error).message || 'Could not load guidelines');
      } finally {
        if (!cancelled) setGuidelinesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, prefetchedGuidelines]);

  // Auto-select preset SOP
  useEffect(() => {
    if (presetSop?._id) setSelectedSopId(presetSop._id);
  }, [presetSop?._id]);

  // ── Filter helpers ───────────────────────────────────────────────────────
  const folderNames = useMemo(() => {
    const s = new Set<string>();
    for (const g of guidelines) { const f = String(g.folderName || '').trim(); if (f) s.add(f); }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [guidelines]);

  const types = useMemo(() => {
    const s = new Set<string>();
    for (const g of guidelines) { const t = String(g.guidelineType || '').trim(); if (t) s.add(t); }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [guidelines]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const g of guidelines) { const c = String(g.category || '').trim(); if (c) s.add(c); }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [guidelines]);

  const filteredGuidelines = useMemo(() => {
    const ff = folderFilter.trim().toLowerCase();
    const tf = typeFilter.trim().toLowerCase();
    const cf = categoryFilter.trim().toLowerCase();
    return guidelines.filter((g) => {
      if (ff && String(g.folderName || '').toLowerCase() !== ff) return false;
      if (tf && String(g.guidelineType || '').toLowerCase() !== tf) return false;
      if (cf && String(g.category || '').toLowerCase() !== cf) return false;
      return true;
    });
  }, [guidelines, folderFilter, typeFilter, categoryFilter]);

  const filteredSopOptions = useMemo(() => {
    const q = sopSearch.trim().toLowerCase();
    if (!q) return sopOptions;
    return sopOptions.filter(
      (o) => o.sopNo.toLowerCase().includes(q) || o.displayName.toLowerCase().includes(q) || o.department.toLowerCase().includes(q),
    );
  }, [sopOptions, sopSearch]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const g of filteredGuidelines) next.add(String(g._id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ── Run review (now calls batch clause analysis) ─────────────────────────
  const runReview = async () => {
    if (!selectedSopId || selectedIds.size === 0) return;
    // Prefer presetSop.sopNo directly (avoids missing it if row is filtered out of sopOptions)
    const sopNo = presetSop?.sopNo || (sopOptions.find((o) => o._id === selectedSopId)?.sopNo ?? '');
    onAnalysisStart?.(sopNo);
    startTimer();
    setReviewLoading(true);
    setReviewError(null);
    setReviewFindings([]);
    setReviewMeta(null);

    pushLog(`Analysis started for ${sopNo}`);
    pushLog(`Selected ${selectedIds.size} guideline document(s)`);

    // Emit phase logs on a schedule so the user sees progress
    const phaseTimeouts: ReturnType<typeof setTimeout>[] = [];
    const scheduleLog = (ms: number, text: string) => {
      phaseTimeouts.push(setTimeout(() => pushLog(text), ms));
    };
    scheduleLog(2000,  'Connecting to database…');
    scheduleLog(5000,  `Fetching SOP content for ${sopNo}…`);
    scheduleLog(10000, 'Loading guideline clauses…');
    scheduleLog(18000, 'Sending clauses to AI for batch analysis…');
    scheduleLog(35000, 'Processing AI responses (batch 1)…');
    scheduleLog(60000, 'Processing AI responses (batch 2)…');
    scheduleLog(90000, 'Processing AI responses (batch 3)…');
    scheduleLog(120000,'Still running — large document set, please wait…');
    scheduleLog(150000,'Processing AI responses (batch 4)…');
    scheduleLog(180000,'Almost done — saving results…');

    try {
      const res = await fetch('/api/dashboard/sop-guideline-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sopId: selectedSopId,
          sopNo: sopNo,
          guidelineIds: [...selectedIds],
        }),
      });
      phaseTimeouts.forEach(clearTimeout);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) {
        throw new Error(j.userMessage || j.error || `Review failed (${res.status})`);
      }
      const findings = Array.isArray(j.findings) ? j.findings : [];
      const meta = {
        overallScore: j.overallScore ?? 0,
        guidelineDocumentsUsed: j.guidelineDocumentsUsed ?? 0,
        clausesAnalyzed: j.clausesAnalyzed ?? findings.length,
      };

      pushLog(`Analysis complete — ${findings.length} findings across ${meta.clausesAnalyzed} clauses`, true);
      stopTimer();

      setReviewFindings(findings);
      setReviewMeta(meta);
      setStep(3);
      if (onResult && sopNo) {
        const sopOpt = sopOptions.find((o) => o._id === selectedSopId);
        const displayName = sopOpt?.displayName ?? presetSop?.sopNo ?? sopNo;
        onResult(sopNo, displayName, { findings, ...meta });
      }
    } catch (e) {
      phaseTimeouts.forEach(clearTimeout);
      stopTimer();
      pushLog(`Error: ${(e as Error).message || 'Review failed'}`);
      setReviewError((e as Error).message || 'Review failed');
    } finally {
      setReviewLoading(false);
    }
  };

  if (!open || minimized) return null;

  // ── Score bar helpers ────────────────────────────────────────────────────
  const cCount = reviewFindings.filter((f) => f.complianceLevel === 'compliant').length;
  const pCount = reviewFindings.filter((f) => f.complianceLevel === 'partial').length;
  const nCount = reviewFindings.filter((f) => f.complianceLevel === 'non-compliant').length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3">
      <div
        className="flex max-h-[min(92vh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guidelines-wizard-title"
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-3">
          <div className="min-w-0">
            <h2 id="guidelines-wizard-title" className="text-base font-bold text-gray-900">
              Guideline compliance review
            </h2>
            <p className="mt-0.5 text-[11px] text-gray-600">
              {presetSop ? `Step ${step} of 2 — select guidelines → analyze` : `Step ${step} of 3 — stored guidelines → primary registry SOP → AI recommendations`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-indigo-600 transition-colors"
                title="Minimize window"
              >
                <Minus className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">

          {/* Step 1 — Pick guidelines (or progress overlay when presetSop triggers immediate analysis) */}
          {step === 1 && reviewLoading && (
            <AnalysisProgressPanel
              elapsed={analysisElapsed}
              logs={analysisLogs}
              logsEndRef={logsEndRef}
              onMinimize={onMinimize}
            />
          )}

          {step === 1 && !reviewLoading && (
            <div className="space-y-3">
              <p className="text-xs text-gray-700">
                Choose one or more guideline documents from your uploaded library (OCR-completed PDFs).
              </p>
              {guidelinesLoading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-gray-600">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                  Loading guidelines…
                </div>
              ) : guidelinesError ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {guidelinesError}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-0.5 text-[10px] font-semibold uppercase text-gray-500">
                      Folder
                      <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}
                        className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800">
                        <option value="">All</option>
                        {folderNames.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5 text-[10px] font-semibold uppercase text-gray-500">
                      Type
                      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                        className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800">
                        <option value="">All</option>
                        {types.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5 text-[10px] font-semibold uppercase text-gray-500">
                      Category
                      <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
                        className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800">
                        <option value="">All</option>
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={selectAllFiltered}
                      className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100">
                      Select all in view
                    </button>
                    <button type="button" onClick={clearSelection}
                      className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100">
                      Clear
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-gray-500">
                      Selected: <strong className="text-gray-800">{selectedIds.size}</strong>
                    </p>
                    <button
                      type="button"
                      onClick={onMinimize}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50"
                      title="Minimize window"
                    >
                      <Minus className="h-3 w-3" />
                      Minimize
                    </button>
                  </div>
                  <ul className="max-h-[min(50vh,420px)] space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/80 p-2">
                    {filteredGuidelines.length === 0 ? (
                      <li className="py-6 text-center text-sm text-gray-500">No guidelines match filters.</li>
                    ) : (
                      filteredGuidelines.map((g) => {
                        const id = String(g._id);
                        const checked = selectedIds.has(id);
                        return (
                          <li key={id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white">
                              <input type="checkbox" checked={checked} onChange={() => toggleId(id)}
                                className="mt-1 h-3.5 w-3.5 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500" />
                              <span className="min-w-0 flex-1 text-xs leading-snug">
                                <span className="font-semibold text-gray-900">{g.name || g.pdfName || 'Untitled'}</span>
                                <span className="block text-[10px] text-gray-500">
                                  {[g.folderName, g.guidelineType, g.category].filter(Boolean).join(' · ')}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  window.open(`/api/guidelines/upload?serve=${id}`, '_blank');
                                }}
                                className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
                                title="View PDF"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Step 2 — Pick SOP / Analysis progress */}
          {step === 2 && (
            <div className="space-y-3">
              {reviewLoading ? (
                <AnalysisProgressPanel
                  elapsed={analysisElapsed}
                  logs={analysisLogs}
                  logsEndRef={logsEndRef}
                  onMinimize={onMinimize}
                />
              ) : (
                /* ── SOP picker ── */
                <>
                  <p className="text-xs text-gray-700">
                    Pick a primary registry SOP. The review analyzes the SOP clause-by-clause against the selected guidelines — SOPs without extracted text cannot be reviewed.
                  </p>
                  <input
                    type="search"
                    value={sopSearch}
                    onChange={(e) => setSopSearch(e.target.value)}
                    placeholder="Search by SOP no., title, department…"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                  />
                  <div className="max-h-[min(52vh,440px)] overflow-y-auto rounded-lg border border-gray-200">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-gray-100 text-[10px] font-bold uppercase text-gray-600">
                        <tr>
                          <th className="px-2 py-2"> </th>
                          <th className="px-2 py-2">SOP No.</th>
                          <th className="px-2 py-2">Title</th>
                          <th className="px-2 py-2">Dept</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSopOptions.map((o: RegistrySopOption) => (
                          <tr key={o._id}
                            className={`border-t border-gray-100 ${selectedSopId === o._id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                            <td className="px-2 py-1.5">
                              <input type="radio" name="sop-pick" checked={selectedSopId === o._id}
                                onChange={() => setSelectedSopId(o._id)}
                                className="text-indigo-600 focus:ring-indigo-500" />
                            </td>
                            <td className="px-2 py-1.5 font-mono font-semibold text-gray-900">{o.sopNo}</td>
                            <td className="max-w-[200px] px-2 py-1.5 text-gray-800">{o.displayName}</td>
                            <td className="px-2 py-1.5 text-gray-600">{o.department}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredSopOptions.length === 0 && (
                      <p className="px-3 py-6 text-center text-sm text-gray-500">No matching SOPs.</p>
                    )}
                  </div>
                  {reviewError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {reviewError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 3 — Results (same format as compliance engine) */}
          {step === 3 && (
            <div className="space-y-3">
              {/* Score bar */}
              {reviewMeta && (
                <div className="flex items-center gap-4 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2.5">
                  <div className="text-2xl font-black text-indigo-700">
                    {reviewMeta.overallScore}
                    <span className="text-sm font-normal text-indigo-400">/10</span>
                  </div>
                  <div className="text-[11px] text-indigo-600">
                    <strong>{reviewMeta.clausesAnalyzed}</strong> clauses ·{' '}
                    <strong>{reviewMeta.guidelineDocumentsUsed}</strong> guideline docs
                  </div>
                  <div className="ml-auto flex gap-1.5 text-[10px] font-bold">
                    <span className="rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-700">{cCount} ✓ Compliant</span>
                    <span className="rounded px-1.5 py-0.5 bg-amber-100 text-amber-700">{pCount} ~ Partial</span>
                    <span className="rounded px-1.5 py-0.5 bg-red-100 text-red-700">{nCount} ✗ Non-Compliant</span>
                  </div>
                </div>
              )}

              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">
                Findings ({reviewFindings.length})
              </h3>

              {reviewFindings.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-500">No findings generated.</p>
              ) : (
                <div className="space-y-3">
                  {reviewFindings.map((f, i) => {
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
                            "{f.sopTextSnippet}"
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
                            <p className="text-emerald-900 text-[11px] leading-relaxed">
                              {f.suggestedAction}
                            </p>
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
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex gap-2">
            {step > 1 && step < 3 && !presetSop && !reviewLoading && (
              <button
                type="button"
                onClick={() => { setReviewError(null); setStep((s) => (s === 2 ? 1 : 2) as 1 | 2 | 3); }}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50"
              >
                <BookOpen className="h-3.5 w-3.5" />
                New review
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reviewLoading ? onMinimize : onClose}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200/80"
            >
              {reviewLoading ? 'Close (keeps running)' : 'Close'}
            </button>
            {step === 1 && !reviewLoading && (
              <button
                type="button"
                disabled={selectedIds.size === 0 || guidelinesLoading}
                onClick={() => {
                  if (presetSop?._id && selectedSopId) {
                    runReview();
                  } else {
                    setStep(2);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {presetSop ? 'Analyze' : 'Next'}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            {step === 2 && !reviewLoading && (
              <button
                type="button"
                disabled={!selectedSopId}
                onClick={runReview}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Run compliance check
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
