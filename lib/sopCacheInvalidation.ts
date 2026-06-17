/* ─── SOP-derived cache invalidation ─────────────────────────────────────────
 * Single place that drops every cache whose contents are computed from SOP
 * data, so any SOP change in the dashboard (edit / delete / revive / create /
 * media upload / MCQ regeneration / reconcile) reflects instantly in:
 *   - the training matrix overview            (/training-matrix)
 *   - the induction training matrix overview  (/induction-training-matrix)
 *   - the manage-SOPs view                    (/training-matrix/manage-sop)
 *   - the LMS portal                          (shared journey content + journeys)
 *
 * This module must only be imported from server code (it pulls Mongoose models
 * transitively). It deliberately does NOT import server-cache so server-cache
 * can call it without a circular dependency.
 */
import { invalidateTrainingMatrixCache } from "@/lib/trainingMatrixCache";
import { invalidateInductionTrainingMatrixCache } from "@/lib/inductionTrainingMatrixCache";
import { invalidateManageSopViewCache } from "@/lib/manageSopViewCache";
import { invalidateLmsServerPrefix } from "@/lib/lmsCache";
import { invalidateEmployeeAssignmentsCache } from "@/lib/employeeAssignments";

/**
 * Invalidate every SOP-derived cache. In-memory caches are cleared
 * synchronously; durable MongoDB snapshots are marked stale best-effort and
 * fired-and-forgotten so callers stay synchronous and a cache hiccup never
 * fails the underlying write.
 */
export function invalidateSopDerivedCaches(): void {
  // LMS in-memory caches that embed SOP content: the shared per-SOP journey
  // content and every per-learner journey (keyed employeeId:sopCode). Both are
  // dropped so freshly edited media / names / file URLs surface on next load.
  invalidateLmsServerPrefix("lms:journey-content:");
  invalidateLmsServerPrefix("lms:journey:");

  // Employee→SOP assignment map embeds SOP display names and excludes obsolete
  // SOPs; the LMS admin training-status view and the employees page both read
  // it, so drop it and the admin caches that depend on it.
  invalidateEmployeeAssignmentsCache();
  invalidateLmsServerPrefix("lms:admin:");

  // Matrix + manage-SOPs overviews keep durable snapshots; their invalidators
  // are async (they touch MongoDB). Run them in the background.
  void Promise.allSettled([
    invalidateTrainingMatrixCache(),
    invalidateInductionTrainingMatrixCache(),
    invalidateManageSopViewCache(),
  ]);
}
