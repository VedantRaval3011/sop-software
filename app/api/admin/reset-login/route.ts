import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import { ensureDefaultAdmin } from "@/lib/ensure-admin";
import User from "@/models/User";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  try {
    await connectDB();
    const user = await ensureDefaultAdmin();
    const passwordOk = await bcrypt.compare("admin123", user.passwordHash);
    const count = await User.countDocuments();

    return NextResponse.json({
      ok: true,
      message: "Admin login reset. Use username: admin, password: admin123",
      username: user.username,
      role: user.role,
      passwordVerified: passwordOk,
      totalUsers: count,
    });
  } catch (error) {
    console.error("[reset-login]", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Reset failed",
      },
      { status: 500 },
    );
  }
}
