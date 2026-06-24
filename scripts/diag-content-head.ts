/** Read-only: print the raw stored content head for an SOP, to judge whether the
 *  text is actually readable (vs image-only/placeholder extraction).
 *    node --experimental-strip-types scripts/diag-content-head.ts [IDENTIFIER]
 */
import fs from "fs";
import mongoose from "mongoose";

const env = fs.readFileSync(".env.local", "utf8");
for (const l of env.split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const arg = process.argv[2] ?? "QAMI38-06";
await mongoose.connect(process.env.MONGODB_URI!);
const recs = await mongoose.connection
  .collection("sops")
  .find({ identifier: { $regex: new RegExp(arg.replace(/-/g, "-?"), "i") } })
  .toArray();

for (const r of recs as any[]) {
  const c: string = r.content ?? "";
  // Crude readability check: ratio of alphanumeric/space to total.
  const readable = c ? (c.match(/[A-Za-z0-9 .,()\/-]/g)?.length ?? 0) / c.length : 0;
  console.log(
    `${r.identifier} ${r.language} ${r.fileType} len=${c.length} readableRatio=${readable.toFixed(2)}`,
  );
  console.log("  HEAD:", JSON.stringify(c.slice(0, 400)));
  console.log("");
}

await mongoose.disconnect();
