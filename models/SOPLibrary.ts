/**
 * The "SOP library" is not a separate collection — the master file records (including the
 * per-language `sopDocuments[]` where DOCX/PDF paths live) are stored in the `sops` collection.
 * SOPLibrary therefore reuses the SOP model so library lookups in lib/loadStoredFileBuffer.ts
 * resolve against the real data. Library callers must match on the `identifier` field
 * (SOP records have no `sopIdentifier`).
 */
export { default } from "./SOP";
export type { ISOP } from "./SOP";
