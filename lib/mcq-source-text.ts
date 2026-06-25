import type { ISOP } from "@/models/SOP";

/** Max SOP excerpt chars per MCQ API call (cloud). ~8k tokens — enough for most SOPs. */
export const MCQ_CONTENT_LIMIT = 32_000;
/** Tighter cap for local Ollama context windows. */
export const MCQ_CONTENT_LIMIT_OLLAMA = 24_000;
/** When the normalized SOP exceeds the cap, rotate through this many section chunks
 *  across batches so we do not resend the full document every call. */
export const MCQ_CONTENT_CHUNKS = 4;

/** Placeholder / binary blobs stored instead of real text — never send to the model. */
export function isUnusableMcqSourceText(content?: string | null): boolean {
  if (!content) return true;
  const c = content.trim();
  return !c || c.startsWith("%PDF") || c.startsWith("[");
}

/** Collapse noise and repeated header paragraphs before MCQ generation. */
export function normalizeSopTextForMcq(raw: string): string {
  if (isUnusableMcqSourceText(raw)) return "";

  let t = raw.trim();
  t = t.replace(/[^\S\n]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");

  const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of paras) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique.join("\n\n");
}

/** Split normalized text into `parts` paragraph-balanced chunks. */
export function chunkSopText(text: string, parts: number): string[] {
  if (parts <= 1) return [text];
  const paras = text.split(/\n{2,}/).filter(Boolean);
  if (paras.length <= 1) return [text];

  const chunks: string[] = Array.from({ length: parts }, () => "");
  for (let i = 0; i < paras.length; i++) {
    const slot = i % parts;
    chunks[slot] = chunks[slot] ? `${chunks[slot]}\n\n${paras[i]}` : paras[i];
  }
  return chunks.filter((c) => c.length > 0);
}

/** SOP body to embed in one MCQ batch — normalized, chunked on long docs, capped. */
export function mcqPromptSopExcerpt(
  raw: string,
  batchIndex: number,
  maxChars: number,
  numChunks = MCQ_CONTENT_CHUNKS,
): string {
  const normalized = normalizeSopTextForMcq(raw);
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;

  const chunks = chunkSopText(normalized, numChunks);
  const chunk = chunks[batchIndex % chunks.length] ?? chunks[0] ?? normalized;
  return chunk.length <= maxChars ? chunk : chunk.slice(0, maxChars);
}

/** Prefer DOCX text over PDF extraction noise; score 0 = unusable. */
export function scoreSopRecordForMcq(sop: Pick<ISOP, "content" | "fileType">): number {
  const normalized = normalizeSopTextForMcq(sop.content ?? "");
  if (!normalized) return 0;
  const readable =
    (normalized.match(/[A-Za-z0-9 .,():;\/-]/g)?.length ?? 0) / normalized.length;
  if (readable < 0.6) return 0;
  const docxBonus = sop.fileType === "docx" ? 1_000_000 : 0;
  return docxBonus + normalized.length;
}
