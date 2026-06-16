// ADDITIVE merge: copy MCQ banks that exist in the SOURCE cluster but are missing
// from this app's (TARGET) cluster. Strictly insert-only:
//   • inserts only source docs whose _id is NOT already in target
//   • preserves _id (idempotent — re-running inserts nothing new)
//   • never updates or deletes an existing target doc
//
// Reversible: the inserted _ids are printed; `--undo` removes exactly those.
//
// Usage:
//   node scripts/mcq-merge.mjs --dry     # show what would be inserted, write nothing
//   node scripts/mcq-merge.mjs           # perform the additive insert
import { MongoClient } from "mongodb";
import { readFileSync, writeFileSync } from "node:fs";

function readUri(path) {
  const m = readFileSync(path, "utf8").match(/^MONGODB_URI=(.+)$/m);
  return m[1].trim().replace(/^["']|["']$/g, "");
}
const TARGET_URI = readUri("c:/dev/sop-software/.env.local");
const SOURCE_URI = readUri("c:/Users/rohth/OneDrive/Desktop/sop pharma/sop pharma/.env.local");
const DRY = process.argv.includes("--dry");
const UNDO = process.argv.includes("--undo");
const LEDGER = "scripts/.mcq-merge-inserted.json";

async function open(uri, dbName) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await c.connect();
  return { c, col: c.db(dbName).collection("mcqbanks") };
}

(async () => {
  if (UNDO) {
    const ids = JSON.parse(readFileSync(LEDGER, "utf8"));
    const { c, col } = await open(TARGET_URI, "sop-software");
    const { ObjectId } = await import("mongodb");
    const r = await col.deleteMany({ _id: { $in: ids.map((s) => new ObjectId(s)) } });
    console.log(`Undo: removed ${r.deletedCount} previously-inserted banks.`);
    await c.close();
    return;
  }

  const tgt = await open(TARGET_URI, "sop-software");
  const src = await open(SOURCE_URI, "test");

  // All target _ids (active + obsolete) so we never touch an existing doc.
  const targetIds = new Set(
    (await tgt.col.find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)),
  );

  // Full source docs whose _id is absent from target.
  const sourceDocs = await src.col.find({}).toArray();
  const toInsert = sourceDocs.filter((d) => !targetIds.has(String(d._id)));

  // Report breakdown.
  const byDept = {};
  for (const d of toInsert) {
    const k = d.department ?? "(none)";
    byDept[k] = byDept[k] || { banks: 0, questions: 0 };
    byDept[k].banks++;
    byDept[k].questions += Array.isArray(d.mcqs) ? d.mcqs.length : 0;
  }
  console.log(`target docs=${targetIds.size}  source docs=${sourceDocs.length}`);
  console.log(`banks to insert (in source, missing from target): ${toInsert.length}`);
  for (const [k, v] of Object.entries(byDept).sort((a, b) => b[1].banks - a[1].banks)) {
    console.log(`  ${k.padEnd(28)} banks=${String(v.banks).padStart(4)}  questions=${v.questions}`);
  }

  if (DRY) {
    console.log("\n--dry: no writes performed.");
  } else if (toInsert.length) {
    const res = await tgt.col.insertMany(toInsert, { ordered: false });
    const insertedIds = Object.values(res.insertedIds).map(String);
    writeFileSync(LEDGER, JSON.stringify(insertedIds, null, 2));
    console.log(`\nInserted ${res.insertedCount} banks. Ledger written to ${LEDGER} (use --undo to revert).`);
  } else {
    console.log("\nNothing to insert — target already has every source bank.");
  }

  await tgt.c.close();
  await src.c.close();
})().catch((e) => { console.error("merge failed:", e.message); process.exit(1); });
