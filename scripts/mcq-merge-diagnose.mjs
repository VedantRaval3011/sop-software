// READ-ONLY diagnostic. Compares the source cluster's mcqbanks against this app's
// (target) mcqbanks so we can see exactly what hasn't been merged. Writes NOTHING.
//
// Usage: node scripts/mcq-merge-diagnose.mjs
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

function readUri(path) {
  const txt = readFileSync(path, "utf8");
  const m = txt.match(/^MONGODB_URI=(.+)$/m);
  if (!m) throw new Error(`MONGODB_URI not found in ${path}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const TARGET_URI = readUri("c:/dev/sop-software/.env.local");
const SOURCE_URI = readUri("c:/Users/rohth/OneDrive/Desktop/sop pharma/sop pharma/.env.local");

const COMMON_DB_SKIP = new Set(["admin", "local", "config"]);

async function findDbWithCollection(client, collName) {
  // If the URI pins a db, prefer it; otherwise scan databases for the collection.
  const admin = client.db().admin();
  const { databases } = await admin.listDatabases();
  const candidates = [];
  for (const d of databases) {
    if (COMMON_DB_SKIP.has(d.name)) continue;
    const cols = await client.db(d.name).listCollections({ name: collName }).toArray();
    if (cols.length) {
      const count = await client.db(d.name).collection(collName).estimatedDocumentCount();
      candidates.push({ db: d.name, count });
    }
  }
  return candidates;
}

async function deptBreakdown(client, dbName, collName) {
  const col = client.db(dbName).collection(collName);
  const total = await col.countDocuments({});
  const active = await col.countDocuments({ isObsolete: { $ne: true } });
  const byDept = await col.aggregate([
    { $match: { isObsolete: { $ne: true } } },
    { $group: { _id: "$department", banks: { $sum: 1 }, questions: { $sum: { $size: { $ifNull: ["$mcqs", []] } } } } },
    { $sort: { banks: -1 } },
  ]).toArray();
  return { total, active, byDept };
}

async function inspect(label, uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    console.log(`\n========== ${label} ==========`);
    const found = await findDbWithCollection(client, "mcqbanks");
    if (!found.length) {
      console.log("  No 'mcqbanks' collection found in any database.");
      // Still list dbs/collections for orientation
      const { databases } = await client.db().admin().listDatabases();
      console.log("  Databases:", databases.map((d) => d.name).join(", "));
      return;
    }
    for (const { db, count } of found) {
      console.log(`  DB '${db}': mcqbanks ~${count} docs`);
      const { total, active, byDept } = await deptBreakdown(client, db, "mcqbanks");
      console.log(`    total=${total}  active(non-obsolete)=${active}`);
      console.log("    per stored department (active):");
      for (const d of byDept) {
        console.log(`      ${String(d._id ?? "(none)").padEnd(28)} banks=${String(d.banks).padStart(5)}  questions=${d.questions}`);
      }
      // Also show whether SOPs exist alongside
      const sopCols = await client.db(db).listCollections({ name: "sops" }).toArray();
      if (sopCols.length) {
        const sopCount = await client.db(db).collection("sops").countDocuments({});
        console.log(`    sops collection: ${sopCount} docs`);
      }
    }
  } finally {
    await client.close();
  }
}

(async () => {
  await inspect("TARGET (this app: sop-software / vixptuw)", TARGET_URI);
  await inspect("SOURCE (sop pharma / rop3mr6)", SOURCE_URI);
  console.log("\nDone (read-only).");
})().catch((e) => {
  console.error("Diagnostic failed:", e.message);
  process.exit(1);
});
