/** Read-only: inspect the QAGE105 family — file types, content extraction state, dates, upload times. */
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

  // Match QAGE105 base regardless of zero-padding / version suffix.
  const records = await col
    .find({ identifier: { $regex: /^QAGE105/i } })
    .toArray();

  console.log(`Found ${records.length} QAGE105* records\n`);

  const rows = records.sort((a: any, b: any) =>
    (a.identifier + a.language + a.fileType).localeCompare(b.identifier + b.language + b.fileType),
  );

  for (const r of rows as any[]) {
    const content: string = r.content ?? "";
    const head = content.slice(0, 600);
    const hasEff = /EFF\.?\s*DATE/i.test(head);
    const effMatch = head.match(/EFF\.?\s*DATE[:\s\t.-]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
    const contentKind = !content
      ? "EMPTY"
      : content.startsWith("[")
        ? `PLACEHOLDER(${head.slice(0, 40)})`
        : content.startsWith("%PDF")
          ? "RAW-PDF"
          : "TEXT";

    console.log(
      `${String(r.identifier).padEnd(14)} v${String(r.versionNum ?? r.version ?? "?").padEnd(4)} ` +
        `${String(r.language).padEnd(9)} ${String(r.fileType).padEnd(5)} ` +
        `obs=${r.isObsolete ? "Y" : "n"} link=${r.linkedFromBunny ? "Y" : "n"} ` +
        `eff=${r.effectiveDate?.toISOString?.().slice(0, 10) ?? "-"} ` +
        `exp=${r.expiryDate?.toISOString?.().slice(0, 10) ?? "-"} ` +
        `hdrValid=${r.headerDatesValid ?? "-"} ` +
        `content=${contentKind} effInText=${hasEff ? (effMatch?.[1] ?? "label-only") : "no"} ` +
        `up=${r.uploadedAt?.toISOString?.().slice(0, 10) ?? "-"} ` +
        `orig="${r.originalFileName ?? r.sopDocuments?.[0]?.fileName ?? "?"}"`,
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
