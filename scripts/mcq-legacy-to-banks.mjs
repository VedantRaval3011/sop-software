// Archive the legacy `mcqs` collection (flat MCQ docs from the old generation
// path) into `mcqbanks` as OBSOLETE banks, so they land in the MCQ Bank's
// "Obsolete MCQs" section alongside old SOP-version MCQs. The real active banks
// (imported sop-pharma data) are untouched; new generation produces the active set.
//
// Strictly additive: creates new mcqbanks docs, never edits/deletes existing ones.
// Reversible via a ledger of created _ids.
//
// Usage:
//   node scripts/mcq-legacy-to-banks.mjs            # DRY RUN (default) — writes nothing
//   node scripts/mcq-legacy-to-banks.mjs --apply    # create the obsolete banks
//   node scripts/mcq-legacy-to-banks.mjs --undo     # remove banks created by --apply
import { MongoClient } from "mongodb";
import { readFileSync, writeFileSync } from "node:fs";

function readUri(path) {
  const m = readFileSync(path, "utf8").match(/^MONGODB_URI=(.+)$/m);
  if (!m) throw new Error(`MONGODB_URI not found in ${path}`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const URI = readUri("c:/dev/sop-software/.env.local");
const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");
const LEDGER = "scripts/.mcq-legacy-to-banks-inserted.json";
const OBSOLETE_REASON = "Legacy generated MCQs archived on migration";

const DIFF = { easy: "Easy", medium: "Medium", hard: "Hard" };
const STARS = { Easy: "⭐", Medium: "⭐⭐", Hard: "⭐⭐⭐" };
const LETTER = { A: 0, B: 1, C: 2, D: 3 };

function toBankMcq(d) {
  const options = [d.optionA, d.optionB, d.optionC, d.optionD].map((o) => String(o ?? "").trim());
  const idx = LETTER[d.correctAnswer] ?? 0;
  const difficulty = DIFF[String(d.difficulty).toLowerCase()] ?? "Medium";
  const correct = options[idx] || options.find((o) => o.length > 0) || "N/A";
  return {
    aiIcon: "✨",
    question: String(d.question ?? "").trim(),
    difficulty,
    difficultyStars: STARS[difficulty],
    options,
    correctAnswer: correct,
    explanation: String(d.explanation ?? "").trim() || "Refer to the SOP for details.",
    sopReference: String(d.topic ?? "").trim() || String(d.identifier ?? ""),
    optionVariants: [],
    isChecked: false,
    isReviewed: false,
    isSimilar: false,
  };
}

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
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  try {
    const dbName = (await dbWith(client, "mcqs")) ?? (await dbWith(client, "mcqbanks"));
    const db = client.db(dbName);
    const banks = db.collection("mcqbanks");

    if (UNDO) {
      const { ObjectId } = await import("mongodb");
      const ids = JSON.parse(readFileSync(LEDGER, "utf8"));
      const r = await banks.deleteMany({ _id: { $in: ids.map((s) => new ObjectId(s)) } });
      console.log(`Undo: removed ${r.deletedCount} migrated obsolete banks.`);
      return;
    }

    const mcqsCol = db.collection("mcqs");
    if (!(await db.listCollections({ name: "mcqs" }).toArray()).length) {
      console.log("No legacy `mcqs` collection — nothing to migrate.");
      return;
    }

    // Group approved legacy MCQs by identifier + language.
    const docs = await mcqsCol.find({ status: "approved" }).toArray();
    console.log(`legacy approved mcqs: ${docs.length}`);
    const groups = new Map();
    for (const d of docs) {
      const id = String(d.identifier ?? "").trim();
      if (!id) continue;
      const lang = String(d.language ?? "English").toLowerCase() === "gujarati" ? "Gujarati" : "English";
      const key = `${id.toUpperCase()}||${lang}`;
      if (!groups.has(key)) groups.set(key, { id, lang, dept: d.department ?? "General", sopId: d.sopId, mcqs: [] });
      groups.get(key).mcqs.push(toBankMcq(d));
    }

    // Skip groups that already have an OBSOLETE bank for the same identifier+language
    // (so re-running doesn't duplicate the archive). Active banks are intentionally
    // left alone — they are the real current set.
    const existingObsolete = new Set(
      (await banks.find({ isObsolete: true }, { projection: { sopIdentifier: 1, language: 1 } }).toArray())
        .map((b) => `${String(b.sopIdentifier ?? "").trim().toUpperCase()}||${b.language ?? "English"}`),
    );

    const toCreate = [];
    for (const [key, g] of groups) {
      if (existingObsolete.has(key)) continue;
      const dist = {
        easy: g.mcqs.filter((m) => m.difficulty === "Easy").length,
        medium: g.mcqs.filter((m) => m.difficulty === "Medium").length,
        hard: g.mcqs.filter((m) => m.difficulty === "Hard").length,
      };
      toCreate.push({
        sopId: g.sopId,
        sopName: g.id,
        sopIdentifier: g.id,
        department: g.dept,
        language: g.lang,
        mcqs: g.mcqs,
        totalQuestions: g.mcqs.length,
        generatedAt: new Date(),
        difficultyDistribution: dist,
        aiModel: "gemini-2.5-flash",
        isObsolete: true,
        obsoleteAt: new Date(),
        obsoleteReason: OBSOLETE_REASON,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    console.log(`groups=${groups.size}  obsolete banks to create=${toCreate.length}`);
    for (const b of toCreate.slice(0, 30)) {
      console.log(`  ${String(b.sopIdentifier).padEnd(14)} ${b.language.padEnd(9)} q=${b.totalQuestions}`);
    }
    if (toCreate.length > 30) console.log(`  … and ${toCreate.length - 30} more`);

    if (!APPLY) {
      console.log("\nDRY RUN — no writes. Re-run with --apply to create the obsolete banks.");
      return;
    }
    if (!toCreate.length) {
      console.log("\nNothing to create.");
      return;
    }
    const res = await banks.insertMany(toCreate, { ordered: false });
    const ids = Object.values(res.insertedIds).map(String);
    writeFileSync(LEDGER, JSON.stringify(ids, null, 2));
    console.log(`\nCreated ${res.insertedCount} obsolete banks. Ledger: ${LEDGER} (use --undo to revert).`);
  } finally {
    await client.close();
  }
})().catch((e) => { console.error("migration failed:", e.message); process.exit(1); });
