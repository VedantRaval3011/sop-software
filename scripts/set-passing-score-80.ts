/** One-time: raise the global LMS passing score from 70 to 80. */
import fs from "fs";
import mongoose from "mongoose";

function loadEnv() {
  const env = fs.readFileSync(".env.local", "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  loadEnv();
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.collection("examsettings");
  const res = await col.updateOne(
    { settingsKey: "global", passingScore: 70 },
    { $set: { passingScore: 80, updatedAt: new Date() } },
  );
  const doc = await col.findOne({ settingsKey: "global" });
  console.log("matched:", res.matchedCount, "modified:", res.modifiedCount);
  console.log("now:", { passingScore: doc?.passingScore });
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
