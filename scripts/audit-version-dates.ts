import fs from "fs";

function loadEnv() {
  const env = fs.readFileSync(".env.local", "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  loadEnv();
  const { connectDB } = await import("@/lib/mongodb");
  const { default: SOP } = await import("@/models/SOP");
  const { groupSOPRecords, buildDashboardStats } = await import("@/lib/sop-utils");
  const { invalidatePersistentGroupedCache } = await import("@/lib/persistentGroupedCache");

  await connectDB();
  const records = await SOP.find({ isObsolete: { $ne: true } }).select("-content").lean();
  const grouped = groupSOPRecords(records as never);
  const stats = buildDashboardStats(grouped);
  const total = stats.departments.find((d) => d.department === "Total");

  console.log("Version Dates — Found:", total?.versionDate.found, "Not Found:", total?.versionDate.missing);

  const qage = grouped.filter((s) => /^QAGE0/i.test(s.identifier));
  for (const sop of qage.sort((a, b) => a.identifier.localeCompare(b.identifier))) {
    if (!/^QAGE0[1-9]|^QAGE1[01]/i.test(sop.identifier.split("-")[0] ?? "")) continue;
    console.log(
      `${sop.identifier.padEnd(14)} ${sop.hasVersionDate ? "FOUND" : "NOT FOUND"} eff=${sop.effectiveDate?.slice(0, 10) ?? "-"}`,
    );
  }

  const missing = grouped.filter((s) => !s.hasVersionDate);
  console.log("\nAll NOT FOUND:", missing.length);
  for (const s of missing) console.log(`  ${s.identifier} (${s.department})`);

  await invalidatePersistentGroupedCache();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
