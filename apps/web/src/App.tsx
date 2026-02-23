import { useCallback, useEffect, useRef, useState } from "react";
import type { Canvas as FabricCanvas, Line as FabricLine } from "fabric";

type Tool = "pen" | "eraser" | "line";
type SizeLevel = "thin" | "medium" | "large";

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
const PAGE_HEIGHT = 1600;
const PAGE_SEPARATOR_HEIGHT = 24;
const MIN_CANVAS_WIDTH = 900;
const MAX_HISTORY = 80;
const AUTO_ADD_SCROLL_THRESHOLD = 120;
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
    .replace(/[\u00F7]/g, "/")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^\d+\-*/().%^]/g, "")
    .trim();
}

function App() {
  const initialDocumentRef = useRef<PersistedDocument>(loadInitialDocument());
  const [pages, setPages] = useState<Page[]>(() => initialDocumentRef.current.pages);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#000000");
  const [penSizeLevel, setPenSizeLevel] = useState<SizeLevel>("medium");
  const [eraserSizeLevel, setEraserSizeLevel] = useState<SizeLevel>("medium");
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("OCR pronto");
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [display, setDisplay] = useState("");
  const [isCanvasReady, setIsCanvasReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
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
    return JSON.stringify(canvas.toJSON());
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
    brush.decimate = 0;
  }, [color, penStrokeWidth]);

  const applyEraserSettings = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const fabricModule = fabricModuleRef.current;
    if (!canvas || !fabricModule) {
      return;
    }

    class EraserBrush extends fabricModule.PencilBrush {
      _setBrushStyles(ctx: CanvasRenderingContext2D): void {
        super._setBrushStyles(ctx);
        ctx.globalCompositeOperation = "destination-out";
      }
    }
    const eraserBrush = new EraserBrush(canvas);

    const brush = eraserBrush as {
      color: string;
      width: number;
      decimate?: number;
    };
    brush.color = "rgba(0,0,0,1)";
    brush.width = eraserStrokeWidth;
    brush.decimate = 0;
    canvas.freeDrawingBrush = brush as FabricCanvas["freeDrawingBrush"];
  }, [eraserStrokeWidth]);

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
      const path = (event as { path?: { set?: (props: Record<string, unknown>) => void } }).path;
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
    if (!canvas) {
      return;
    }
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

    canvas.isDrawingMode = false;
    canvas.selection = false;
    const topContext = (canvas as unknown as { contextTop?: CanvasRenderingContext2D }).contextTop;
    if (topContext) {
      topContext.globalCompositeOperation = "source-over";
    }

    if (tool === "eraser") {
      canvas.isDrawingMode = true;
      applyEraserSettings();
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
  }, [applyBrushSettings, applyEraserSettings, color, detachToolHandlers, penStrokeWidth, pushHistoryState, syncCanvasOffset, tool]);

  const resizeCanvas = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const container = containerRef.current;
    const selectionCanvas = selectionCanvasRef.current;
    const wrapper = wrapperRef.current;

    if (!canvas || !container || !selectionCanvas || !wrapper) {
      return;
    }

    const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(container.clientWidth) - 2);
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
        tesseract.createWorker("eng").then((worker) => {
          const typedWorker = worker as OcrWorker;
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
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

    for (let i = 0; i < pagesSnapshot.length; i += 1) {
      const image = canvas.toDataURL({
        format: "png",
        left: 0,
        top: getPageTop(i),
        width: canvas.getWidth(),
        height: PAGE_HEIGHT,
        multiplier: 2
      });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const ratio = canvas.getWidth() / PAGE_HEIGHT;
      const drawWidth = pageWidth - 30;
      const drawHeight = drawWidth / ratio;
      const y = Math.max(15, (pageHeight - drawHeight) / 2);

      if (i > 0) {
        doc.addPage();
      }
      doc.addImage(image, "PNG", 15, y, drawWidth, drawHeight);
    }

    const defaultName = `lavagna_${new Date().toISOString().slice(0, 10)}`;
    const fileName = window.prompt("Nome PDF", defaultName) ?? defaultName;
    doc.save(`${fileName}.pdf`);
  }, [persistCurrentDocument]);

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

  const appendDisplay = useCallback((value: string) => {
    setDisplay((previous) => `${previous}${value}`);
  }, []);

  const calculate = useCallback(async () => {
    const expression = normalizeExpression(display);
    if (!expression) {
      return;
    }

    try {
      const { evaluate } = await import("mathjs");
      const result = evaluate(expression);
      setDisplay(String(result));
    } catch {
      window.alert("Espressione non valida");
    }
  }, [display]);

  const runOcrForRect = useCallback(
    async (rect: SelectionRect) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || rect.width < 6 || rect.height < 6) {
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
        const cleaned = normalizeExpression(result.data.text);

        if (cleaned) {
          setDisplay((previous) => `${previous}${cleaned}`);
          setOcrStatus(`OCR ok: ${cleaned}`);
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
    [clearSelectionOverlay, getWorker]
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
    if (!isCanvasReady || tool !== "eraser") {
      return;
    }
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }
    syncCanvasOffset();
    canvas.isDrawingMode = true;
    canvas.selection = false;
    applyEraserSettings();
  }, [applyEraserSettings, eraserSizeLevel, isCanvasReady, syncCanvasOffset, tool]);

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
    return () => {
      const worker = workerRef.current;
      if (worker) {
        void worker.terminate();
      }
    };
  }, []);

  return (
    <main className="whiteboard-app">
      <div
        className="board-scroll-area"
        ref={containerRef}
        onPointerMove={handleBoardPointerMove}
        onPointerLeave={hideEraserPreview}
      >
        <div className="canvas-wrapper" ref={wrapperRef}>
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
        <button
          className={`icon-button ${tool === "pen" ? "active" : ""}`}
          onClick={() => setTool("pen")}
          title="Penna"
          aria-label="Penna"
          type="button"
        >
          <i className="fa-solid fa-pen" />
          <span className="sr-only">Penna</span>
        </button>
        <button
          className={`icon-button ${tool === "eraser" ? "active" : ""}`}
          onClick={() => setTool("eraser")}
          title="Gomma"
          aria-label="Gomma"
          type="button"
        >
          <i className="fa-solid fa-eraser" />
          <span className="sr-only">Gomma</span>
        </button>
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
          className={isSelectionMode ? "active warning ocr-button" : "warning ocr-button"}
          onClick={() => setIsSelectionMode((value) => !value)}
          type="button"
          disabled={isOcrRunning}
        >
          Selezione OCR
        </button>

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

        <div className="size-controls">
          <div className="size-control" role="group" aria-label="Spessore penna">
            <span className="size-label">Penna</span>
            {SIZE_LEVELS.map((level) => (
              <button
                key={`pen-${level.key}`}
                type="button"
                className={`size-chip ${penSizeLevel === level.key ? "selected" : ""}`}
                onClick={() => {
                  setPenSizeLevel(level.key);
                }}
              >
                {level.label}
              </button>
            ))}
          </div>
          <div className="size-control" role="group" aria-label="Spessore gomma">
            <span className="size-label">Gomma</span>
            {SIZE_LEVELS.map((level) => (
              <button
                key={`eraser-${level.key}`}
                type="button"
                className={`size-chip ${eraserSizeLevel === level.key ? "selected" : ""}`}
                onClick={() => {
                  setEraserSizeLevel(level.key);
                }}
              >
                {level.label}
              </button>
            ))}
          </div>
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
