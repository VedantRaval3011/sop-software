/**
 * One-time / maintenance: merge duplicate MCQGenJob rows for identifier variants
 * (e.g. QAMI34-08 + QAMI34-8 → single QAMI34-8 row).
 *
 * Usage: npx tsx scripts/dedupe-mcq-gen-jobs.ts [identifier...]
 */
import fs from "fs";
import mongoose from "mongoose";
import { ensureSingleMcqGenJob, canonicalMcqJobId } from "@/lib/mcq-gen-job-store";
import { normalizeSopIdentifierKey } from "@/lib/sopIdentifierNormalize";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const env = fs.readFileSync(file, "utf8");
      for (const line of env.split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
      }
      return;
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  loadEnv();
  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.collection("mcqgenjobs");

  const args = process.argv.slice(2);
  let identifiers: string[];

  if (args.length > 0) {
    identifiers = args;
  } else {
    const all = await col.find({}, { projection: { identifier: 1 } }).toArray();
    const byCanonical = new Map<string, Set<string>>();
    for (const doc of all) {
      const raw = String(doc.identifier ?? "");
      const canonical = normalizeSopIdentifierKey(raw);
      if (!byCanonical.has(canonical)) byCanonical.set(canonical, new Set());
      byCanonical.get(canonical)!.add(raw);
    }
    identifiers = [...byCanonical.entries()]
      .filter(([, variants]) => variants.size > 1)
      .map(([canonical]) => canonical);
    console.log(`Found ${identifiers.length} identifier families with duplicate job rows`);
  }

  for (const id of identifiers) {
    const before = await col
      .find({ identifier: { $regex: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } })
      .project({ identifier: 1 })
      .toArray();
    const canonical = await ensureSingleMcqGenJob(id);
    const after = await col.find({ identifier: canonical }).project({ identifier: 1 }).toArray();
    if (before.length > 1 || before.some((d) => d.identifier !== canonical)) {
      console.log(
        `${id} → ${canonicalMcqJobId(id)}: merged ${before.map((d) => d.identifier).join(", ")} → ${after.length} row(s)`,
      );
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
