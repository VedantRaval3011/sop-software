import mammoth from "mammoth";

export async function extractTextFromBuffer(
  buffer: Buffer,
  fileType: "pdf" | "docx",
): Promise<string> {
  if (fileType === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim() || "[Empty DOCX content]";
  }

  // Basic PDF text extraction placeholder — PDF parsing requires pdf-parse
  // For production PDFs, store extracted text at upload or use pdf-parse
  const asText = buffer.toString("utf8");
  const readable = asText.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
  if (readable.length > 200) return readable.slice(0, 50000);
  return "[PDF text extraction pending — upload DOCX for MCQ generation or install pdf-parse]";
}

export function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}
