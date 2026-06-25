/**
 * Read-only: diagnose why a Gujarati SOP DOCX fails header-date validation.
 *
 * Point it at the actual failing file(s) and it replays the real upload pipeline
 * (extractTextFromBuffer -> languageFromContentScript -> validateSopHeaderDates)
 * while dumping the raw header XML so we can see exactly which step drops the
 * EFF. DATE / REVIEW DT. (લાગુ પડેલ તારીખ / ફેર ચકાસણી તારીખ) values.
 *
 * Run:  npx tsx scripts/diag-gujarati-header-dates.ts "C:\path\PREG05-2.docx" [more.docx ...]
 */
import fs from "fs";
import path from "path";
import JSZip from "jszip";

async function rawHeaderRuns(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files)
    .filter((n) => /^word\/header\d*\.xml$/i.test(n))
    .sort();
  const out: { name: string; runs: string[]; hasTextbox: boolean; allTextLen: number }[] = [];
  for (const n of names) {
    const xml = await zip.file(n)!.async("string");
    const runs = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    out.push({
      name: n,
      runs,
      hasTextbox: /w:txbxContent|v:textbox|mc:AlternateContent/.test(xml),
      allTextLen: runs.join("").length,
    });
  }
  return out;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: npx tsx scripts/diag-gujarati-header-dates.ts "<file.docx>" [...]');
    process.exit(1);
  }

  const { extractTextFromBuffer } = await import("@/lib/extractContent");
  const { languageFromContentScript, hasGujaratiScript } = await import(
    "@/lib/sop-name-resolution"
  );
  const { validateSopHeaderDates, formatSopHeaderDateErrors } = await import("@/lib/sop-dates");

  for (const f of files) {
    const buf = fs.readFileSync(f);
    console.log("\n" + "=".repeat(78));
    console.log(path.basename(f));
    console.log("=".repeat(78));

    // 1) Raw page-header XML runs (what the extractor is fed).
    const headers = await rawHeaderRuns(buf);
    if (headers.length === 0) console.log("  (no word/headerN.xml parts found)");
    for (const h of headers) {
      console.log(
        `\n  [${h.name}] ${h.runs.length} <w:t> runs, ${h.allTextLen} chars, textbox/altContent=${h.hasTextbox}`,
      );
      console.log("    runs:", JSON.stringify(h.runs));
    }

    // 2) What extractTextFromBuffer actually returns (header + body, header first).
    const content = await extractTextFromBuffer(buf, "docx");
    const head = content.slice(0, 600);
    console.log("\n  --- extracted content[0:600] ---");
    console.log("  " + head.replace(/\n/g, "\n  "));

    // 3) Every date token + every Gujarati "તારીખ" (date) label context anywhere.
    const dateTokens = content.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g) ?? [];
    console.log("\n  date tokens in content:", [...new Set(dateTokens)]);
    const tareekh = [...content.matchAll(/(.{0,18})તારીખ/g)].map((m) => (m[1] + "તારીખ").trim());
    console.log("  'તારીખ' (date) contexts:", [...new Set(tareekh)]);

    // 4) Language detection + validation for BOTH languages.
    const detected = languageFromContentScript(content, "English");
    console.log(
      `\n  hasGujaratiScript=${hasGujaratiScript(content)}  detectedLanguage=${detected}`,
    );
    for (const lang of ["English", "Gujarati"] as const) {
      const v = validateSopHeaderDates(content, lang);
      console.log(
        `  validate(${lang}): valid=${v.valid} errors=[${v.errors.join(", ")}]` +
          (v.valid ? ` eff=${v.effectiveDate?.toISOString().slice(0, 10)} rev=${v.reviewDate?.toISOString().slice(0, 10)}` : ""),
      );
      if (!v.valid) console.log(`     -> message: ${formatSopHeaderDateErrors(v.errors)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
