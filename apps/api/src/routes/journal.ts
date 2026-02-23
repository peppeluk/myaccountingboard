import { readFile } from "node:fs/promises";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const JOURNAL_SHEET_PATH = "xl/worksheets/sheet2.xml";
const JOURNAL_START_ROW = 11;
const JOURNAL_END_ROW = 212;
const MAX_ENTRIES = JOURNAL_END_ROW - JOURNAL_START_ROW + 1;
const COLUMN_STYLE: Record<"D" | "E" | "F" | "G" | "H", string> = {
  D: "23",
  E: "24",
  F: "24",
  G: "25",
  H: "25"
};
type XmlDocument = ReturnType<DOMParser["parseFromString"]>;
type XmlElement = NonNullable<XmlDocument["documentElement"]>;

const entrySchema = z.object({
  date: z.string().max(20).optional().default(""),
  accountName: z.string().max(300).optional().default(""),
  description: z.string().max(1000).optional().default(""),
  debit: z.string().max(60).optional().default(""),
  credit: z.string().max(60).optional().default("")
});

const exportBodySchema = z.object({
  entries: z.array(entrySchema).max(MAX_ENTRIES),
  fileName: z.string().max(120).optional()
});

type JournalEntryPayload = z.infer<typeof entrySchema>;

function sanitizeFileName(input: string): string {
  const trimmed = input.trim();
  const stripped = trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cleaned = stripped.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "giornale_data";
}

function getSafeText(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function toExcelDateSerial(dateIso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return null;
  }
  const [yearText, monthText, dayText] = dateIso.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const utcDate = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utcDate)) {
    return null;
  }
  const excelEpoch = Date.UTC(1899, 11, 30);
  return Math.floor((utcDate - excelEpoch) / 86_400_000);
}

function parseAmount(value: string): number | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const base = raw.replace(/[€\s]/g, "");
  const normalized = base.includes(",") ? base.replace(/\./g, "").replace(",", ".") : base;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function getSheetDataNode(document: XmlDocument): XmlElement {
  const found = document.getElementsByTagNameNS(MAIN_NS, "sheetData").item(0);
  if (!found) {
    throw new Error("Struttura sheetData non trovata nel template.");
  }
  return found as XmlElement;
}

function getOrCreateRow(document: XmlDocument, sheetData: XmlElement, rowIndex: number): XmlElement {
  const rows = sheetData.getElementsByTagNameNS(MAIN_NS, "row");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows.item(index);
    if (row?.getAttribute("r") === String(rowIndex)) {
      return row as XmlElement;
    }
  }
  const row = document.createElementNS(MAIN_NS, "row");
  row.setAttribute("r", String(rowIndex));
  sheetData.appendChild(row);
  return row as XmlElement;
}

function getOrCreateCell(
  document: XmlDocument,
  row: XmlElement,
  rowIndex: number,
  column: "D" | "E" | "F" | "G" | "H"
): XmlElement {
  const reference = `${column}${rowIndex}`;
  const cells = row.getElementsByTagNameNS(MAIN_NS, "c");
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells.item(index);
    if (cell?.getAttribute("r") === reference) {
      return cell as XmlElement;
    }
  }
  const cell = document.createElementNS(MAIN_NS, "c");
  cell.setAttribute("r", reference);
  row.appendChild(cell);
  return cell as XmlElement;
}

function clearCell(cell: XmlElement, styleId: string): void {
  while (cell.firstChild) {
    cell.removeChild(cell.firstChild);
  }
  cell.removeAttribute("t");
  cell.setAttribute("s", styleId);
}

function setNumericCell(document: XmlDocument, cell: XmlElement, styleId: string, value: number): void {
  while (cell.firstChild) {
    cell.removeChild(cell.firstChild);
  }
  cell.removeAttribute("t");
  cell.setAttribute("s", styleId);
  const valueNode = document.createElementNS(MAIN_NS, "v");
  valueNode.appendChild(document.createTextNode(String(value)));
  cell.appendChild(valueNode);
}

function setTextCell(document: XmlDocument, cell: XmlElement, styleId: string, value: string): void {
  while (cell.firstChild) {
    cell.removeChild(cell.firstChild);
  }
  cell.setAttribute("s", styleId);
  cell.setAttribute("t", "inlineStr");

  const inline = document.createElementNS(MAIN_NS, "is");
  const text = document.createElementNS(MAIN_NS, "t");
  if (/^\s|\s$/.test(value) || /\s{2,}/.test(value)) {
    text.setAttribute("xml:space", "preserve");
  }
  text.appendChild(document.createTextNode(value));
  inline.appendChild(text);
  cell.appendChild(inline);
}

function applyEntryToRow(
  document: XmlDocument,
  row: XmlElement,
  rowIndex: number,
  entry: JournalEntryPayload | null
): void {
  const cellD = getOrCreateCell(document, row, rowIndex, "D");
  const cellE = getOrCreateCell(document, row, rowIndex, "E");
  const cellF = getOrCreateCell(document, row, rowIndex, "F");
  const cellG = getOrCreateCell(document, row, rowIndex, "G");
  const cellH = getOrCreateCell(document, row, rowIndex, "H");

  if (!entry) {
    clearCell(cellD, COLUMN_STYLE.D);
    clearCell(cellE, COLUMN_STYLE.E);
    clearCell(cellF, COLUMN_STYLE.F);
    clearCell(cellG, COLUMN_STYLE.G);
    clearCell(cellH, COLUMN_STYLE.H);
    return;
  }

  const serialDate = toExcelDateSerial(entry.date);
  const accountName = getSafeText(entry.accountName);
  const description = getSafeText(entry.description);
  const debit = parseAmount(entry.debit);
  const credit = parseAmount(entry.credit);

  if (serialDate !== null) {
    setNumericCell(document, cellD, COLUMN_STYLE.D, serialDate);
  } else {
    clearCell(cellD, COLUMN_STYLE.D);
  }

  if (accountName) {
    setTextCell(document, cellE, COLUMN_STYLE.E, accountName);
  } else {
    clearCell(cellE, COLUMN_STYLE.E);
  }

  if (description) {
    setTextCell(document, cellF, COLUMN_STYLE.F, description);
  } else {
    clearCell(cellF, COLUMN_STYLE.F);
  }

  if (debit !== null) {
    setNumericCell(document, cellG, COLUMN_STYLE.G, debit);
  } else {
    clearCell(cellG, COLUMN_STYLE.G);
  }

  if (credit !== null) {
    setNumericCell(document, cellH, COLUMN_STYLE.H, credit);
  } else {
    clearCell(cellH, COLUMN_STYLE.H);
  }
}

function enableFullRecalc(workbookXml: string): string {
  if (!workbookXml.includes("<calcPr")) {
    return workbookXml;
  }
  return workbookXml.replace(/<calcPr([^>]*)\/>/, (match, attrs: string) => {
    if (/fullCalcOnLoad=/.test(attrs)) {
      return match.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"');
    }
    return `<calcPr${attrs} fullCalcOnLoad="1"/>`;
  });
}

function normalizeEntries(entries: JournalEntryPayload[]): JournalEntryPayload[] {
  return entries.map((entry) => ({
    date: entry.date ?? "",
    accountName: entry.accountName ?? "",
    description: entry.description ?? "",
    debit: entry.debit ?? "",
    credit: entry.credit ?? ""
  }));
}

export function registerJournalRoutes(app: FastifyInstance, config: AppConfig): void {
  app.post("/api/journal/export", async (request, reply) => {
    const parsedBody = exportBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        message: "Payload export giornale non valido",
        issues: parsedBody.error.issues
      });
    }

    try {
      const templateBuffer = await readFile(config.JOURNAL_TEMPLATE_PATH);
      const zip = await JSZip.loadAsync(templateBuffer);
      const sheetFile = zip.file(JOURNAL_SHEET_PATH);
      if (!sheetFile) {
        return reply.code(500).send({
          message: "Template non valido: foglio LIBRO_GIORNALE non trovato."
        });
      }

      const xml = await sheetFile.async("string");
      const document = new DOMParser().parseFromString(xml, "text/xml");
      const sheetData = getSheetDataNode(document);
      const entries = normalizeEntries(parsedBody.data.entries);

      for (let rowIndex = JOURNAL_START_ROW; rowIndex <= JOURNAL_END_ROW; rowIndex += 1) {
        const row = getOrCreateRow(document, sheetData, rowIndex);
        const entry = entries[rowIndex - JOURNAL_START_ROW] ?? null;
        applyEntryToRow(document, row, rowIndex, entry);
      }

      const serializedSheet = new XMLSerializer().serializeToString(document);
      zip.file(JOURNAL_SHEET_PATH, serializedSheet);

      const workbookFile = zip.file("xl/workbook.xml");
      if (workbookFile) {
        const workbookXml = await workbookFile.async("string");
        zip.file("xl/workbook.xml", enableFullRecalc(workbookXml));
      }

      const outputBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 9 }
      });

      const datePart = new Date().toISOString().slice(0, 10);
      const safeBaseName = sanitizeFileName(parsedBody.data.fileName ?? `giornale_data_${datePart}`);

      reply.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      reply.header("Content-Disposition", `attachment; filename=\"${safeBaseName}.xlsx\"`);
      return reply.send(outputBuffer);
    } catch (error) {
      request.log.error(
        { error, templatePath: config.JOURNAL_TEMPLATE_PATH },
        "Impossibile generare il file Excel del giornale."
      );
      return reply.code(500).send({
        message:
          "Export non riuscito. Verifica che il template sia presente e accessibile dal server API."
      });
    }
  });
}
