import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Per-version file artifacts produced by the folder-upload pipeline: one document per
 * (identifier, language) holding an `entries[]` array, newest version first. Each entry
 * points at the reachable Bunny CDN path for that version's PDF and/or DOCX.
 *
 * Consumed by lib/loadStoredFileBuffer.ts (resolveFromVersionArtifacts) as the most reliable
 * source after migration. When the collection is empty the resolver degrades gracefully to the
 * SOP-collection lookups, so this model is safe to keep registered even before it is populated.
 */
export interface ISOPVersionArtifactEntry {
  version: number;
  pdfPath?: string;
  docxPath?: string;
}

export interface ISOPVersionArtifacts extends Document {
  identifier: string;
  /** Loosely typed: legacy folder-upload rows may use casings other than English/Gujarati. */
  language?: string;
  entries: ISOPVersionArtifactEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const SOPVersionArtifactEntrySchema = new Schema<ISOPVersionArtifactEntry>(
  {
    version: { type: Number, required: true },
    pdfPath: { type: String, trim: true },
    docxPath: { type: String, trim: true },
  },
  { _id: false },
);

const SOPVersionArtifactsSchema = new Schema<ISOPVersionArtifacts>(
  {
    identifier: { type: String, required: true, trim: true, index: true },
    language: { type: String, trim: true, default: "English" },
    entries: { type: [SOPVersionArtifactEntrySchema], default: [] },
  },
  { timestamps: true },
);

SOPVersionArtifactsSchema.index({ identifier: 1, language: 1 });

const SOPVersionArtifacts: Model<ISOPVersionArtifacts> =
  mongoose.models.SOPVersionArtifacts ||
  mongoose.model<ISOPVersionArtifacts>("SOPVersionArtifacts", SOPVersionArtifactsSchema);

export default SOPVersionArtifacts;
