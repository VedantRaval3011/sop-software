import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { requireAuth } from "@/lib/withAuth";
import { sopFamilyGroupKey } from "@/lib/sop-utils";

const langCodeOf = (language: unknown): "EN" | "GU" =>
  String(language ?? "").toLowerCase() === "gujarati" ? "GU" : "EN";

// GET /api/mcq-bank/bank?id=<bankId>
// Uses native driver to preserve isChecked / isReviewed / isSimilar sub-doc fields.
// Also returns `siblings`: the same SOP family's banks keyed by language so the
// viewer can flip between the English and Gujarati versions of one SOP.
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

    // ── Sibling language banks (same SOP family) ──────────────────────────────
    // Family grouping is padding-insensitive, so compute the family key per bank
    // rather than matching identifiers literally. One entry per language.
    const famKey = sopFamilyGroupKey({ identifier: String(bank.sopIdentifier ?? "").trim() });
    const candidates = await col
      .find({ isObsolete: { $ne: true } }, { projection: { sopIdentifier: 1, language: 1 } })
      .toArray();

    const siblingByLang = new Map<"EN" | "GU", string>();
    for (const c of candidates) {
      const key = sopFamilyGroupKey({ identifier: String(c.sopIdentifier ?? "").trim() });
      if (key !== famKey) continue;
      const lc = langCodeOf(c.language);
      if (!siblingByLang.has(lc)) siblingByLang.set(lc, String(c._id));
    }
    // The requested bank always represents its own language.
    siblingByLang.set(langCodeOf(bank.language), String(bank._id));

    const siblings = [...siblingByLang.entries()].map(([langCode, bankId]) => ({ langCode, bankId }));

    return NextResponse.json({ success: true, bank, siblings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
