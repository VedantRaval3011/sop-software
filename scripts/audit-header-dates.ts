/**
 * Report prior-version DOCX header date errors for active registry SOPs (~416).
 * Use --fix to backfill validation flags first.
 *
 * Run:  npx tsx scripts/audit-header-dates.ts
 *       npx tsx scripts/audit-header-dates.ts --fix
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
  const fix = process.argv.includes("--fix");

  const { connectDB } = await import("@/lib/mongodb");
  const { default: SOP } = await import("@/models/SOP");
  const { groupSOPRecords } = await import("@/lib/sop-utils");
  const {
    backfillPriorHeaderDateFlags,
    countPriorHeaderDateErrors,
  } = await import("@/lib/prior-header-dates");
  const { invalidateDashboardSopsCache } = await import("@/lib/server-cache");

  await connectDB();

  if (fix) {
    console.log("Backfilling prior-version header date flags…\n");
    const backfill = await backfillPriorHeaderDateFlags();
    invalidateDashboardSopsCache();
    console.log(
      `Backfill done — ${backfill.flagsWritten} flag(s) across ${backfill.familiesTouched} families\n`,
    );
  }

  const records = await SOP.find({ isObsolete: { $ne: true } }).select("-content").lean();
  const grouped = groupSOPRecords(records as never);
  const stats = countPriorHeaderDateErrors(grouped);

  console.log("── Active registry (prior-version DOCX only) ──");
  console.log(`SOP families:            ${stats.sopCount}`);
  console.log(`Prior-version DOCX slots: ${stats.priorDocxSlots}`);
  console.log(`Invalid header dates:     ${stats.invalid}`);

  if (!fix && stats.invalid === stats.priorDocxSlots && stats.priorDocxSlots > 0) {
    console.log("\nTip: run with --fix to backfill validation flags from stored DOCX content.");
  }

  const errors = grouped.flatMap((sop) =>
    sop.priorVersions
      .filter((pv) => pv.docxDateError && !pv.missing)
      .map((pv) => ({ identifier: sop.identifier, version: pv.version, language: pv.language })),
  );

  if (errors.length > 0) {
    console.log("");
    for (const pv of errors) {
      console.log(`${pv.identifier.padEnd(16)} V${pv.version.padEnd(3)} ${pv.language}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
