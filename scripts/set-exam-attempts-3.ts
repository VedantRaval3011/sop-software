/** One-time: allocate 3 total exam attempts (was unlimited). */
import fs from "fs";
import mongoose from "mongoose";
function loadEnv() {
  const env = fs.readFileSync(".env.local", "utf8");
  for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
}
(async () => {
  loadEnv();
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.collection("examsettings");
  const res = await col.updateOne(
    { settingsKey: "global" },
    { $set: { maxAttempts: 3, updatedAt: new Date() } },
    { upsert: true },
  );
  const d = await col.findOne({ settingsKey: "global" });
  console.log("modified:", res.modifiedCount, "now maxAttempts:", d?.maxAttempts);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
