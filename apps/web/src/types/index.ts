// Type definitions for MYAccounting app

export interface Page {
  id: string;
  name: string;
}

export interface PageCanvasDataMap {
  [pageId: string]: string | null;
}

export interface VirtualWindowRange {
  startIndex: number;
  endIndex: number;
}

export interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Tool = "pen" | "eraser" | "text" | "calculator";
export type SizeLevel = "thin" | "medium" | "large";
export type BackgroundMode = "plain" | "grid";

export interface JournalEntry {
  id: string;
  date: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: string;
  credit: string;
  closeLine: boolean;
}

export interface PersistedDocument {
  pages: Page[];
  canvasData: string | null;
  pageCanvasData: PageCanvasDataMap;
  journalEntries: JournalEntry[];
}

export interface ArchivedBoardDocument {
  id: string;
  fileName: string;
  updatedAt: number;
  pageCount: number;
  previewImages: string[];
  journalPreview: Array<{
    id: string;
    date?: string;
    accountCode?: string;
    accountName?: string;
    description?: string;
    debit?: string;
    credit?: string;
  }>;
}

export interface OcrWorker {
  recognize(image: string): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}
