import fs from "fs";
import path from "path";
import mongoose from "mongoose";

const envPath = path.join(process.cwd(), ".env.local");
const env = fs.readFileSync(envPath, "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)?.[1]?.trim();

const SOPSchema = new mongoose.Schema(
  {
    name: String,
    identifier: String,
    sopBaseId: String,
    versionNum: Number,
    version: String,
    fileUrl: String,
    fileType: String,
    language: String,
    isObsolete: Boolean,
    sopDocuments: [{ fileName: String, filePath: String, fileType: String, language: String }],
  },
  { strict: false, timestamps: true },
);

await mongoose.connect(uri);
const SOP = mongoose.models.SOP || mongoose.model("SOP", SOPSchema, "sops");
const records = await SOP.find({});

// Group by base SOP code
function baseId(record) {
  const base = record.sopBaseId ?? record.identifier ?? "";
  return base.trim().toUpperCase().replace(/_/g, "-").replace(/^([A-Z]{2,}[A-Z0-9]*)-\d+$/, "$1").replace(/^([A-Z]{2,}-[A-Z]{2,})-\d+$/, "$1");
}

function versionNum(record) {
  const fromId = (record.identifier ?? "").match(/[A-Z]+-(\d+)$/i)?.[1];
  if (fromId) return parseInt(fromId, 10);
  return parseFloat(record.version ?? "0") || 0;
}

const grouped = new Map();
for (const r of records) {
  const key = baseId(r);
  const bucket = grouped.get(key) ?? [];
  bucket.push(r);
  grouped.set(key, bucket);
}

// Find families with more than one distinct version number
const toDelete = [];
const families = [];

for (const [key, family] of grouped) {
  const versions = new Set(family.map(versionNum));
  if (versions.size <= 1) continue;
  families.push(key);
  toDelete.push(...family);
}

if (toDelete.length === 0) {
  console.log("No versioned SOP families found. Nothing deleted.");
  await mongoose.disconnect();
  process.exit(0);
}

console.log(`Found ${families.length} versioned SOP families: ${families.join(", ")}`);
console.log(`Total records to delete: ${toDelete.length}`);

// Delete files from public/uploads
let filesDeleted = 0;
for (const record of toDelete) {
  const urls = new Set();
  if (record.fileUrl) urls.add(record.fileUrl);
  for (const doc of record.sopDocuments ?? []) {
    if (doc.filePath) urls.add(doc.filePath);
  }

  for (const url of urls) {
    try {
      const raw = url.trim();
      const urlPath = raw.startsWith("http://") || raw.startsWith("https://")
        ? new URL(raw).pathname
        : raw;
      if (!urlPath.startsWith("/uploads/") && !urlPath.startsWith("uploads/")) continue;
      const fsPath = path.join(process.cwd(), "public", urlPath.replace(/^\//, ""));
      if (fs.existsSync(fsPath)) {
        fs.unlinkSync(fsPath);
        filesDeleted++;
        const dir = path.dirname(fsPath);
        const remaining = fs.readdirSync(dir).filter((f) => f !== ".gitkeep");
        if (remaining.length === 0) fs.rmdirSync(dir);
      }
    } catch {
      // skip
    }
  }
}

// Hard-delete from MongoDB
const ids = toDelete.map((r) => r._id);
const result = await SOP.deleteMany({ _id: { $in: ids } });

console.log(`Deleted ${result.deletedCount} records from MongoDB.`);
console.log(`Deleted ${filesDeleted} local files.`);
console.log("Done.");

await mongoose.disconnect();
