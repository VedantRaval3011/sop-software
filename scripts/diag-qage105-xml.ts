/** Read-only: inspect raw header/document XML of the stored QAGE105-04 docx for the dates. */
import fs from "fs";
import mongoose from "mongoose";
import JSZip from "jszip";

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
  const r: any = await col.findOne({ identifier: "QAGE105-04", fileType: "docx" });
  await mongoose.disconnect();
  if (!r?.fileUrl) return console.log("no record");

  const res = await fetch(r.fileUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = await JSZip.loadAsync(buf);

  const names = Object.keys(zip.files).filter((n) => /\.xml$/i.test(n)).sort();
  console.log("XML parts:", names.join(", "));

  // Search every part for the dates seen in the screenshot.
  for (const n of names) {
    const xml = await zip.file(n)!.async("string");
    const hits = xml.match(/22[\/\-.]10[\/\-.]2022|21[\/\-.]10[\/\-.]2024|\d{2}\/\d{2}\/20\d{2}/g);
    if (hits) console.log(`\n[${n}] date-like tokens:`, [...new Set(hits)]);
  }

  // Dump each header part's <w:t> runs in order so we can see where EFF/REVIEW values sit.
  const headerFiles = names.filter((n) => /^word\/header\d*\.xml$/i.test(n));
  for (const n of headerFiles) {
    const xml = await zip.file(n)!.async("string");
    const runs = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    console.log(`\n===== ${n} — ${runs.length} runs =====`);
    console.log(JSON.stringify(runs));
    // also check for textboxes / alternate content
    console.log("has w:txbxContent:", /w:txbxContent/.test(xml), "has v:textbox:", /v:textbox/.test(xml));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
