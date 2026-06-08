import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const envPath = path.join(process.cwd(), ".env.local");
const env = fs.readFileSync(envPath, "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)?.[1]?.trim();

if (!uri) {
  console.error("FAIL: MONGODB_URI not found in .env.local");
  process.exit(1);
}

const UserSchema = new mongoose.Schema(
  {
    username: String,
    passwordHash: String,
    name: String,
    email: String,
    role: String,
  },
  { strict: false },
);

try {
  await mongoose.connect(uri);
  const User = mongoose.model("User", UserSchema);
  const user = await User.findOne({ username: "admin" });

  if (!user) {
    console.error("FAIL: No user with username 'admin' found");
    process.exit(1);
  }

  if (!user.passwordHash) {
    console.error("FAIL: Admin user has no passwordHash field");
    process.exit(1);
  }

  const ok = await bcrypt.compare("admin123", user.passwordHash);
  if (!ok) {
    console.error("FAIL: Password admin123 does not match stored hash");
    process.exit(1);
  }

  console.log("OK: admin / admin123 verified in database");
  console.log("DB:", mongoose.connection.db.databaseName);
  console.log("Role:", user.role);
} catch (err) {
  console.error("FAIL:", err.message);
  process.exit(1);
} finally {
  await mongoose.disconnect();
}
