/**
 * Force-stop MCQ generation from the terminal (kills Claude + marks jobs cancelled).
 *
 * Usage:
 *   npx tsx scripts/stop-mcq-gen.ts                  # stop ALL active jobs
 *   npx tsx scripts/stop-mcq-gen.ts PRCL17-05 PRCL12-06
 */
import fs from "fs";
import mongoose from "mongoose";
import {
  requestMcqGenerationCancel,
  requestMcqGenerationCancelAll,
} from "@/lib/mcq-generation";

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
      /* try next */
    }
  }
}

async function main() {
  loadEnv();
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI not set — add it to .env.local");
  }
  await mongoose.connect(process.env.MONGODB_URI);

  const ids = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);

  if (!ids.length) {
    const n = await requestMcqGenerationCancelAll();
    console.log(`Stopped ${n} MCQ job(s) in the database and signalled in-process runs to abort.`);
    return;
  }

  for (const id of ids) {
    const ok = await requestMcqGenerationCancel(id);
    console.log(ok ? `✓ Stopped ${id}` : `✗ No active job for ${id} (may already be stopped)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
