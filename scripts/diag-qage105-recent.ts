/** Read-only: what was uploaded recently + search any QAGE105 docx body for the screenshot dates. */
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
  const col = mongoose.connection.collection("sops");

  const since = new Date("2026-06-20T00:00:00Z");
  const recent = await col
    .find({ uploadedAt: { $gte: since } })
    .project({ identifier: 1, fileType: 1, language: 1, uploadedAt: 1, originalFileName: 1, effectiveDate: 1 })
    .sort({ uploadedAt: 1 })
    .toArray();
  console.log(`Records uploaded since ${since.toISOString().slice(0, 10)}: ${recent.length}`);
  for (const r of recent as any[]) {
    console.log(
      `  ${r.uploadedAt?.toISOString?.().slice(0, 16)}  ${String(r.identifier).padEnd(14)} ${String(r.language).padEnd(8)} ${String(r.fileType).padEnd(4)} eff=${r.effectiveDate?.toISOString?.().slice(0,10) ?? "-"}  orig="${r.originalFileName ?? "?"}"`,
    );
  }

  // Does ANY QAGE105 record's stored content contain the screenshot dates?
  const all = await col.find({ identifier: { $regex: /^QAGE105/i } }).toArray();
  console.log("\nQAGE105* records whose stored content contains 22/10/2022 or 21/10/2024:");
  let any = false;
  for (const r of all as any[]) {
    const c: string = r.content ?? "";
    if (/22[\/\-.]10[\/\-.]2022|21[\/\-.]10[\/\-.]2024/.test(c)) {
      any = true;
      console.log(`  ${r.identifier} ${r.fileType} ${r.language}`);
    }
  }
  if (!any) console.log("  (none — the dated v4 file is not stored anywhere)");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
