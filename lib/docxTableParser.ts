import AdmZip from "adm-zip";
import { parseStringPromise } from "xml2js";

interface TableRow {
  cells: string[];
}

interface Table {
  rows: TableRow[];
}

/** Extract tables from DOCX file by parsing the underlying XML. */
export async function extractTablesFromDOCX(buffer: Buffer): Promise<Table[]> {
  try {
    const zip = new AdmZip(buffer);
    const documentXml = zip.readAsText("word/document.xml");

    if (!documentXml) {
      throw new Error("Could not read document.xml from DOCX file");
    }

    const parsed = await parseStringPromise(documentXml);
    const body = parsed?.["w:document"]?.["w:body"]?.[0];

    if (!body) {
      return [];
    }

    const tables: Table[] = [];
    const tableElements = body["w:tbl"] || [];

    for (const tableElement of tableElements) {
      const table: Table = { rows: [] };
      const rows = tableElement["w:tr"] || [];

      for (const rowElement of rows) {
        const row: TableRow = { cells: [] };
        const cells = rowElement["w:tc"] || [];

        for (const cellElement of cells) {
          row.cells.push(extractTextFromElement(cellElement).trim());
        }

        if (row.cells.length > 0) {
          table.rows.push(row);
        }
      }

      if (table.rows.length > 0) {
        tables.push(table);
      }
    }

    return tables;
  } catch (error) {
    console.error("Error extracting tables from DOCX:", error);
    return [];
  }
}

function extractTextFromElement(element: any): string {
  let text = "";
  if (!element) return text;

  if (element["w:p"]) {
    const paragraphs = Array.isArray(element["w:p"]) ? element["w:p"] : [element["w:p"]];
    for (const para of paragraphs) {
      const runs = para["w:r"] || [];
      const runArray = Array.isArray(runs) ? runs : [runs];

      for (const run of runArray) {
        const textNodes = run["w:t"] || [];
        const textArray = Array.isArray(textNodes) ? textNodes : [textNodes];

        for (const textNode of textArray) {
          if (typeof textNode === "string") {
            text += textNode;
          } else if (textNode && textNode._) {
            text += textNode._;
          }
        }
      }

      text += " ";
    }
  }

  return text;
}
