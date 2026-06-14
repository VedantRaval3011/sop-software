"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  ExternalLink,
  FileText,
  HardDrive,
  Home,
  RefreshCw,
  Search,
} from "lucide-react";
import type { BunnyFileEntry, BunnyFilesReport } from "@/lib/bunny-files-report";
import type { AppRole } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { Badge, Btn } from "@/components/dashboard/ui";

const PAGE_SIZE = 50;

function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BunnyFilesClient() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = (session?.user?.role ?? "viewer") as AppRole;
  const userIsAdmin = isAdmin(role);

  const [allFiles, setAllFiles] = useState<BunnyFileEntry[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFiles = useCallback(async (refresh = false) => {
    setError(null);
    setLoading(true);
    setElapsedSec(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);

    try {
      const params = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/admin/bunny-files${params}`, { cache: "no-store" });
      const data = (await res.json()) as BunnyFilesReport & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load Bunny files");
      setAllFiles(data.files ?? []);
      setTotalFiles(data.totalFiles ?? data.files?.length ?? 0);
      setTruncated(Boolean(data.truncated));
      setCached(Boolean(data.cached));
      setScannedAt(data.scannedAt ?? null);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setAllFiles([]);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!userIsAdmin) {
      setLoading(false);
      return;
    }
    fetchFiles();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, userIsAdmin, fetchFiles]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allFiles;
    return allFiles.filter(
      (file) =>
        file.path.toLowerCase().includes(q) ||
        file.fileName.toLowerCase().includes(q) ||
        file.extension.toLowerCase().includes(q) ||
        file.folder.toLowerCase().includes(q),
    );
  }, [allFiles, search]);

  const totalPages = Math.max(1, Math.ceil(filteredFiles.length / PAGE_SIZE));
  const pageFiles = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredFiles.slice(start, start + PAGE_SIZE);
  }, [filteredFiles, page]);

  const filteredSize = useMemo(
    () => filteredFiles.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0),
    [filteredFiles],
  );

  useEffect(() => {
    setPage(1);
  }, [search]);

  const copyUrl = async (file: BunnyFileEntry) => {
    try {
      await navigator.clipboard.writeText(file.cdnUrl);
      setCopiedPath(file.path);
      window.setTimeout(() => setCopiedPath((cur) => (cur === file.path ? null : cur)), 2000);
    } catch {
      setError("Could not copy URL to clipboard");
    }
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] text-sm text-slate-600">
        Loading…
      </div>
    );
  }

  if (!userIsAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#f8f9fa] px-4 text-center">
        <p className="text-sm font-medium text-slate-700">Admin access required to browse Bunny storage.</p>
        <Btn onClick={() => router.push("/dashboard")}>
          <Home className="h-3 w-3" /> Back to Dashboard
        </Btn>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-800">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500">
              <Cloud className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-gray-900">Bunny Files</h1>
              <p className="text-[10px] text-gray-600">All files in Bunny storage — searchable flat list</p>
            </div>
          </div>

          <Btn onClick={() => fetchFiles(true)} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            {loading ? `Indexing… ${elapsedSec}s` : "Refresh"}
          </Btn>
        </div>
      </header>

      <main className="mx-auto max-w-[1920px] px-4 py-4">
        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {truncated && !loading && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Indexing stopped early because the storage zone is very large. Use search to find specific files.
          </div>
        )}

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<FileText className="h-4 w-4 text-sky-600" />} label="Total files" value={loading ? "—" : String(totalFiles)} />
          <StatCard icon={<Search className="h-4 w-4 text-emerald-600" />} label="Matching search" value={loading ? "—" : String(filteredFiles.length)} />
          <StatCard icon={<HardDrive className="h-4 w-4 text-orange-600" />} label="Filtered size" value={loading ? "—" : formatBytes(filteredSize)} />
          <StatCard icon={<Cloud className="h-4 w-4 text-violet-600" />} label="Index" value={loading ? "Building…" : cached ? "Cached" : "Fresh"} />
        </div>

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading}
              placeholder="Search by file name, path, extension, or folder…"
              className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none disabled:bg-slate-50"
            />
          </div>
          {search && !loading && (
            <p className="mt-2 text-[10px] text-slate-500">
              Showing {filteredFiles.length} of {totalFiles} files matching &ldquo;{search}&rdquo;
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">File name</th>
                  <th className="px-3 py-2.5">Full path</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Size</th>
                  <th className="px-3 py-2.5">Last changed</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                      Indexing all Bunny storage files… this may take 20–40 seconds on first load.
                      {elapsedSec > 0 && <span className="mt-1 block text-[10px]">Elapsed: {elapsedSec}s</span>}
                    </td>
                  </tr>
                ) : pageFiles.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                      {search ? `No files match "${search}".` : "No files found in Bunny storage."}
                    </td>
                  </tr>
                ) : (
                  pageFiles.map((file) => (
                    <tr key={file.path} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2 font-medium text-slate-800">{file.fileName}</td>
                      <td className="max-w-[400px] truncate px-3 py-2 font-mono text-[10px] text-slate-600" title={file.path}>
                        {file.path}
                      </td>
                      <td className="px-3 py-2">
                        {file.extension ? <Badge variant="blue">{file.extension}</Badge> : <Badge variant="gray">file</Badge>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{formatBytes(file.sizeBytes)}</td>
                      <td className="px-3 py-2 text-slate-600">{formatDate(file.lastChanged)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={file.cdnUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </a>
                          <button
                            type="button"
                            onClick={() => copyUrl(file)}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Copy className="h-3 w-3" />
                            {copiedPath === file.path ? "Copied" : "Copy URL"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && filteredFiles.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-[11px] text-slate-600">
              <span>
                Page {page} of {totalPages} ({filteredFiles.length} files)
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 p-1 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded border border-slate-200 p-1 disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {scannedAt && !loading && (
          <p className="mt-3 text-[10px] text-slate-500">
            Last indexed {formatDate(scannedAt)}
            {cached ? " (cached — click Refresh to rescan)" : ""}
          </p>
        )}
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div className="truncate text-lg font-bold text-slate-800" title={value}>
        {value}
      </div>
    </div>
  );
}
