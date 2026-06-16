import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import User from "@/models/User";
import { requireAuth } from "@/lib/withAuth";
import { getGroupedRegistryRows } from "@/lib/dashboardRegistrySource";
import { sopFamilyGroupKey } from "@/lib/sop-utils";
import {
  aggregateMcqBanksByFamily,
  buildActiveSopFamilyMap,
  findObsoleteMcqFamilies,
  mcqResolveDept,
} from "@/lib/mcq-bank-utils";

// GET /api/mcq-bank/dept-sops?dept=QA
export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const { searchParams } = new URL(request.url);
    const dept = searchParams.get("dept");
    if (!dept) return NextResponse.json({ error: "dept required" }, { status: 400 });

    const mcqBankCol = db.collection("mcqbanks");

    // Fetch all banks (summary mode — no mcqs content, just counts)
    const allBanks = await mcqBankCol.aggregate([
      { $match: { isObsolete: { $ne: true } } },
      {
        $project: {
          _id: 1,
          sopId: 1,
          sopIdentifier: 1,
          sopName: 1,
          department: 1,
          language: 1,
          updatedAt: 1,
          totalQuestions: { $size: { $ifNull: ["$mcqs", []] } },
          checkedCount: {
            $size: {
              $filter: { input: { $ifNull: ["$mcqs", []] }, as: "q", cond: { $eq: ["$$q.isChecked", true] } },
            },
          },
          reviewedCount: {
            $size: {
              $filter: { input: { $ifNull: ["$mcqs", []] }, as: "q", cond: { $eq: ["$$q.isReviewed", true] } },
            },
          },
          similarCount: {
            $size: {
              $filter: { input: { $ifNull: ["$mcqs", []] }, as: "q", cond: { $eq: ["$$q.isSimilar", true] } },
            },
          },
        },
      },
      { $sort: { sopIdentifier: 1 } },
    ]).toArray() as {
      _id: unknown; sopId: unknown; sopIdentifier: string; sopName: string;
      department: string; language: string; updatedAt?: Date;
      totalQuestions: number; checkedCount: number; reviewedCount: number; similarCount: number;
    }[];

    const groupedRegistry = await getGroupedRegistryRows();
    const activeFamilyMap = buildActiveSopFamilyMap(groupedRegistry);
    const mcqFamilies = aggregateMcqBanksByFamily(allBanks as never[]);
    const orphanFamKeys = new Set(
      findObsoleteMcqFamilies(activeFamilyMap, mcqFamilies).map((f) => f.famKey),
    );

    const deptBanks = allBanks.filter((b) => {
      const famKey = sopFamilyGroupKey({ identifier: (b.sopIdentifier ?? "").trim() });
      if (orphanFamKeys.has(famKey)) return false;
      return mcqResolveDept(b.sopIdentifier ?? "", b.department) === dept;
    });

    // Fetch SOP docs for trainer info
    const sopIds: string[] = [...new Set(
      deptBanks.map((b) => b.sopId?.toString()).filter((id): id is string => Boolean(id))
    )];
    const [sops, trainers] = await Promise.all([
      sopIds.length
        ? SOP.find({ _id: { $in: sopIds } })
            .select("_id identifier name assignedTrainers")
            .populate("assignedTrainers", "name")
            .lean()
        : [],
      User.find({ role: "trainer" }).select("name department").lean(),
    ]);

    const sopMap = new Map(sops.map((s: any) => [String(s._id), s]));
    const trainerByDept = new Map<string, string>();
    for (const t of trainers) {
      if (t.department && !trainerByDept.has(t.department)) trainerByDept.set(t.department, t.name);
    }

    // Group by sopIdentifier (merge EN + GU into one entry)
    const grouped = new Map<string, {
      sopId: string; sopCode: string; sopName: string;
      department: string; trainerName: string;
      totalQuestions: number; checkedCount: number; reviewedCount: number; similarCount: number;
      mcqBanks: { id: string; language: string }[];
      lastUpdated: Date | null;
    }>();

    for (const b of deptBanks) {
      const key = b.sopIdentifier?.trim().toUpperCase() ?? String(b._id);
      if (!grouped.has(key)) {
        const sopDoc = b.sopId ? sopMap.get(String(b.sopId)) : null;
        const trainersOnSop: string[] = (sopDoc as any)?.assignedTrainers?.map((t: any) => t.name) ?? [];
        const trainerName = trainersOnSop.length > 0
          ? trainersOnSop.join(", ")
          : trainerByDept.get(dept) ?? "";

        grouped.set(key, {
          sopId: String(b.sopId ?? b._id),
          sopCode: b.sopIdentifier ?? key,
          sopName: b.sopName ?? "",
          department: dept,
          trainerName,
          totalQuestions: 0, checkedCount: 0, reviewedCount: 0, similarCount: 0,
          mcqBanks: [],
          lastUpdated: null,
        });
      }
      const g = grouped.get(key)!;
      g.totalQuestions += b.totalQuestions;
      g.checkedCount   += b.checkedCount;
      g.reviewedCount  += b.reviewedCount;
      g.similarCount   += b.similarCount;
      g.mcqBanks.push({ id: String(b._id), language: b.language ?? "English" });
      if (b.updatedAt && (!g.lastUpdated || b.updatedAt > g.lastUpdated)) {
        g.lastUpdated = b.updatedAt;
      }
    }

    const sopList = Array.from(grouped.values()).sort((a, b) =>
      a.sopCode.localeCompare(b.sopCode),
    );

    // Aggregate dept totals
    const totalQuestions  = sopList.reduce((s, r) => s + r.totalQuestions, 0);
    const checkedCount    = sopList.reduce((s, r) => s + r.checkedCount, 0);
    const reviewedCount   = sopList.reduce((s, r) => s + r.reviewedCount, 0);
    const similarCount    = sopList.reduce((s, r) => s + r.similarCount, 0);
    const notChecked      = Math.max(0, totalQuestions - checkedCount);

    return NextResponse.json({
      success: true,
      dept,
      sops: sopList,
      total: sopList.length,
      stats: { totalQuestions, checkedCount, reviewedCount, similarCount, notChecked },
      trainer: trainerByDept.get(dept) ?? null,
    });
  } catch (error) {
    console.error("[dept-sops] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
