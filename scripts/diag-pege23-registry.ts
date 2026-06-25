/** Read-only: run the real registry build + version filter on the PEGE23 family. */
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
  const records: any[] = await col.find({ identifier: { $regex: /^PEGE23/i } }).toArray();

  const { groupSOPRecords, applyFilters } = await import("@/lib/sop-utils");
  const registry = groupSOPRecords(records as any);

  for (const s of registry) {
    console.log("identifier      :", s.identifier);
    console.log("version (current):", s.version);
    console.log("language        :", s.language);
    console.log("files.docx      :", JSON.stringify(s.files.docx));
    console.log("files.pdf       :", JSON.stringify(s.files.pdf));
    console.log("priorVersions   :");
    for (const pv of s.priorVersions) {
      console.log(
        `   v${pv.version} [${pv.language}] docx=${pv.docx ? "Y" : "-"} pdf=${pv.pdf ? "Y" : "-"} missing=${pv.missing ?? false}`,
      );
    }
  }

  const missing = applyFilters(registry, { versionStatus: "missing" } as any);
  console.log("\nAppears in 'Versions Missing' filter:", missing.length > 0);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
