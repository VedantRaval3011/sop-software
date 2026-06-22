/** Read-only diagnostic: inspect MAGE20 family + mangled MAGE20-CLEANING* records. */
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

  // Anything whose identifier mentions MAGE20 or starts MAGE2 (to catch MAGE2x too)
  const records = await col
    .find({ identifier: { $regex: /^MAGE2/i } })
    .toArray();

  console.log(`Found ${records.length} records matching ^MAGE2\n`);
  const rows = records
    .map((r: any) => ({
      _id: String(r._id),
      identifier: r.identifier,
      sopBaseId: r.sopBaseId,
      version: r.version,
      versionNum: r.versionNum,
      language: r.language,
      fileType: r.fileType,
      isObsolete: r.isObsolete ?? false,
      name: (r.name || "").slice(0, 50),
      department: r.department,
      uploadedAt: r.uploadedAt,
      createdAt: r.createdAt,
      fileUrl: r.fileUrl,
    }))
    .sort((a, b) =>
      (a.identifier + a.language + a.fileType).localeCompare(
        b.identifier + b.language + b.fileType,
      ),
    );

  for (const r of rows) {
    console.log(
      `${r.identifier.padEnd(20)} | base=${String(r.sopBaseId).padEnd(10)} | v=${String(r.version).padEnd(5)} vNum=${String(r.versionNum).padEnd(4)} | ${String(r.language).padEnd(9)} ${String(r.fileType).padEnd(5)} | obs=${r.isObsolete} | ${r.name}`,
    );
  }

  console.log("\n--- detail (ids, dates, urls) ---");
  for (const r of rows) {
    console.log(
      `${r.identifier} [${r.language}/${r.fileType}] _id=${r._id}\n   created=${r.createdAt?.toISOString?.() ?? r.createdAt} uploaded=${r.uploadedAt?.toISOString?.() ?? r.uploadedAt}\n   url=${r.fileUrl}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
