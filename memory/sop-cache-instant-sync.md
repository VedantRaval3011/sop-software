---
name: sop-cache-instant-sync
description: SOP edits must reflect instantly across dashboard, training matrices, manage-sops, and LMS portal
metadata:
  type: project
---

The user requires that any SOP data change in the dashboard reflect instantly in the training matrix, induction training matrix, training-matrix/manage-sop view, and the LMS portal.

Every SOP mutation routes through `invalidateDashboardSopsCache()` in [lib/server-cache.ts](../lib/server-cache.ts). That function now also calls `invalidateSopDerivedCaches()` in [lib/sopCacheInvalidation.ts](../lib/sopCacheInvalidation.ts), which busts: trainingMatrixCache, inductionTrainingMatrixCache, manageSopViewCache, LMS server caches (`lms:journey-content:`, `lms:journey:`, `lms:admin:`), and the employee assignments cache.

**Why:** Before this, SOP edits only cleared the dashboard/registry cache; the other caches stayed stale until their TTLs (30s–5min) expired.

**How to apply:** Any new SOP-derived cache must be wired into `invalidateSopDerivedCaches()`. Any new SOP-mutating route must call `invalidateDashboardSopsCache()` (or `bustServerDashboardCache()`). Note: training-matrix overview and manage-sop-view use stale-while-revalidate, so they serve one stale response then rebuild in the background (~1-2s) — not byte-for-byte instant on the very first load after an edit.
