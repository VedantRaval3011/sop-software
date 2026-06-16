import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import { requireAuth } from "@/lib/withAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAuth(["admin"]);
  if (auth.error) return auth.error;

  await connectDB();

  const before = await SOP.collection.indexes();

  await SOP.syncIndexes();

  const after = await SOP.collection.indexes();

  console.log("[sync-indexes] Indexes before:", before.map((i) => i.name));
  console.log("[sync-indexes] Indexes after:", after.map((i) => i.name));

  return NextResponse.json({
    before: before.map((i) => ({ name: i.name, key: i.key })),
    after: after.map((i) => ({ name: i.name, key: i.key })),
  });
}
