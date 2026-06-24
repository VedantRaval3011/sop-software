/** Read-only: dump extracted header text for QAGE105-04 docx and re-extract live from Bunny. */
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

  for (const id of ["QAGE105-04", "QAGE105-4", "QAGE105-05"]) {
    const r: any = await col.findOne({ identifier: id, fileType: "docx" });
    console.log(`\n===== ${id} (docx) =====`);
    if (!r) {
      console.log("  (no docx record)");
      continue;
    }
    console.log("fileUrl:", r.fileUrl);
    console.log("checksum:", r.checksum);
    console.log("--- stored content (first 700 chars) ---");
    console.log((r.content ?? "").slice(0, 700));
  }

  // Live re-extract of QAGE105-04 docx from Bunny to see what extractor produces NOW.
  const r: any = await col.findOne({ identifier: "QAGE105-04", fileType: "docx" });
  if (r?.fileUrl) {
    console.log("\n===== LIVE re-extract of QAGE105-04 from Bunny =====");
    const { extractTextFromBuffer } = await import("@/lib/extractContent");
    const { resolveSopDatesFromContent } = await import("@/lib/sop-dates");
    const { validateSopHeaderDates } = await import("@/lib/sop-dates");
    try {
      const res = await fetch(r.fileUrl);
      console.log("fetch status:", res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      console.log("bytes:", buf.length, "magic:", buf.slice(0, 4).toString("hex"));
      const content = await extractTextFromBuffer(buf, "docx");
      console.log("--- live extracted (first 700) ---");
      console.log(content.slice(0, 700));
      console.log("--- resolved dates ---", resolveSopDatesFromContent(content));
      console.log("--- header validation ---", validateSopHeaderDates(content, "English"));
    } catch (e) {
      console.log("live extract error:", e);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
