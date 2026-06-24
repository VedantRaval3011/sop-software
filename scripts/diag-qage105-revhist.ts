/** Read-only: confirm sopBaseId/versionNum grouping + show where v4's date lives in v5/v6 revision history. */
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
  const col = mongoose.connection.collection("sops");
  const recs = await col.find({ identifier: { $regex: /^QAGE105/i } }).toArray();

  console.log("Grouping keys:");
  for (const r of recs as any[]) {
    console.log(`  ${String(r.identifier).padEnd(12)} ${String(r.fileType).padEnd(4)} base=${r.sopBaseId} vNum=${r.versionNum}`);
  }

  const v5: any = await col.findOne({ identifier: "QAGE105-05", fileType: "docx" });
  if (v5?.content) {
    const c: string = v5.content;
    const idx = c.search(/revision\s*history|date\s*of\s*revision/i);
    console.log("\nv5 revision-history region:");
    console.log(idx >= 0 ? c.slice(idx, idx + 500) : "(no revision history section found)");
  }
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
