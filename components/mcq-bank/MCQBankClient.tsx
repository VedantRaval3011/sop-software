"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Home,
  LayoutList,
  Monitor,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { MCQViewerModal } from "./MCQViewerModal";
import { DeptDetailModal } from "./DeptDetailModal";
import { DeptGridSkeleton } from "./MCQSkeleton";
import { displaySopCode, displaySopTitle } from "@/lib/sop-display";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface DeptMCQStats {
  department: string;
  sopCount: number;
  subcategories: number;
  totalQuestions: number;
  checkedQuestions: number;
  reviewedQuestions: number;
  similarQuestions: number;
  remainingQuestions: number;
  mcqCoverage: number;
  withEnglish: number;
  withGujarati: number;
  totalSopEng: number;
  totalSopGuj: number;
  approvedSops: number;
  partialSops: number;
  pendingSops: number;
  similarSops: number;
  sopWithMcqs: number;
  sopWithoutMcqs: number;
  enRemaining: number;
  guRemaining: number;
  trainer: string | null;
}

interface MCQBankGlobalStats {
  totalUniqueSops: number;
  totalVersions: number;
  totalMcqBanks: number;
  mcqFound: number;
  notFound: number;
  withEnglish: number;
  withGujarati: number;
  approvedSops: number;
  partialSops: number;
  pendingSops: number;
  similarSops: number;
  totalQuestions: number;
  checkedQuestions: number;
  reviewedQuestions: number;
  similarQuestions: number;
  remainingQuestions: number;
  enRemaining: number;
  guRemaining: number;
  departments: DeptMCQStats[];
  obsoleteMcqs?: {
    count: number;
    identifiers: string[];
    totalQuestions: number;
  };
}

interface RegistryEntry {
  id: string;
  identifier: string;
  sopName: string;
  sopNameGujarati: string | null;
  department: string;
  language: string;
  langCode: string;
  totalMcqs: number;
  remaining: number;
  approved: number;
  partial: number;
  similar: number;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
  lastUpdated: string | null;
  banks: { id: string; langCode: "ENG" | "GUJ" }[];
  isObsoleteMcq?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const fmt = (n: number | undefined | null) => (n == null ? "—" : n.toLocaleString());
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ─────────────────────────────────────────────────────────────
// Department theme (bordered white cards)
// ─────────────────────────────────────────────────────────────
function getDeptTheme(deptName: string) {
  const name = deptName.toLowerCase();
  if (name.includes("qa"))
    return { border: "border-purple-500", statBg: "bg-purple-50", iconBg: "bg-purple-100", iconText: "text-purple-600", accent: "text-purple-600", headerBorder: "border-b border-purple-100", capBg: "bg-purple-50 border-purple-200", pendingText: "text-purple-700", cardBg: "" };
  if (name.includes("qc"))
    return { border: "border-blue-500", statBg: "bg-blue-50", iconBg: "bg-blue-100", iconText: "text-blue-600", accent: "text-blue-600", headerBorder: "border-b border-blue-100", capBg: "bg-blue-50 border-blue-200", pendingText: "text-blue-700", cardBg: "" };
  if (name.includes("micro"))
    return { border: "border-orange-500", statBg: "bg-orange-50", iconBg: "bg-orange-100", iconText: "text-orange-600", accent: "text-orange-600", headerBorder: "border-b border-orange-100", capBg: "bg-orange-50 border-orange-200", pendingText: "text-orange-700", cardBg: "" };
  if (name.includes("prod"))
    return { border: "border-emerald-500", statBg: "bg-emerald-50", iconBg: "bg-emerald-100", iconText: "text-emerald-600", accent: "text-emerald-600", headerBorder: "border-b border-emerald-100", capBg: "bg-emerald-50 border-emerald-200", pendingText: "text-emerald-700", cardBg: "" };
  if (name.includes("store"))
    return { border: "border-amber-500", statBg: "bg-amber-50", iconBg: "bg-amber-100", iconText: "text-amber-600", accent: "text-amber-600", headerBorder: "border-b border-amber-100", capBg: "bg-amber-50 border-amber-200", pendingText: "text-amber-700", cardBg: "" };
  if (name.includes("engineer") || name.includes("maint"))
    return { border: "border-cyan-500", statBg: "bg-cyan-50", iconBg: "bg-cyan-100", iconText: "text-cyan-600", accent: "text-cyan-600", headerBorder: "border-b border-cyan-100", capBg: "bg-cyan-50 border-cyan-200", pendingText: "text-cyan-700", cardBg: "" };
  if (name.includes("person") || name.includes("hr"))
    return { border: "border-rose-500", statBg: "bg-rose-50", iconBg: "bg-rose-100", iconText: "text-rose-600", accent: "text-rose-600", headerBorder: "border-b border-rose-100", capBg: "bg-rose-50 border-rose-200", pendingText: "text-rose-700", cardBg: "" };
  return { border: "border-slate-400", statBg: "bg-slate-50", iconBg: "bg-slate-100", iconText: "text-slate-600", accent: "text-slate-600", headerBorder: "border-b border-slate-100", capBg: "bg-slate-50 border-slate-200", pendingText: "text-slate-700", cardBg: "" };
}

// Map a department name → the { bg } class DeptDetailModal uses to pick its
// header gradient. Keys must match DEPT_GRADIENT in DeptDetailModal.tsx.
function getDeptModalColor(deptName: string): { bg: string; badge: string } {
  const name = deptName.toLowerCase();
  if (name.includes("qa")) return { bg: "bg-violet-600", badge: "bg-violet-100 text-violet-700" };
  if (name.includes("qc")) return { bg: "bg-blue-600", badge: "bg-blue-100 text-blue-700" };
  if (name.includes("micro")) return { bg: "bg-orange-600", badge: "bg-orange-100 text-orange-700" };
  if (name.includes("prod")) return { bg: "bg-emerald-600", badge: "bg-emerald-100 text-emerald-700" };
  if (name.includes("store")) return { bg: "bg-amber-600", badge: "bg-amber-100 text-amber-700" };
  if (name.includes("engineer") || name.includes("maint")) return { bg: "bg-cyan-600", badge: "bg-cyan-100 text-cyan-700" };
  if (name.includes("person") || name.includes("hr")) return { bg: "bg-rose-600", badge: "bg-rose-100 text-rose-700" };
  return { bg: "bg-slate-600", badge: "bg-slate-100 text-slate-700" };
}

// ─────────────────────────────────────────────────────────────
// CapsuleMetric — compact label + value row
// ─────────────────────────────────────────────────────────────
function CM({
  label, value, vc, onClick, isActive = false,
}: {
  label: string; value: number; vc?: string;
  onClick?: () => void; isActive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick ? (e) => { e.preventDefault(); e.stopPropagation(); onClick(); } : undefined}
      aria-pressed={isActive || undefined}
      className={`flex w-full min-h-[24px] cursor-pointer items-center justify-between gap-1.5 rounded-[4px] px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-purple-100/80 active:bg-purple-200/60 focus:outline-none focus:ring-1 focus:ring-purple-400 ${
        isActive ? "border border-purple-400 bg-purple-100/90" : "border border-transparent"
      }`}
    >
      <span className="min-w-0 shrink text-gray-700 font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
      <span className={`font-bold tabular-nums shrink-0 leading-tight text-[11px] ${vc ?? "text-gray-900"}`}>{value}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// TripleRow — 3 CMs side by side
// ─────────────────────────────────────────────────────────────
function TripleRow({ items }: {
  items: { label: string; value: number; vc?: string; onClick?: () => void; isActive?: boolean }[];
}) {
  return (
    <div className="flex w-full gap-0.5">
      {items.map((item) => (
        <div key={item.label} className="flex-1 min-w-0">
          <CM label={item.label} value={item.value} vc={item.vc} onClick={item.onClick} isActive={item.isActive} />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CovBar — coverage progress bar
// ─────────────────────────────────────────────────────────────
function CovBar({ pct, label = "COVERAGE" }: { pct: number; label?: string }) {
  return (
    <div className="pt-1.5 mt-1.5 border-t border-gray-100">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
        <span className={`text-[9px] font-black ${pct >= 100 ? "text-emerald-600" : pct >= 60 ? "text-blue-600" : "text-amber-500"}`}>{pct}%</span>
      </div>
      <div className="w-full h-[3px] bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-blue-500" : "bg-amber-500"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Compact whitebox Card (MCQ Status Cards section)
// ─────────────────────────────────────────────────────────────
function StatusCard({
  title, subtitle, isGrand = false,
  totalSOPs, sopWithMCQs, sopWithoutMCQs,
  approvedSOPs, partialSOPs, pendingSOPs, similarSOPs,
  totalSopEng, totalSopGuj, remainingEng, remainingGuj,
  mcqFound, mcqNotFound,
  genCompleted, genTarget, genRemaining,
  onOpen, onRowClick,
  onMcqWithClick, onMcqWithoutClick,
}: {
  title: string; subtitle: string; isGrand?: boolean;
  totalSOPs: number; sopWithMCQs: number; sopWithoutMCQs: number;
  approvedSOPs: number; partialSOPs: number; pendingSOPs: number; similarSOPs: number;
  totalSopEng: number; totalSopGuj: number; remainingEng: number; remainingGuj: number;
  mcqFound?: number; mcqNotFound?: number;
  genCompleted?: number; genTarget?: number; genRemaining?: number;
  onOpen?: () => void;
  onRowClick?: (f: "approved" | "partial" | "pending" | "similar") => void;
  onMcqWithClick?: () => void;
  onMcqWithoutClick?: () => void;
}) {
  return (
    <div className={`flex h-full w-full min-w-0 flex-col rounded-[10px] border px-2 py-1.5 text-left shadow-sm ${
      isGrand ? "border-purple-300 bg-purple-50" : "border-gray-200 bg-white"
    }`}>
      {/* Header */}
      <div
        role={isGrand || !onOpen ? undefined : "button"}
        tabIndex={isGrand || !onOpen ? -1 : 0}
        onClick={isGrand ? undefined : onOpen}
        onKeyDown={isGrand || !onOpen ? undefined : (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(); }
        }}
        className={`mb-2 flex w-full min-h-[40px] items-start gap-1.5 rounded-md border-b pb-2 ${
          isGrand || !onOpen
            ? "cursor-default border-purple-200"
            : "cursor-pointer border-gray-100 hover:bg-purple-50/80 focus:outline-none focus:ring-2 focus:ring-purple-400"
        }`}
      >
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-600" />
        <div className="min-w-0 flex-1">
          <span className="block min-w-0 text-[11px] font-bold leading-tight text-gray-800 truncate" title={title}>{title}</span>
          <span className="block text-[9px] font-medium text-gray-500 leading-tight mt-0.5">{subtitle}</span>
        </div>
      </div>

      {/* Summary block — same on Total and every department capsule */}
      <div className={`flex flex-col gap-0 border-t border-transparent pt-0.5 mb-1 ${isGrand ? "" : "border-b border-gray-100 pb-1"}`}>
        <CM label="Unique SOPs" value={totalSOPs} onClick={onOpen} />
        <CM label="MCQ Found" value={mcqFound ?? sopWithMCQs} vc="text-emerald-600" onClick={onMcqWithClick ?? onOpen} />
        <CM
          label="Not Found"
          value={mcqNotFound ?? sopWithoutMCQs}
          vc={(mcqNotFound ?? sopWithoutMCQs) > 0 ? "text-red-600" : "text-gray-900"}
          onClick={onMcqWithoutClick ?? onOpen}
        />
      </div>

      {/* SOP counts */}
      <div className="flex flex-col gap-0 border-t border-transparent pt-0.5">
        <CM label="SOPs" value={totalSOPs} onClick={onOpen} />
        <CM label="w/ MCQs" value={sopWithMCQs} vc="text-emerald-600" onClick={onMcqWithClick ?? onOpen} />
        <CM label="w/o MCQs" value={sopWithoutMCQs} vc={sopWithoutMCQs > 0 ? "text-red-600" : "text-gray-900"} onClick={onMcqWithoutClick ?? onOpen} />
        <CM label="w/ EN" value={totalSopEng} />
        <CM label="w/ GU" value={totalSopGuj} vc="text-orange-500" />
        <TripleRow items={[
          { label: "Approved", value: approvedSOPs, vc: "text-emerald-600", onClick: onRowClick ? () => onRowClick("approved") : undefined },
          { label: "Partial",  value: partialSOPs,  vc: "text-amber-500",  onClick: onRowClick ? () => onRowClick("partial")  : undefined },
          { label: "Pending",  value: pendingSOPs,  vc: "text-red-600",    onClick: onRowClick ? () => onRowClick("pending")  : undefined },
        ]} />
        <CM label="Similar" value={similarSOPs} onClick={onRowClick ? () => onRowClick("similar") : undefined} />
      </div>

      {/* Remaining language slots */}
      <div className={`mt-1.5 pt-1.5 border-t ${isGrand ? "border-purple-200" : "border-gray-100"}`}>
        <div className="flex items-center gap-1.5 mb-1">
          <FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1 text-[11px] font-bold leading-tight text-gray-800">Lang Remaining</span>
        </div>
        <div className="flex flex-col gap-0">
          <TripleRow items={[
            { label: "EN rem.", value: remainingEng, vc: remainingEng > 0 ? "text-red-600" : "text-gray-900" },
            { label: "GU rem.", value: remainingGuj, vc: remainingGuj > 0 ? "text-red-600" : "text-gray-900" },
          ]} />
        </div>
      </div>

      {/* Generation section (Total only) */}
      {genCompleted !== undefined && (
        <div className={`mt-1.5 pt-1.5 border-t ${isGrand ? "border-purple-200" : "border-gray-100"}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span className="min-w-0 flex-1 text-[11px] font-bold leading-tight text-gray-800">Generation</span>
          </div>
          <div className="flex flex-col gap-0">
            <CM label="Total SOPs" value={sopWithMCQs} vc="text-blue-600" />
            <TripleRow items={[
              { label: "Completed", value: genCompleted,     vc: "text-emerald-600" },
              { label: "Target",    value: genTarget ?? 0,   vc: "text-amber-500" },
              { label: "Remaining", value: genRemaining ?? 0, vc: "text-red-600" },
            ]} />
          </div>
        </div>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Colorful dept card (By Department section)
// ─────────────────────────────────────────────────────────────
function DeptColorCard({
  dept, onClick, onMcqWithClick, onMcqWithoutClick,
}: {
  dept: DeptMCQStats;
  onClick?: () => void;
  onMcqWithClick?: () => void;
  onMcqWithoutClick?: () => void;
}) {
  const theme = getDeptTheme(dept.department);
  const [expanded, setExpanded] = useState(false);
  const coveragePct = Math.min(dept.mcqCoverage, 100);

  // Coverage bar color matches accent
  const barColor = coveragePct >= 100 ? "bg-emerald-500" : coveragePct >= 60 ? "bg-blue-500" : "bg-amber-400";

  return (
    <div className={`rounded-xl border-2 ${theme.border} bg-white transition-all duration-300 shadow-sm hover:shadow-lg overflow-hidden group`}>
      {/* Clickable header area */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
        className="w-full px-4 pt-4 pb-3 flex flex-col gap-0 bg-transparent transition-all text-left cursor-pointer"
      >
        {/* Header row */}
        <div className="flex items-center justify-between w-full mb-3">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${theme.iconBg} border border-current/10`}>
              <Folder className={`h-5 w-5 ${theme.iconText}`} />
            </div>
            <div>
              <h3 className={`text-base font-bold ${theme.accent}`}>{dept.department}</h3>
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                <p className="text-[10px] text-gray-400">
                  {dept.subcategories} Subcategor{dept.subcategories !== 1 ? "ies" : "y"}
                </p>
                {dept.trainer && (
                  <div className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-gray-300" />
                    <div className={`px-1.5 py-0.5 rounded border ${theme.capBg} text-[8px] font-black uppercase tracking-wider text-gray-700`}>
                      <span className="opacity-60 mr-1">Trainer:</span>{dept.trainer}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            title={expanded ? "Collapse" : "Expand"}
            className={`h-6 w-6 rounded-full flex items-center justify-center border ${theme.border} ${theme.iconBg} ${theme.iconText} shrink-0 hover:opacity-80 transition-all duration-200`}
          >
            <ChevronDown className={`h-3 w-3 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Top stats — SOP MCQ coverage */}
        <div className="grid grid-cols-3 gap-1.5 w-full mb-3">
          <div
            role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
            className={`${theme.statBg} rounded-lg p-2 text-left border border-gray-100 cursor-pointer hover:opacity-90`}
          >
            <p className="text-gray-400 text-[8px] uppercase tracking-wider font-bold mb-0.5">SOPs</p>
            <span className={`text-base font-black leading-none ${theme.accent}`}>{dept.sopCount}</span>
          </div>
          <div
            role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onMcqWithClick?.(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMcqWithClick?.(); } }}
            className="bg-emerald-50 rounded-lg p-2 text-left border border-emerald-100 cursor-pointer hover:opacity-90"
          >
            <p className="text-emerald-400 text-[8px] uppercase tracking-wider font-bold mb-0.5">w/ MCQs</p>
            <span className="text-base font-black leading-none text-emerald-600">{dept.sopWithMcqs}</span>
          </div>
          <div
            role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onMcqWithoutClick?.(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMcqWithoutClick?.(); } }}
            className={`rounded-lg p-2 text-left border cursor-pointer hover:opacity-90 ${dept.sopWithoutMcqs > 0 ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-100"}`}
          >
            <p className="text-[8px] uppercase tracking-wider font-bold mb-0.5 text-gray-400">w/o MCQs</p>
            <span className={`text-base font-black leading-none ${dept.sopWithoutMcqs > 0 ? "text-red-600" : "text-gray-400"}`}>{dept.sopWithoutMcqs}</span>
          </div>
        </div>

        {/* Coverage bar */}
        <div className="w-full mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">MCQ Coverage</span>
            <span className={`text-[9px] font-black ${theme.accent}`}>{coveragePct}%</span>
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${coveragePct}%` }} />
          </div>
        </div>

        {/* Status capsules */}
        <div className="grid grid-cols-2 gap-1.5 w-full mb-2">
          <div
            role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            className={`flex items-center gap-1.5 justify-between ${theme.capBg} border rounded-lg px-2.5 py-1.5 hover:opacity-80 transition-all cursor-pointer`}
          >
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Approved</span>
            </div>
            <span className="text-sm font-black text-emerald-600 leading-none">{dept.approvedSops}</span>
          </div>
          <div className={`flex items-center gap-1.5 justify-between ${theme.capBg} border rounded-lg px-2.5 py-1.5`}>
            <div className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Pending</span>
            </div>
            <span className="text-sm font-black text-amber-600 leading-none">{dept.pendingSops}</span>
          </div>
          <div className={`flex items-center gap-1.5 justify-between ${theme.capBg} border rounded-lg px-2.5 py-1.5`}>
            <div className="flex items-center gap-1">
              <Copy className="h-3 w-3 text-red-500 shrink-0" />
              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Similar</span>
            </div>
            <span className={`text-sm font-black leading-none ${dept.similarSops > 0 ? "text-red-500" : "text-gray-300"}`}>{dept.similarSops}</span>
          </div>
          <div className={`flex items-center gap-1.5 justify-between ${theme.capBg} border rounded-lg px-2.5 py-1.5`}>
            <div className="flex items-center gap-1">
              <FileText className="h-3 w-3 text-gray-400 shrink-0" />
              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Remaining</span>
            </div>
            <span className={`text-sm font-black leading-none ${dept.sopWithoutMcqs > 0 ? "text-gray-700" : "text-gray-300"}`}>{dept.sopWithoutMcqs}</span>
          </div>
        </div>

        {/* Question breakdown badges */}
        {(dept.checkedQuestions > 0 || dept.similarQuestions > 0) && (
          <div className={`flex items-center gap-1.5 w-full ${theme.statBg} rounded-lg px-2 py-1.5 overflow-hidden flex-wrap border border-gray-100`}>
            <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mr-0.5">Qs:</span>
            {dept.checkedQuestions > 0 && (
              <div className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                <span className="text-[9px] font-bold text-emerald-600 leading-none">{dept.checkedQuestions}</span>
                <span className="text-[8px] text-gray-400 leading-none">chkd</span>
              </div>
            )}
            {dept.reviewedQuestions > 0 && (
              <div className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                <Eye className="h-2.5 w-2.5 text-blue-500 shrink-0" />
                <span className="text-[9px] font-bold text-blue-600 leading-none">{dept.reviewedQuestions}</span>
                <span className="text-[8px] text-gray-400 leading-none">rvwd</span>
              </div>
            )}
            {dept.similarQuestions > 0 && (
              <div className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-gray-200 animate-pulse">
                <AlertTriangle className="h-2.5 w-2.5 text-red-500 shrink-0" />
                <span className="text-[9px] font-bold text-red-500 leading-none">{dept.similarQuestions}</span>
                <span className="text-[8px] text-gray-400 leading-none">sim</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className={`border-t ${theme.border} ${theme.statBg} px-3 py-2 flex flex-col gap-1.5`}>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-gray-100">
            <FileText className={`h-3 w-3 ${theme.iconText} shrink-0`} />
            <span className="text-[9px] text-gray-500">
              <span className={`font-bold ${theme.accent}`}>{fmt(dept.totalQuestions)}</span> total questions ·
              <span className="font-bold text-emerald-600 ml-1">{dept.approvedSops}</span> approved SOPs
            </span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-gray-200">
            <FolderOpen className={`h-3 w-3 ${theme.iconText} shrink-0`} />
            <span className="text-[9px] text-gray-500">{dept.subcategories} subcategor{dept.subcategories !== 1 ? "ies" : "y"} — click card to filter MCQ Registry</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Registry table row
// ─────────────────────────────────────────────────────────────
function RegistryRow({
  entry, isEven, onViewMcqs,
}: {
  entry: RegistryEntry; isEven: boolean; onViewMcqs?: (id: string) => void;
}) {
  const remaining = Math.max(0, entry.totalMcqs - entry.approved);
  const isDual = entry.language === "ENG-GUJ";
  // SOP No. / SOP Name rendered with displaySopCode / displaySopTitle and the exact
  // same Tailwind classes the SOP Registry uses, so both modules look identical.
  const sopCode = displaySopCode(entry.identifier);
  const sopTitle = displaySopTitle(entry.sopName, entry.identifier);
  const gujTitle = entry.sopNameGujarati
    ? displaySopTitle(entry.sopNameGujarati, entry.identifier)
    : null;

  return (
    <tr className={`hover:bg-purple-50/80 transition-colors group/row border-b border-gray-100/80 ${
      isEven ? "bg-white" : "bg-gray-50/60"
    }`}>
      {/* SOP No. — matches SOP Registry (font-mono, 13px, purple-700) */}
      <td className="px-3 py-2.5 font-mono text-[13px] font-bold tracking-wider text-purple-700 group-hover/row:underline">
        <span className="block truncate" title={sopCode}>{sopCode}</span>
      </td>
      {/* SOP Name — matches SOP Registry (12px bold, Gujarati subline) */}
      <td className="px-3 py-2.5 max-w-[220px]">
        <div className="flex min-w-0 flex-col gap-0 leading-tight">
          <span className="line-clamp-2 text-[12px] font-bold leading-tight text-gray-900 wrap-break-word" title={sopTitle}>
            {sopTitle}
          </span>
          {gujTitle && (
            <span className="line-clamp-2 text-[10px] font-bold leading-tight text-indigo-700 wrap-break-word" title={gujTitle}>
              {gujTitle}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-gray-600">{entry.department}</td>
      {/* Lang — stacked ENG/GUJ for dual-language families, matching SOP Registry */}
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        {isDual ? (
          <div className="inline-flex flex-col items-center gap-0 leading-none">
            <span className="text-[9px] font-bold text-gray-800">ENG</span>
            <span className="text-[9px] font-bold text-indigo-800">GUJ</span>
          </div>
        ) : (
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
            entry.langCode === "ENG" ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800"
          }`}>
            {entry.langCode}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <span className={`text-[11px] font-bold ${entry.totalMcqs > 0 ? "text-emerald-600" : "text-gray-300"}`}>
          {entry.totalMcqs > 0 ? fmt(entry.totalMcqs) : "—"}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <span className={`text-[11px] font-bold ${remaining > 0 ? "text-red-500" : "text-gray-300"}`}>
          {entry.totalMcqs > 0 ? fmt(remaining) : "—"}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <span className={`text-[11px] font-semibold ${entry.approved > 0 ? "text-emerald-600" : "text-gray-300"}`}>
          {fmt(entry.approved)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <span className={`text-[11px] font-semibold ${entry.partial > 0 ? "text-amber-600" : "text-gray-300"}`}>
          {fmt(entry.partial)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <span className={`text-[11px] font-semibold ${entry.similar > 0 ? "text-violet-600" : "text-gray-300"}`}>
          {fmt(entry.similar)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <span className="text-[11px] text-gray-500">{fmtDate(entry.lastUpdated)}</span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {entry.banks.length > 0 ? (
          <div className="flex items-center gap-1">
            {entry.banks.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onViewMcqs?.(b.id)}
                className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-[9px] font-semibold text-violet-700 hover:bg-violet-100 transition-colors"
              >
                <Eye className="h-2.5 w-2.5" /> {entry.banks.length > 1 ? b.langCode : "VIEW MCQs"}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[9px] text-gray-300">—</span>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
// Sort icon
// ─────────────────────────────────────────────────────────────
function SortIcon({ col, current, dir }: { col: string; current: string; dir: string }) {
  if (current !== col) return <span className="text-gray-400 ml-0.5">↕</span>;
  return <span className="text-purple-300 ml-0.5">{dir === "asc" ? "↑" : "↓"}</span>;
}

// ─────────────────────────────────────────────────────────────
// Main client component
// ─────────────────────────────────────────────────────────────
export function MCQBankClient() {
  const router = useRouter();

  // Modal state
  const [viewerBankId, setViewerBankId] = useState<string | null>(null);
  // Department folder modal (opened by clicking a department capsule/card)
  const [modalDept, setModalDept] = useState<string | null>(null);

  // Data state
  const [stats, setStats] = useState<MCQBankGlobalStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [allActiveEntries, setAllActiveEntries] = useState<RegistryEntry[]>([]);
  const [allObsoleteEntries, setAllObsoleteEntries] = useState<RegistryEntry[]>([]);
  const [regLoading, setRegLoading] = useState(true);
  const [regError, setRegError] = useState<string | null>(null);

  // Filters — applied client-side for instant capsule/card clicks (same pattern as Dashboard)
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<"all" | "easy" | "medium" | "hard">("all");
  const [deptFilter, setDeptFilter] = useState("all");
  // MCQ presence filter: "all" | "found" (has MCQs) | "notFound" (no MCQs yet)
  const [mcqPresence, setMcqPresence] = useState<"all" | "found" | "notFound">("all");
  const [obsoleteOnly, setObsoleteOnly] = useState(false);
  const [sortCol, setSortCol] = useState("identifier");
  const [sortDir, setSortDir] = useState("asc");
  const [regLangFilter, setRegLangFilter] = useState("All");

  // UI state
  const [showDeptCards, setShowDeptCards] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const mcqRegistryRef = useRef<HTMLDivElement>(null);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const statsRes = await fetch("/api/mcq-bank/stats");
      if (!statsRes.ok) throw new Error((await statsRes.json()).error ?? "Failed to load MCQ stats");
      setStats(await statsRes.json());
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchRegistry = useCallback(async () => {
    setRegLoading(true);
    setRegError(null);
    try {
      const res = await fetch("/api/mcq-bank/registry?all=1");
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      const data = await res.json();
      setAllActiveEntries(data.active ?? []);
      setAllObsoleteEntries(data.obsolete ?? []);
    } catch (e) {
      setRegError(e instanceof Error ? e.message : "Failed to load registry");
    } finally {
      setRegLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats, refreshKey]);
  useEffect(() => { fetchRegistry(); }, [fetchRegistry, refreshKey]);

  const handleSort = (field: string) => {
    if (sortCol === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(field); setSortDir("asc"); }
  };

  const { filteredEntries, total } = useMemo(() => {
    let rows = obsoleteOnly ? allObsoleteEntries : allActiveEntries;

    if (deptFilter !== "all") {
      rows = rows.filter((e) => e.department === deptFilter);
    }
    // MCQ presence: "found" = SOPs that have at least one MCQ bank;
    // "notFound" = SOPs with no MCQ bank yet (banks empty / no questions).
    if (mcqPresence === "found") {
      rows = rows.filter((e) => e.banks.length > 0);
    } else if (mcqPresence === "notFound") {
      rows = rows.filter((e) => e.banks.length === 0);
    }
    if (regLangFilter === "English") {
      rows = rows.filter((e) => e.language === "ENG" || e.language === "ENG-GUJ");
    } else if (regLangFilter === "Gujarati") {
      rows = rows.filter((e) => e.language === "GUJ" || e.language === "ENG-GUJ");
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (e) =>
          e.identifier.toLowerCase().includes(q) ||
          e.sopName.toLowerCase().includes(q) ||
          (e.sopNameGujarati ?? "").toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q),
      );
    }
    if (difficulty === "easy") rows = rows.filter((e) => e.easyCount > 0);
    else if (difficulty === "medium") rows = rows.filter((e) => e.mediumCount > 0);
    else if (difficulty === "hard") rows = rows.filter((e) => e.hardCount > 0);

    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortCol === "name") cmp = a.sopName.localeCompare(b.sopName);
      else if (sortCol === "questions" || sortCol === "totalMcqs") cmp = b.totalMcqs - a.totalMcqs;
      else if (sortCol === "remaining") cmp = b.remaining - a.remaining;
      else if (sortCol === "approved") cmp = b.approved - a.approved;
      else if (sortCol === "partial") cmp = b.partial - a.partial;
      else if (sortCol === "similar") cmp = b.similar - a.similar;
      else if (sortCol === "lastUpdated" || sortCol === "date") {
        cmp = (Date.parse(b.lastUpdated ?? "") || 0) - (Date.parse(a.lastUpdated ?? "") || 0);
      } else cmp = a.identifier.localeCompare(b.identifier);
      return sortDir === "desc" ? -cmp : cmp;
    });

    return { filteredEntries: sorted, total: sorted.length };
  }, [
    allActiveEntries, allObsoleteEntries, obsoleteOnly, deptFilter, mcqPresence, regLangFilter,
    search, difficulty, sortCol, sortDir,
  ]);

  const totalBanks = stats?.totalMcqBanks ?? allActiveEntries.length;

  // Aggregate global totals for StatusCard
  const globalCard = stats ? {
    totalSOPs: stats.totalUniqueSops,
    sopWithMCQs: stats.mcqFound,
    sopWithoutMCQs: stats.notFound,
    approvedSOPs: stats.approvedSops,
    partialSOPs: stats.partialSops,
    pendingSOPs: stats.pendingSops,
    similarSOPs: stats.similarSops,
    totalSopEng: stats.withEnglish,
    totalSopGuj: stats.withGujarati,
    remainingEng: stats.enRemaining,
    remainingGuj: stats.guRemaining,
  } : null;

  const applyDeptFilter = useCallback((department: string) => {
    setObsoleteOnly(false);
    setDeptFilter(department === "Total" ? "all" : department);
    setMcqPresence("all");
    setSearch("");
    mcqRegistryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Filter the registry by MCQ presence (e.g. clicking "MCQ Found" / "Not Found").
  const applyPresenceFilter = useCallback((department: string, presence: "found" | "notFound") => {
    setObsoleteOnly(false);
    setDeptFilter(department === "Total" ? "all" : department);
    setMcqPresence(presence);
    setSearch("");
    mcqRegistryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Open the department folder modal (Digital Repository view) for a department.
  const openDeptModal = useCallback((department: string) => {
    if (department === "Total") return;
    setModalDept(department);
  }, []);

  const toggleObsoleteView = useCallback(() => {
    setObsoleteOnly((v) => !v);
    setDeptFilter("all");
    setMcqPresence("all");
    setSearch("");
    mcqRegistryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const DEPT_ORDER = ["QA", "QC", "Microbiology", "Production", "Store", "Engineering and Maintenance", "Personnel"];
  const orderedDepts = stats ? [
    ...DEPT_ORDER.map((n) => stats.departments.find((d) => d.department === n)).filter(Boolean) as DeptMCQStats[],
    ...stats.departments.filter((d) => !DEPT_ORDER.includes(d.department)),
  ] : [];

  const totalStatusCards = 1 + orderedDepts.length;

  return (
    <>
      {/* Department folder modal (Digital Repository) — opened from a dept capsule/card.
          Rendered before the viewer so the MCQ viewer stacks on top when both are open. */}
      {modalDept && (
        <DeptDetailModal
          dept={modalDept}
          deptColor={getDeptModalColor(modalDept)}
          onClose={() => setModalDept(null)}
          onViewMcqs={(bankId) => setViewerBankId(bankId)}
        />
      )}

      {/* MCQ Viewer Modal */}
      {viewerBankId && (
        <MCQViewerModal
          bankId={viewerBankId}
          onClose={() => setViewerBankId(null)}
          onBack={() => setViewerBankId(null)}
        />
      )}

      <div className="min-h-screen bg-gray-50">
        {/* ── Header ── */}
        <div className="border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
          <div className="mx-auto max-w-[1920px]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-black text-slate-800">MCQ Question Bank</h1>
                <p className="text-xs text-slate-500">
                  Browse and manage your generated MCQ banks ({fmt(totalBanks)} total)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => router.back()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  ← Back
                </button>
                <button type="button" onClick={() => router.push("/dashboard")}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700">
                  <Home className="h-3.5 w-3.5" /> Home
                </button>
                <button type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900">
                  <Monitor className="h-3.5 w-3.5" /> Dev Mode
                </button>
                <button type="button" onClick={() => setRefreshKey((k) => k + 1)}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                  <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? "animate-spin" : ""}`} /> Refresh
                </button>
                <button type="button" onClick={toggleObsoleteView}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors ${
                    obsoleteOnly ? "bg-red-700 hover:bg-red-800 ring-2 ring-red-300" : "bg-red-500 hover:bg-red-600"
                  }`}>
                  Obsolete MCQs{stats?.obsoleteMcqs?.count ? ` (${stats.obsoleteMcqs.count})` : ""}
                </button>
                <button type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600">
                  Similar Questions
                </button>
                <button type="button" onClick={() => router.push("/dashboard")}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900">
                  <Upload className="h-3.5 w-3.5" /> Upload SOP
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1920px] space-y-6 px-6 py-4">

          {/* Error banner */}
          {statsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {statsError}
            </div>
          )}

          {/* ── MCQ STATUS CARDS — horizontal scroll grid ── */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="h-3.5 w-3.5 text-purple-400" />
              <span className="text-[10px] font-black text-gray-700 uppercase tracking-widest">MCQ Status</span>
              {statsLoading && <span className="text-[9px] text-gray-500 animate-pulse">Loading…</span>}
            </div>

            <div className="w-full px-1 py-2 sm:px-2 overflow-x-auto">
              {statsLoading ? (
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(8, minmax(150px, 1fr))` }}>
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="rounded-[10px] border border-gray-200 bg-white p-3 space-y-2 animate-pulse">
                      <div className="h-3 bg-gray-200 rounded w-3/4" />
                      <div className="h-2 bg-gray-100 rounded w-1/2" />
                      <div className="space-y-1 mt-2">
                        {[...Array(6)].map((_, j) => (
                          <div key={j} className="h-5 bg-gray-100 rounded" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : stats && globalCard ? (
                <div className="grid items-stretch gap-3" style={{ gridTemplateColumns: `repeat(${totalStatusCards}, minmax(165px, 1fr))` }}>
                  {/* Total card */}
                  <StatusCard
                    title="Total"
                    subtitle={`${orderedDepts.length} departments`}
                    isGrand
                    totalSOPs={globalCard.totalSOPs}
                    sopWithMCQs={globalCard.sopWithMCQs}
                    sopWithoutMCQs={globalCard.sopWithoutMCQs}
                    approvedSOPs={globalCard.approvedSOPs}
                    partialSOPs={globalCard.partialSOPs}
                    pendingSOPs={globalCard.pendingSOPs}
                    similarSOPs={globalCard.similarSOPs}
                    totalSopEng={globalCard.totalSopEng}
                    totalSopGuj={globalCard.totalSopGuj}
                    remainingEng={globalCard.remainingEng}
                    remainingGuj={globalCard.remainingGuj}
                    mcqFound={stats.mcqFound}
                    mcqNotFound={stats.notFound}
                    onOpen={() => applyDeptFilter("Total")}
                    onMcqWithClick={() => applyPresenceFilter("Total", "found")}
                    onMcqWithoutClick={() => applyPresenceFilter("Total", "notFound")}
                  />
                  {orderedDepts.map((dept) => (
                    <StatusCard
                      key={dept.department}
                      title={dept.department}
                      subtitle={`${dept.subcategories} subcategories`}
                      totalSOPs={dept.sopCount}
                      sopWithMCQs={dept.sopWithMcqs}
                      sopWithoutMCQs={dept.sopWithoutMcqs}
                      approvedSOPs={dept.approvedSops}
                      partialSOPs={dept.partialSops}
                      pendingSOPs={dept.pendingSops}
                      similarSOPs={dept.similarSops}
                      totalSopEng={dept.withEnglish}
                      totalSopGuj={dept.withGujarati}
                      remainingEng={dept.enRemaining}
                      remainingGuj={dept.guRemaining}
                      mcqFound={dept.sopWithMcqs}
                      mcqNotFound={dept.sopWithoutMcqs}
                      onOpen={() => openDeptModal(dept.department)}
                      onMcqWithClick={() => applyPresenceFilter(dept.department, "found")}
                      onMcqWithoutClick={() => applyPresenceFilter(dept.department, "notFound")}
                      onRowClick={() => applyDeptFilter(dept.department)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* ── BY DEPARTMENT — Collapsible colorful grid ── */}
          <button
            type="button"
            onClick={() => setShowDeptCards((v) => !v)}
            className="w-full flex items-center gap-3 px-4 py-3 mb-2 rounded-xl bg-white border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors text-left group"
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-indigo-500 shadow-sm shrink-0">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-gray-800">
                By Department <span className="text-gray-500 font-medium">({orderedDepts.length})</span>
              </span>
              <p className="text-xs text-gray-400 leading-none mt-0.5">Filter MCQs by department</p>
            </div>
            <span className="text-gray-400 group-hover:text-gray-600 transition-colors shrink-0">
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showDeptCards ? "" : "-rotate-90"}`} />
            </span>
          </button>

          {showDeptCards && (
            statsLoading ? (
              <DeptGridSkeleton count={8} />
            ) : stats ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {orderedDepts.map((dept) => (
                  <DeptColorCard
                    key={dept.department}
                    dept={dept}
                    onClick={() => openDeptModal(dept.department)}
                    onMcqWithClick={() => applyPresenceFilter(dept.department, "found")}
                    onMcqWithoutClick={() => applyPresenceFilter(dept.department, "notFound")}
                  />
                ))}
              </div>
            ) : null
          )}

          {/* ── MCQ REGISTRY TABLE ── */}
          <div className="mt-8" ref={mcqRegistryRef}>
            {/* Section header */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
                  <LayoutList className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-800 uppercase tracking-widest">
                    {obsoleteOnly ? "Obsolete MCQs" : "MCQ Registry"}
                  </h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {regLoading ? "Loading…" : obsoleteOnly
                      ? `${total} obsolete MCQ ${total === 1 ? "family" : "families"}`
                      : `${total} SOP${total === 1 ? "" : "s"}${deptFilter !== "all" ? ` · ${deptFilter}` : ""}${mcqPresence === "notFound" ? " · Not Found" : mcqPresence === "found" ? " · MCQ Found" : ""}`}
                  </p>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search SOPs..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-800 text-[11px] placeholder-gray-400 focus:outline-none focus:border-purple-400 w-44 transition-colors"
                  />
                </div>
                {!obsoleteOnly && (
                  <select
                    value={deptFilter}
                    onChange={(e) => { setDeptFilter(e.target.value); setMcqPresence("all"); }}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-800 text-[11px] focus:outline-none focus:border-purple-400 cursor-pointer"
                  >
                    <option value="all">All Depts</option>
                    {stats?.departments.map((d) => (
                      <option key={d.department} value={d.department}>{d.department}</option>
                    ))}
                  </select>
                )}
                {deptFilter !== "all" && !obsoleteOnly && (
                  <button
                    type="button"
                    onClick={() => setDeptFilter("all")}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-100 border border-purple-300 text-purple-700 text-[10px] font-bold hover:bg-purple-200 transition-colors"
                  >
                    {deptFilter} <X className="h-3 w-3 ml-0.5" />
                  </button>
                )}
                {mcqPresence !== "all" && !obsoleteOnly && (
                  <button
                    type="button"
                    onClick={() => setMcqPresence("all")}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold transition-colors ${
                      mcqPresence === "notFound"
                        ? "bg-red-100 border-red-300 text-red-700 hover:bg-red-200"
                        : "bg-emerald-100 border-emerald-300 text-emerald-700 hover:bg-emerald-200"
                    }`}
                  >
                    {mcqPresence === "notFound" ? "Not Found" : "MCQ Found"} <X className="h-3 w-3 ml-0.5" />
                  </button>
                )}
                <select
                  value={regLangFilter}
                  onChange={(e) => setRegLangFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-800 text-[11px] focus:outline-none focus:border-purple-400 cursor-pointer"
                >
                  <option value="All">All Languages</option>
                  <option value="English">English</option>
                  <option value="Gujarati">Gujarati</option>
                </select>
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 border border-gray-300 text-gray-600 text-[10px] font-bold hover:bg-gray-200 transition-colors"
                  >
                    Clear <X className="h-3 w-3 ml-0.5" />
                  </button>
                )}
              </div>
            </div>

            {regError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{regError}</div>
            )}

            {/* Table — chrome matches the SOP Registry (sticky gray-100 header) */}
            <div className="rounded-2xl border border-gray-200 overflow-hidden bg-gray-50">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b border-gray-300">
                      {([
                        ["identifier", "SOP No."],
                        ["name", "SOP Name"],
                        ["dept", "Dept"],
                        ["lang", "Lang"],
                        ["totalMcqs", "Total MCQs"],
                        ["remaining", "Remaining"],
                        ["approved", "Approved"],
                        ["partial", "Partial"],
                        ["similar", "Similar"],
                        ["lastUpdated", "Last Updated"],
                      ] as [string, string][]).map(([col, label]) => (
                        <th
                          key={col}
                          onClick={() => handleSort(col)}
                          className="px-3 py-3 text-[9px] font-bold uppercase tracking-wide text-gray-600 cursor-pointer hover:text-purple-700 whitespace-nowrap select-none transition-colors"
                        >
                          {label}<SortIcon col={col} current={sortCol} dir={sortDir} />
                        </th>
                      ))}
                      <th className="px-3 py-3 text-[9px] font-bold uppercase tracking-wide text-gray-600 whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regLoading ? (
                      [...Array(8)].map((_, i) => (
                        <tr key={i} className="border-b border-gray-200">
                          {[...Array(11)].map((_, j) => (
                            <td key={j} className="px-3 py-3">
                              <div className="h-3 animate-pulse rounded bg-gray-200" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : filteredEntries.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="text-center py-12 text-gray-500 text-sm">
                          No MCQ banks match the current filters.
                        </td>
                      </tr>
                    ) : filteredEntries.map((entry, idx) => (
                      <RegistryRow
                        key={entry.id || `${entry.identifier}||${entry.language}`}
                        entry={entry}
                        isEven={idx % 2 === 0}
                        onViewMcqs={(id) => setViewerBankId(id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
