import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { requireAuth } from "@/lib/withAuth";

// GET /api/mcq-bank/bank?id=<bankId>
// Uses native driver to preserve isChecked / isReviewed / isSimilar sub-doc fields
export async function GET(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer", "viewer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const col = db.collection("mcqbanks");
    const bank = await col.findOne({ _id: new mongoose.Types.ObjectId(id) });

    if (!bank) return NextResponse.json({ error: "Bank not found" }, { status: 404 });

    // Fix stale totalQuestions
    if (Array.isArray(bank.mcqs)) bank.totalQuestions = bank.mcqs.length;

    return NextResponse.json({ success: true, bank });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
