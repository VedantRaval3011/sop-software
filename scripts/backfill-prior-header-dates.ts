/**
 * Backfill headerDatesValid for prior-version DOCX slots across active registry
 * SOP families only (~416). Skips current-version and archived DOCX.
 *
 * Run:  npx tsx scripts/backfill-prior-header-dates.ts
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
  const { connectDB } = await import("@/lib/mongodb");
  const { backfillPriorHeaderDateFlags } = await import("@/lib/prior-header-dates");
  const { invalidateDashboardSopsCache } = await import("@/lib/server-cache");

  await connectDB();
  const result = await backfillPriorHeaderDateFlags();
  invalidateDashboardSopsCache();

  console.log("Prior-version header date backfill complete:");
  console.log(`  Active families:  ${result.families}`);
  console.log(`  Re-extracted DOCX: ${result.reextract.extracted}/${result.reextract.attempted}`);
  console.log(`  Families updated: ${result.familiesTouched}`);
  console.log(`  Flags written:    ${result.flagsWritten}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
