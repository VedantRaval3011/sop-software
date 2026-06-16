/**
 * Re-backfill dates and print Version Date Found/Missing for every department.
 * Run: npx tsx scripts/rebuild-version-dates.ts
 */
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
  const { backfillSopDates } = await import("@/lib/backfill-sop-dates");
  const { connectDB } = await import("@/lib/mongodb");
  const { default: SOP } = await import("@/models/SOP");
  const { groupSOPRecords, buildDashboardStats } = await import("@/lib/sop-utils");
  const { invalidatePersistentGroupedCache } = await import("@/lib/persistentGroupedCache");

  console.log("Re-extracting version dates for all SOP families…");
  const backfill = await backfillSopDates();
  console.log("Backfill:", backfill);

  await invalidatePersistentGroupedCache();

  await connectDB();
  const records = await SOP.find({}).select("-content").lean();
  const grouped = groupSOPRecords(records as never);
  const stats = buildDashboardStats(grouped);

  console.log("\nVersion Dates by department (all active SOPs):");
  for (const cap of stats.departments) {
    const { found, missing } = cap.versionDate;
    console.log(`  ${cap.department.padEnd(28)} Found: ${found}  Not Found: ${missing}`);
  }

  const total = stats.departments.find((d) => d.department === "Total");
  if (total) {
    console.log(`\nTotal active SOPs: ${stats.totalSops}`);
    console.log(`Total Version Dates — Found: ${total.versionDate.found}, Not Found: ${total.versionDate.missing}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
