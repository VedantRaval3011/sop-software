import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import SOP from "@/models/SOP";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const { name } = await request.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: "Department name required" }, { status: 400 });
    }
    const exists = await SOP.findOne({ department: name.trim() });
    if (exists) {
      return NextResponse.json({ department: name.trim(), created: false });
    }
    return NextResponse.json({ department: name.trim(), created: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add department" },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    await connectDB();
    const departments = await SOP.distinct("department");
    return NextResponse.json({ departments: departments.sort() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch departments" },
      { status: 500 },
    );
  }
}
