"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import type { DashboardStats, RegistrySOP } from "@/lib/types";
import {
  DASHBOARD_CACHE_KEY,
  DASHBOARD_STATS_CACHE_KEY,
  bustDashboardCache,
  readClientCache,
  writeClientCache,
} from "@/lib/cache";
import { useDashboardStore } from "@/lib/store/dashboard-store";
import { applyFilters, paginate } from "@/lib/sop-utils";
import { canMutate, isAdmin } from "@/lib/roles";
import type { AppRole } from "@/lib/auth";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardToolbar } from "./DashboardToolbar";
import { DepartmentCapsules } from "./DepartmentCapsules";
import { SOPRegistryTable } from "./SOPRegistryTable";
import { FilterSidebar } from "./FilterSidebar";
import { UploadSOPModal } from "./UploadModals";
import {
  BulkLocationUploadModal,
  BulkPdfUploadModal,
  BulkVideosSlidesModal,
  GujaratiFolderUploadModal,
  MigrateBunnyModal,
  SopFolderUploadModal,
} from "./BulkUploadModals";
import { PipelineDock, ToastNotification } from "./PipelineDock";
import { AdminToolsModal, ComplianceModal, GuidelinesPanel } from "./ExtraModals";

export function DashboardClient() {
  const { data: session } = useSession();
  const role = (session?.user?.role ?? "viewer") as AppRole;
  const userCanMutate = canMutate(role);
  const userIsAdmin = isAdmin(role);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [departmentList, setDepartmentList] = useState<string[]>([]);

  const handleDepartmentAdded = useCallback((name: string) => {
    setDepartmentList((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }, []);

  const handleDepartmentDeleted = useCallback((name: string) => {
    setDepartmentList((prev) => prev.filter((d) => d !== name));
  }, []);

  // The full grouped registry (active + obsolete). Fetched once and filtered
  // entirely on the client, so capsule/pill clicks update the table instantly
  // without a network round-trip per filter change.
  const [allItems, setAllItems] = useState<RegistrySOP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    filters,
    setFilter,
    uploadModalOpen,
    setUploadModalOpen,
    pdfUploadOpen,
    setPdfUploadOpen,
    folderUploadOpen,
    setFolderUploadOpen,
    gujaratiUploadOpen,
    setGujaratiUploadOpen,
    locationUploadOpen,
    setLocationUploadOpen,
    bunnyMigrateOpen,
    setBunnyMigrateOpen,
    videoUploadOpen,
    setVideoUploadOpen,
    complianceOpen,
    setComplianceOpen,
    adminOpen,
    setAdminOpen,
  } = useDashboardStore();

  // Derived view: filter + sort + paginate the cached registry locally. This runs
  // in a few ms even for the whole collection, so every capsule/pill/department
  // click is instant.
  const { items, total } = useMemo(() => {
    const filtered = applyFilters(allItems, filters);
    return paginate(filtered, filters.page, filters.limit);
  }, [allItems, filters]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/sops/stats?_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Stats fetch failed: ${res.status}`);
      const data = await res.json();
      setStats(data);
      setDepartmentList(data.departmentList ?? []);
      writeClientCache(DASHBOARD_STATS_CACHE_KEY, "stats", data);
    } catch (e) {
      console.error("fetchStats error:", e);
    }
  }, []);

  const fetchSops = useCallback(async () => {
    setError(null);
    // Stale-while-revalidate: paint the cached registry instantly, then refetch
    // the full set once in the background. All filtering happens client-side.
    const cached = readClientCache<RegistrySOP[]>(DASHBOARD_CACHE_KEY, "all");
    if (cached) {
      setAllItems(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/sops?all=1`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to load SOPs");
      }
      const data = await res.json();
      setAllItems(data.items);
      writeClientCache(DASHBOARD_CACHE_KEY, "all", data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      if (!cached) {
        setAllItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    bustDashboardCache();
    await Promise.allSettled([fetchStats(), fetchSops()]);
  }, [fetchStats, fetchSops]);

  useEffect(() => {
    const cachedStats = readClientCache<DashboardStats & { departmentList?: string[] }>(
      DASHBOARD_STATS_CACHE_KEY,
      "stats",
    );
    if (cachedStats) {
      setStats(cachedStats);
      setDepartmentList(cachedStats.departmentList ?? []);
    }
    fetchStats().catch((e) => setError(e.message));
  }, [fetchStats]);

  useEffect(() => {
    fetchSops();
  }, [fetchSops]);

  const handleSort = (field: string) => {
    setFilter({
      sortBy: field,
      sortDir:
        filters.sortBy === field && filters.sortDir === "asc" ? "desc" : "asc",
    });
  };

  const handleExport = () => {
    const headers = [
      "SOP No",
      "Version",
      "Name",
      "Department",
      "Location",
      "Language",
      "Expiry",
      "Uploaded",
    ];
    const rows = items.map((s) =>
      [
        s.identifier,
        s.version,
        `"${s.name.replace(/"/g, '""')}"`,
        s.department,
        s.location ?? "",
        s.language,
        s.expiryDate ?? "",
        s.uploadedAt,
      ].join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sop-registry.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-[#f8f9fa] text-gray-800">
      <DashboardHeader
        stats={stats}
        onExpiryFilter={(tier) => setFilter({ expiry: tier })}
      />
      <DashboardToolbar
        stats={stats}
        onRefresh={refresh}
        onExport={handleExport}
        canMutate={userCanMutate}
        isAdmin={userIsAdmin}
      />

      {error && (
        <div className="mx-4 mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
          {error.includes("MONGODB_URI") && (
            <span>
              {" "}
              — Create a <code className="rounded bg-red-100 px-1">.env.local</code> file with
              your MongoDB connection string.
            </span>
          )}
        </div>
      )}

      {stats && (
        <DepartmentCapsules
          capsules={stats.departments}
          onDepartmentAdded={handleDepartmentAdded}
          onDepartmentDeleted={handleDepartmentDeleted}
        />
      )}

      <div id="sop-registry">
        <SOPRegistryTable
          items={items}
          total={total}
          loading={loading}
          departments={departmentList}
          onSort={handleSort}
          onRefresh={refresh}
          canMutate={userCanMutate}
        />
      </div>

      <FilterSidebar sops={items} />
      <GuidelinesPanel />

      <UploadSOPModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onSuccess={refresh}
        departmentList={departmentList}
      />
      <SopFolderUploadModal
        open={folderUploadOpen}
        onClose={() => setFolderUploadOpen(false)}
        onSuccess={refresh}
      />
      <GujaratiFolderUploadModal
        open={gujaratiUploadOpen}
        onClose={() => setGujaratiUploadOpen(false)}
        onSuccess={refresh}
      />
      <BulkPdfUploadModal
        open={pdfUploadOpen}
        onClose={() => setPdfUploadOpen(false)}
        onSuccess={refresh}
      />
      <BulkLocationUploadModal
        open={locationUploadOpen}
        onClose={() => setLocationUploadOpen(false)}
        onSuccess={refresh}
      />
      <BulkVideosSlidesModal
        open={videoUploadOpen}
        onClose={() => setVideoUploadOpen(false)}
        onSuccess={refresh}
      />
      <MigrateBunnyModal
        open={bunnyMigrateOpen}
        onClose={() => setBunnyMigrateOpen(false)}
        onSuccess={refresh}
        isAdmin={userIsAdmin}
      />

      <ComplianceModal
        open={complianceOpen}
        onClose={() => setComplianceOpen(false)}
        sops={items}
        onComplete={refresh}
      />
      <AdminToolsModal
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        onSuccess={refresh}
        isAdmin={userIsAdmin}
      />
      <PipelineDock onComplete={refresh} />
      <ToastNotification />
    </div>
  );
}
