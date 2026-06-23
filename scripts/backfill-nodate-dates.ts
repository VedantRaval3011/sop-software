/**
 * Targeted backfill for the dashboard "No Date" bucket ONLY.
 *
 * A registry SOP shows "No Date" when its DB record has no `expiryDate`. Many of
 * these records actually carry valid EFF. DATE / REVIEW DT. header dates inside
 * their DOCX text — the dates were simply never extracted into the DB. This
 * script re-derives those dates (using the SAME validated extraction logic the
 * Expired / Near Expiry buckets rely on) and fills them in.
 *
 * Strictly additive and scoped to the No-Date bucket:
 *   • Only records that currently have NO expiryDate are ever written.
 *   • Records that already carry an expiryDate (Expired / Near / Medium / Low)
 *     are never read-for-write and never modified.
 *   • Dates are only ever SET — nothing is ever unset/cleared. A record whose
 *     document genuinely carries no date stays "No Date".
 *
 * Date source per (sopBaseId, versionNum, language) group is that group's DOCX
 * text (stored content first; re-downloaded from Bunny only if stored content is
 * a PDF blob / placeholder). PDFs are scanned images and never a date source.
 *
 * Run:  npx tsx scripts/backfill-nodate-dates.ts            # dry run (no writes)
 *       npx tsx scripts/backfill-nodate-dates.ts --apply    # write changes
 *       npx tsx scripts/backfill-nodate-dates.ts --base QAGE103   # limit to one family
 */
import fs from "fs";
import mongoose from "mongoose";
import { resolveSopDatesFromContent, sopDatesToDbFields } from "@/lib/sop-dates";
import { extractTextFromBuffer } from "@/lib/extractContent";

function loadEnv() {
  const env = fs.readFileSync(".env.local", "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const fmt = (d?: Date) => (d ? d.toLocaleDateString("en-GB") : "-");

type Rec = {
  _id: mongoose.Types.ObjectId;
  identifier: string;
  language?: string;
  fileType: "pdf" | "docx";
  content?: string;
  fileUrl?: string;
  sopBaseId?: string;
  versionNum?: number;
  expiryDate?: Date;
};

const langOf = (r: Rec) => (r.language === "Gujarati" ? "Gujarati" : "English");
const groupKey = (r: Rec) =>
  `${r.sopBaseId ?? r.identifier}::${r.versionNum ?? 0}::${langOf(r)}`;

/** Usable DOCX text — not a PDF blob, not a "[...]" extraction placeholder. */
function hasUsableDocxText(r: Rec): boolean {
  return (
    r.fileType === "docx" &&
    !!r.content &&
    !r.content.startsWith("[") &&
    !r.content.startsWith("%PDF")
  );
}

async function main() {
  loadEnv();
  const APPLY = process.argv.includes("--apply");
  const baseArg = process.argv.indexOf("--base");
  const BASE = baseArg >= 0 ? process.argv[baseArg + 1] : null;

  await mongoose.connect(process.env.MONGODB_URI!);
  const col = mongoose.connection.collection("sops");

  const query: Record<string, unknown> = { isObsolete: { $ne: true } };
  if (BASE) query.sopBaseId = BASE;

  const records = (await col
    .find(query, {
      projection: {
        identifier: 1,
        language: 1,
        fileType: 1,
        content: 1,
        fileUrl: 1,
        sopBaseId: 1,
        versionNum: 1,
        expiryDate: 1,
      },
    })
    .toArray()) as unknown as Rec[];

  // Group by (base, version, language) so a PDF can inherit its DOCX sibling's date.
  const groups = new Map<string, Rec[]>();
  for (const r of records) {
    const k = groupKey(r);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  const ops: Parameters<typeof col.bulkWrite>[0] = [];
  let filledRecords = 0;
  let filledGroups = 0;
  let stillNoDate = 0;
  let downloads = 0;
  const report: string[] = [];

  for (const [key, group] of groups) {
    // Only consider groups that actually contain a "No Date" record. Groups whose
    // records all have an expiryDate are validated buckets — left untouched.
    const undated = group.filter((r) => !r.expiryDate);
    if (undated.length === 0) continue;

    // Find the date source: a DOCX with usable text. Prefer stored content; fall
    // back to re-downloading the DOCX file only when stored content is unusable.
    let docx = group.find(hasUsableDocxText);
    let content = docx?.content;

    if (!content) {
      const docxFile = group.find((r) => r.fileType === "docx" && r.fileUrl);
      if (docxFile?.fileUrl) {
        try {
          const res = await fetch(docxFile.fileUrl);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            content = await extractTextFromBuffer(buf, "docx");
            docx = docxFile;
            downloads++;
          }
        } catch {
          /* fall through to "no source" handling below */
        }
      }
    }

    const resolved = content ? resolveSopDatesFromContent(content) : undefined;
    // resolveSopDatesFromContent only yields effectiveDate when the document
    // actually stated one — it never invents a date.
    if (!resolved?.effectiveDate || !resolved.expiryDate) {
      stillNoDate += undated.length;
      report.push(`  [no date in doc] ${key}  (${undated.length} record(s) stay No Date)`);
      continue;
    }

    const fields = sopDatesToDbFields(resolved);
    for (const r of undated) {
      ops.push({
        updateOne: {
          filter: { _id: r._id },
          // Bump updatedAt so the dashboard's grouped cache signature changes.
          update: { $set: { ...fields, updatedAt: new Date() } },
        },
      });
      filledRecords++;
    }
    filledGroups++;
    report.push(
      `  [fill] ${key.padEnd(34)} eff:${fmt(fields.effectiveDate)} exp:${fmt(fields.expiryDate)}  -> ${undated
        .map((r) => `${r.identifier}/${r.fileType}`)
        .join(", ")}`,
    );
  }

  console.log(`\n── No-Date backfill ${APPLY ? "(APPLY)" : "(DRY RUN)"} ${BASE ? `base=${BASE}` : ""} ──`);
  console.log(report.join("\n") || "  (nothing to do)");
  console.log(
    `\nGroups with a No-Date record fixed: ${filledGroups}` +
      `\nRecords filled:                     ${filledRecords}` +
      `\nRecords still No-Date (no doc date): ${stillNoDate}` +
      `\nDOCX re-downloads needed:           ${downloads}`,
  );

  if (APPLY && ops.length) {
    // Revert log: every _id we touch + the date fields we set, so this strictly
    // additive change can be undone (unset on exactly these records) if needed.
    const revert = ops.map((o) => {
      const u = (o as { updateOne: { filter: { _id: mongoose.Types.ObjectId }; update: { $set: Record<string, unknown> } } }).updateOne;
      return { _id: u.filter._id.toString(), set: u.update.$set };
    });
    const logPath = `scripts/.nodate-backfill-revert-${Date.now()}.json`;
    fs.writeFileSync(logPath, JSON.stringify(revert, null, 2));
    console.log(`Revert log written: ${logPath} (${revert.length} record(s))`);

    const res = await col.bulkWrite(ops);
    console.log(`\nApplied. modified=${res.modifiedCount}`);
    // Drop the persisted grouped-registry cache so the dashboard recomputes.
    try {
      await mongoose.connection.collection("dashboard_grouped_cache").deleteMany({
        key: { $regex: /^grouped-registry-v/ },
      });
      console.log("Dashboard grouped cache cleared.");
    } catch (e) {
      console.log("Cache clear skipped:", (e as Error).message);
    }
  } else if (!APPLY) {
    console.log("\nDry run — no writes. Re-run with --apply to persist.");
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
