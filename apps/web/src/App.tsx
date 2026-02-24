import { useCallback, useEffect, useRef, useState } from "react";
import type { Canvas as FabricCanvas, Line as FabricLine } from "fabric";
import { JournalPanel, type JournalEntry } from "./components/JournalPanel";
import { PIANO_DEI_CONTI } from "./data/pianoDeiConti";
import { exportJournalWorkbook } from "./lib/api";

type Tool = "pen" | "eraser" | "line" | "pan";
type SizeLevel = "thin" | "medium" | "large";
type BackgroundMode = "plain" | "grid";

type Page = {
  id: string;
  name: string;
};

type PersistedDocument = {
  pages: Page[];
  canvasData: string | null;
};

type ToolHandlers = {
  down?: (event: unknown) => void;
  move?: (event: unknown) => void;
  up?: (event: unknown) => void;
};

type SelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const STORAGE_KEY = "myaccounting.whiteboard.pages.v1";
const JOURNAL_STORAGE_KEY = "myaccounting.journal.entries.v1";
const BACKGROUND_STORAGE_KEY = "myaccounting.whiteboard.background.v1";
const MAX_JOURNAL_ENTRIES = 202;
const PAGE_HEIGHT = 1600;
const PAGE_SEPARATOR_HEIGHT = 24;
const MAX_HISTORY = 80;
const AUTO_ADD_SCROLL_THRESHOLD = 120;
const TOOL_LONG_PRESS_MS = 420;
const AUTO_OCR_DEBOUNCE_MS = 550;
const AUTO_OCR_PADDING = 24;
const PEN_DECIMATE = 0.6;
const ERASER_DECIMATE = 1.1;
const SNAPSHOT_NUMBER_PRECISION = 2;
const PDF_EXPORT_MULTIPLIER = 1.25;
const PDF_EXPORT_JPEG_QUALITY = 0.72;
const GRID_BACKGROUND_COLOR = "rgba(148, 163, 184, 0.35)";
const GRID_BACKGROUND_SIZE = 28;
const GRID_BACKGROUND_LINE_WIDTH = 1;
const SIZE_POPOVER_HALF_WIDTH = 72;
const SIZE_POPOVER_MARGIN = 8;
const SIZE_LEVELS: Array<{ key: SizeLevel; label: string }> = [
  { key: "thin", label: "Sottile" },
  { key: "medium", label: "Medio" },
  { key: "large", label: "Grande" }
];
const PEN_WIDTH_BY_LEVEL: Record<SizeLevel, number> = {
  thin: 2,
  medium: 5,
  large: 9
};
const ERASER_WIDTH_BY_LEVEL: Record<SizeLevel, number> = {
  thin: 8,
  medium: 22,
  large: 34
};
const COLOR_PRESETS = [
  { name: "Nero", value: "#000000" },
  { name: "Rosso", value: "#e53935" },
  { name: "Blu", value: "#1e3a8a" },
  { name: "Verde", value: "#16a34a" },
  { name: "Giallo", value: "#facc15" }
] as const;

type OcrWorker = {
  recognize(image: string): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

function createJournalEntry(): JournalEntry {
  return {
    id: `journal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: "",
    accountCode: "",
    accountName: "",
    description: "",
    debit: "",
    credit: ""
  };
}

function loadInitialJournalEntries(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(JOURNAL_STORAGE_KEY);
    if (!raw) {
      return [createJournalEntry()];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [createJournalEntry()];
    }

    const normalized = parsed
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const entry = item as Partial<JournalEntry>;
        return {
          id: typeof entry.id === "string" ? entry.id : createJournalEntry().id,
          date: typeof entry.date === "string" ? entry.date : "",
          accountCode: typeof entry.accountCode === "string" ? entry.accountCode : "",
          accountName: typeof entry.accountName === "string" ? entry.accountName : "",
          description: typeof entry.description === "string" ? entry.description : "",
          debit: typeof entry.debit === "string" ? entry.debit : "",
          credit: typeof entry.credit === "string" ? entry.credit : ""
        } satisfies JournalEntry;
      })
      .filter((item): item is JournalEntry => item !== null);

    return normalized.length > 0 ? normalized : [createJournalEntry()];
  } catch {
    return [createJournalEntry()];
  }
}

function loadInitialBackgroundMode(): BackgroundMode {
  try {
    const raw = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    return raw === "grid" ? "grid" : "plain";
  } catch {
    return "plain";
  }
}

function createPage(index: number): Page {
  return {
    id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Pagina ${index + 1}`
  };
}

function getPageTop(index: number): number {
  return index * (PAGE_HEIGHT + PAGE_SEPARATOR_HEIGHT);
}

function getDocumentHeight(pageCount: number): number {
  return pageCount * PAGE_HEIGHT + Math.max(0, pageCount - 1) * PAGE_SEPARATOR_HEIGHT;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getClientPositionFromEvent(rawEvent: Event): { x: number; y: number } | null {
  if (rawEvent instanceof MouseEvent) {
    return {
      x: rawEvent.clientX,
      y: rawEvent.clientY
    };
  }
  if (typeof TouchEvent !== "undefined" && rawEvent instanceof TouchEvent) {
    const touch = rawEvent.touches[0] ?? rawEvent.changedTouches[0];
    if (!touch) {
      return null;
    }
    return {
      x: touch.clientX,
      y: touch.clientY
    };
  }
  return null;
}

function getTouchCenter(touches: TouchList): { x: number; y: number } | null {
  if (touches.length < 2) {
    return null;
  }
  const first = touches.item(0);
  const second = touches.item(1);
  if (!first || !second) {
    return null;
  }
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2
  };
}

function roundForSnapshot(value: number): number {
  const factor = 10 ** SNAPSHOT_NUMBER_PRECISION;
  return Math.round(value * factor) / factor;
}

function drawGridBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  multiplier: number
): void {
  const step = GRID_BACKGROUND_SIZE * multiplier;
  const lineWidth = GRID_BACKGROUND_LINE_WIDTH * multiplier;

  context.save();
  context.strokeStyle = GRID_BACKGROUND_COLOR;
  context.lineWidth = lineWidth;
  context.beginPath();

  for (let x = 0; x <= width; x += step) {
    const px = Math.round(x) + 0.5;
    context.moveTo(px, 0);
    context.lineTo(px, height);
  }

  for (let y = 0; y <= height; y += step) {
    const py = Math.round(y) + 0.5;
    context.moveTo(0, py);
    context.lineTo(width, py);
  }

  context.stroke();
  context.restore();
}

function loadInitialDocument(): PersistedDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { pages: [createPage(0)], canvasData: null };
    }
    const parsed = JSON.parse(raw) as unknown;

    // Backward compatibility: legacy format was Page[] with per-page canvasData
    if (Array.isArray(parsed)) {
      const legacyPages = parsed
        .map((item, index) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const page = item as Partial<Page> & { canvasData?: string };
          return {
            id: typeof page.id === "string" ? page.id : `page-${index}`,
            name: typeof page.name === "string" ? page.name : `Pagina ${index + 1}`
          } satisfies Page;
        })
        .filter((item): item is Page => item !== null);

      const canvasData =
        typeof (parsed[0] as { canvasData?: unknown } | undefined)?.canvasData === "string"
          ? ((parsed[0] as { canvasData?: string }).canvasData ?? null)
          : null;

      return {
        pages: legacyPages.length > 0 ? legacyPages : [createPage(0)],
        canvasData
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return { pages: [createPage(0)], canvasData: null };
    }

    const persisted = parsed as Partial<PersistedDocument>;
    const normalizedPages = Array.isArray(persisted.pages)
      ? persisted.pages
          .map((item, index) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const page = item as Partial<Page>;
            return {
              id: typeof page.id === "string" ? page.id : `page-${index}`,
              name: typeof page.name === "string" ? page.name : `Pagina ${index + 1}`
            } satisfies Page;
          })
          .filter((item): item is Page => item !== null)
      : [];

    return {
      pages: normalizedPages.length > 0 ? normalizedPages : [createPage(0)],
      canvasData: typeof persisted.canvasData === "string" ? persisted.canvasData : null
    };
  } catch {
    return { pages: [createPage(0)], canvasData: null };
  }
}

function normalizeExpression(input: string): string {
  return input
    .replace(/\s+/g, "")
    .replace(/[xX\u00D7]/g, "*")
    .replace(/[:\u00F7]/g, "/")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^\d+\-*/().%^]/g, "")
    .trim();
}

function formatExpressionForDisplay(input: string): string {
  return input.replace(/\*/g, "x").replace(/\//g, ":");
}

function normalizeOcrOperators(input: string): string {
  return input
    .replace(/[‐‑‒–—−﹣_~]/g, "-")
    .replace(/[＋﹢]/g, "+")
    .replace(/[×✕✖＊⋅·•*]/g, "x")
    .replace(/[÷／]/g, ":")
    .replace(/([0-9)%])([tT†┼╋])(?=[0-9(])/g, "$1+")
    .replace(/([0-9)%])([;])(?=[0-9(])/g, "$1:")
    .replace(/([0-9)%])([xX])(?=[0-9(])/g, "$1x")
    .replace(/([0-9)%])([:/])(?=[0-9(])/g, "$1:");
}

function normalizeOcrChunk(input: string): string {
  const normalizedOperators = normalizeOcrOperators(input);
  return normalizedOperators
    .replace(/\s+/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^\d+\-x:().%^=]/g, "")
    .replace(/\+{2,}/g, "+")
    .replace(/x{2,}/g, "x")
    .replace(/:{2,}/g, ":")
    .trim();
}

function mergeRecognizedText(previous: string, nextChunk: string): string {
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

function App() {
  const initialDocumentRef = useRef<PersistedDocument>(loadInitialDocument());
  const [pages, setPages] = useState<Page[]>(() => initialDocumentRef.current.pages);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#000000");
  const [penSizeLevel, setPenSizeLevel] = useState<SizeLevel>("medium");
  const [eraserSizeLevel, setEraserSizeLevel] = useState<SizeLevel>("medium");
  const [isPenSizeMenuOpen, setIsPenSizeMenuOpen] = useState(false);
  const [isEraserSizeMenuOpen, setIsEraserSizeMenuOpen] = useState(false);
  const [isOcrEnabled, setIsOcrEnabled] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("OCR spento");
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [isJournalExtracting, setIsJournalExtracting] = useState(false);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => loadInitialJournalEntries());
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() => loadInitialBackgroundMode());
  const [display, setDisplay] = useState("");
  const [isCanvasReady, setIsCanvasReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const penToolRef = useRef<HTMLDivElement | null>(null);
  const eraserToolRef = useRef<HTMLDivElement | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eraserPreviewRef = useRef<HTMLDivElement | null>(null);

  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const activeLineRef = useRef<FabricLine | null>(null);
  const fabricModuleRef = useRef<typeof import("fabric") | null>(null);
  const toolHandlersRef = useRef<ToolHandlers>({});
  const activeToolRef = useRef<Tool>("pen");
  const selectionDragRef = useRef<{ active: boolean; startX: number; startY: number }>({
    active: false,
    startX: 0,
    startY: 0
  });

  const pagesRef = useRef<Page[]>(pages);
  const canvasDataRef = useRef<string | null>(initialDocumentRef.current.canvasData);
  const currentPageIndexRef = useRef(currentPageIndex);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const isRestoringRef = useRef(false);
  const isAutoAddingPageRef = useRef(false);
  const toolLongPressTimeoutRef = useRef<number | null>(null);
  const suppressToolClickRef = useRef(false);
  const autoOcrTimeoutRef = useRef<number | null>(null);
  const autoOcrRectRef = useRef<SelectionRect | null>(null);
  const isOcrEnabledRef = useRef(false);
  const isAutoOcrBusyRef = useRef(false);
  const lastOcrChunkRef = useRef<string>("");
  const clearAutoOcrScheduleRef = useRef<() => void>(() => undefined);
  const scheduleAutoOcrForRectRef = useRef<(rect: SelectionRect) => void>(() => undefined);

  const workerRef = useRef<OcrWorker | null>(null);
  const workerInitPromiseRef = useRef<Promise<OcrWorker> | null>(null);
  const penStrokeWidth = PEN_WIDTH_BY_LEVEL[penSizeLevel];
  const eraserStrokeWidth = ERASER_WIDTH_BY_LEVEL[eraserSizeLevel];

  const syncCanvasOffset = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.calcOffset();
  }, []);

  const persistDocument = useCallback((nextPages: Page[], nextCanvasData: string | null) => {
    pagesRef.current = nextPages;
    canvasDataRef.current = nextCanvasData;
    setPages(nextPages);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pages: nextPages,
        canvasData: nextCanvasData
      } satisfies PersistedDocument)
    );
  }, []);

  const snapshotCanvas = useCallback((): string | null => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const json = canvas.toJSON();
    return JSON.stringify(json, (_key, value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return roundForSnapshot(value);
      }
      return value;
    });
  }, []);

  const applyBrushSettings = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const fabricModule = fabricModuleRef.current;
    if (!canvas || !fabricModule) {
      return;
    }

    class PenBrush extends fabricModule.PencilBrush {
      _setBrushStyles(ctx: CanvasRenderingContext2D): void {
        super._setBrushStyles(ctx);
        ctx.globalCompositeOperation = "source-over";
      }
    }
    const penBrush = new PenBrush(canvas);
    canvas.freeDrawingBrush = penBrush as FabricCanvas["freeDrawingBrush"];
    const brush = canvas.freeDrawingBrush as (FabricCanvas["freeDrawingBrush"] & {
      decimate?: number;
    }) | undefined;
    if (!brush) {
      return;
    }
    brush.color = color;
    brush.width = penStrokeWidth;
    brush.decimate = PEN_DECIMATE;
  }, [color, penStrokeWidth]);

  const clearSelectionOverlay = useCallback(() => {
    const selectionCanvas = selectionCanvasRef.current;
    if (!selectionCanvas) {
      return;
    }
    const context = selectionCanvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
  }, []);

  const hideEraserPreview = useCallback(() => {
    const preview = eraserPreviewRef.current;
    if (!preview) {
      return;
    }
    preview.style.display = "none";
  }, []);

  const clearToolLongPress = useCallback(() => {
    if (toolLongPressTimeoutRef.current !== null) {
      window.clearTimeout(toolLongPressTimeoutRef.current);
      toolLongPressTimeoutRef.current = null;
    }
  }, []);

  const openToolSizeMenu = useCallback((nextTool: "pen" | "eraser") => {
    setTool(nextTool);
    if (nextTool === "pen") {
      setIsPenSizeMenuOpen(true);
      setIsEraserSizeMenuOpen(false);
      return;
    }
    setIsEraserSizeMenuOpen(true);
    setIsPenSizeMenuOpen(false);
  }, []);

  const handleToolLongPressStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, nextTool: "pen" | "eraser") => {
      if (event.button !== 0) {
        return;
      }
      clearToolLongPress();
      toolLongPressTimeoutRef.current = window.setTimeout(() => {
        suppressToolClickRef.current = true;
        openToolSizeMenu(nextTool);
        toolLongPressTimeoutRef.current = null;
      }, TOOL_LONG_PRESS_MS);
    },
    [clearToolLongPress, openToolSizeMenu]
  );

  const handleToolLongPressEnd = useCallback(() => {
    clearToolLongPress();
  }, [clearToolLongPress]);

  const handleBoardPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      const preview = eraserPreviewRef.current;
      if (!container || !preview) {
        return;
      }

      if (tool !== "eraser" || isSelectionMode || isOcrRunning) {
        hideEraserPreview();
        return;
      }

      const rect = container.getBoundingClientRect();
      const pointerX = container.scrollLeft + (event.clientX - rect.left);
      const pointerY = container.scrollTop + (event.clientY - rect.top);
      const size = eraserStrokeWidth;

      preview.style.width = `${size}px`;
      preview.style.height = `${size}px`;
      preview.style.left = `${pointerX - size / 2}px`;
      preview.style.top = `${pointerY - size / 2}px`;
      preview.style.display = "block";
    },
    [eraserStrokeWidth, hideEraserPreview, isOcrRunning, isSelectionMode, tool]
  );

  const loadCanvasData = useCallback(
    async (canvasData: string | null) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) {
        return;
      }

      isRestoringRef.current = true;
      canvas.clear();
      clearSelectionOverlay();

      if (canvasData) {
        const parsed = JSON.parse(canvasData) as Record<string, unknown>;
        await canvas.loadFromJSON(parsed);
      }
      canvas.requestRenderAll();
      isRestoringRef.current = false;
    },
    [clearSelectionOverlay]
  );

  const resetHistory = useCallback(() => {
    const snapshot = snapshotCanvas();
    undoStackRef.current = snapshot ? [snapshot] : [];
    redoStackRef.current = [];
  }, [snapshotCanvas]);

  const persistCurrentDocument = useCallback(() => {
    const snapshot = snapshotCanvas();
    if (!snapshot) {
      return;
    }
    if (canvasDataRef.current === snapshot) {
      return;
    }
    persistDocument(pagesRef.current, snapshot);
  }, [persistDocument, snapshotCanvas]);

  const pushHistoryState = useCallback(() => {
    if (isRestoringRef.current) {
      return;
    }
    const snapshot = snapshotCanvas();
    if (!snapshot) {
      return;
    }

    const stack = undoStackRef.current;
    if (stack[stack.length - 1] === snapshot) {
      return;
    }

    stack.push(snapshot);
    if (stack.length > MAX_HISTORY) {
      stack.shift();
    }
    redoStackRef.current = [];
    persistCurrentDocument();
  }, [persistCurrentDocument, snapshotCanvas]);

  const handlePathCreated = useCallback(
    (event: unknown) => {
      const path = (
        event as {
          path?: {
            set?: (props: Record<string, unknown>) => void;
            getBoundingRect?: (options?: { absolute?: boolean; stroke?: boolean }) => SelectionRect;
          };
        }
      ).path;
      if (path?.set) {
        if (activeToolRef.current === "eraser") {
          path.set({
            globalCompositeOperation: "destination-out",
            selectable: false,
            evented: false,
            strokeLineCap: "round",
            strokeLineJoin: "round"
          });
        } else {
          path.set({
            globalCompositeOperation: "source-over",
            selectable: false,
            evented: false
          });
        }
      }
      fabricCanvasRef.current?.requestRenderAll();
      pushHistoryState();

      if (activeToolRef.current === "pen" && path?.getBoundingRect && isOcrEnabledRef.current) {
        const rect = path.getBoundingRect({ absolute: true, stroke: true });
        scheduleAutoOcrForRectRef.current(rect);
      }
    },
    [pushHistoryState]
  );

  const detachToolHandlers = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    const handlers = toolHandlersRef.current;
    if (handlers.down) {
      canvas.off("mouse:down", handlers.down);
    }
    if (handlers.move) {
      canvas.off("mouse:move", handlers.move);
    }
    if (handlers.up) {
      canvas.off("mouse:up", handlers.up);
    }
    toolHandlersRef.current = {};
  }, []);

  const configureActiveTool = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const fabricModule = fabricModuleRef.current;
    const container = containerRef.current;
    if (!canvas) {
      return;
    }
    container?.classList.remove("is-panning");
    syncCanvasOffset();
    activeToolRef.current = tool;

    detachToolHandlers();
    activeLineRef.current = null;

    if (tool === "pen") {
      canvas.isDrawingMode = true;
      canvas.selection = false;
      const topContext = (canvas as unknown as { contextTop?: CanvasRenderingContext2D }).contextTop;
      if (topContext) {
        topContext.globalCompositeOperation = "source-over";
      }
      applyBrushSettings();
      return;
    }

    if (tool === "eraser") {
      if (!fabricModule) {
        return;
      }

      class EraserBrush extends fabricModule.PencilBrush {
        _setBrushStyles(ctx: CanvasRenderingContext2D): void {
          super._setBrushStyles(ctx);
          ctx.globalCompositeOperation = "destination-out";
        }
      }

      const eraserBrush = new EraserBrush(canvas);
      canvas.freeDrawingBrush = eraserBrush as FabricCanvas["freeDrawingBrush"];
      const brush = canvas.freeDrawingBrush as (FabricCanvas["freeDrawingBrush"] & {
        decimate?: number;
      }) | undefined;
      if (!brush) {
        return;
      }
      brush.color = "#000000";
      brush.width = eraserStrokeWidth;
      brush.decimate = ERASER_DECIMATE;
      canvas.isDrawingMode = true;
      canvas.selection = false;
      return;
    }

    canvas.isDrawingMode = false;
    canvas.selection = false;
    const topContext = (canvas as unknown as { contextTop?: CanvasRenderingContext2D }).contextTop;
    if (topContext) {
      topContext.globalCompositeOperation = "source-over";
    }

    if (tool === "pan") {
      let isPanning = false;
      let startX = 0;
      let startY = 0;
      let startScrollLeft = 0;
      let startScrollTop = 0;

      const down = (event: unknown) => {
        const opt = event as { e: Event };
        const rawEvent = opt.e;
        if (rawEvent instanceof MouseEvent && rawEvent.button !== 0) {
          return;
        }
        const position = getClientPositionFromEvent(rawEvent);
        if (!position || !container) {
          return;
        }
        isPanning = true;
        startX = position.x;
        startY = position.y;
        startScrollLeft = container.scrollLeft;
        startScrollTop = container.scrollTop;
        container.classList.add("is-panning");
        rawEvent.preventDefault?.();
      };

      const move = (event: unknown) => {
        if (!isPanning || !container) {
          return;
        }
        const opt = event as { e: Event };
        const rawEvent = opt.e;
        const position = getClientPositionFromEvent(rawEvent);
        if (!position) {
          return;
        }
        const deltaX = position.x - startX;
        const deltaY = position.y - startY;
        container.scrollLeft = startScrollLeft - deltaX;
        container.scrollTop = startScrollTop - deltaY;
        rawEvent.preventDefault?.();
      };

      const up = () => {
        isPanning = false;
        container?.classList.remove("is-panning");
      };

      canvas.on("mouse:down", down);
      canvas.on("mouse:move", move);
      canvas.on("mouse:up", up);
      toolHandlersRef.current = { down, move, up };
      return;
    }

    const down = (event: unknown) => {
      const opt = event as { e: MouseEvent };
      const pointer = canvas.getPointer(opt.e);
      if (!fabricModule) {
        return;
      }
      const line = new fabricModule.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: color,
        strokeWidth: penStrokeWidth,
        selectable: false
      });
      activeLineRef.current = line;
      canvas.add(line);
    };

    const move = (event: unknown) => {
      const line = activeLineRef.current;
      if (!line) {
        return;
      }
      const opt = event as { e: MouseEvent };
      const pointer = canvas.getPointer(opt.e);
      line.set({
        x2: pointer.x,
        y2: pointer.y
      });
      canvas.requestRenderAll();
    };

    const up = () => {
      if (!activeLineRef.current) {
        return;
      }
      activeLineRef.current = null;
      pushHistoryState();
    };

    canvas.on("mouse:down", down);
    canvas.on("mouse:move", move);
    canvas.on("mouse:up", up);
    toolHandlersRef.current = { down, move, up };
  }, [applyBrushSettings, color, detachToolHandlers, eraserStrokeWidth, penStrokeWidth, pushHistoryState, syncCanvasOffset, tool]);

  const resizeCanvas = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const container = containerRef.current;
    const selectionCanvas = selectionCanvasRef.current;
    const wrapper = wrapperRef.current;

    if (!canvas || !container || !selectionCanvas || !wrapper) {
      return;
    }

    const width = Math.max(1, Math.floor(container.clientWidth));
    const documentHeight = getDocumentHeight(pagesRef.current.length);

    canvas.setDimensions({ width, height: documentHeight });
    canvas.calcOffset();

    selectionCanvas.width = width;
    selectionCanvas.height = documentHeight;
    selectionCanvas.style.width = `${width}px`;
    selectionCanvas.style.height = `${documentHeight}px`;

    wrapper.style.height = `${documentHeight}px`;
    wrapper.style.width = `${width}px`;
    canvas.requestRenderAll();
  }, []);

  const getWorker = useCallback(async (): Promise<OcrWorker> => {
    if (workerRef.current) {
      return workerRef.current;
    }
    if (!workerInitPromiseRef.current) {
      workerInitPromiseRef.current = import("tesseract.js").then((tesseract) =>
        tesseract.createWorker("eng").then(async (worker) => {
          const configurableWorker = worker as OcrWorker & {
            setParameters?: (params: Record<string, string>) => Promise<unknown>;
          };
          if (configurableWorker.setParameters) {
            await configurableWorker.setParameters({
              tessedit_pageseg_mode: "6",
              tessedit_char_whitelist: "0123456789+-*/xX().,%=:;tT\u00D7\u00F7"
            });
          }
          const typedWorker = configurableWorker as OcrWorker;
          workerRef.current = typedWorker;
          return typedWorker;
        })
      );
    }
    return workerInitPromiseRef.current;
  }, []);

  const switchPage = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const clampedIndex = clamp(index, 0, Math.max(0, pagesRef.current.length - 1));
    currentPageIndexRef.current = clampedIndex;
    setCurrentPageIndex(clampedIndex);
    container.scrollTo({
      top: getPageTop(clampedIndex),
      behavior: "smooth"
    });
  }, []);

  const addPage = useCallback(async () => {
    persistCurrentDocument();
    const nextPages = [...pagesRef.current, createPage(pagesRef.current.length)];
    persistDocument(nextPages, canvasDataRef.current);
    resizeCanvas();
  }, [persistCurrentDocument, persistDocument, resizeCanvas]);

  const clearAllPages = useCallback(async () => {
    if (!window.confirm("Vuoi cancellare tutte le pagine?")) {
      return;
    }

    const initialPages = [createPage(0)];
    persistDocument(initialPages, null);
    lastOcrChunkRef.current = "";
    autoOcrRectRef.current = null;
    clearAutoOcrScheduleRef.current();
    currentPageIndexRef.current = 0;
    setCurrentPageIndex(0);
    await loadCanvasData(null);
    resetHistory();
    containerRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [loadCanvasData, persistDocument, resetHistory]);

  const exportPdf = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    persistCurrentDocument();

    const pagesSnapshot = pagesRef.current;
    if (pagesSnapshot.length === 0) {
      return;
    }

    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });

    for (let i = 0; i < pagesSnapshot.length; i += 1) {
      const pageCanvas = canvas.toCanvasElement(PDF_EXPORT_MULTIPLIER, {
        left: 0,
        top: getPageTop(i),
        width: canvas.getWidth(),
        height: PAGE_HEIGHT
      });
      const flattenedCanvas = document.createElement("canvas");
      flattenedCanvas.width = pageCanvas.width;
      flattenedCanvas.height = pageCanvas.height;
      const flattenedContext = flattenedCanvas.getContext("2d");
      if (!flattenedContext) {
        continue;
      }
      flattenedContext.fillStyle = "#ffffff";
      flattenedContext.fillRect(0, 0, flattenedCanvas.width, flattenedCanvas.height);
      if (backgroundMode === "grid") {
        drawGridBackground(flattenedContext, flattenedCanvas.width, flattenedCanvas.height, PDF_EXPORT_MULTIPLIER);
      }
      flattenedContext.drawImage(pageCanvas, 0, 0);

      const image = flattenedCanvas.toDataURL("image/jpeg", PDF_EXPORT_JPEG_QUALITY);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const ratio = canvas.getWidth() / PAGE_HEIGHT;
      const drawWidth = pageWidth - 30;
      const drawHeight = drawWidth / ratio;
      const y = Math.max(15, (pageHeight - drawHeight) / 2);

      if (i > 0) {
        doc.addPage();
      }
      doc.addImage(image, "JPEG", 15, y, drawWidth, drawHeight, undefined, "MEDIUM");
    }

    const defaultName = `lavagna_${new Date().toISOString().slice(0, 10)}`;
    const fileName = window.prompt("Nome PDF", defaultName) ?? defaultName;
    doc.save(`${fileName}.pdf`);
  }, [backgroundMode, persistCurrentDocument]);

  const undo = useCallback(async () => {
    const undoStack = undoStackRef.current;
    if (undoStack.length <= 1) {
      return;
    }

    const currentState = undoStack.pop();
    if (!currentState) {
      return;
    }

    redoStackRef.current.push(currentState);
    const previousState = undoStack[undoStack.length - 1];
    if (!previousState) {
      return;
    }

    await loadCanvasData(previousState);
    persistCurrentDocument();
  }, [loadCanvasData, persistCurrentDocument]);

  const redo = useCallback(async () => {
    const redoStack = redoStackRef.current;
    const nextState = redoStack.pop();
    if (!nextState) {
      return;
    }

    undoStackRef.current.push(nextState);
    await loadCanvasData(nextState);
    persistCurrentDocument();
  }, [loadCanvasData, persistCurrentDocument]);

  const addJournalEntry = useCallback(() => {
    setJournalEntries((previous) => {
      if (previous.length >= MAX_JOURNAL_ENTRIES) {
        window.alert(`Hai raggiunto il limite massimo di ${MAX_JOURNAL_ENTRIES} righe compilabili.`);
        return previous;
      }
      return [...previous, createJournalEntry()];
    });
  }, []);

  const clearJournalEntries = useCallback(() => {
    if (!window.confirm("Vuoi svuotare tutte le righe del Libro Giornale?")) {
      return;
    }
    setJournalEntries([createJournalEntry()]);
  }, []);

  const removeJournalEntry = useCallback((entryId: string) => {
    setJournalEntries((previous) => {
      if (previous.length <= 1) {
        return previous;
      }
      const nextEntries = previous.filter((entry) => entry.id !== entryId);
      return nextEntries.length > 0 ? nextEntries : [createJournalEntry()];
    });
  }, []);

  const updateJournalEntry = useCallback((entryId: string, patch: Partial<JournalEntry>) => {
    setJournalEntries((previous) =>
      previous.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }
        return {
          ...entry,
          ...patch
        };
      })
    );
  }, []);

  const extractJournalData = useCallback(async () => {
    setIsJournalExtracting(true);
    try {
      const payload = journalEntries.map((entry) => ({
        date: entry.date,
        accountName: entry.accountName,
        description: entry.description,
        debit: entry.debit,
        credit: entry.credit
      }));
      const datePart = new Date().toISOString().slice(0, 10);
      const blob = await exportJournalWorkbook(payload, `giornale_data_${datePart}`);

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `giornale_data_${datePart}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch {
      window.alert(
        "Estrazione non riuscita. Verifica che API sia avviata e che il template sia configurato in JOURNAL_TEMPLATE_PATH."
      );
    } finally {
      setIsJournalExtracting(false);
    }
  }, [journalEntries]);

  const appendDisplay = useCallback((value: string) => {
    setDisplay((previous) => `${previous}${value}`);
  }, []);

  const solveDisplayExpression = useCallback(
    async (rawInput: string, fromOcr = false): Promise<boolean> => {
      const leftSide = rawInput.includes("=") ? rawInput.split("=")[0] ?? "" : rawInput;
      const expression = normalizeExpression(leftSide);
      if (!expression) {
        return false;
      }

      try {
        const { evaluate } = await import("mathjs");
        const result = evaluate(expression);
        const resolved = `${formatExpressionForDisplay(expression)}=${result}`;
        setDisplay(resolved);
        if (fromOcr) {
          setOcrStatus(`OCR ok: ${resolved}`);
        }
        return true;
      } catch {
        if (fromOcr) {
          setOcrStatus("OCR: espressione non valida");
          return false;
        }
        window.alert("Espressione non valida");
        return false;
      }
    },
    []
  );

  const calculate = useCallback(async () => {
    await solveDisplayExpression(display);
  }, [display, solveDisplayExpression]);

  const handlePenClick = useCallback(() => {
    if (suppressToolClickRef.current) {
      suppressToolClickRef.current = false;
      return;
    }
    setTool("pen");
    setIsPenSizeMenuOpen(false);
    setIsEraserSizeMenuOpen(false);
  }, []);

  const handleEraserClick = useCallback(() => {
    if (suppressToolClickRef.current) {
      suppressToolClickRef.current = false;
      return;
    }
    setTool("eraser");
    setIsEraserSizeMenuOpen(false);
    setIsPenSizeMenuOpen(false);
  }, []);

  const getSizePopoverStyle = useCallback((anchor: HTMLDivElement | null) => {
    if (!anchor) {
      return { visibility: "hidden" } as const;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const centerX = clamp(
      rect.left + rect.width / 2,
      SIZE_POPOVER_MARGIN + SIZE_POPOVER_HALF_WIDTH,
      viewportWidth - SIZE_POPOVER_MARGIN - SIZE_POPOVER_HALF_WIDTH
    );
    const shouldOpenAbove = rect.top > 76;

    return {
      left: `${centerX}px`,
      top: shouldOpenAbove ? `${rect.top - 8}px` : `${rect.bottom + 8}px`,
      transform: shouldOpenAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)"
    } as const;
  }, []);

  const clearAutoOcrSchedule = useCallback(() => {
    if (autoOcrTimeoutRef.current !== null) {
      window.clearTimeout(autoOcrTimeoutRef.current);
      autoOcrTimeoutRef.current = null;
    }
  }, []);
  clearAutoOcrScheduleRef.current = clearAutoOcrSchedule;

  const runAutoOcrFromPendingRect = useCallback(async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !isOcrEnabledRef.current || isSelectionMode || isAutoOcrBusyRef.current) {
      return;
    }

    const rect = autoOcrRectRef.current;
    if (!rect || rect.width < 8 || rect.height < 8) {
      return;
    }
    autoOcrRectRef.current = null;
    isAutoOcrBusyRef.current = true;
    setIsOcrRunning(true);
    setOcrStatus("OCR automatico...");

    try {
      const imageData = canvas.toDataURL({
        format: "png",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        multiplier: 2
      });

      const worker = await getWorker();
      const result = await worker.recognize(imageData);
      if (!isOcrEnabledRef.current) {
        return;
      }
      const chunk = normalizeOcrChunk(result.data.text);

      if (!chunk) {
        setOcrStatus("OCR automatico: nessun testo");
        return;
      }

      if (chunk === lastOcrChunkRef.current) {
        setOcrStatus(`OCR: ${chunk}`);
        return;
      }
      lastOcrChunkRef.current = chunk;

      let mergedDisplay = "";
      setDisplay((previous) => {
        mergedDisplay = mergeRecognizedText(previous, chunk);
        return mergedDisplay;
      });
      setOcrStatus(`OCR: ${chunk}`);

      if (mergedDisplay.includes("=")) {
        await solveDisplayExpression(mergedDisplay, true);
      }
    } catch {
      setOcrStatus("OCR automatico fallito");
    } finally {
      isAutoOcrBusyRef.current = false;
      setIsOcrRunning(false);

      if (isOcrEnabledRef.current && autoOcrRectRef.current && autoOcrTimeoutRef.current === null) {
        autoOcrTimeoutRef.current = window.setTimeout(() => {
          autoOcrTimeoutRef.current = null;
          void runAutoOcrFromPendingRect();
        }, AUTO_OCR_DEBOUNCE_MS);
      }
    }
  }, [getWorker, isSelectionMode, solveDisplayExpression]);

  const scheduleAutoOcrForRect = useCallback(
    (rect: SelectionRect) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || !isOcrEnabledRef.current) {
        return;
      }

      const canvasWidth = canvas.getWidth();
      const canvasHeight = canvas.getHeight();
      const left = clamp(Math.floor(rect.left - AUTO_OCR_PADDING), 0, canvasWidth);
      const top = clamp(Math.floor(rect.top - AUTO_OCR_PADDING), 0, canvasHeight);
      const right = clamp(Math.ceil(rect.left + rect.width + AUTO_OCR_PADDING), 0, canvasWidth);
      const bottom = clamp(Math.ceil(rect.top + rect.height + AUTO_OCR_PADDING), 0, canvasHeight);
      const normalizedRect: SelectionRect = {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
      };

      const previousRect = autoOcrRectRef.current;
      autoOcrRectRef.current = previousRect
        ? {
            left: Math.min(previousRect.left, normalizedRect.left),
            top: Math.min(previousRect.top, normalizedRect.top),
            width: Math.max(previousRect.left + previousRect.width, normalizedRect.left + normalizedRect.width) -
              Math.min(previousRect.left, normalizedRect.left),
            height: Math.max(previousRect.top + previousRect.height, normalizedRect.top + normalizedRect.height) -
              Math.min(previousRect.top, normalizedRect.top)
          }
        : normalizedRect;

      clearAutoOcrSchedule();
      autoOcrTimeoutRef.current = window.setTimeout(() => {
        autoOcrTimeoutRef.current = null;
        void runAutoOcrFromPendingRect();
      }, AUTO_OCR_DEBOUNCE_MS);
    },
    [clearAutoOcrSchedule, runAutoOcrFromPendingRect]
  );
  scheduleAutoOcrForRectRef.current = scheduleAutoOcrForRect;

  const runOcrForRect = useCallback(
    async (rect: SelectionRect) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || !isOcrEnabledRef.current || rect.width < 6 || rect.height < 6) {
        return;
      }

      setIsOcrRunning(true);
      setOcrStatus("OCR in corso...");

      try {
        const imageData = canvas.toDataURL({
          format: "png",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          multiplier: 2
        });

        const worker = await getWorker();
        const result = await worker.recognize(imageData);
        const cleaned = normalizeOcrChunk(result.data.text);

        if (cleaned) {
          let mergedDisplay = "";
          setDisplay((previous) => {
            mergedDisplay = mergeRecognizedText(previous, cleaned);
            return mergedDisplay;
          });
          setOcrStatus(`OCR ok: ${cleaned}`);
          if (mergedDisplay.includes("=")) {
            await solveDisplayExpression(mergedDisplay, true);
          }
        } else {
          setOcrStatus("OCR completato: nessuna operazione valida trovata");
        }
      } catch {
        setOcrStatus("OCR fallito");
      } finally {
        clearSelectionOverlay();
        selectionDragRef.current.active = false;
        setIsSelectionMode(false);
        setIsOcrRunning(false);
      }
    },
    [clearSelectionOverlay, getWorker, solveDisplayExpression]
  );

  const handleSelectionPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isSelectionMode || isOcrRunning) {
        return;
      }
      selectionDragRef.current = {
        active: true,
        startX: event.nativeEvent.offsetX,
        startY: event.nativeEvent.offsetY
      };
      clearSelectionOverlay();
    },
    [clearSelectionOverlay, isOcrRunning, isSelectionMode]
  );

  const handleSelectionPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isSelectionMode || !selectionDragRef.current.active) {
        return;
      }
      const selectionCanvas = selectionCanvasRef.current;
      if (!selectionCanvas) {
        return;
      }
      const context = selectionCanvas.getContext("2d");
      if (!context) {
        return;
      }

      const endX = event.nativeEvent.offsetX;
      const endY = event.nativeEvent.offsetY;
      const left = Math.min(selectionDragRef.current.startX, endX);
      const top = Math.min(selectionDragRef.current.startY, endY);
      const width = Math.abs(endX - selectionDragRef.current.startX);
      const height = Math.abs(endY - selectionDragRef.current.startY);

      clearSelectionOverlay();
      context.setLineDash([6, 5]);
      context.lineWidth = 2;
      context.strokeStyle = "#d92d20";
      context.strokeRect(left, top, width, height);
    },
    [clearSelectionOverlay, isSelectionMode]
  );

  const handleSelectionPointerUp = useCallback(
    async (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isSelectionMode || !selectionDragRef.current.active) {
        return;
      }

      const endX = event.nativeEvent.offsetX;
      const endY = event.nativeEvent.offsetY;
      const left = Math.min(selectionDragRef.current.startX, endX);
      const top = Math.min(selectionDragRef.current.startY, endY);
      const width = Math.abs(endX - selectionDragRef.current.startX);
      const height = Math.abs(endY - selectionDragRef.current.startY);

      await runOcrForRect({ left, top, width, height });
    },
    [isSelectionMode, runOcrForRect]
  );

  useEffect(() => {
    const drawingCanvas = drawingCanvasRef.current;
    if (!drawingCanvas) {
      return;
    }

    let unmounted = false;
    let onResize: (() => void) | null = null;
    let createdCanvas: FabricCanvas | null = null;

    void import("fabric").then((fabricModule) => {
      if (unmounted) {
        return;
      }
      fabricModuleRef.current = fabricModule;

      const canvas = new fabricModule.Canvas(drawingCanvas, {
        isDrawingMode: true,
        selection: false
      });
      createdCanvas = canvas;
      fabricCanvasRef.current = canvas;
      setIsCanvasReady(true);
      applyBrushSettings();

      canvas.on("path:created", handlePathCreated);
      canvas.on("object:modified", pushHistoryState);
      canvas.on("object:removed", pushHistoryState);

      resizeCanvas();
      syncCanvasOffset();
      void loadCanvasData(canvasDataRef.current).then(() => {
        resetHistory();
      });

      onResize = () => {
        resizeCanvas();
        syncCanvasOffset();
      };
      window.addEventListener("resize", onResize);
    });

    return () => {
      unmounted = true;
      if (onResize) {
        window.removeEventListener("resize", onResize);
      }
      detachToolHandlers();
      createdCanvas?.dispose();
      fabricCanvasRef.current = null;
      fabricModuleRef.current = null;
      setIsCanvasReady(false);
    };
  }, [applyBrushSettings, detachToolHandlers, handlePathCreated, loadCanvasData, pushHistoryState, resetHistory, resizeCanvas, syncCanvasOffset]);

  useEffect(() => {
    if (!isCanvasReady) {
      return;
    }
    configureActiveTool();
  }, [configureActiveTool, isCanvasReady]);

  useEffect(() => {
    if (!isCanvasReady || tool !== "pen") {
      return;
    }
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }
    syncCanvasOffset();
    canvas.isDrawingMode = true;
    canvas.selection = false;
    applyBrushSettings();
  }, [applyBrushSettings, isCanvasReady, penSizeLevel, color, syncCanvasOffset, tool]);

  useEffect(() => {
    if (!isCanvasReady) {
      return;
    }
    resizeCanvas();
  }, [isCanvasReady, pages.length, resizeCanvas]);

  useEffect(() => {
    if (!isSelectionMode) {
      clearSelectionOverlay();
      selectionDragRef.current.active = false;
    }
  }, [clearSelectionOverlay, isSelectionMode]);

  useEffect(() => {
    if (tool !== "eraser") {
      hideEraserPreview();
    }
  }, [hideEraserPreview, tool]);

  useEffect(() => {
    if (tool === "pen") {
      return;
    }
    clearAutoOcrSchedule();
    autoOcrRectRef.current = null;
  }, [clearAutoOcrSchedule, tool]);

  useEffect(() => {
    if (!isCanvasReady) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onScroll = () => {
      syncCanvasOffset();
      const step = PAGE_HEIGHT + PAGE_SEPARATOR_HEIGHT;
      const index = clamp(
        Math.floor((container.scrollTop + PAGE_HEIGHT / 2) / step),
        0,
        Math.max(0, pagesRef.current.length - 1)
      );

      if (index !== currentPageIndexRef.current) {
        currentPageIndexRef.current = index;
        setCurrentPageIndex(index);
      }

      const nearBottom =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - AUTO_ADD_SCROLL_THRESHOLD;

      if (
        nearBottom &&
        !isAutoAddingPageRef.current &&
        !isSelectionMode &&
        !isOcrRunning
      ) {
        isAutoAddingPageRef.current = true;
        void addPage().finally(() => {
          window.setTimeout(() => {
            isAutoAddingPageRef.current = false;
          }, 150);
        });
      }
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [addPage, isCanvasReady, isOcrRunning, isSelectionMode, syncCanvasOffset]);

  useEffect(() => {
    if (!isCanvasReady) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    let isTwoFingerPanning = false;
    let startCenterX = 0;
    let startCenterY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    let drawingModeBefore = false;

    const startTwoFingerPan = (event: TouchEvent) => {
      const center = getTouchCenter(event.touches);
      if (!center) {
        return;
      }

      isTwoFingerPanning = true;
      startCenterX = center.x;
      startCenterY = center.y;
      startScrollLeft = container.scrollLeft;
      startScrollTop = container.scrollTop;
      container.classList.add("is-two-finger-panning");

      const canvas = fabricCanvasRef.current;
      if (canvas) {
        drawingModeBefore = canvas.isDrawingMode;
        canvas.isDrawingMode = false;
      } else {
        drawingModeBefore = false;
      }

      event.preventDefault();
    };

    const stopTwoFingerPan = () => {
      if (!isTwoFingerPanning) {
        return;
      }

      isTwoFingerPanning = false;
      container.classList.remove("is-two-finger-panning");

      const canvas = fabricCanvasRef.current;
      if (canvas && drawingModeBefore && activeToolRef.current === "pen") {
        canvas.isDrawingMode = true;
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        startTwoFingerPan(event);
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!isTwoFingerPanning) {
        if (event.touches.length === 2) {
          startTwoFingerPan(event);
        }
        return;
      }

      const center = getTouchCenter(event.touches);
      if (!center) {
        return;
      }

      const deltaX = center.x - startCenterX;
      const deltaY = center.y - startCenterY;
      container.scrollLeft = startScrollLeft - deltaX;
      container.scrollTop = startScrollTop - deltaY;
      event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        stopTwoFingerPan();
      }
    };

    const onTouchCancel = () => {
      stopTwoFingerPan();
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    container.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
    container.addEventListener("touchcancel", onTouchCancel, { passive: false, capture: true });

    return () => {
      stopTwoFingerPan();
      container.removeEventListener("touchstart", onTouchStart, true);
      container.removeEventListener("touchmove", onTouchMove, true);
      container.removeEventListener("touchend", onTouchEnd, true);
      container.removeEventListener("touchcancel", onTouchCancel, true);
    };
  }, [isCanvasReady]);

  useEffect(() => {
    return () => {
      const worker = workerRef.current;
      if (worker) {
        void worker.terminate();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      clearToolLongPress();
      clearAutoOcrSchedule();
      autoOcrRectRef.current = null;
    };
  }, [clearAutoOcrSchedule, clearToolLongPress]);

  useEffect(() => {
    if (!isPenSizeMenuOpen && !isEraserSizeMenuOpen) {
      return;
    }

    const onGlobalPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".tool-trigger") || target?.closest(".size-popover")) {
        return;
      }
      setIsPenSizeMenuOpen(false);
      setIsEraserSizeMenuOpen(false);
    };

    window.addEventListener("pointerdown", onGlobalPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onGlobalPointerDown);
    };
  }, [isEraserSizeMenuOpen, isPenSizeMenuOpen]);

  useEffect(() => {
    localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(journalEntries));
  }, [journalEntries]);

  useEffect(() => {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, backgroundMode);
  }, [backgroundMode]);

  useEffect(() => {
    isOcrEnabledRef.current = isOcrEnabled;
    if (!isOcrEnabled) {
      setIsSelectionMode(false);
      clearSelectionOverlay();
      clearAutoOcrSchedule();
      autoOcrRectRef.current = null;
      isAutoOcrBusyRef.current = false;
      setIsOcrRunning(false);
      setOcrStatus("OCR spento");
      return;
    }
    setOcrStatus("OCR attivo");
  }, [clearAutoOcrSchedule, clearSelectionOverlay, isOcrEnabled]);

  const penSizePopoverStyle = getSizePopoverStyle(penToolRef.current);
  const eraserSizePopoverStyle = getSizePopoverStyle(eraserToolRef.current);

  return (
    <main className="whiteboard-app">
      <div
        className={tool === "pan" ? "board-scroll-area pan-mode" : "board-scroll-area"}
        ref={containerRef}
        onPointerMove={handleBoardPointerMove}
        onPointerLeave={hideEraserPreview}
      >
        <div
          className={backgroundMode === "grid" ? "canvas-wrapper grid-background" : "canvas-wrapper"}
          ref={wrapperRef}
        >
          <canvas ref={drawingCanvasRef} />
          <canvas
            className={`selection-canvas ${isSelectionMode ? "enabled" : ""}`}
            ref={selectionCanvasRef}
            style={{ display: isSelectionMode ? "block" : "none" }}
            onPointerDown={handleSelectionPointerDown}
            onPointerMove={handleSelectionPointerMove}
            onPointerUp={(event) => {
              void handleSelectionPointerUp(event);
            }}
            onPointerLeave={() => {
              if (selectionDragRef.current.active) {
                selectionDragRef.current.active = false;
                clearSelectionOverlay();
              }
            }}
          />
          <div className="page-separators">
            {pages.slice(0, -1).map((page, index) => (
              <div
                className="page-separator"
                key={`${page.id}-separator`}
                style={{ top: `${getPageTop(index) + PAGE_HEIGHT}px` }}
              />
            ))}
          </div>
          <div className="eraser-preview" ref={eraserPreviewRef} />
        </div>
      </div>

      <section className="toolbar bottom-toolbar">
        <div className="tool-trigger" ref={penToolRef}>
          <button
            className={`icon-button ${tool === "pen" ? "active" : ""}`}
            onClick={handlePenClick}
            onPointerDown={(event) => handleToolLongPressStart(event, "pen")}
            onPointerUp={handleToolLongPressEnd}
            onPointerLeave={handleToolLongPressEnd}
            onPointerCancel={handleToolLongPressEnd}
            onContextMenu={(event) => {
              event.preventDefault();
              suppressToolClickRef.current = true;
              openToolSizeMenu("pen");
            }}
            title="Penna"
            aria-label="Penna"
            type="button"
          >
            <i className="fa-solid fa-pen" />
            <span className="sr-only">Penna</span>
          </button>
          {isPenSizeMenuOpen && (
            <div className="size-popover" role="group" aria-label="Spessore penna" style={penSizePopoverStyle}>
              {SIZE_LEVELS.map((level) => (
                <button
                  key={`pen-size-${level.key}`}
                  type="button"
                  className={`size-visual pen ${penSizeLevel === level.key ? "selected" : ""}`}
                  onClick={() => {
                    setPenSizeLevel(level.key);
                    setTool("pen");
                    setIsPenSizeMenuOpen(false);
                  }}
                  title={`Penna ${level.label.toLowerCase()}`}
                  aria-label={`Penna ${level.label.toLowerCase()}`}
                >
                  <span className={`pen-stroke ${level.key}`} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="tool-trigger" ref={eraserToolRef}>
          <button
            className={`icon-button ${tool === "eraser" ? "active" : ""}`}
            onClick={handleEraserClick}
            onPointerDown={(event) => handleToolLongPressStart(event, "eraser")}
            onPointerUp={handleToolLongPressEnd}
            onPointerLeave={handleToolLongPressEnd}
            onPointerCancel={handleToolLongPressEnd}
            onContextMenu={(event) => {
              event.preventDefault();
              suppressToolClickRef.current = true;
              openToolSizeMenu("eraser");
            }}
            title="Gomma"
            aria-label="Gomma"
            type="button"
          >
            <i className="fa-solid fa-eraser" />
            <span className="sr-only">Gomma</span>
          </button>
          {isEraserSizeMenuOpen && (
            <div className="size-popover" role="group" aria-label="Spessore gomma" style={eraserSizePopoverStyle}>
              {SIZE_LEVELS.map((level) => (
                <button
                  key={`eraser-size-${level.key}`}
                  type="button"
                  className={`size-visual eraser ${eraserSizeLevel === level.key ? "selected" : ""}`}
                  onClick={() => {
                    setEraserSizeLevel(level.key);
                    setTool("eraser");
                    setIsEraserSizeMenuOpen(false);
                  }}
                  title={`Gomma ${level.label.toLowerCase()}`}
                  aria-label={`Gomma ${level.label.toLowerCase()}`}
                >
                  <span className={`eraser-dot ${level.key}`} />
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className={`icon-button ${tool === "line" ? "active" : ""}`}
          onClick={() => setTool("line")}
          title="Linea"
          aria-label="Linea"
          type="button"
        >
          <i className="fa-solid fa-minus" />
          <span className="sr-only">Linea</span>
        </button>
        <button
          className={`icon-button ${tool === "pan" ? "active" : ""}`}
          onClick={() => setTool("pan")}
          title="Mano (scorri)"
          aria-label="Mano (scorri)"
          type="button"
        >
          <i className="fa-solid fa-hand" />
          <span className="sr-only">Mano</span>
        </button>
        <div className="ocr-switch-control" aria-label="Interruttore OCR">
          <span className="ocr-switch-label">OCR</span>
          <label className="ocr-switch">
            <input
              type="checkbox"
              role="switch"
              checked={isOcrEnabled}
              onChange={(event) => setIsOcrEnabled(event.target.checked)}
              disabled={isOcrRunning}
              aria-label="Attiva o disattiva OCR"
            />
            <span className="ocr-switch-track">
              <span className="ocr-switch-thumb" />
            </span>
          </label>
        </div>

        <span>Colore</span>
        <div className="color-palette" role="group" aria-label="Colori principali">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              title={preset.name}
              aria-label={preset.name}
              className={`color-swatch ${color === preset.value ? "selected" : ""}`}
              style={{ backgroundColor: preset.value }}
              onClick={() => {
                setColor(preset.value);
              }}
            />
          ))}
        </div>

        <button className="icon-button" title="Undo" aria-label="Undo" type="button" onClick={() => void undo()}>
          <i className="fa-solid fa-rotate-left" />
          <span className="sr-only">Undo</span>
        </button>
        <button className="icon-button" title="Redo" aria-label="Redo" type="button" onClick={() => void redo()}>
          <i className="fa-solid fa-rotate-right" />
          <span className="sr-only">Redo</span>
        </button>
        <button
          className={backgroundMode === "grid" ? "icon-button active background-grid-button" : "icon-button background-grid-button"}
          title="Sfondo a quadretti"
          aria-label="Sfondo a quadretti"
          type="button"
          onClick={() => setBackgroundMode((value) => (value === "grid" ? "plain" : "grid"))}
        >
          <span className="grid-icon" aria-hidden="true" />
          <span className="sr-only">Sfondo</span>
        </button>
        <button
          className={isJournalOpen ? "active journal-toggle-button" : "journal-toggle-button"}
          title="giornale_data"
          aria-label="giornale_data"
          type="button"
          onClick={() => setIsJournalOpen((value) => !value)}
        >
          <i className="fa-solid fa-book-open" />
          <span>giornale_data</span>
        </button>
        <button
          className="icon-button"
          title="Calcolatrice"
          aria-label="Calcolatrice"
          type="button"
          onClick={() => setIsCalculatorOpen((value) => !value)}
        >
          <i className="fa-solid fa-calculator" />
          <span className="sr-only">Calcolatrice</span>
        </button>
        <button
          className="icon-button"
          title="Nuova pagina"
          aria-label="Nuova pagina"
          type="button"
          onClick={() => void addPage()}
        >
          <i className="fa-solid fa-square-plus" />
          <span className="sr-only">Nuova pagina</span>
        </button>
        <label htmlFor="pageSelect">Pagina</label>
        <select
          id="pageSelect"
          value={currentPageIndex}
          onChange={(event) => void switchPage(Number(event.target.value))}
        >
          {pages.map((page, index) => (
            <option key={page.id} value={index}>
              {page.name}
            </option>
          ))}
        </select>

        <button
          className="icon-button"
          title="Salva PDF"
          aria-label="Salva PDF"
          type="button"
          onClick={() => void exportPdf()}
        >
          <i className="fa-solid fa-file-pdf" />
          <span className="sr-only">Salva PDF</span>
        </button>
        <button
          className="icon-button"
          title="Cancella dati"
          aria-label="Cancella dati"
          type="button"
          onClick={() => void clearAllPages()}
        >
          <i className="fa-solid fa-trash" />
          <span className="sr-only">Cancella dati</span>
        </button>
        <span className="toolbar-status">
          {ocrStatus} | Pagina {currentPageIndex + 1} di {pages.length}
        </span>
      </section>

      <JournalPanel
        isOpen={isJournalOpen}
        entries={journalEntries}
        accounts={PIANO_DEI_CONTI}
        isExtracting={isJournalExtracting}
        onClose={() => setIsJournalOpen(false)}
        onExtract={() => void extractJournalData()}
        onAddEntry={addJournalEntry}
        onClearEntries={clearJournalEntries}
        onRemoveEntry={removeJournalEntry}
        onUpdateEntry={updateJournalEntry}
      />

      {isCalculatorOpen && (
        <section className="calculator">
          <header>
            <h3>Calcolatrice</h3>
            <button
              className="icon-button"
              title="Chiudi"
              aria-label="Chiudi"
              type="button"
              onClick={() => setIsCalculatorOpen(false)}
            >
              <i className="fa-solid fa-xmark" />
              <span className="sr-only">Chiudi</span>
            </button>
          </header>
          <input
            value={display}
            onChange={(event) => setDisplay(event.target.value)}
            placeholder="Espressione"
          />
          <div className="calculator-grid">
            {["7", "8", "9", "/", "(", "4", "5", "6", "*", ")", "1", "2", "3", "-", "^", "0", ".", "%", "+", "C"].map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    if (item === "C") {
                      setDisplay("");
                      return;
                    }
                    appendDisplay(item);
                  }}
                >
                  {item}
                </button>
              )
            )}
          </div>
          <button className="equals" type="button" onClick={calculate}>
            =
          </button>
        </section>
      )}
    </main>
  );
}

export default App;
