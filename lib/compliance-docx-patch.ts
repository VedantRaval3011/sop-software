import JSZip from "jszip";
import { extractTextFromBuffer } from "@/lib/extractContent";
import { hashSopContent } from "@/lib/compliance-hashes";

export type DocxPatchResult = {
  success: boolean;
  originalText: string;
  modifiedText: string;
  changeSummary: string;
  buffer?: Buffer;
  error?: string;
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Replace the first occurrence of originalText with replacementText in document.xml
 * while preserving surrounding XML structure. Only <w:t> text nodes are modified.
 */
async function patchDocumentXml(
  xml: string,
  originalText: string,
  replacementText: string,
): Promise<{ xml: string; replaced: boolean }> {
  const plainOriginal = normalizeWhitespace(originalText);
  if (!plainOriginal) return { xml, replaced: false };

  const tNodeRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let fullPlain = "";
  const nodes: { start: number; end: number; text: string; match: string }[] = [];

  let m: RegExpExecArray | null;
  while ((m = tNodeRe.exec(xml)) !== null) {
    const decoded = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    nodes.push({ start: m.index, end: m.index + m[0].length, text: decoded, match: m[0] });
    fullPlain += decoded;
  }

  const normFull = normalizeWhitespace(fullPlain);
  const idx = normFull.toLowerCase().indexOf(plainOriginal.toLowerCase());
  if (idx < 0) return { xml, replaced: false };

  // Map normalized index back to node(s) — simple single-node replacement when possible
  let cursor = 0;
  for (const node of nodes) {
    const nodeNorm = normalizeWhitespace(node.text);
    const nodeStart = cursor;
    const nodeEnd = cursor + nodeNorm.length;
    cursor = nodeEnd + (node.text.length > nodeNorm.length ? 1 : 0);

    if (idx >= nodeStart && idx < nodeEnd) {
      const localStart = idx - nodeStart;
      const newNodeText =
        node.text.slice(0, localStart) +
        replacementText +
        node.text.slice(localStart + plainOriginal.length);
      const newMatch = node.match.replace(
        /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/,
        `$1${escapeXml(newNodeText)}$3`,
      );
      const patched = xml.slice(0, node.start) + newMatch + xml.slice(node.end);
      return { xml: patched, replaced: true };
    }
  }

  // Fallback: replace in concatenated plain text within first matching node containing substring
  for (const node of nodes) {
    if (node.text.toLowerCase().includes(plainOriginal.toLowerCase())) {
      const newNodeText = node.text.replace(originalText, replacementText);
      const newMatch = node.match.replace(
        /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/,
        `$1${escapeXml(newNodeText)}$3`,
      );
      const patched = xml.slice(0, node.start) + newMatch + xml.slice(node.end);
      return { xml: patched, replaced: true };
    }
  }

  return { xml, replaced: false };
}

/**
 * Apply a minimal text fix to a DOCX buffer. Headers, footers, styles, and tables
 * are left untouched — only document body text matching originalText is changed.
 */
export async function applyDocxTextFix(
  docxBuffer: Buffer,
  originalText: string,
  replacementText: string,
): Promise<DocxPatchResult> {
  const originalExtracted = await extractTextFromBuffer(docxBuffer, "docx");

  if (!originalText.trim()) {
    return {
      success: false,
      originalText,
      modifiedText: replacementText,
      changeSummary: "No original text specified",
      error: "originalText is required",
    };
  }

  try {
    const zip = await JSZip.loadAsync(docxBuffer);
    const docPath = "word/document.xml";
    const docFile = zip.file(docPath);
    if (!docFile) {
      return {
        success: false,
        originalText,
        modifiedText: replacementText,
        changeSummary: "document.xml not found",
        error: "Invalid DOCX structure",
      };
    }

    const xml = await docFile.async("string");
    const { xml: patchedXml, replaced } = await patchDocumentXml(xml, originalText, replacementText);

    if (!replaced) {
      return {
        success: false,
        originalText,
        modifiedText: replacementText,
        changeSummary: "Could not locate original text in DOCX body",
        error: "Text not found in document.xml",
      };
    }

    zip.file(docPath, patchedXml);
    const outBuffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const modifiedExtracted = await extractTextFromBuffer(outBuffer, "docx");

    return {
      success: true,
      originalText,
      modifiedText: replacementText,
      changeSummary: `Replaced ${originalText.slice(0, 80)}${originalText.length > 80 ? "…" : ""} in document body`,
      buffer: outBuffer,
    };
  } catch (err) {
    return {
      success: false,
      originalText,
      modifiedText: replacementText,
      changeSummary: "DOCX patch failed",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/** Apply fix to plain SOP text content (MongoDB content field). */
export function applyTextContentFix(
  content: string,
  originalText: string,
  replacementText: string,
): { content: string; replaced: boolean } {
  if (!originalText.trim() || !content.includes(originalText)) {
    const idx = content.toLowerCase().indexOf(originalText.toLowerCase());
    if (idx < 0) return { content, replaced: false };
    return {
      content:
        content.slice(0, idx) + replacementText + content.slice(idx + originalText.length),
      replaced: true,
    };
  }
  return { content: content.replace(originalText, replacementText), replaced: true };
}

export function contentHashAfterFix(content: string): string {
  return hashSopContent(content);
}
