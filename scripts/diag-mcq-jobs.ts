import fs from "fs";
import mongoose from "mongoose";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const env = fs.readFileSync(file, "utf8");
      for (const line of env.split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      }
      return;
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  loadEnv();
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.collection("mcqgenjobs");
  const all = await col.find({}).sort({ updatedAt: -1 }).limit(20).toArray();
  console.log("Recent MCQGenJob records:");
  for (const j of all) {
    console.log(
      `  ${j.identifier} | status=${j.status} | cancel=${j.cancelRequested} | phase=${j.phase} | updated=${j.updatedAt}`,
    );
  }
  const active = await col.find({ status: { $in: ["queued", "running"] } }).toArray();
  console.log(`\nActive (queued/running): ${active.length}`);
  for (const j of active) {
    console.log(`  ${j.identifier} | ${j.status} | cancel=${j.cancelRequested}`);
  }
  await mongoose.disconnect();
}

main().catch(console.error);
