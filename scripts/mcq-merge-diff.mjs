// READ-ONLY key-level diff between source and target mcqbanks. Writes NOTHING.
// Determines: which source banks are missing from target, whether overlapping
// banks share _id (→ safe to upsert by _id), and a Personnel spot-check.
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

function readUri(path) {
  const m = readFileSync(path, "utf8").match(/^MONGODB_URI=(.+)$/m);
  return m[1].trim().replace(/^["']|["']$/g, "");
}
const TARGET_URI = readUri("c:/dev/sop-software/.env.local");
const SOURCE_URI = readUri("c:/Users/rohth/OneDrive/Desktop/sop pharma/sop pharma/.env.local");

const key = (b) =>
  `${String(b.sopIdentifier ?? "").trim().toUpperCase()}|${String(b.language ?? "English").toLowerCase()}`;

async function load(uri, dbName) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await c.connect();
  const col = c.db(dbName).collection("mcqbanks");
  const docs = await col.find(
    { isObsolete: { $ne: true } },
    { projection: { sopIdentifier: 1, language: 1, department: 1, mcqs: { $size: { $ifNull: ["$mcqs", []] } } } },
  ).toArray().catch(async () => {
    // projection with $size needs aggregation in some driver versions; fallback
    return col.aggregate([
      { $match: { isObsolete: { $ne: true } } },
      { $project: { sopIdentifier: 1, language: 1, department: 1, mcqs: { $size: { $ifNull: ["$mcqs", []] } } } },
    ]).toArray();
  });
  await c.close();
  return docs;
}

(async () => {
  const target = await load(TARGET_URI, "sop-software");
  const source = await load(SOURCE_URI, "test");

  const tById = new Map(target.map((d) => [String(d._id), d]));
  const tByKey = new Map(target.map((d) => [key(d), d]));

  let missing = [];
  let overlapSameId = 0;
  let overlapDiffId = 0;
  for (const s of source) {
    const k = key(s);
    if (!tByKey.has(k)) { missing.push(s); continue; }
    if (tById.has(String(s._id))) overlapSameId++;
    else overlapDiffId++;
  }

  console.log(`target active=${target.length}  source active=${source.length}`);
  console.log(`overlap by (sopIdentifier|lang): sameId=${overlapSameId}  diffId=${overlapDiffId}`);
  console.log(`source banks MISSING from target: ${missing.length}`);

  const byDept = {};
  for (const m of missing) {
    const d = m.department ?? "(none)";
    byDept[d] = byDept[d] || { banks: 0, questions: 0 };
    byDept[d].banks++; byDept[d].questions += m.mcqs ?? 0;
  }
  console.log("\nMissing-from-target grouped by SOURCE department:");
  for (const [d, v] of Object.entries(byDept).sort((a, b) => b[1].banks - a[1].banks)) {
    console.log(`  ${d.padEnd(28)} banks=${String(v.banks).padStart(4)}  questions=${v.questions}`);
  }

  const personnel = source.filter((s) => /person/i.test(s.department ?? ""));
  console.log(`\nSOURCE Personnel banks: ${personnel.length}`);
  for (const p of personnel.slice(0, 30)) {
    const inTarget = tByKey.has(key(p));
    console.log(`  ${String(p.sopIdentifier).padEnd(18)} ${String(p.language).padEnd(9)} q=${String(p.mcqs).padStart(4)} ${inTarget ? "(already in target)" : "MISSING"}`);
  }
})().catch((e) => { console.error("diff failed:", e.message); process.exit(1); });
