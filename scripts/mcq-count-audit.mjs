// READ-ONLY audit. Verifies MCQ Bank counts and whether generation output is
// reflected in the bank. Writes NOTHING.
//
// Usage: node scripts/mcq-count-audit.mjs
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

function readUri(path) {
  const txt = readFileSync(path, "utf8");
  const m = txt.match(/^MONGODB_URI=(.+)$/m);
  if (!m) throw new Error(`MONGODB_URI not found in ${path}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const URI = readUri("c:/dev/sop-software/.env.local");

async function dbWith(client, collName) {
  const { databases } = await client.db().admin().listDatabases();
  for (const d of databases) {
    if (["admin", "local", "config"].includes(d.name)) continue;
    const cols = await client.db(d.name).listCollections({ name: collName }).toArray();
    if (cols.length) return d.name;
  }
  return null;
}

(async () => {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    const dbName = (await dbWith(client, "mcqbanks")) ?? (await dbWith(client, "sops"));
    const db = client.db(dbName);
    console.log(`DB: ${dbName}\n`);

    // ── mcqbanks (the MCQ Bank UI reads this) ──
    const banks = db.collection("mcqbanks");
    const bankTotal = await banks.countDocuments({});
    const bankActive = await banks.countDocuments({ isObsolete: { $ne: true } });
    const bankObsolete = await banks.countDocuments({ isObsolete: true });
    const qAgg = await banks.aggregate([
      { $group: {
        _id: { $cond: [{ $eq: ["$isObsolete", true] }, "obsolete", "active"] },
        questions: { $sum: { $size: { $ifNull: ["$mcqs", []] } } },
        zeroQ: { $sum: { $cond: [{ $eq: [{ $size: { $ifNull: ["$mcqs", []] } }, 0] }, 1, 0] } },
      } },
    ]).toArray();
    console.log("── mcqbanks (MCQBank model — what the UI counts) ──");
    console.log(`  total=${bankTotal}  active=${bankActive}  obsolete=${bankObsolete}`);
    for (const r of qAgg) console.log(`  ${r._id}: questions=${r.questions}  banksWithZeroQ=${r.zeroQ}`);

    // totalQuestions field vs actual mcqs.length mismatch (count integrity)
    const mismatch = await banks.aggregate([
      { $project: { sopIdentifier: 1, stored: "$totalQuestions", actual: { $size: { $ifNull: ["$mcqs", []] } } } },
      { $match: { $expr: { $ne: ["$stored", "$actual"] } } },
      { $limit: 20 },
    ]).toArray();
    console.log(`  totalQuestions-field mismatches: ${mismatch.length}${mismatch.length ? " (first 20 shown)" : ""}`);
    for (const m of mismatch) console.log(`    ${m.sopIdentifier}: stored=${m.stored} actual=${m.actual}`);

    // ── mcqs (the generation pipeline writes this) ──
    const mcqs = db.collection("mcqs");
    const mcqExists = await db.listCollections({ name: "mcqs" }).toArray();
    console.log("\n── mcqs (MCQ model — what generation writes) ──");
    if (!mcqExists.length) {
      console.log("  collection does NOT exist — generation pipeline has never produced output here.");
    } else {
      const mcqTotal = await mcqs.countDocuments({});
      const byStatus = await mcqs.aggregate([
        { $group: { _id: "$status", n: { $sum: 1 } } }, { $sort: { n: -1 } },
      ]).toArray();
      console.log(`  total=${mcqTotal}`);
      for (const s of byStatus) console.log(`    status=${s._id}: ${s.n}`);

      // distinct identifiers in each collection — overlap shows whether the two are linked
      const mcqIds = new Set((await mcqs.distinct("identifier")).map((x) => String(x).toUpperCase().trim()));
      const bankIds = new Set((await banks.distinct("sopIdentifier")).map((x) => String(x).toUpperCase().trim()));
      const onlyInMcqs = [...mcqIds].filter((x) => !bankIds.has(x));
      const inBoth = [...mcqIds].filter((x) => bankIds.has(x));
      console.log(`  distinct identifiers: mcqs=${mcqIds.size}  mcqbanks=${bankIds.size}`);
      console.log(`  identifiers in BOTH=${inBoth.length}  only-in-mcqs(generated, not in bank)=${onlyInMcqs.length}`);
      if (onlyInMcqs.length) console.log(`    e.g. ${onlyInMcqs.slice(0, 15).join(", ")}`);
    }

    // ── sops universe ──
    const sops = db.collection("sops");
    const sopTotal = await sops.countDocuments({});
    const sopActive = await sops.countDocuments({ isObsolete: { $ne: true } });
    console.log(`\n── sops ──\n  total=${sopTotal}  active=${sopActive}`);

    console.log("\nDone (read-only).");
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("Audit failed:", e.message); process.exit(1); });
