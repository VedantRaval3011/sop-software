/** Read-only: compare checksums/sizes of MAGE20 family vs mangled MAGE20-CLEANING* records. */
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

  const ids = [
    "MAGE20-0",
    "MAGE20-1",
    "MAGE20-02",
    "MAGE20-0-CLEANING",
    "MAGE20-CLEANINGO",
    "MAGE20-CLEANINGOF",
  ];
  const records = await col
    .find({ identifier: { $in: ids } })
    .toArray();

  for (const r of records.sort((a: any, b: any) =>
    (a.identifier + a.language + a.fileType).localeCompare(b.identifier + b.language + b.fileType),
  )) {
    const rr = r as any;
    console.log(
      `${rr.identifier.padEnd(18)} ${String(rr.language).padEnd(9)} ${String(rr.fileType).padEnd(5)} size=${String(rr.metadata?.fileSize ?? "?").padEnd(8)} sum=${String(rr.checksum ?? "none").slice(0, 16)} eff=${rr.effectiveDate?.toISOString?.().slice(0,10) ?? "-"} exp=${rr.expiryDate?.toISOString?.().slice(0,10) ?? "-"}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
