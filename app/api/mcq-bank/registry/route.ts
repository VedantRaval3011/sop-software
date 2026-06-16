import { NextRequest, NextResponse } from "next/server";
import type { PipelineStage } from "mongoose";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { requireAuth } from "@/lib/withAuth";
import { getGroupedRegistryRows } from "@/lib/dashboardRegistrySource";
import { sopFamilyGroupKey } from "@/lib/sop-utils";

export const dynamic = "force-dynamic";

// ── Subcategory prefix → canonical department (aligned with mcq-bank/stats) ──
const SUBCAT_TO_DEPT: Record<string, string> = {
  QAGE: "QA", ANNE: "QA",
  QCGE: "QC", QAIC: "QC", QAIO: "QC",
  QAMI: "Microbiology", QCMI: "Microbiology",
  PRAA: "Production", PRCL: "Production", PRED: "Production",
  PREO: "Production", PREP: "Production", PRGE: "Production",
  PRMA: "Production", PRPA: "Production",
  BSGE: "Store", STCL: "Store", STGE: "Store",
  STOP: "Store", STPA: "Store", STRM: "Store",
  MAGE: "Engineering and Maintenance", PREG: "Engineering and Maintenance",
  PEGE: "Personnel",
};

function deptFromIdentifier(id?: string | null): string {
  if (!id) return "Other";
  const up = id.toUpperCase().trim();
  const m = up.match(/^([A-Z]{2,6})\d/);
  if (m && SUBCAT_TO_DEPT[m[1]]) return SUBCAT_TO_DEPT[m[1]];
  for (let len = 6; len >= 2; len--) {
    if (SUBCAT_TO_DEPT[up.slice(0, len)]) return SUBCAT_TO_DEPT[up.slice(0, len)];
  }
  return "Other";
}

function normalizeDept(raw?: string | null): string {
  if (!raw) return "Other";
  const l = raw.toLowerCase().trim();
  if (l === "qa" || l.includes("quality assurance")) return "QA";
  if (l === "qc" || l.includes("quality control")) return "QC";
  if (l.includes("micro")) return "Microbiology";
  if (/engineer|maint/.test(l)) return "Engineering and Maintenance";
  if (l.includes("person") || l.includes("hr")) return "Personnel";
  if (l.includes("store")) return "Store";
  if (l.includes("prod")) return "Production";
  return "Other";
}

function resolveDept(identifier: string, stored?: string | null): string {
  const fromId = deptFromIdentifier(identifier);
  if (fromId !== "Other") return fromId;
  return normalizeDept(stored);
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const difficulty = searchParams.get("difficulty") ?? "all";
    const languageFilter = searchParams.get("language") ?? "all";
    const deptFilter = searchParams.get("dept") ?? "all";
    const sortBy = searchParams.get("sortBy") ?? "identifier";
    const sortDir = searchParams.get("sortDir") ?? "asc";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit = Math.min(200, Math.max(10, parseInt(searchParams.get("limit") ?? "50")));

    // ── 1. SOP universe = the SAME grouped families the Main Dashboard shows ──
    // One row per SOP family (ENG+GUJ collapsed, version-collapsed). Sourcing the
    // row set from here is what guarantees the MCQ Registry total always equals the
    // Main Dashboard SOP count.
    const grouped = (await getGroupedRegistryRows()).filter((r) => !r.isObsolete);

    // ── 2. Aggregate MCQ banks, keyed by SOP family ──────────────────────────
    const mcqBankCol = db.collection("mcqbanks");
    const pipeline: PipelineStage[] = [
      { $match: { isObsolete: { $ne: true } } } as PipelineStage,
      {
        $project: {
          sopIdentifier: 1,
          language: 1,
          updatedAt: 1,
          totalQuestions: { $size: { $ifNull: ["$mcqs", []] } },
          checkedCount: {
            $size: { $filter: { input: { $ifNull: ["$mcqs", []] }, as: "q", cond: { $eq: ["$$q.isChecked", true] } } },
          },
          reviewedCount: {
            $size: { $filter: { input: { $ifNull: ["$mcqs", []] }, as: "q", cond: { $eq: ["$$q.isReviewed", true] } } },
          },
          similarCount: {
            $size: { $filter: { input: { $ifNull: ["$mcqs", []] }, as: "q", cond: { $eq: ["$$q.isSimilar", true] } } },
          },
          ...(difficulty !== "all"
            ? {
                filteredCount: {
                  $size: {
                    $filter: {
                      input: { $ifNull: ["$mcqs", []] },
                      as: "q",
                      cond: { $eq: ["$$q.difficulty", difficulty.charAt(0).toUpperCase() + difficulty.slice(1)] },
                    },
                  },
                },
              }
            : {}),
        },
      } as PipelineStage,
    ];

    const rawBanks = await mcqBankCol.aggregate(pipeline).toArray() as {
      _id: unknown; sopIdentifier: string; language: string;
      totalQuestions: number; checkedCount: number; reviewedCount: number; similarCount: number;
      filteredCount?: number; updatedAt?: Date;
    }[];

    interface FamilyBank {
      totalQ: number; checkedQ: number; reviewedQ: number; similarQ: number;
      difficultyMatches: number;
      lastUpdated: Date | null;
      banks: { id: string; langCode: "ENG" | "GUJ" }[];
    }
    const banksByFamily = new Map<string, FamilyBank>();

    for (const b of rawBanks) {
      const fam = sopFamilyGroupKey({ identifier: (b.sopIdentifier ?? "").trim() });
      if (!banksByFamily.has(fam)) {
        banksByFamily.set(fam, {
          totalQ: 0, checkedQ: 0, reviewedQ: 0, similarQ: 0,
          difficultyMatches: 0, lastUpdated: null, banks: [],
        });
      }
      const e = banksByFamily.get(fam)!;
      e.totalQ += b.totalQuestions;
      e.checkedQ += b.checkedCount;
      e.reviewedQ += b.reviewedCount;
      e.similarQ += b.similarCount;
      e.difficultyMatches += b.filteredCount ?? 0;
      const langCode: "ENG" | "GUJ" = (b.language ?? "").toLowerCase() === "gujarati" ? "GUJ" : "ENG";
      if (b._id) e.banks.push({ id: String(b._id), langCode });
      const ts = b.updatedAt ? new Date(b.updatedAt) : null;
      if (ts && (!e.lastUpdated || ts > e.lastUpdated)) e.lastUpdated = ts;
    }

    // ── 3. Build one registry row per SOP family ─────────────────────────────
    type RegistryEntry = {
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
      lastUpdated: Date | null;
      banks: { id: string; langCode: "ENG" | "GUJ" }[];
    };

    let entries: RegistryEntry[] = grouped.map((row) => {
      const fam = sopFamilyGroupKey(row);
      const bank = banksByFamily.get(fam);
      const dept = resolveDept(row.identifier, row.department);
      return {
        id: fam,
        identifier: row.identifier,
        sopName: row.name,
        sopNameGujarati: row.nameGujarati ?? null,
        department: dept,
        language: row.language,
        langCode: row.language === "GUJ" ? "GUJ" : "ENG",
        totalMcqs: bank?.totalQ ?? 0,
        remaining: bank ? Math.max(0, bank.totalQ - bank.checkedQ) : 0,
        approved: bank?.checkedQ ?? 0,
        partial: bank?.reviewedQ ?? 0,
        similar: bank?.similarQ ?? 0,
        lastUpdated: bank?.lastUpdated ?? null,
        banks: bank?.banks ?? [],
      };
    });

    // ── 4. Filters ───────────────────────────────────────────────────────────
    if (deptFilter !== "all") {
      entries = entries.filter((e) => e.department === deptFilter);
    }
    if (languageFilter !== "all") {
      // ENG matches English-bearing families (ENG, ENG-GUJ); GUJ matches GUJ, ENG-GUJ.
      entries = entries.filter((e) =>
        languageFilter === "ENG"
          ? e.language === "ENG" || e.language === "ENG-GUJ"
          : e.language === "GUJ" || e.language === "ENG-GUJ",
      );
    }
    if (search) {
      const lc = search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.identifier.toLowerCase().includes(lc) ||
          e.sopName.toLowerCase().includes(lc) ||
          (e.sopNameGujarati ?? "").toLowerCase().includes(lc),
      );
    }
    if (difficulty !== "all") {
      // Only families with at least one MCQ of the requested difficulty.
      entries = entries.filter((e) => {
        const bank = banksByFamily.get(e.id);
        return (bank?.difficultyMatches ?? 0) > 0;
      });
    }

    // ── 5. Sort ──────────────────────────────────────────────────────────────
    entries.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = a.sopName.localeCompare(b.sopName);
      else if (sortBy === "questions" || sortBy === "totalMcqs") cmp = b.totalMcqs - a.totalMcqs;
      else if (sortBy === "remaining") cmp = b.remaining - a.remaining;
      else if (sortBy === "approved") cmp = b.approved - a.approved;
      else if (sortBy === "partial") cmp = b.partial - a.partial;
      else if (sortBy === "similar") cmp = b.similar - a.similar;
      else if (sortBy === "lastUpdated" || sortBy === "date") {
        cmp = (b.lastUpdated?.getTime() ?? 0) - (a.lastUpdated?.getTime() ?? 0);
      } else cmp = a.identifier.localeCompare(b.identifier);
      return sortDir === "desc" ? -cmp : cmp;
    });

    const total = entries.length;
    const paginated = entries.slice((page - 1) * limit, page * limit);

    return NextResponse.json({ items: paginated, total, page, limit });
  } catch (error) {
    console.error("[mcq-bank/registry] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch registry" },
      { status: 500 },
    );
  }
}
