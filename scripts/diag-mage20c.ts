/** Read-only: check whether mangled MAGE20-CLEANING* ids are referenced in other collections. */
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
  const db = mongoose.connection.db!;
  const mangled = ["MAGE20-0-CLEANING", "MAGE20-CLEANINGO", "MAGE20-CLEANINGOF"];
  const rx = mangled.map((m) => new RegExp(`^${m}$`, "i"));

  const cols = await db.listCollections().toArray();
  console.log("Collections:", cols.map((c) => c.name).join(", "), "\n");

  for (const c of cols) {
    const col = db.collection(c.name);
    const fields = ["identifier", "sopIdentifier", "sopBaseId", "sopId"];
    const or = fields.map((f) => ({ [f]: { $in: rx } }));
    let count = 0;
    try {
      count = await col.countDocuments({ $or: or });
    } catch {
      continue;
    }
    if (count > 0) console.log(`${c.name}: ${count} docs reference a mangled id`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
