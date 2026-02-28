// App utility functions - estratte da App.tsx
// Queste funzioni sono pure e testabili

import type { Page, PageCanvasDataMap, VirtualWindowRange } from "../types";

export function mergeRecognizedText(previous: string, nextChunk: string): string {
  if (!nextChunk) {
    return previous;
  }
  if (!previous) {
    return nextChunk;
  }
  if (previous.endsWith(nextChunk)) {
    return previous;
  }
  if (nextChunk.startsWith(previous)) {
    return nextChunk;
  }

  const maxOverlap = Math.min(previous.length, nextChunk.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previous.slice(-overlap) === nextChunk.slice(0, overlap)) {
      return `${previous}${nextChunk.slice(overlap)}`;
    }
  }
  return `${previous}${nextChunk}`;
}

export function formatArchiveDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(timestamp));
}

export function buildDocumentBaseName(timestamp: number): string {
  const date = new Date(timestamp);
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `MA_${d}${m}_${h}${min}${s}`;
}

export function normalizePageCanvasDataForPages(
  pages: Page[],
  input?: Record<string, string | null> | null,
  legacyCanvasData?: string | null
): PageCanvasDataMap {
  const source = input ?? {};
  return pages.reduce<PageCanvasDataMap>((acc, page, index) => {
    const nextValue = source[page.id];
    if (typeof nextValue === "string" || nextValue === null) {
      acc[page.id] = nextValue;
      return acc;
    }
    if (index === 0 && typeof legacyCanvasData === "string") {
      acc[page.id] = legacyCanvasData;
      return acc;
    }
    acc[page.id] = null;
    return acc;
  }, {});
}

export function computeVirtualWindowRange(
  scrollTop: number,
  viewportHeight: number,
  pageCount: number,
  bufferSize: number
): VirtualWindowRange {
  if (pageCount <= 0) {
    return { startIndex: 0, endIndex: -1 };
  }
  const step = 1600 + 24; // PAGE_HEIGHT + PAGE_SEPARATOR_HEIGHT
  const firstVisible = Math.floor(Math.max(0, scrollTop) / step);
  const lastVisible = Math.floor(Math.max(0, scrollTop + Math.max(1, viewportHeight) - 1) / step);
  return {
    startIndex: Math.min(Math.max(firstVisible - bufferSize, 0), pageCount - 1),
    endIndex: Math.min(Math.max(lastVisible + bufferSize, 0), pageCount - 1)
  };
}

export function buildIndexRange(startIndex: number, endIndex: number): number[] {
  if (endIndex < startIndex) {
    return [];
  }
  return Array.from({ length: endIndex - startIndex + 1 }, (_unused, offset) => startIndex + offset);
}
