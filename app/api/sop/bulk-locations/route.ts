import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";
import { invalidateDashboardSopsCache } from "@/lib/cache";
import { requireAuth } from "@/lib/withAuth";

function parseLocationRows(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const rows: Array<{ identifier: string; location: string }> = [];

  for (const [index, line] of lines.entries()) {
    const parts = line.split(delimiter).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (index === 0 && /identifier|sop/i.test(parts[0]) && /location/i.test(parts[1] ?? "")) {
      continue;
    }
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    rows.push({ identifier: parts[0], location: parts[1] });
  }

  return rows;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  try {
    await connectDB();
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file?.size) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseLocationRows(text);
    if (!rows.length) {
      return NextResponse.json({ error: "No valid location rows found in file" }, { status: 400 });
    }

    const results: Array<{ identifier: string; success: boolean; error?: string }> = [];

    for (const row of rows) {
      const escaped = row.identifier.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      const group = await SOP.find({
        identifier: new RegExp(`^${escaped}$`, "i"),
      });

      if (!group.length) {
        results.push({
          identifier: row.identifier,
          success: false,
          error: "SOP not found",
        });
        continue;
      }

      await Promise.all(
        group.map((sop) => sop.updateOne({ location: row.location })),
      );
      results.push({ identifier: row.identifier, success: true });
    }

    if (results.some((r) => r.success)) {
      invalidateDashboardSopsCache();
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import locations" },
      { status: 500 },
    );
  }
}
