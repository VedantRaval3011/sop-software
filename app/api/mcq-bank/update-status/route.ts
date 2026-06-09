import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { requireAuth } from "@/lib/withAuth";

// PATCH /api/mcq-bank/update-status
// Body: { bankId, index, field: "isChecked"|"isReviewed"|"isSimilar", value: boolean }
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const body = await request.json();
    const { bankId, index, field, value } = body;

    if (!bankId || typeof index !== "number" || !field || typeof value !== "boolean") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const allowed = ["isChecked", "isReviewed", "isSimilar"];
    if (!allowed.includes(field)) {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }

    const col = db.collection("mcqbanks");
    const result = await col.updateOne(
      { _id: new mongoose.Types.ObjectId(bankId) },
      { $set: { [`mcqs.${index}.${field}`]: value } },
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Bank not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, field, index, value });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
