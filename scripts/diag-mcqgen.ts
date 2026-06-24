/** Read-only: inspect MCQ generation jobs + the resulting banks, to diagnose a
 *  regenerate that "did nothing". Run:
 *    node --experimental-strip-types scripts/diag-mcqgen.ts [IDENTIFIER]
 *  e.g. node --experimental-strip-types scripts/diag-mcqgen.ts QAMI38-06
 */
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
  const db = mongoose.connection;

  const arg = process.argv[2];

  // 1) Recent generation jobs (most recent first).
  const jobCol = db.collection("mcqgenjobs");
  const jobFilter = arg ? { identifier: { $regex: new RegExp(arg.replace(/-/g, "-?"), "i") } } : {};
  const jobs = await jobCol.find(jobFilter).sort({ updatedAt: -1 }).limit(15).toArray();

  console.log(`\n=== MCQ GEN JOBS (${jobs.length}) ===`);
  if (!jobs.length) {
    console.log("No job records found. The regenerate request never reached enqueueMcqGeneration");
    console.log("(server not running the new code? POST /api/sop/generate-mcqs failed? wrong identifier?)");
  }
  for (const j of jobs as any[]) {
    console.log(
      `\n${j.identifier}  mode=${j.mode}  status=${j.status}  ${j.percent ?? 0}%\n` +
        `  phase: ${j.phase}\n` +
        `  inserted=${j.totalInserted ?? 0} skipped=${j.totalSkipped ?? 0} failedBatches=${j.totalFailedBatches ?? 0}\n` +
        `  started=${j.startedAt?.toISOString?.() ?? "-"}  finished=${j.finishedAt?.toISOString?.() ?? "-"}\n` +
        (j.error ? `  ERROR: ${j.error}\n` : "") +
        `  langs: ${JSON.stringify(j.languages ?? [])}`,
    );
  }

  // 2) Active banks for the identifier (or recently generated banks).
  const bankCol = db.collection("mcqbanks");
  const bankFilter = arg
    ? { sopIdentifier: { $regex: new RegExp(arg.replace(/-/g, "-?"), "i") }, isObsolete: { $ne: true } }
    : {};
  const banks = await bankCol
    .find(bankFilter)
    .sort({ generatedAt: -1 })
    .limit(10)
    .toArray();

  console.log(`\n=== ACTIVE BANKS (${banks.length}) ===`);
  for (const b of banks as any[]) {
    const sample = (b.mcqs ?? []).slice(0, 3).map((m: any) => m.sopReference);
    console.log(
      `${b.sopIdentifier}  ${b.language}  q=${b.totalQuestions}  ` +
        `generatedAt=${b.generatedAt?.toISOString?.() ?? "-"}  obsolete=${b.isObsolete ? "Y" : "n"}\n` +
        `  sample sopReference: ${JSON.stringify(sample)}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
