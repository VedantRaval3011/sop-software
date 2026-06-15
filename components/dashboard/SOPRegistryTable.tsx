"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  ChevronDown,
  ChevronRight,
  Download,
  Edit2,
  FileText,
  Loader2,
  Presentation,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { PasswordConfirmDialog } from "./PasswordConfirmDialog";
import { EditSOPModal } from "./EditSOPModal";
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { RegistrySOP } from "@/lib/types";
import {
  buildOfficeOnlineEmbedUrl,
  buildPreviewHref,
  isOfficePreviewAvailable,
} from "@/lib/file-urls";
import { formatUploaded } from "@/lib/sop-utils";
import { describeFilters } from "@/lib/filter-breadcrumb";
import { useDashboardStore } from "@/lib/store/dashboard-store";
import { Btn } from "./ui";
import { DocPreviewModal } from "@/components/shared/DocPreviewModal";

/* ─── SOP display helpers ────────────────────────────────────────────── */
function displaySopCode(identifier: string): string {
  const match = identifier.match(/^([A-Z]+\d+[-]\d+)/i);
  if (match) return match[1].toUpperCase();
  const seg = identifier.split("_")[0];
  return /^[A-Z]{2,}\d/i.test(seg) ? seg.toUpperCase() : identifier;
}

function displaySopTitle(name: string, identifier: string): string {
  const code = displaySopCode(identifier);
  const codePattern = code.replace(/[-]/g, String.raw`[\s_-]`);
  const stripped = name.replace(new RegExp(`^${codePattern}[\\s_-]*`, "i"), "").trim();
  return stripped || name;
}

const registryTdBase = "px-1 py-1 align-middle overflow-hidden max-w-0";

/* ─── Media (video / slide) preview modal ────────────────────────────── */
function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0];
  return /\.(mp4|webm|mov|ogg|ogv|avi|mkv)$/.test(lower);
}

function isSlideUrl(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0];
  return /\.(pptx?|key)$/.test(lower);
}

function mediaSummary(url: string, index: number): string {
  try {
    const decoded = decodeURIComponent(url.split("?")[0]);
    const seg = decoded.split("/").filter(Boolean).pop() ?? "";
    const name = seg.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    if (name.length > 30) return name.slice(0, 30) + "…";
    return name || `Item ${index + 1}`;
  } catch {
    return `Item ${index + 1}`;
  }
}

function MediaPreviewModal({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const officeEmbedSrc = isSlideUrl(url) ? buildOfficeOnlineEmbedUrl(url, origin) : null;
  const officeAvailable = isSlideUrl(url) && isOfficePreviewAvailable(url, origin);
  const [iframeLoading, setIframeLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ height: isVideoUrl(url) ? "auto" : "min(90vh, 900px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            {isVideoUrl(url)
              ? <Video className="h-4 w-4 shrink-0 text-emerald-600" />
              : <Presentation className="h-4 w-4 shrink-0 text-indigo-600" />}
            <span className="truncate text-sm font-semibold text-gray-800">{label}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={url}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="h-3 w-3" />
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="relative min-h-0 flex-1 bg-black/5">
          {isVideoUrl(url) ? (
            <video
              src={url}
              controls
              autoPlay={false}
              className="mx-auto block max-h-[70vh] w-full bg-black"
              style={{ maxHeight: "70vh" }}
            >
              Your browser does not support the video tag.
            </video>
          ) : isSlideUrl(url) && !officeAvailable ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center text-sm text-gray-600">
              <Presentation className="h-10 w-10 text-gray-300" />
              <p>Office Online preview requires a public URL.</p>
              <p className="text-xs text-gray-500">On localhost, download the file to view it.</p>
              <a
                href={url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download file
              </a>
            </div>
          ) : isSlideUrl(url) ? (
            <div className="relative h-full">
              {iframeLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white text-sm text-gray-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading preview…
                </div>
              )}
              <iframe
                src={officeEmbedSrc!}
                className="absolute inset-0 h-full w-full border-0"
                title={`Slide preview: ${label}`}
                allowFullScreen
                onLoad={() => setIframeLoading(false)}
              />
            </div>
          ) : (
            /* Generic: open in new iframe (PDF-like CDN file) */
            <div className="relative h-full">
              {iframeLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white text-sm text-gray-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading…
                </div>
              )}
              <iframe
                src={url}
                className="absolute inset-0 h-full w-full border-0"
                title={label}
                allowFullScreen
                onLoad={() => setIframeLoading(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

/* ─── Clickable pill for one media item ─────────────────────────────── */
function MediaPill({
  url,
  langLabel,
  index,
  kind,
}: {
  url: string;
  langLabel: string;
  index: number;
  kind: "video" | "slide";
}) {
  const [open, setOpen] = useState(false);
  const summary = mediaSummary(url, index);
  const isVideo = kind === "video";
  const urlLower = url.toLowerCase();
  const videoTypeLabel = urlLower.includes("explainer") ? "EX" : urlLower.includes("brief") ? "BR" : null;
  const displayLabel = isVideo ? (videoTypeLabel ?? `${langLabel}·${index + 1}`) : langLabel;

  const pillCls = isVideo
    ? "inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-1 py-px text-[8px] font-semibold text-emerald-700 hover:bg-emerald-100 cursor-pointer transition-colors max-w-full"
    : "inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1 py-px text-[8px] font-semibold text-indigo-700 hover:bg-indigo-100 cursor-pointer transition-colors max-w-full";

  const label = `${langLabel} — ${summary}`;

  return (
    <>
      <button
        type="button"
        className={pillCls}
        title={`Preview: ${label}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        {isVideo
          ? <Video className="h-2 w-2 shrink-0" aria-hidden />
          : <Presentation className="h-2 w-2 shrink-0" aria-hidden />}
        <span className="truncate max-w-15">{displayLabel}</span>
      </button>
      {open && (
        <MediaPreviewModal
          url={url}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* ─── Document preview modal ─────────────────────────────────────────── */

interface SOPRegistryTableProps {
  items: RegistrySOP[];
  total: number;
  loading: boolean;
  departments: string[];
  onSort: (field: string) => void;
  onRefresh: () => void;
  onObsolete: (sop: RegistrySOP) => Promise<void>;
  onRevive: (sop: RegistrySOP) => Promise<void>;
  onPermanentDelete: (sop: RegistrySOP, password: string) => Promise<void>;
  onExportExcel: () => void;
  canMutate: boolean;
}

export function SOPRegistryTable({
  items,
  total,
  loading,
  departments,
  onSort,
  onRefresh,
  onObsolete,
  onRevive,
  onPermanentDelete,
  onExportExcel,
  canMutate,
}: SOPRegistryTableProps) {
  const { filters, setFilter, resetFilters, expandedRows, toggleRow, toggleFilterSidebar, showToast } =
    useDashboardStore();
  const [editIdentifier, setEditIdentifier] = useState<string | null>(null);
  const [obsoleteTarget, setObsoleteTarget] = useState<RegistrySOP | null>(null);
  const [obsoleting, setObsoleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RegistrySOP | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const breadcrumb = useMemo(() => describeFilters(filters), [filters]);

  const handleEditClose = useCallback(() => setEditIdentifier(null), []);

  const SortIcon = ({ field }: { field: string }) => {
    if (filters.sortBy !== field)
      return <ArrowUpDown className="h-3 w-3 text-gray-400 ml-0.5 inline opacity-60" />;
    return filters.sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 text-purple-600 ml-0.5 inline" />
      : <ArrowDown className="h-3 w-3 text-purple-600 ml-0.5 inline" />;
  };

  const thBase = "sticky top-0 z-20 bg-gray-100 px-1 py-0.5 align-top text-[9px] font-bold text-gray-600 uppercase tracking-wide whitespace-normal wrap-break-word overflow-hidden";
  const selBase = "w-full min-w-0 text-[8px] p-px border border-gray-300 rounded bg-white focus:outline-none focus:border-purple-500 cursor-pointer leading-tight";
  const sortBtn = "flex w-full min-w-0 items-center gap-0.5 rounded px-0.5 py-1 text-left font-bold uppercase tracking-wide text-gray-600 hover:bg-purple-50/80 hover:text-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-400";

  /* Unique language options for filter dropdown */
  const uniqueLanguages = useMemo(() => {
    const langs = new Set(items.map((s) => s.language));
    return Array.from(langs).sort();
  }, [items]);

  // True when the table is showing the Obsolete SOPs view; there we offer Revive
  // (move back to active) instead of the Obsolete action.
  const isObsoleteView = Boolean(filters.obsoleteOnly);

  const handleRevive = useCallback(
    async (sop: RegistrySOP) => {
      try {
        await onRevive(sop);
        showToast(`${sop.identifier} restored to the SOP Registry`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to revive SOP");
      }
    },
    [onRevive, showToast],
  );

  const handleObsoleteConfirm = async () => {
    if (!obsoleteTarget) return;
    const target = obsoleteTarget;
    // The move is applied optimistically by the parent, so close the dialog at
    // once — the SOP leaves the active list and the counts update on this click.
    setObsoleteTarget(null);
    setObsoleting(true);
    try {
      await onObsolete(target);
      showToast(`${target.identifier} moved to Obsolete SOPs`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to move SOP to Obsolete");
    } finally {
      setObsoleting(false);
    }
  };

  const handleDeleteConfirm = async (password: string) => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onPermanentDelete(target, password);
      // Only close on success; a wrong password keeps the dialog open so the
      // user can retry without losing their place.
      setDeleteTarget(null);
      showToast(`${target.identifier} permanently deleted`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete SOP");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-full overflow-hidden px-1 pb-2 sm:px-2">
      <EditSOPModal
        open={editIdentifier !== null}
        identifier={editIdentifier}
        departmentList={departments}
        onClose={handleEditClose}
        onSuccess={onRefresh}
      />
      <ConfirmDialog
        open={obsoleteTarget !== null}
        title="Move SOP to Obsolete"
        message={
          obsoleteTarget
            ? `Move SOP ${obsoleteTarget.identifier} to Obsolete SOPs? All files, versions, history, and metadata will be preserved. The SOP will be removed from active listings.`
            : ""
        }
        confirmLabel="Move to Obsolete"
        loading={obsoleting}
        onConfirm={handleObsoleteConfirm}
        onCancel={() => setObsoleteTarget(null)}
      />
      <PasswordConfirmDialog
        open={deleteTarget !== null}
        title="Permanently delete SOP"
        message={
          deleteTarget
            ? `Permanently delete SOP ${deleteTarget.identifier}? This removes all versions, languages, history, and metadata from the registry and cannot be undone.`
            : ""
        }
        confirmLabel="Delete permanently"
        loading={deleting}
        error={deleteError}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
      <div className="flex flex-col w-full bg-gray-50">

        {/* Toolbar row */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-300 bg-gray-100 px-3 py-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-700">SOP Registry</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <Btn size="xs" onClick={resetFilters}>Reset</Btn>
            <Btn
              size="xs"
              onClick={onExportExcel}
              disabled={total === 0}
              title={`Export the ${total} displayed record${total === 1 ? "" : "s"} (${breadcrumb.label}) to Excel`}
            >
              <Download className="h-3 w-3" />
              Export to Excel{total > 0 ? ` (${total})` : ""}
            </Btn>
            <select
              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-purple-500"
              value={filters.searchField ?? "All"}
              onChange={(e) => setFilter({ searchField: e.target.value })}
            >
              {["All fields", "SOP No", "Name", "Department", "Location"].map((f) => (
                <option key={f} value={f === "All fields" ? "All" : f}>{f}</option>
              ))}
            </select>
            <div className="relative">
              <input
                type="search"
                placeholder="Search SOPs..."
                className="w-44 rounded border border-gray-300 py-0.5 pl-2 pr-6 text-[10px] focus:border-purple-500 focus:outline-none"
                value={filters.search ?? ""}
                onChange={(e) => setFilter({ search: e.target.value })}
              />
            </div>
            <Btn size="xs" onClick={toggleFilterSidebar}>
              <SlidersHorizontal className="h-3 w-3" />
            </Btn>
          </div>
          <span className="ml-auto rounded bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-800">
            {total} results
          </span>
        </div>

        {/* Breadcrumb — shows which capsule/card was clicked and the dataset on view */}
        <div
          className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-1.5 text-[11px]"
          aria-label="Current results context"
        >
          <span className="font-semibold text-purple-700">{breadcrumb.department}</span>
          <ChevronRight className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
          {breadcrumb.segments.length > 0 ? (
            breadcrumb.segments.map((seg, i) => (
              <Fragment key={seg}>
                {i > 0 && <span className="text-gray-300" aria-hidden>·</span>}
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">{seg}</span>
              </Fragment>
            ))
          ) : (
            <span className="font-medium text-gray-600">All SOPs</span>
          )}
          <span className="text-gray-500">Results</span>
        </div>

        {/* Table — vertical scroll only; columns share viewport width */}
        <div
          className="w-full max-w-full overflow-x-hidden overflow-y-auto overscroll-y-contain max-h-[calc(100vh-180px)]"
        >
          <table className="w-full table-fixed border-collapse text-left">
            <colgroup>
              <col style={{ width: "1.5%" }} />
              <col style={{ width: "2%" }} />
              <col style={{ width: "5.5%" }} />
              <col style={{ width: "2.5%" }} />
              <col style={{ width: canMutate ? "15%" : "17%" }} />
              <col style={{ width: "3.5%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: canMutate ? "15.5%" : "16.5%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "3.5%" }} />
              <col style={{ width: "8.5%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "6.5%" }} />
              <col style={{ width: "7%" }} />
              {canMutate && <col style={{ width: "3.5%" }} />}
            </colgroup>
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className={`${thBase} text-center`} />
                <th className={`${thBase} text-center`} title="Serial number">SR</th>
                <th className={thBase}>
                  <button type="button" className={sortBtn} onClick={() => onSort("identifier")}>
                    SOP No <SortIcon field="identifier" />
                  </button>
                </th>
                <th className={`${thBase} text-center`}>
                  <button type="button" className={sortBtn} onClick={() => onSort("version")}>
                    Ver <SortIcon field="version" />
                  </button>
                </th>
                <th className={thBase}>
                  <button type="button" className={sortBtn} onClick={() => onSort("name")}>
                    SOP Name <SortIcon field="name" />
                  </button>
                </th>
                <th className={thBase}>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[8px] font-bold text-gray-500 uppercase tracking-widest leading-none">Guideline</span>
                    <button type="button" className={`${sortBtn} justify-center py-0.5`} onClick={() => onSort("guidelineReference")} title="Guideline reference">
                      <Sparkles className="h-3 w-3 text-orange-500 shrink-0" />
                      <SortIcon field="guidelineReference" />
                    </button>
                  </div>
                </th>
                <th className={thBase}>
                  <button type="button" className={sortBtn} onClick={() => onSort("location")}>
                    Location <SortIcon field="location" />
                  </button>
                </th>
                <th className={thBase} title="Prior revisions (DOCX/PDF) per language">
                  <button type="button" className={sortBtn} onClick={() => onSort("priorVersions")}>
                    Prior Versions <SortIcon field="priorVersions" />
                  </button>
                </th>
                <th className={thBase}>
                  <div className="flex flex-col gap-px min-w-0">
                    <button type="button" className={sortBtn} onClick={() => onSort("department")}>
                      Dept <SortIcon field="department" />
                    </button>
                    <select
                      className={selBase}
                      value={filters.department ?? ""}
                      onChange={(e) => setFilter({ department: e.target.value || undefined })}
                    >
                      <option value="">All</option>
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </th>
                <th className={thBase}>
                  <div className="flex flex-col gap-px">
                    <button type="button" className={sortBtn} onClick={() => onSort("language")}>
                      Lang <SortIcon field="language" />
                    </button>
                    <select
                      className={selBase}
                      value={filters.language ?? ""}
                      onChange={(e) => setFilter({ language: e.target.value || undefined })}
                    >
                      <option value="">All</option>
                      {uniqueLanguages.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                </th>
                <th className={thBase} title="Current approved files: English first, then Gujarati when dual">
                  <div className="flex flex-col gap-px">
                    <button type="button" className={sortBtn} onClick={() => onSort("fileType")}>
                      Files <SortIcon field="fileType" />
                    </button>
                    <select
                      className={selBase}
                      value={filters.fileType ?? ""}
                      onChange={(e) => setFilter({ fileType: e.target.value || undefined })}
                    >
                      <option value="">All</option>
                      <option value="DOCX">DOCX</option>
                      <option value="No DOCX">No DOCX</option>
                      <option value="PDF">PDF</option>
                      <option value="No PDF">No PDF</option>
                    </select>
                  </div>
                </th>
                <th className={thBase}>
                  <div className="flex flex-col gap-px">
                    <button type="button" className={sortBtn} onClick={() => onSort("videos")} title="Training videos">
                      Video <SortIcon field="videos" />
                    </button>
                    <select
                      className={selBase}
                      value={filters.media?.startsWith("Video") || filters.media?.startsWith("No Video") ? (filters.media ?? "") : ""}
                      onChange={(e) => setFilter({ media: e.target.value || undefined })}
                    >
                      <option value="">All</option>
                      <option value="Video">Has Video</option>
                      <option value="No Video">No Video</option>
                    </select>
                  </div>
                </th>
                <th className={thBase}>
                  <div className="flex flex-col gap-px">
                    <button type="button" className={sortBtn} onClick={() => onSort("slides")} title="Slide decks">
                      Slides <SortIcon field="slides" />
                    </button>
                    <select
                      className={selBase}
                      value={filters.media?.startsWith("Slides") || filters.media?.startsWith("No Slides") ? (filters.media ?? "") : ""}
                      onChange={(e) => setFilter({ media: e.target.value || undefined })}
                    >
                      <option value="">All</option>
                      <option value="Slides">Has Slides</option>
                      <option value="No Slides">No Slides</option>
                    </select>
                  </div>
                </th>
                <th className={thBase}>
                  <button type="button" className={sortBtn} onClick={() => onSort("uploadedAt")} title="Upload date">
                    Uploaded <SortIcon field="uploadedAt" />
                  </button>
                </th>
                <th className={thBase}>
                  <div className="flex flex-col gap-px">
                    <button type="button" className={sortBtn} onClick={() => onSort("expiryDate")}>
                      Expiry <SortIcon field="expiryDate" />
                    </button>
                    <select
                      className={selBase}
                      value={filters.expiry ?? ""}
                      onChange={(e) => setFilter({ expiry: e.target.value || undefined })}
                    >
                      <option value="">All</option>
                      <option value="Expired">Expired</option>
                      <option value="Near">Near (&lt;90d)</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                      <option value="No Date">No Date</option>
                    </select>
                  </div>
                </th>
                {canMutate && <th className={thBase}>Actions</th>}
              </tr>
            </thead>
            <tbody className="text-[10px] text-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={canMutate ? 16 : 15} className="py-12 text-center text-slate-400">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={canMutate ? 16 : 15} className="py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center gap-1">
                      <FileText className="h-5 w-5 text-gray-300" />
                      <p className="text-xs">No SOPs found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((sop, idx) => (
                  <SOPRow
                    key={sop.id}
                    sop={sop}
                    index={(filters.page! - 1) * (filters.limit ?? 50) + idx + 1}
                    isEven={idx % 2 === 0}
                    expanded={expandedRows.has(sop.id)}
                    onToggle={() => toggleRow(sop.id)}
                    canMutate={canMutate}
                    isObsoleteView={isObsoleteView}
                    onEdit={() => setEditIdentifier(sop.identifier)}
                    onObsolete={() => setObsoleteTarget(sop)}
                    onRevive={() => handleRevive(sop)}
                    onDelete={() => {
                      setDeleteError(null);
                      setDeleteTarget(sop);
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ─── Individual row ─────────────────────────────────────────────────── */
const SOPRow = memo(function SOPRow({
  sop,
  index,
  isEven,
  expanded,
  onToggle,
  canMutate,
  isObsoleteView,
  onEdit,
  onObsolete,
  onRevive,
  onDelete,
}: {
  sop: RegistrySOP;
  index: number;
  isEven: boolean;
  expanded: boolean;
  onToggle: () => void;
  canMutate: boolean;
  isObsoleteView: boolean;
  onEdit: () => void;
  onObsolete: () => void;
  onRevive: () => void;
  onDelete: () => void;
}) {
  const isDual = sop.language === "ENG-GUJ";

  /* Expiry badge */
  const expiryNode = (() => {
    if (!sop.expiryDate) {
      return <span className="inline-block rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[8px] font-semibold text-gray-400">No Date</span>;
    }
    const diffDays = Math.floor((new Date(sop.expiryDate).getTime() - Date.now()) / 86400000);
    const absDays = Math.abs(diffDays);
    const months = Math.floor(absDays / 30);
    const remDays = absDays - months * 30;
    const monthWord = months === 1 ? "month" : "months";
    const breakdown = months > 0 && remDays > 0
      ? ` (${months} ${monthWord} ${remDays} days)`
      : months > 0 ? ` (${months} ${monthWord})` : "";

    let label: string;
    let colorClass: string;
    if (diffDays < 0) {
      label = `Expired · ${absDays} days ago${breakdown}`;
      colorClass = "text-red-700 bg-red-50 border-red-200";
    } else if (diffDays <= 30) {
      label = `${diffDays} days${breakdown}`;
      colorClass = "text-orange-700 bg-orange-50 border-orange-200";
    } else if (diffDays <= 90) {
      label = `${diffDays} days${breakdown}`;
      colorClass = "text-yellow-800 bg-yellow-50 border-yellow-200";
    } else {
      label = `${diffDays} days${breakdown}`;
      colorClass = "text-emerald-800 bg-emerald-50 border-emerald-200";
    }
    return (
      <span
        className={`inline-block w-full max-w-full rounded border px-1 py-0.5 text-[8px] font-semibold leading-snug line-clamp-2 ${colorClass}`}
        title={`Expiry: ${new Date(sop.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} — ${label}`}
      >
        {label}
      </span>
    );
  })();

  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className={`hover:bg-purple-50/80 cursor-pointer transition-colors group border-b border-gray-100/80 ${
          expanded ? "bg-purple-50" : isEven ? "bg-white" : "bg-gray-50/60"
        }`}
      >
        {/* Expand toggle */}
        <td className={`${registryTdBase} text-center`}>
          {expanded
            ? <ChevronDown className="h-4 w-4 text-purple-600 mx-auto" />
            : <ChevronRight className="h-4 w-4 text-gray-400 mx-auto" />}
        </td>

        {/* SR */}
        <td className={`${registryTdBase} text-center text-[10px] font-bold text-gray-600 tabular-nums`}>
          {index}
          {sop.isNew && (
            <span className="ml-0.5 rounded bg-blue-100 px-0.5 py-px text-[8px] font-bold text-blue-700">N</span>
          )}
        </td>

        {/* SOP No */}
        <td className={`${registryTdBase} font-mono text-[13px] font-bold tracking-wider text-purple-700 group-hover:underline`}>
          <span className="block truncate" title={displaySopCode(sop.identifier)}>
            {displaySopCode(sop.identifier)}
          </span>
        </td>

        {/* Ver */}
        <td className={`${registryTdBase} text-center`}>
          <span className="text-[11px] font-bold text-gray-800 tabular-nums">{sop.version}</span>
        </td>

        {/* SOP Name */}
        <td className={`${registryTdBase} font-medium text-gray-800`}>
          <div className="flex min-w-0 flex-col gap-0 leading-tight">
            <span
              className="line-clamp-2 text-[12px] font-bold leading-tight text-gray-900 wrap-break-word"
              title={displaySopTitle(sop.name, sop.identifier)}
            >
              {displaySopTitle(sop.name, sop.identifier)}
            </span>
            {sop.nameGujarati && (
              <span
                className="line-clamp-2 text-[10px] font-bold leading-tight text-indigo-700 wrap-break-word"
                title={displaySopTitle(sop.nameGujarati, sop.identifier)}
              >
                {displaySopTitle(sop.nameGujarati, sop.identifier)}
              </span>
            )}
          </div>
        </td>

        {/* Guideline */}
        <td className={`${registryTdBase} text-center`}>
          <span className="inline-block max-w-full truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 tabular-nums">
            {sop.guidelineReference ?? <span className="text-gray-300">—</span>}
          </span>
        </td>

        {/* Location */}
        <td className={registryTdBase}>
          <span className="line-clamp-2 text-[10px] font-medium leading-snug text-gray-700 cursor-help" title={sop.location ?? undefined}>
            {sop.location ?? <span className="text-gray-400">—</span>}
          </span>
        </td>

        {/* Prior Versions */}
        <td className={`${registryTdBase} px-0.5`}>
          <PriorVersionsCell sop={sop} />
        </td>

        {/* Department */}
        <td className={`${registryTdBase} text-gray-700`}>
          <span
            className="line-clamp-2 text-[10px] font-semibold leading-snug text-gray-700 wrap-break-word"
            title={sop.department}
          >
            {sop.department}
          </span>
        </td>

        {/* Lang */}
        <td className={`${registryTdBase} text-center`}>
          {isDual ? (
            <div className="inline-flex flex-col items-center gap-0 leading-none">
              <span className="text-[9px] font-bold text-gray-800">ENG</span>
              <span className="text-[9px] font-bold text-indigo-800">GUJ</span>
            </div>
          ) : (
            <span className="text-[9px] font-semibold text-gray-700">
              {sop.language === "GUJ" ? "GUJ" : "ENG"}
            </span>
          )}
        </td>

        {/* Files */}
        <td className={`${registryTdBase} text-center`}>
          <FilesCell sop={sop} />
        </td>

        {/* Video */}
        <td className={`${registryTdBase} text-left`}>
          <VideoCell sop={sop} isDual={isDual} />
        </td>

        {/* Slides */}
        <td className={`${registryTdBase} text-left`}>
          <SlidesCell sop={sop} isDual={isDual} />
        </td>

        {/* Uploaded */}
        <td className={`${registryTdBase} text-[9px] leading-tight text-gray-600`}>
          {(() => {
            const full = formatUploaded(sop.uploadedAt);
            const spaceIdx = full.lastIndexOf(" ");
            const datePart = spaceIdx > 0 ? full.slice(0, spaceIdx) : full;
            const timePart = spaceIdx > 0 ? full.slice(spaceIdx + 1) : null;
            return (
              <div className="flex flex-col leading-snug" title={full}>
                <span>{datePart}</span>
                {timePart && <span className="text-gray-400">{timePart}</span>}
              </div>
            );
          })()}
        </td>

        {/* Expiry */}
        <td className={registryTdBase}>{expiryNode}</td>

        {/* Actions */}
        {canMutate && (
          <td className={registryTdBase}>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="rounded p-0.5 hover:bg-slate-100"
                title="Edit SOP"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Edit2 className="h-3 w-3 text-slate-500" />
              </button>
              {isObsoleteView ? (
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-emerald-50"
                  title="Revive — move back to SOP Registry"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRevive();
                  }}
                >
                  <RotateCcw className="h-3 w-3 text-emerald-600" />
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-amber-50"
                  title="Move to Obsolete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onObsolete();
                  }}
                >
                  <Archive className="h-3 w-3 text-amber-600" />
                </button>
              )}
              <button
                type="button"
                className="rounded p-0.5 hover:bg-red-50"
                title="Delete permanently"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-3 w-3 text-red-500" />
              </button>
            </div>
          </td>
        )}
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-200">
          <td colSpan={canMutate ? 16 : 15} className="px-4 py-3">
            <SOPDetailPanel
              sop={sop}
              expiryNode={expiryNode}
              canMutate={canMutate}
              isObsoleteView={isObsoleteView}
              onEdit={onEdit}
              onObsolete={onObsolete}
              onRevive={onRevive}
              onDelete={onDelete}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
});

/* ─── Expanded row detail panel ──────────────────────────────────────── */
function DetailRow({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="shrink-0 font-semibold text-gray-600">{label}</span>
      <span className="truncate text-right font-bold text-gray-800" title={title}>{value}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="border-b border-gray-300 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-700">
      {children}
    </h4>
  );
}

function SOPDetailPanel({
  sop,
  expiryNode,
  canMutate,
  isObsoleteView,
  onEdit,
  onObsolete,
  onRevive,
  onDelete,
}: {
  sop: RegistrySOP;
  expiryNode: React.ReactNode;
  canMutate: boolean;
  isObsoleteView: boolean;
  onEdit: () => void;
  onObsolete: () => void;
  onRevive: () => void;
  onDelete: () => void;
}) {
  const languageLabel =
    sop.language === "ENG-GUJ" ? "English & Gujarati" : sop.language === "GUJ" ? "Gujarati" : "English";
  const videoCount = sop.media.videos.en + sop.media.videos.gu;
  const slideCount = sop.media.slides.en + sop.media.slides.gu;
  const effective = sop.effectiveDate
    ? new Date(sop.effectiveDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  const fileGroups = [
    { lang: "ENG", docx: sop.files.docx.en, pdf: sop.files.pdf.en },
    { lang: "GUJ", docx: sop.files.docx.gu, pdf: sop.files.pdf.gu },
  ].filter((g) => g.docx || g.pdf);

  const engPrior = sop.priorVersions.filter((pv) => pv.language === "ENG");
  const gujPrior = sop.priorVersions.filter((pv) => pv.language === "GUJ");

  const renderPriorGroup = (label: string, pvs: typeof sop.priorVersions) =>
    pvs.length === 0 ? null : (
      <div className="flex items-start gap-1.5">
        <span className="w-12 shrink-0 text-[8px] font-bold uppercase text-gray-400">{label}</span>
        <div className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          {pvs.map((pv) =>
            pv.missing ? (
              <span key={`${pv.version}-${pv.language}`} className="text-[8px] font-semibold italic text-amber-600" title={`Version ${pv.version} was never uploaded`}>
                <span className="font-bold not-italic text-gray-400 line-through">V{pv.version}</span> not found
              </span>
            ) : (
              <span key={`${pv.version}-${pv.language}`} className="flex items-center gap-0.5 text-[8px] font-bold">
                <span className="text-green-700">V{pv.version}</span>
                {pv.docx ? <FileLink filePath={pv.docx} label="DOCX" /> : <span className="text-red-500">DOCX</span>}
                <span className="select-none text-gray-300">/</span>
                {pv.pdf ? <FileLink filePath={pv.pdf} label="PDF" isPdf /> : <span className="text-red-500">PDF</span>}
              </span>
            ),
          )}
        </div>
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
      {/* Basic Information */}
      <div className="space-y-2">
        <SectionHeading>Basic Information</SectionHeading>
        <div className="space-y-1 text-[10px]">
          <DetailRow label="SOP Number:" value={sop.identifier} />
          <DetailRow label="Version:" value={sop.version || "—"} />
          <DetailRow label="Department:" value={sop.department || "Other"} />
          {sop.location && <DetailRow label="Location:" value={sop.location} title={sop.location} />}
          <DetailRow label="Language:" value={languageLabel} />
          {sop.name && <DetailRow label="English Name:" value={sop.name} title={sop.name} />}
          {sop.nameGujarati && <DetailRow label="Gujarati Name:" value={sop.nameGujarati} title={sop.nameGujarati} />}
          {sop.guidelineReference && <DetailRow label="Guideline:" value={sop.guidelineReference} title={sop.guidelineReference} />}
        </div>
      </div>

      {/* Documents & Revisions */}
      <div className="space-y-2">
        <SectionHeading>Documents &amp; Revisions</SectionHeading>
        <div className="space-y-2 text-[10px]">
          <div className="flex items-start gap-1.5">
            <FileText className="mt-0.5 h-3 w-3 shrink-0 text-gray-500" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-semibold text-gray-600">Active Files:</span>
              {fileGroups.length === 0 ? (
                <span className="text-gray-500">No documents</span>
              ) : (
                fileGroups.map((g) => (
                  <div key={g.lang} className="flex items-center gap-1.5">
                    <span className="w-7 shrink-0 text-[8px] font-bold text-gray-400">{g.lang}</span>
                    <div className="flex items-center gap-2 text-[8px] font-bold">
                      {g.docx ? <FileLink filePath={g.docx} label="DOCX" /> : <span className="text-red-500">DOCX&nbsp;✗</span>}
                      {g.pdf ? <FileLink filePath={g.pdf} label="PDF" isPdf /> : <span className="text-red-500">PDF&nbsp;✗</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          {sop.priorVersions.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-gray-200 pt-1.5">
              <span className="font-semibold text-gray-600">Prior Revisions:</span>
              {renderPriorGroup("English", engPrior)}
              {renderPriorGroup("Gujarati", gujPrior)}
            </div>
          )}
        </div>
      </div>

      {/* Training & Status */}
      <div className="space-y-2">
        <SectionHeading>Training &amp; Status</SectionHeading>
        <div className="space-y-1.5 text-[10px]">
          <div className="flex items-start gap-1.5">
            <Video className="h-3 w-3 shrink-0 text-gray-500 mt-0.5" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold text-gray-600">Training Video</span>
              {videoCount === 0 ? (
                <span className="text-[10px] font-semibold italic text-amber-600">Not Available</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(sop.mediaUrls?.videos?.en ?? []).map((url, i) => (
                    <MediaPill key={url} url={url} langLabel="ENG" index={i} kind="video" />
                  ))}
                  {(sop.mediaUrls?.videos?.gu ?? []).map((url, i) => (
                    <MediaPill key={url} url={url} langLabel="GUJ" index={i} kind="video" />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-start gap-1.5">
            <Presentation className="h-3 w-3 shrink-0 text-gray-500 mt-0.5" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold text-gray-600">Slides &amp; Materials</span>
              {slideCount === 0 ? (
                <span className="text-[10px] font-semibold italic text-amber-600">Not Available</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(sop.mediaUrls?.slides?.en ?? []).map((url, i) => (
                    <MediaPill key={url} url={url} langLabel="ENG" index={i} kind="slide" />
                  ))}
                  {(sop.mediaUrls?.slides?.gu ?? []).map((url, i) => (
                    <MediaPill key={url} url={url} langLabel="GUJ" index={i} kind="slide" />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 shrink-0 text-gray-500" />
            <span className="font-semibold text-gray-600">MCQ Bank:</span>
            <span className="font-bold text-gray-800">{sop.mcqCount > 0 ? `${sop.mcqCount} questions` : "Pending"}</span>
          </div>
          <div className="flex items-center gap-1.5 border-t border-gray-200 pt-1.5">
            <Calendar className="h-3 w-3 shrink-0 text-gray-500" />
            <span className="font-semibold text-gray-600">Expiry:</span>
            <span className="min-w-0 flex-1">{expiryNode}</span>
          </div>
          {effective && (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3 w-3 shrink-0 text-gray-500" />
              <span className="font-semibold text-gray-600">Effective:</span>
              <span className="font-bold text-gray-800">{effective}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 shrink-0 text-gray-500" />
            <span className="font-semibold text-gray-600">Compliance:</span>
            <span className="font-bold text-gray-800">{sop.complianceScore}/10 ({sop.complianceStatus})</span>
          </div>

          {canMutate && (
            <div className="flex flex-col gap-1 pt-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="flex items-center justify-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                <Edit2 className="h-3 w-3" /> Edit SOP
              </button>
              {isObsoleteView ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRevive(); }}
                  className="flex items-center justify-center gap-1 rounded border border-emerald-200 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  <RotateCcw className="h-3 w-3" /> Revive SOP
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onObsolete(); }}
                  className="flex items-center justify-center gap-1 rounded border border-amber-200 bg-white px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-50"
                >
                  <Archive className="h-3 w-3" /> Mark Obsolete
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="flex items-center justify-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3 w-3" /> Delete Permanently
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Files cell: ENG row + GUJ row ──────────────────────────────────── */
function FilesCell({ sop }: { sop: RegistrySOP }) {
  const isDual = sop.language === "ENG-GUJ";
  const hasGu = Boolean(sop.files.docx.gu || sop.files.pdf.gu) || isDual;

  const renderLangRow = (
    langLabel: string,
    docxPath: string | undefined,
    pdfPath: string | undefined,
  ) => (
    <div className="flex min-w-0 items-center gap-1.5 text-left leading-none">
      <span className="w-4.5 shrink-0 text-[8px] font-bold text-gray-500">{langLabel}</span>
      {docxPath ? (
        <FileLink filePath={docxPath} label="DOCX" />
      ) : (
        <span className="truncate text-[8px] font-bold leading-none text-red-600" title="DOCX missing">DOCX&nbsp;✗</span>
      )}
      {pdfPath ? (
        <FileLink filePath={pdfPath} label="PDF" isPdf />
      ) : (
        <span className="truncate text-[8px] font-bold leading-none text-red-600" title="PDF missing">PDF&nbsp;✗</span>
      )}
    </div>
  );

  if (!hasGu) {
    return (
      <div className="mx-auto flex w-full min-w-0 flex-col gap-1 text-left leading-none">
        {renderLangRow("ENG", sop.files.docx.en, sop.files.pdf.en)}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 flex-col gap-1 text-left leading-none">
      {renderLangRow("ENG", sop.files.docx.en, sop.files.pdf.en)}
      {renderLangRow("GUJ", sop.files.docx.gu, sop.files.pdf.gu)}
    </div>
  );
}

function FileLink({
  filePath,
  label,
  isPdf,
}: {
  filePath: string;
  label: string;
  isPdf?: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const openPreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewOpen(true);
  }, []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);

  return (
    <>
      <div className="flex min-w-0 items-center gap-px overflow-hidden">
        <button
          type="button"
          className="min-w-0 truncate font-bold text-[9px] text-green-600 hover:underline cursor-pointer"
          onClick={openPreview}
          title={`Preview ${label}`}
        >
          {label}
        </button>
        <a
          href={buildPreviewHref(filePath)}
          download
          rel="noopener noreferrer"
          className="shrink-0 rounded p-px text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title={`Download ${label}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-2 w-2" />
        </a>
      </div>
      {previewOpen && (
        <DocPreviewModal
          filePath={filePath}
          label={label}
          isPdf={!!isPdf}
          onClose={closePreview}
        />
      )}
    </>
  );
}

/* ─── Prior versions cell ─────────────────────────────────────────────── */
const MAX_PRIOR_VERSIONS = 2;

type PriorVersion = RegistrySOP["priorVersions"][0];

function PriorVersionEntry({ pv }: { pv: PriorVersion }) {
  if (pv.missing) {
    return (
      <span className="inline-flex items-center gap-px leading-none whitespace-nowrap">
        <span className="text-[9px] font-bold text-gray-400 line-through">V{pv.version}</span>
        <span className="ml-0.5 text-[8px] italic text-amber-600">miss</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-px leading-none whitespace-nowrap">
      <span className="shrink-0 text-[9px] font-bold text-green-700">V{pv.version}</span>
      <span className="mx-0.5 shrink-0 text-[8px] font-bold">
        {pv.docx ? <FileLink filePath={pv.docx} label="DOCX" /> : <span className="text-red-500">DOCX</span>}
      </span>
      <span className="select-none text-[8px] text-gray-400">/</span>
      <span className="mx-0.5 shrink-0 text-[8px] font-bold">
        {pv.pdf ? <FileLink filePath={pv.pdf} label="PDF" isPdf /> : <span className="text-red-500">PDF</span>}
      </span>
    </span>
  );
}

/* Version slot width: wide enough for "V12 DOCX / PDF" at 8-9px font */
const PRIOR_SLOT_W = "6rem";
const PRIOR_LABEL_W = "2rem";

function PriorLangRow({ pvs, label }: { pvs: PriorVersion[]; label: string }) {
  if (pvs.length === 0) return null;
  const slots = Array.from({ length: MAX_PRIOR_VERSIONS }, (_, i) => pvs[i] ?? null);
  return (
    <div
      className="grid items-center leading-none"
      style={{ gridTemplateColumns: `${PRIOR_LABEL_W} repeat(${MAX_PRIOR_VERSIONS}, ${PRIOR_SLOT_W})` }}
    >
      <span className="text-[8px] font-bold uppercase text-gray-400 tabular-nums">{label}</span>
      {slots.map((pv, i) =>
        pv ? (
          <div key={`${pv.version}-${pv.language}`} style={{ width: PRIOR_SLOT_W }} className="overflow-hidden">
            <PriorVersionEntry pv={pv} />
          </div>
        ) : (
          <div key={i} style={{ width: PRIOR_SLOT_W }} />
        )
      )}
    </div>
  );
}

function sortPriorDesc(pvs: PriorVersion[]): PriorVersion[] {
  return [...pvs].sort((a, b) => (parseFloat(b.version) || 0) - (parseFloat(a.version) || 0));
}

function PriorVersionsCell({ sop }: { sop: RegistrySOP }) {
  if (sop.priorVersions.length === 0) {
    return <span className="text-[8px] text-gray-400">—</span>;
  }

  const isDual = sop.language === "ENG-GUJ";
  const all = sortPriorDesc(sop.priorVersions);

  if (isDual) {
    const eng = all.filter((pv) => pv.language === "ENG").slice(0, MAX_PRIOR_VERSIONS);
    const guj = all.filter((pv) => pv.language === "GUJ").slice(0, MAX_PRIOR_VERSIONS);
    return (
      <div className="flex flex-col gap-0.5">
        <PriorLangRow pvs={eng} label="ENG" />
        <PriorLangRow pvs={guj} label="GUJ" />
      </div>
    );
  }

  const langCode = sop.language === "GUJ" ? "GUJ" : "ENG";
  const label = langCode;
  // Include entries matching the SOP language, plus any untagged legacy entries
  const pvs = all
    .filter((pv) => pv.language === langCode || !pv.language)
    .slice(0, MAX_PRIOR_VERSIONS);
  return <PriorLangRow pvs={pvs} label={label} />;
}

/* ─── Shared helper: render media pills for one language row ─────────── */
function MediaLangRow({
  langLabel,
  urls,
  kind,
  noneLabel,
}: {
  langLabel: string;
  urls: string[];
  kind: "video" | "slide";
  noneLabel: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-1 text-left leading-none min-h-2.5 py-px">
      <span className="w-5 shrink-0 text-[8px] font-bold text-gray-500 mt-px">{langLabel}</span>
      {urls.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-0.5">
          {urls.map((url, i) => (
            <MediaPill key={url} url={url} langLabel={langLabel} index={i} kind={kind} />
          ))}
        </div>
      ) : (
        <span className="truncate text-[8px] font-semibold italic leading-none text-amber-600">{noneLabel}</span>
      )}
    </div>
  );
}

/* ─── Video cell ─────────────────────────────────────────────────────── */
function VideoCell({ sop, isDual }: { sop: RegistrySOP; isDual: boolean }) {
  const enUrls = sop.mediaUrls?.videos?.en ?? [];
  const guUrls = sop.mediaUrls?.videos?.gu ?? [];
  const allUrls = [...enUrls, ...guUrls];

  if (allUrls.length === 0 && !isDual) {
    return <span className="text-[10px] font-bold tabular-nums text-gray-400">0</span>;
  }

  if (!isDual) {
    return (
      <div className="flex min-w-0 flex-wrap gap-0.5">
        {allUrls.map((url, i) => (
          <MediaPill key={url} url={url} langLabel="ENG" index={i} kind="video" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 text-left leading-none">
      <MediaLangRow langLabel="ENG" urls={enUrls} kind="video" noneLabel="no video" />
      <MediaLangRow langLabel="GUJ" urls={guUrls} kind="video" noneLabel="no video" />
    </div>
  );
}

/* ─── Slides cell ────────────────────────────────────────────────────── */
function SlidesCell({ sop, isDual }: { sop: RegistrySOP; isDual: boolean }) {
  const enUrls = sop.mediaUrls?.slides?.en ?? [];
  const guUrls = sop.mediaUrls?.slides?.gu ?? [];
  const allUrls = [...enUrls, ...guUrls];

  if (allUrls.length === 0 && !isDual) {
    return <span className="text-[10px] font-bold tabular-nums text-gray-400">0</span>;
  }

  if (!isDual) {
    return (
      <div className="flex min-w-0 flex-wrap gap-0.5">
        {allUrls.map((url, i) => (
          <MediaPill key={url} url={url} langLabel="ENG" index={i} kind="slide" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 text-left leading-none">
      <MediaLangRow langLabel="ENG" urls={enUrls} kind="slide" noneLabel="no slides" />
      <MediaLangRow langLabel="GUJ" urls={guUrls} kind="slide" noneLabel="no slides" />
    </div>
  );
}
