import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JournalPanel, type JournalEntry } from "./components/JournalPanel";
import { PIANO_DEI_CONTI } from "./data/pianoDeiConti";
import { exportJournalWorkbook } from "./lib/api";
import { lazyImportFabric, lazyImportTesseract, lazyImportJsPDF, lazyImportMathJS, type FabricCanvas, type FabricLine, type FabricObject } from "./lib/lazyImports";
import { normalizeExpression, formatExpressionForDisplay, normalizeOcrChunk, validateExpression, evaluateExpressionNative } from "./utils/ocrUtils";
import { mergeRecognizedText, formatArchiveDateTime, buildDocumentBaseName, normalizePageCanvasDataForPages, computeVirtualWindowRange, buildIndexRange } from "./utils/appUtils";
// import { useMathRecognition } from './features/math-recognition';
import {
  archiveBoardDocument,
  deleteArchivedBoardDocument,
  listArchivedBoardDocuments,
  loadAppSettings,
  loadArchivedBoardDocument,
  loadLastBoardDocument,
  renameArchivedBoardDocument,
  saveAppSettings,
  saveLastBoardDocument,
  type ArchivedBoardDocument,
  type BoardDocument
} from "./lib/boardStorage";
import { waitForSaveComplete } from "./lib/saveManager";

type Tool = "pen" | "eraser" | "line" | "pan";
type SizeLevel = "thin" | "medium" | "large";
type BackgroundMode = "plain" | "grid";

type Page = {
  id: string;
  name: string;
};

type PageCanvasDataMap = Record<string, string | null>;

type PersistedDocument = BoardDocument;

type ToolHandlers = {
  down?: (event: unknown) => void;
  move?: (event: unknown) => void;
  up?: (event: unknown) => void;
  leave?: (event: unknown) => void;
  cleanup?: () => void;
};

type SelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type VirtualWindowRange = {
  startIndex: number;
  endIndex: number;
};

const MAX_JOURNAL_ENTRIES = 202;
const MIN_VISIBLE_JOURNAL_ENTRIES = 10;
const PAGE_HEIGHT = 1600;
const PAGE_SEPARATOR_HEIGHT = 24;
const MAX_HISTORY = 80;
const AUTO_ADD_SCROLL_THRESHOLD = 120;
const TOOL_LONG_PRESS_MS = 420;
const AUTO_OCR_DEBOUNCE_MS = 550;
const AUTO_OCR_PADDING = 24;
const PEN_DECIMATE = 0.6;
const SNAPSHOT_NUMBER_PRECISION = 2;
const PDF_EXPORT_MULTIPLIER = 1.25;
const PDF_EXPORT_JPEG_QUALITY = 0.72;
const ARCHIVE_PREVIEW_WIDTH = 120;  // 🎯 Ridotto da 180 a 120 per anteprime più piccole e definite
const ARCHIVE_PREVIEW_JPEG_QUALITY = 0.62;
const GRID_BACKGROUND_COLOR = "rgba(148, 163, 184, 0.35)";
const GRID_BACKGROUND_SIZE = 28;
const GRID_BACKGROUND_LINE_WIDTH = 1;
const DOCUMENT_SAVE_DEBOUNCE_MS = 500;
const VIRTUALIZATION_BUFFER_PAGES = 1;
const CANVAS_POOL_SIZE = 6;
const COPY_PASTE_OFFSET = 18;
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
    credit: "",
    closeLine: false
  };
}

function createJournalEntries(count: number): JournalEntry[] {
  return Array.from({ length: count }, () => createJournalEntry());
}

function normalizeJournalEntries(input: unknown): JournalEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
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
        credit: typeof entry.credit === "string" ? entry.credit : "",
        closeLine: entry.closeLine === true
      } satisfies JournalEntry;
    })
    .filter((item): item is JournalEntry => item !== null);
}

function ensureMinimumJournalEntries(entries: JournalEntry[]): JournalEntry[] {
  if (entries.length >= MIN_VISIBLE_JOURNAL_ENTRIES) {
    return entries;
  }
  if (entries.length === 0) {
    return createJournalEntries(MIN_VISIBLE_JOURNAL_ENTRIES);
  }
  return [...entries, ...createJournalEntries(MIN_VISIBLE_JOURNAL_ENTRIES - entries.length)];
}

function loadInitialJournalEntries(): JournalEntry[] {
  return createJournalEntries(MIN_VISIBLE_JOURNAL_ENTRIES);
}

function loadInitialBackgroundMode(): BackgroundMode {
  return "plain";
}

function loadActiveArchiveDocumentId(): string | null {
  return null;
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
  const firstPage = createPage(0);
  return {
    pages: [firstPage],
    canvasData: null,
    pageCanvasData: {},
    journalEntries: loadInitialJournalEntries()
  };
}

function App() {
  const initialDocumentRef = useRef<PersistedDocument>(loadInitialDocument());
  const initialPageCanvasDataRef = useRef<PageCanvasDataMap>(
    normalizePageCanvasDataForPages(
      initialDocumentRef.current.pages,
      initialDocumentRef.current.pageCanvasData,
      initialDocumentRef.current.canvasData
    )
  );
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
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [archiveEntries, setArchiveEntries] = useState<ArchivedBoardDocument[]>([]);
  const [selectedArchiveEntryId, setSelectedArchiveEntryId] = useState<string | null>(null);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState("");
  const [isJournalExtracting, setIsJournalExtracting] = useState(false);
  // const [useMathRec, setUseMathRec] = useState(false);
  // const mathRec = useMathRecognition();
  const [isSharingFiles, setIsSharingFiles] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);  // 🎯 Loading per PDF
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(
    () => initialDocumentRef.current.journalEntries
  );
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() => loadInitialBackgroundMode());
  const [display, setDisplay] = useState("");
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [virtualWindowRange, setVirtualWindowRange] = useState<VirtualWindowRange>({ startIndex: 0, endIndex: 0 });
  const [intersectingPageIds, setIntersectingPageIds] = useState<string[]>([]);
  const [slotAssignments, setSlotAssignments] = useState<Array<string | null>>(
    () => Array.from({ length: 6 }, () => null) // CANVAS_POOL_SIZE
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const boardPagesRef = useRef<HTMLDivElement | null>(null);
  const penToolRef = useRef<HTMLDivElement | null>(null);
  const eraserToolRef = useRef<HTMLDivElement | null>(null);
  const drawingCanvasElementsRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const selectionCanvasElementsRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageSentinelElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const drawingCanvasRefCallbacksRef = useRef<Map<number, (node: HTMLCanvasElement | null) => void>>(new Map());
  const selectionCanvasRefCallbacksRef = useRef<Map<number, (node: HTMLCanvasElement | null) => void>>(new Map());
  const pageSentinelRefCallbacksRef = useRef<Map<string, (node: HTMLDivElement | null) => void>>(new Map());
  const eraserPreviewRef = useRef<HTMLDivElement | null>(null);

  const fabricCanvasMapRef = useRef<Map<number, FabricCanvas>>(new Map());
  const pageSlotMapRef = useRef<Map<string, number>>(new Map());
  const slotPageMapRef = useRef<Map<number, string>>(new Map());
  const slotLoadTokenRef = useRef<Record<number, number>>({});
  const activeCanvasPageIdRef = useRef<string | null>(null);
  const activeLineRef = useRef<FabricLine | null>(null);
  const fabricModuleRef = useRef<typeof import("fabric") | null>(null);
  const toolHandlersRef = useRef<ToolHandlers>({});
  const activeToolRef = useRef<Tool>("pen");
  const clipboardObjectRef = useRef<unknown | null>(null);
  const clipboardSourcePageIdRef = useRef<string | null>(null);
  const selectionDragRef = useRef<{ active: boolean; startX: number; startY: number; pageId: string | null }>({
    active: false,
    startX: 0,
    startY: 0,
    pageId: null
  });
  const multiSelectionRef = useRef<{
    active: boolean;
    startPoint: { x: number; y: number } | null;
    currentPoint: { x: number; y: number } | null;
    pageId: string | null;
  }>({
    active: false,
    startPoint: null,
    currentPoint: null,
    pageId: null
  });
  const selectedObjectsRef = useRef<Set<string>>(new Set());

  const pagesRef = useRef<Page[]>(pages);
  const pageCanvasDataRef = useRef<PageCanvasDataMap>(initialPageCanvasDataRef.current);
  const journalEntriesRef = useRef<JournalEntry[]>(initialDocumentRef.current.journalEntries);
  const currentPageIndexRef = useRef(currentPageIndex);
  const pendingDocumentSaveRef = useRef<PersistedDocument | null>(null);
  const documentSaveTimeoutRef = useRef<number | null>(null);
  const hasHydratedFromIndexedDbRef = useRef(false);
  const hasArchivedOnExitRef = useRef(false);
  const activeArchiveDocumentIdRef = useRef<string | null>(loadActiveArchiveDocumentId());
  const historyStacksRef = useRef<Record<string, { undo: string[]; redo: string[] }>>({});
  const isRestoringRef = useRef(false);
  const isAutoAddingPageRef = useRef(false);
  const toolLongPressTimeoutRef = useRef<number | null>(null);
  const suppressToolClickRef = useRef(false);
  const autoOcrTimeoutRef = useRef<number | null>(null);
  const autoOcrRectRef = useRef<{ pageId: string; rect: SelectionRect } | null>(null);
  const isOcrEnabledRef = useRef(false);
  const isAutoOcrBusyRef = useRef(false);
  const lastOcrChunkRef = useRef<string>("");
  const clearAutoOcrScheduleRef = useRef<() => void>(() => undefined);
  const scheduleAutoOcrForRectRef = useRef<(pageId: string, rect: SelectionRect) => void>(() => undefined);

  const workerRef = useRef<OcrWorker | null>(null);
  const workerInitPromiseRef = useRef<Promise<OcrWorker> | null>(null);
  const penStrokeWidth = PEN_WIDTH_BY_LEVEL[penSizeLevel];
  const eraserStrokeWidth = ERASER_WIDTH_BY_LEVEL[eraserSizeLevel];

  // 🆕 FUNZIONE PER INCOLLARE IMMAGINI DA CLIPBOARD
  const pasteImageFromClipboard = useCallback(async (pageId: string | null) => {
    if (!pageId) {
      console.warn('⚠️ pasteImageFromClipboard: pageId is null');
      return; // 🛡️ Early return se null
    }
    
    console.log('🖼️ pasteImageFromClipboard called with pageId:', pageId);
    
    try {
      console.log('📋 Reading clipboard...');
      const clipboardItems = await navigator.clipboard.read();
      console.log('📋 Clipboard items:', clipboardItems);
      
      for (const item of clipboardItems) {
        console.log('🔍 Checking item types:', item.types);
        for (const type of item.types) {
          console.log('🔍 Checking type:', type);
          if (type.startsWith('image/')) {
            console.log('✅ Found image type:', type);
            const blob = await item.getType(type);
            console.log('📦 Blob created:', blob.size, 'bytes');
            
            // Converti blob in data URL invece di blob URL
            const reader = new FileReader();
            reader.onload = async (event) => {
              const dataUrl = event.target?.result as string;
              console.log('🔗 Data URL created:', dataUrl.substring(0, 50) + '...');
              
              // Carica Fabric.js se non già caricato
              if (!fabricModuleRef.current) {
                console.log('📦 Loading Fabric.js...');
                fabricModuleRef.current = await lazyImportFabric();
              }
              
              const fabric = fabricModuleRef.current;
              
              // 🆕 APPROCCIO: Carica immagine in HTML Image poi converti in Fabric
              console.log('🖼️ Loading HTML Image first...');
              const htmlImg = new Image();
              htmlImg.onload = () => {
                console.log('🖼️ HTML Image loaded!', {
                  width: htmlImg.width,
                  height: htmlImg.height
                });
                
                // Ora converti in Fabric Image
                console.log('🎨 Converting HTML Image to Fabric Image...');
                const fabricImg = new fabric.Image(htmlImg, {
                  left: 200,
                  top: 200,
                  selectable: true,
                  evented: true,
                  visible: true,
                  opacity: 1
                });
                
                console.log('🎨 Fabric Image created from HTML!', fabricImg);
                console.log('🎨 Image properties:', {
                  width: fabricImg.width,
                  height: fabricImg.height,
                  left: fabricImg.left,
                  top: fabricImg.top,
                  visible: fabricImg.visible,
                  opacity: fabricImg.opacity
                });
                
                // 🛡️ Ottieni canvas direttamente senza usare getCanvasByPageId
                const slot = pageSlotMapRef.current.get(pageId);
                console.log('📍 Page slot:', slot);
                console.log('📍 Available slots:', Array.from(pageSlotMapRef.current.entries()));
                console.log('📍 Available canvases:', Array.from(fabricCanvasMapRef.current.entries()));
                
                const canvas = slot !== undefined ? fabricCanvasMapRef.current.get(slot) ?? null : null;
                console.log('🎯 Canvas found:', !!canvas);
                if (canvas) {
                  console.log('🎯 Canvas details:', {
                    width: canvas.width,
                    height: canvas.height,
                    objectCount: canvas.getObjects().length,
                    backgroundColor: canvas.backgroundColor
                  });
                }
                
                if (!canvas) {
                  console.warn('⚠️ No canvas found for page:', pageId);
                  return;
                }
                
                // Dimensioni massime per evitare immagini troppo grandi
                const maxWidth = 600;
                const maxHeight = 450;
                
                let width = fabricImg.width || 200;
                let height = fabricImg.height || 150;
                
                console.log('📏 Original dimensions:', { width, height });
                
                // Scala se necessario
                if (width > maxWidth || height > maxHeight) {
                  const ratio = Math.min(maxWidth / width, maxHeight / height);
                  width *= ratio;
                  height *= ratio;
                  console.log('📏 Scaled dimensions:', { width, height });
                  
                  // Applica scaling
                  fabricImg.set({
                    scaleX: width / (fabricImg.width || 1),
                    scaleY: height / (fabricImg.height || 1)
                  });
                }
                
                console.log('⚙️ Final image properties:', {
                  left: fabricImg.left,
                  top: fabricImg.top,
                  scaleX: fabricImg.scaleX,
                  scaleY: fabricImg.scaleY,
                  selectable: fabricImg.selectable,
                  evented: fabricImg.evented,
                  visible: fabricImg.visible,
                  opacity: fabricImg.opacity
                });
                
                // Aggiungi al canvas
                console.log('➕ Adding image to canvas...');
                canvas.add(fabricImg);
                console.log('📊 Canvas objects after add:', canvas.getObjects().length);
                
                // Imposta come oggetto attivo
                canvas.setActiveObject(fabricImg);
                console.log('🎯 Image set as active');
                
                // Renderizza
                console.log('🎨 Rendering canvas...');
                canvas.renderAll();
                console.log('✅ Canvas rendered!');
                
                // Verifica finale
                const finalObjects = canvas.getObjects();
                const addedImage = finalObjects[finalObjects.length - 1];
                console.log('🔍 Final verification:', {
                  totalObjects: finalObjects.length,
                  lastObject: addedImage,
                  isImage: addedImage?.type === 'image',
                  imageVisible: addedImage?.visible,
                  imagePosition: { left: addedImage?.left, top: addedImage?.top }
                });
                
                console.log('🖼️ Immagine incollata con successo:', { width, height });
              };
              
              htmlImg.onerror = (error) => {
                console.error('❌ HTML Image load ERROR:', error);
              };
              
              htmlImg.src = dataUrl;
            };
            reader.readAsDataURL(blob);
            
            return; // Esci dopo aver processato la prima immagine
          }
        }
      }
    } catch (error) {
      console.error('❌ Errore incollaggio immagine:', error);
      // Prova fallback per browser meno recenti
      try {
        const text = await navigator.clipboard.readText();
        if (text.startsWith('data:image')) {
          // È un data URL di immagine
          const img = new Image();
          img.onload = () => {
            console.log('📋 Data URL immagine rilevato:', text.substring(0, 50) + '...');
          };
          img.src = text;
        }
      } catch (fallbackError) {
        console.warn('⚠️ Fallback incollaggio fallito:', fallbackError);
      }
    }
  }, []); // 🛡️ Rimuovi dipendenza getCanvasByPageId per evitare hoisting

  // 🆕 EVENT LISTENER GLOBALE PER PASTE
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      console.log('🎯 GLOBAL paste event triggered!', e);
      console.log('🎯 Event details:', {
        defaultPrevented: e.defaultPrevented,
        clipboardData: !!e.clipboardData,
        items: e.clipboardData?.items?.length || 0
      });
      
      // Non preveniamo default per ora, per debug
      // e.preventDefault();
      
      const currentPageId = pages[currentPageIndex]?.id ?? null;
      console.log('📍 Current page ID:', currentPageId);
      if (currentPageId) {
        console.log('🚀 Calling pasteImageFromClipboard...');
        
        // 🛡️ PROVA CLIPBOARD API PRIMA
        try {
          await pasteImageFromClipboard(currentPageId);
          return;
        } catch (clipboardError) {
          console.warn('⚠️ Clipboard API failed, trying fallback...', clipboardError);
        }
        
        // 🔄 FALLBACK: Prova a leggere da e.clipboardData
        try {
          const items = e.clipboardData?.items;
          if (items) {
            console.log('🔄 Trying clipboardData.items fallback:', items.length);
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              console.log('🔍 Fallback item:', item.type);
              if (item.type.startsWith('image/')) {
                console.log('✅ Fallback found image:', item.type);
                const file = item.getAsFile();
                if (file) {
                  console.log('📦 Fallback file:', file.size, 'bytes');
                  
                  // Converti file in URL
                  const reader = new FileReader();
                  reader.onload = async (event) => {
                    const dataUrl = event.target?.result as string;
                    console.log('🔗 Fallback data URL created:', dataUrl.substring(0, 50) + '...');
                    
                    // Carica Fabric.js se non già caricato
                    if (!fabricModuleRef.current) {
                      console.log('📦 Loading Fabric.js for fallback...');
                      fabricModuleRef.current = await lazyImportFabric();
                    }
                    
                    const fabric = fabricModuleRef.current;
                    
                    // Crea immagine Fabric.js da data URL
                    fabric.Image.fromURL(dataUrl, {
                      crossOrigin: 'anonymous'
                    } as any, (img: any) => {
                      console.log('🎨 Fallback Fabric image created:', img);
                      
                      // 🛡️ Ottieni canvas direttamente
                      const slot = pageSlotMapRef.current.get(currentPageId);
                      console.log('📍 Fallback page slot:', slot);
                      const canvas = slot !== undefined ? fabricCanvasMapRef.current.get(slot) ?? null : null;
                      console.log('🎯 Fallback canvas found:', !!canvas);
                      if (!canvas) {
                        console.warn('⚠️ No canvas found for page:', currentPageId);
                        return;
                      }
                      
                      // Dimensioni massime
                      const maxWidth = 400;
                      const maxHeight = 300;
                      
                      let width = img.width || 200;
                      let height = img.height || 150;
                      
                      console.log('📏 Fallback original dimensions:', { width, height });
                      
                      // Scala se necessario
                      if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width *= ratio;
                        height *= ratio;
                        console.log('📏 Fallback scaled dimensions:', { width, height });
                      }
                      
                      // Imposta dimensioni e posizione
                      img.set({
                        left: 50,
                        top: 50,
                        scaleX: width / (img.width || 1),
                        scaleY: height / (img.height || 1),
                        selectable: true,
                        evented: true
                      });
                      
                      console.log('⚙️ Fallback image properties set');
                      
                      // Aggiungi al canvas
                      canvas.add(img);
                      canvas.setActiveObject(img);
                      canvas.renderAll();
                      
                      console.log('✅ Fallback image added to canvas!');
                    });
                  };
                  reader.readAsDataURL(file);
                  return;
                }
              }
            }
          }
        } catch (fallbackError) {
          console.error('❌ All paste methods failed:', fallbackError);
        }
      } else {
        console.warn('⚠️ No current page ID found');
      }
    };

    // Aggiungi event listener globale con capture
    document.addEventListener('paste', handlePaste, true);
    
    console.log('📡 Global paste listener attached (capture mode)');

    // Cleanup
    return () => {
      document.removeEventListener('paste', handlePaste, true);
      console.log('📡 Global paste listener removed (capture mode)');
    };
  }, [pages, currentPageIndex, pasteImageFromClipboard]);

  const filteredArchiveEntries = useMemo(() => {
    const query = archiveSearch.trim().toLocaleLowerCase("it-IT");
    if (!query) {
      return archiveEntries;
    }
    return archiveEntries.filter((entry) => entry.fileName.toLocaleLowerCase("it-IT").includes(query));
  }, [archiveEntries, archiveSearch]);

  const selectedArchiveEntry = useMemo(
    () =>
      filteredArchiveEntries.find((entry) => entry.id === selectedArchiveEntryId) ??
      filteredArchiveEntries[0] ??
      null,
    [filteredArchiveEntries, selectedArchiveEntryId]
  );

  const pageIndexById = useMemo(() => {
    return pages.reduce<Map<string, number>>((acc, page, index) => {
      acc.set(page.id, index);
      return acc;
    }, new Map());
  }, [pages]);

  const windowPageIndexes = useMemo(
    () => buildIndexRange(virtualWindowRange.startIndex, virtualWindowRange.endIndex),
    [virtualWindowRange.endIndex, virtualWindowRange.startIndex]
  );

  const renderPageIds = useMemo(() => {
    const intersectingSet = new Set(intersectingPageIds);
    const ids = new Set<string>();
    for (const index of windowPageIndexes) {
      const page = pages[index];
      if (page) {
        ids.add(page.id);
      }
    }
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (page && intersectingSet.has(page.id)) {
        ids.add(page.id);
      }
    }
    const currentPageId = pages[currentPageIndex]?.id;
    if (currentPageId) {
      ids.add(currentPageId);
    }

    const orderedIds = pages
      .map((page) => page.id)
      .filter((pageId) => ids.has(pageId));

    if (orderedIds.length <= CANVAS_POOL_SIZE) {
      return orderedIds;
    }

    const current = pages[currentPageIndex]?.id ?? orderedIds[0];
    const prioritized = orderedIds
      .map((pageId) => ({
        pageId,
        distance: Math.abs((pageIndexById.get(pageId) ?? 0) - currentPageIndex),
        isCurrent: pageId === current
      }))
      .sort((a, b) => {
        if (a.isCurrent) {
          return -1;
        }
        if (b.isCurrent) {
          return 1;
        }
        return a.distance - b.distance;
      })
      .slice(0, CANVAS_POOL_SIZE)
      .map((item) => item.pageId);

    return pages
      .map((page) => page.id)
      .filter((pageId) => prioritized.includes(pageId));
  }, [currentPageIndex, intersectingPageIds, pageIndexById, pages, windowPageIndexes]);

  const getCurrentPageId = useCallback(() => {
    return pagesRef.current[currentPageIndexRef.current]?.id ?? null;
  }, []);

  const getCanvasByPageId = useCallback((pageId: string | null) => {
    if (!pageId) {
      return null;
    }
    const slotId = pageSlotMapRef.current.get(pageId);
    if (slotId === undefined) {
      return null;
    }
    return fabricCanvasMapRef.current.get(slotId) ?? null;
  }, []);

  const getActiveCanvas = useCallback(() => {
    return getCanvasByPageId(getCurrentPageId());
  }, [getCanvasByPageId, getCurrentPageId]);

  const getSelectionCanvasByPageId = useCallback((pageId: string | null) => {
    if (!pageId) {
      return null;
    }
    const slotId = pageSlotMapRef.current.get(pageId);
    if (slotId === undefined) {
      return null;
    }
    return selectionCanvasElementsRef.current.get(slotId) ?? null;
  }, []);

  const syncCanvasOffset = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!canvas) {
      return;
    }
    canvas.calcOffset();
  }, [getActiveCanvas]);

  const setActiveArchiveDocumentId = useCallback((archiveId: string | null) => {
    activeArchiveDocumentIdRef.current = archiveId;
    void saveAppSettings({
      activeArchiveDocumentId: archiveId
    }).catch(() => undefined);
  }, []);

  const flushDocumentSave = useCallback(() => {
    const pendingDocument = pendingDocumentSaveRef.current;
    if (!pendingDocument) {
      return;
    }
    pendingDocumentSaveRef.current = null;
    void saveLastBoardDocument(pendingDocument).catch(() => undefined);
  }, []);

  const flushPendingDocumentSaveNow = useCallback(() => {
    if (documentSaveTimeoutRef.current !== null) {
      window.clearTimeout(documentSaveTimeoutRef.current);
      documentSaveTimeoutRef.current = null;
    }

    const pendingDocument = pendingDocumentSaveRef.current;
    if (!pendingDocument) {
      return;
    }
    pendingDocumentSaveRef.current = null;
    void saveLastBoardDocument(pendingDocument).catch(() => undefined);
  }, []);

  const scheduleDocumentSave = useCallback(
    (document: PersistedDocument) => {
      pendingDocumentSaveRef.current = document;
      if (documentSaveTimeoutRef.current !== null) {
        window.clearTimeout(documentSaveTimeoutRef.current);
      }
      documentSaveTimeoutRef.current = window.setTimeout(() => {
        documentSaveTimeoutRef.current = null;
        flushDocumentSave();
      }, DOCUMENT_SAVE_DEBOUNCE_MS);
    },
    [flushDocumentSave]
  );

  const buildPersistedDocument = useCallback(
    (nextPages: Page[], nextPageCanvasData: PageCanvasDataMap, nextJournalEntries: JournalEntry[]): PersistedDocument => {
      const firstPageId = nextPages[0]?.id ?? null;
      return {
        pages: nextPages,
        canvasData: firstPageId ? nextPageCanvasData[firstPageId] ?? null : null,
        pageCanvasData: nextPageCanvasData,
        journalEntries: nextJournalEntries
      };
    },
    []
  );

  const persistDocument = useCallback((nextPages: Page[], nextPageCanvasData: PageCanvasDataMap) => {
    pagesRef.current = nextPages;
    pageCanvasDataRef.current = nextPageCanvasData;
    setPages(nextPages);
    scheduleDocumentSave(
      buildPersistedDocument(nextPages, nextPageCanvasData, journalEntriesRef.current) satisfies PersistedDocument
    );
  }, [buildPersistedDocument, scheduleDocumentSave]);

  const snapshotCanvasByPageId = useCallback((pageId: string): string | null => {
    const canvas = getCanvasByPageId(pageId);
    if (!canvas) {
      return pageCanvasDataRef.current[pageId] ?? null;
    }
    const json = canvas.toJSON();
    return JSON.stringify(json, (_key, value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return roundForSnapshot(value);
      }
      return value;
    });
  }, [getCanvasByPageId]);

  const applyBrushSettings = useCallback((targetCanvas?: FabricCanvas | null) => {
    const canvas = targetCanvas ?? getActiveCanvas();
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
  }, [color, getActiveCanvas, penStrokeWidth]);

  const setCanvasPanObjectInteractivity = useCallback((canvas: FabricCanvas | null | undefined, enabled: boolean) => {
    if (!canvas) {
      return;
    }
    const canvasApi = canvas as unknown as {
      getObjects?: () => unknown[];
    };
    const objects = canvasApi.getObjects?.() ?? [];
    for (const object of objects) {
      const objApi = object as {
        selectable?: boolean;
        evented?: boolean;
        globalCompositeOperation?: string;
        setCoords?: () => void;
        __panPrevSelectable?: boolean;
        __panPrevEvented?: boolean;
      };
      if (enabled) {
        if (objApi.globalCompositeOperation === "destination-out") {
          continue;
        }
        if (objApi.__panPrevSelectable === undefined) {
          objApi.__panPrevSelectable = objApi.selectable !== false;
        }
        if (objApi.__panPrevEvented === undefined) {
          objApi.__panPrevEvented = objApi.evented !== false;
        }
        objApi.selectable = true;
        objApi.evented = true;
        objApi.setCoords?.();
        continue;
      }
      if (objApi.__panPrevSelectable !== undefined) {
        objApi.selectable = objApi.__panPrevSelectable;
        delete objApi.__panPrevSelectable;
      }
      if (objApi.__panPrevEvented !== undefined) {
        objApi.evented = objApi.__panPrevEvented;
        delete objApi.__panPrevEvented;
      }
      objApi.setCoords?.();
    }
    canvas.requestRenderAll();
  }, []);

  const clearSelectionOverlay = useCallback((pageId?: string | null) => {
    const resolvedPageId = pageId ?? getCurrentPageId();
    const selectionCanvas = getSelectionCanvasByPageId(resolvedPageId);
    if (!selectionCanvas) {
      return;
    }
    const context = selectionCanvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
  }, [getCurrentPageId, getSelectionCanvasByPageId]);

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

  const loadCanvasDataIntoCanvas = useCallback(
    async (canvas: FabricCanvas, pageCanvasData: string | null, pageIdForOverlay?: string) => {
      isRestoringRef.current = true;
      canvas.clear();
      if (pageIdForOverlay) {
        clearSelectionOverlay(pageIdForOverlay);
      }

      if (pageCanvasData) {
        const parsed = JSON.parse(pageCanvasData) as Record<string, unknown>;
        await canvas.loadFromJSON(parsed);
      }
      canvas.requestRenderAll();
      isRestoringRef.current = false;
    },
    [clearSelectionOverlay]
  );

  const loadCanvasDataForPage = useCallback(
    async (pageId: string, pageCanvasData: string | null) => {
      const canvas = getCanvasByPageId(pageId);
      if (!canvas) {
        return;
      }
      await loadCanvasDataIntoCanvas(canvas, pageCanvasData, pageId);
    },
    [getCanvasByPageId, loadCanvasDataIntoCanvas]
  );

  const resetHistoryForPage = useCallback((pageId: string) => {
    const snapshot = snapshotCanvasByPageId(pageId);
    historyStacksRef.current[pageId] = {
      undo: snapshot ? [snapshot] : [],
      redo: []
    };
  }, [snapshotCanvasByPageId]);

  // DEPRECATED: Usare forceSaveAllPages dal saveManager per forza salvataggio
  // const persistCurrentDocument = useCallback(() => {
  //   const pageId = getCurrentPageId();
  //   if (!pageId) {
  //     return;
  //   }
  //   const snapshot = snapshotCanvasByPageId(pageId);
  //   if (!snapshot) {
  //     return;
  //   }
  //   if (pageCanvasDataRef.current[pageId] === snapshot) {
  //     return;
  //   }
  //   persistDocument(pagesRef.current, {
  //     ...pageCanvasDataRef.current,
  //     [pageId]: snapshot
  //   });
  // }, [getCurrentPageId, persistDocument, snapshotCanvasByPageId]);

  const applyPersistedDocument = useCallback(
    async (document: PersistedDocument) => {
      console.log("🔄 applyPersistedDocument: INIZIO caricamento documento archiviato");
      console.log(`🔄 applyPersistedDocument: Pagine da caricare: ${document.pages.length}`);
      console.log(`🔄 applyPersistedDocument: Canvas data disponibili: ${Object.keys(document.pageCanvasData).length}`);
      console.log(`🔄 applyPersistedDocument: Journal entries disponibili: ${document.journalEntries?.length || 0}`);
      
      const normalizedPages = document.pages.length > 0 ? document.pages : [createPage(0)];
      const normalizedPageCanvasData = normalizePageCanvasDataForPages(
        normalizedPages,
        document.pageCanvasData,
        document.canvasData
      );
      const normalizedJournalEntries = ensureMinimumJournalEntries(
        normalizeJournalEntries(document.journalEntries)
      );
      
      console.log(`🔄 applyPersistedDocument: Journal entries normalizzate: ${normalizedJournalEntries.length}`);
      
      // 🚨 CRITICO: Imposta i dati PRIMA di tutto
      pagesRef.current = normalizedPages;
      pageCanvasDataRef.current = normalizedPageCanvasData;
      journalEntriesRef.current = normalizedJournalEntries;
      currentPageIndexRef.current = 0;
      setCurrentPageIndex(0);
      setPages(normalizedPages);
      setJournalEntries(normalizedJournalEntries);  // 🎯 AGGIUNTO: Aggiorna stato giornale!
      
      console.log("🔄 applyPersistedDocument: Dati impostati, inizio caricamento canvas...");
      
      // 🚨 CRITICO: Carica solo i canvas che esistono già (montati)
      await Promise.all(
        normalizedPages.map(async (page) => {
          const canvas = getCanvasByPageId(page.id);
          const canvasData = normalizedPageCanvasData[page.id] ?? null;
          
          console.log(`🔄 applyPersistedDocument: Pagina ${page.name} - canvas disponibile: ${canvas ? 'SÌ' : 'NO'}, dati: ${canvasData?.length || 0} bytes`);
          
          if (canvas && canvasData) {
            await loadCanvasDataForPage(page.id, canvasData);
            resetHistoryForPage(page.id);
            console.log(`🔄 applyPersistedDocument: Pagina ${page.name} - canvas caricato`);
          } else {
            console.log(`🔄 applyPersistedDocument: Pagina ${page.name} - canvas non disponibile, dati salvati per virtualizzazione futura`);
            // I dati sono già in pageCanvasDataRef.current, verranno usati quando il canvas verrà montato
            resetHistoryForPage(page.id);
          }
        })
      );
      
      console.log("🔄 applyPersistedDocument: Caricamento completato");
      containerRef.current?.scrollTo({ top: 0, behavior: "auto" });
    },
    [getCanvasByPageId, loadCanvasDataForPage, resetHistoryForPage, setJournalEntries]
  );

  const buildCurrentDocumentSnapshot = useCallback((): PersistedDocument => {
    console.log("🔧 buildCurrentDocumentSnapshot: INIZIO creazione snapshot");
    const normalizedPages = pagesRef.current.length > 0 ? pagesRef.current : [createPage(0)];
    
    // 🚨 CRITICO: Copia TUTTI i dati canvas esistenti, non solo quelli della pagina attiva
    const nextPageCanvasData = { ...pageCanvasDataRef.current };
    console.log(`🔧 buildCurrentDocumentSnapshot: Dati canvas esistenti copiati: ${Object.keys(nextPageCanvasData).length}`);
    
    // 🚨 CRITICO: Verifica e forza salvataggio pagina attiva
    const activePageId = getCurrentPageId();
    if (activePageId) {
      const activeSnapshot = snapshotCanvasByPageId(activePageId);
      if (activeSnapshot && activeSnapshot.length > 32) {
        console.log(`🔧 buildCurrentDocumentSnapshot: Salvataggio pagina attiva ${activePageId} - ${activeSnapshot.length} bytes`);
        nextPageCanvasData[activePageId] = activeSnapshot;
      } else {
        console.log(`🔧 buildCurrentDocumentSnapshot: Pagina attiva ${activePageId} senza dati validi (${activeSnapshot?.length || 0} bytes)`);
      }
    }
    
    // 🚨 DEBUG: Verifica finale dati
    console.log(`🔧 buildCurrentDocumentSnapshot: Canvas data finali: ${Object.keys(nextPageCanvasData).length}`);
    Object.entries(nextPageCanvasData).forEach(([pageId, data]) => {
      console.log(`🔧 buildCurrentDocumentSnapshot: ${pageId}: ${data?.length || 0} bytes`);
    });
    
    return buildPersistedDocument(normalizedPages, nextPageCanvasData, journalEntriesRef.current);
  }, [buildPersistedDocument, getCurrentPageId, snapshotCanvasByPageId]);

  
  const buildArchivePreviewImages = useCallback(async (): Promise<string[]> => {
    try {
      console.log("🖼️ buildArchivePreviewImages: INIZIO");
      const previewImages: string[] = [];
      const baseWidth = Math.max(1, Math.floor(containerRef.current?.clientWidth ?? 1200));
      const previewHeight = Math.max(1, Math.round((PAGE_HEIGHT / baseWidth) * ARCHIVE_PREVIEW_WIDTH));
      const gridMultiplier = ARCHIVE_PREVIEW_WIDTH / baseWidth;

      console.log(`🖼️ buildArchivePreviewImages: Processo ${pagesRef.current.length} pagine`);

      for (let index = 0; index < pagesRef.current.length; index += 1) {
        const page = pagesRef.current[index];
        console.log(`🖼️ buildArchivePreviewImages: Processo pagina ${index + 1}: ${page.name}`);
        
        const previewCanvas = document.createElement("canvas");
        previewCanvas.width = ARCHIVE_PREVIEW_WIDTH;
        previewCanvas.height = previewHeight;
        const context = previewCanvas.getContext("2d");
        if (!context) {
          console.log(`🖼️ buildArchivePreviewImages: ERRORE - nessun context per pagina ${page.name}`);
          continue;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

        if (backgroundMode === "grid") {
          drawGridBackground(
            context,
            previewCanvas.width,
            previewCanvas.height,
            gridMultiplier
          );
        }

        const snapshot = pageCanvasDataRef.current[page.id];
        console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - snapshot disponibile: ${snapshot ? 'SÌ' : 'NO'} (${snapshot?.length || 0} bytes)`);

        if (snapshot && snapshot.length > 32) {
          console.log(`🖼️ Anteprima ${page.name} - usando snapshot da pageCanvasDataRef: ${snapshot.length} bytes`);
          try {
            const fabricModule = fabricModuleRef.current ?? (await lazyImportFabric());
            if (!fabricModuleRef.current) {
              fabricModuleRef.current = fabricModule;
            }
            const tempCanvasEl = document.createElement("canvas");
            const tempCanvas = new fabricModule.StaticCanvas(tempCanvasEl, {
              enableRetinaScaling: false,
              renderOnAddRemove: false
            });
            try {
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - creazione temp canvas ${baseWidth}x${PAGE_HEIGHT}`);
              tempCanvas.setDimensions({ width: baseWidth, height: PAGE_HEIGHT });

              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - parsing JSON snapshot...`);
              const parsed = JSON.parse(snapshot) as Record<string, unknown>;
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - JSON parsed: ${Object.keys(parsed).length} keys`);
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - JSON keys:`, Object.keys(parsed));

              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - loading into temp canvas...`);
              await tempCanvas.loadFromJSON(parsed);
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - loaded, objects: ${tempCanvas.getObjects().length}`);

              // 🚨 CRITICO: Forza rendering sincrono completo
              tempCanvas.renderAll();
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - renderAll() completato`);

              // 🚨 CRITICO: Attendi un frame per assicurare rendering completo
              await new Promise(resolve => requestAnimationFrame(resolve));
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - frame completato`);

              const source = (tempCanvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl ?? tempCanvasEl;
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - source canvas: ${source.width}x${source.height}`);
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - source canvas data: ${source.toDataURL().length} chars`);

              // 🚨 CRITICO: Verifica se il canvas ha contenuto
              const ctx = source.getContext('2d');
              const imageData = ctx?.getImageData(0, 0, source.width, source.height);
              const hasContent = imageData?.data.some((value, index) => index % 4 === 3 && value !== 0); // Check alpha channel
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - ha contenuto: ${hasContent ? 'SÌ' : 'NO'}`);

              context.drawImage(
                source,
                0,
                0,
                Math.max(1, source.width),
                Math.max(1, source.height),
                0,
                0,
                previewCanvas.width,
                previewCanvas.height
              );
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - disegnato su preview canvas`);

              // 🚨 CRITICO: Verifica preview canvas
              const previewData = context.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
              const previewHasContent = previewData.data.some((value, index) => index % 4 === 3 && value !== 0);
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - preview ha contenuto: ${previewHasContent ? 'SÌ' : 'NO'}`);

              const dataUrl = previewCanvas.toDataURL("image/jpeg", ARCHIVE_PREVIEW_JPEG_QUALITY);
              previewImages.push(dataUrl);
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - snapshot salvato (${dataUrl.length} chars)`);
              continue; // 🚨 CRITICO: Salta il push finale!
            } finally {
              tempCanvas.dispose();
              console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - temp canvas disposed`);
            }
          } catch (error) {
            console.error(`🖼️ buildArchivePreviewImages: ERRORE nel renderizzare snapshot per ${page.name}:`, error);
            console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - fallback a canvas montato`);
            // Continue to canvas mounted fallback
          }
        } else {
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - NESSUN snapshot valido (${snapshot?.length || 0} bytes)`);
        }

        // 🚨 FALLBACK: Usa canvas montato
        const canvas = getCanvasByPageId(page.id);
        const sourceCanvas = canvas
          ? (canvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl
          : null;

        console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - canvas montato disponibile: ${canvas ? 'SÌ' : 'NO'}`);
        console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - sourceCanvas disponibile: ${sourceCanvas ? 'SÌ' : 'NO'}`);

        if (canvas && sourceCanvas) {
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - uso canvas montato (fallback)`);
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - canvas dimensions: ${canvas.getWidth()}x${canvas.getHeight()}`);
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - sourceCanvas dimensions: ${sourceCanvas.width}x${sourceCanvas.height}`);
          
          // 🚨 CRITICO: Verifica se il canvas montato ha contenuto reale
          const canvasCtx = sourceCanvas.getContext('2d');
          const canvasImageData = canvasCtx?.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
          const canvasHasContent = canvasImageData?.data.some((value, index) => index % 4 === 3 && value !== 0);
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - canvas montato ha contenuto: ${canvasHasContent ? 'SÌ' : 'NO'}`);
          
          if (!canvasHasContent) {
            console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - canvas montato VUOTO, uso pagina bianca`);
            // Usa pagina bianca invece del canvas vuoto
            const dataUrl = previewCanvas.toDataURL("image/jpeg", ARCHIVE_PREVIEW_JPEG_QUALITY);
            previewImages.push(dataUrl);
            console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - pagina bianca salvata (${dataUrl.length} chars)`);
            continue;
          }

          const canvasWidth = Math.max(1, canvas.getWidth());
          const previewHeight = Math.max(1, Math.round((PAGE_HEIGHT / canvasWidth) * ARCHIVE_PREVIEW_WIDTH));
          previewCanvas.height = previewHeight;
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - preview height: ${previewHeight}`);

          context.drawImage(
            sourceCanvas,
            0,
            0,
            Math.max(1, sourceCanvas.width),
            Math.max(1, sourceCanvas.height),
            0,
            0,
            previewCanvas.width,
            previewCanvas.height
          );
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - disegnato canvas montato su preview`);

          const dataUrl = previewCanvas.toDataURL("image/jpeg", ARCHIVE_PREVIEW_JPEG_QUALITY);
          previewImages.push(dataUrl);
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - canvas montato salvato (${dataUrl.length} chars)`);
        } else {
          // 🚨 ULTIMO FALLBACK: Pagina bianca
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - NESSUN canvas, uso pagina bianca`);
          const dataUrl = previewCanvas.toDataURL("image/jpeg", ARCHIVE_PREVIEW_JPEG_QUALITY);
          previewImages.push(dataUrl);
          console.log(`🖼️ buildArchivePreviewImages: Pagina ${page.name} - pagina bianca salvata (${dataUrl.length} chars)`);
        }
      }

      console.log(`🖼️ buildArchivePreviewImages: COMPLETATO - ${previewImages.length} immagini generate`);
      return previewImages;
    } catch (error) {
      console.error("🖼️ buildArchivePreviewImages: ERRORE GRAVE:", error);
      return [];
    }
  }, [backgroundMode, getCanvasByPageId]);

  const buildArchivePreviewImagesSyncFallback = useCallback((): string[] => {
    try {
      const previewImages: string[] = [];

      for (let index = 0; index < pagesRef.current.length; index += 1) {
        const page = pagesRef.current[index];
        const canvas = getCanvasByPageId(page.id);
        const sourceCanvas = canvas
          ? (canvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl
          : null;
        if (!canvas || !sourceCanvas) {
          continue;
        }

        const canvasWidth = Math.max(1, canvas.getWidth());
        const previewHeight = Math.max(1, Math.round((PAGE_HEIGHT / canvasWidth) * ARCHIVE_PREVIEW_WIDTH));
        const previewCanvas = document.createElement("canvas");
        previewCanvas.width = ARCHIVE_PREVIEW_WIDTH;
        previewCanvas.height = previewHeight;
        const context = previewCanvas.getContext("2d");
        if (!context) {
          continue;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

        if (backgroundMode === "grid") {
          drawGridBackground(
            context,
            previewCanvas.width,
            previewCanvas.height,
            previewCanvas.width / canvasWidth
          );
        }
        context.drawImage(
          sourceCanvas,
          0,
          0,
          Math.max(1, sourceCanvas.width),
          Math.max(1, sourceCanvas.height),
          0,
          0,
          previewCanvas.width,
          previewCanvas.height
        );
        previewImages.push(previewCanvas.toDataURL("image/jpeg", ARCHIVE_PREVIEW_JPEG_QUALITY));
      }

      return previewImages;
    } catch {
      return [];
    }
  }, [backgroundMode, getCanvasByPageId]);

  const loadArchiveEntries = useCallback(async () => {
    setIsArchiveLoading(true);
    try {
      const items = await listArchivedBoardDocuments();
      setArchiveEntries(items);
      setSelectedArchiveEntryId((current) => {
        if (items.length === 0) {
          return null;
        }
        if (current && items.some((entry) => entry.id === current)) {
          return current;
        }
        return items[0].id;
      });
    } catch {
      setArchiveMessage("Archivio non disponibile");
    } finally {
      setIsArchiveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filteredArchiveEntries.length === 0) {
      setSelectedArchiveEntryId(null);
      return;
    }
    if (
      selectedArchiveEntryId === null ||
      !filteredArchiveEntries.some((entry) => entry.id === selectedArchiveEntryId)
    ) {
      setSelectedArchiveEntryId(filteredArchiveEntries[0].id);
    }
  }, [filteredArchiveEntries, selectedArchiveEntryId]);

  const openArchiveDocument = useCallback(
    async (archiveId: string) => {
      setArchiveMessage("");
      try {
        const archivedDocument = await loadArchivedBoardDocument(archiveId);
        if (!archivedDocument) {
          setArchiveMessage("Documento archivio non trovato");
          return;
        }
        await applyPersistedDocument(archivedDocument);
        setActiveArchiveDocumentId(archiveId);
        void saveLastBoardDocument(archivedDocument).catch(() => undefined);
        setIsArchiveOpen(false);
      } catch {
        setArchiveMessage("Apertura archivio fallita");
      }
    },
    [applyPersistedDocument, setActiveArchiveDocumentId]
  );

  const removeArchiveDocument = useCallback(
    async (archiveId: string) => {
      try {
        await deleteArchivedBoardDocument(archiveId);
        if (activeArchiveDocumentIdRef.current === archiveId) {
          setActiveArchiveDocumentId(null);
        }
        await loadArchiveEntries();
      } catch {
        setArchiveMessage("Cancellazione archivio fallita");
      }
    },
    [loadArchiveEntries, setActiveArchiveDocumentId]
  );

  const renameArchiveDocument = useCallback(
    async (archiveId: string, currentFileName: string) => {
      const defaultName = currentFileName.replace(/\.mbd$/i, "");
      const nextFileName = window.prompt("Nuovo nome file", defaultName);
      if (nextFileName === null) {
        return;
      }
      if (!nextFileName.trim()) {
        setArchiveMessage("Nome file non valido");
        return;
      }

      try {
        await renameArchivedBoardDocument(archiveId, nextFileName);
        await loadArchiveEntries();
        setArchiveMessage("Documento rinominato");
      } catch {
        setArchiveMessage("Rinomina archivio fallita");
      }
    },
    [loadArchiveEntries]
  );

  // 🎯 FUNZIONE DI SALVATAGGIO UNIFICATA
  const saveCurrentState = useCallback(async (force: boolean = false) => {
    console.log("💾 saveCurrentState: INIZIO salvataggio unificato");
    console.log(`💾 saveCurrentState: Pagine totali: ${pagesRef.current.length}`);
    console.log(`💾 saveCurrentState: Dati canvas esistenti: ${Object.keys(pageCanvasDataRef.current).length}`);
    
    try {
      // Salva la pagina corrente
      const currentPageId = getCurrentPageId();
      if (currentPageId) {
        const snapshot = snapshotCanvasByPageId(currentPageId);
        console.log(`💾 saveCurrentState: Pagina corrente ${currentPageId} - snapshot: ${snapshot?.length || 0} bytes`);
        
        if (snapshot && snapshot.length > 32) {
          const existingData = pageCanvasDataRef.current[currentPageId];
          if (!existingData || snapshot.length >= existingData.length || force) {
            const updatedCanvasData = {
              ...pageCanvasDataRef.current,
              [currentPageId]: snapshot
            };
            
            console.log(`💾 saveCurrentState: Prima del salvataggio - dati canvas: ${Object.keys(updatedCanvasData).length} pagine`);
            
            // Salva immediatamente senza debounce
            if (documentSaveTimeoutRef.current !== null) {
              window.clearTimeout(documentSaveTimeoutRef.current);
              documentSaveTimeoutRef.current = null;
            }
            
            pageCanvasDataRef.current = updatedCanvasData;
            setPages(pagesRef.current);
            
            const document = buildPersistedDocument(pagesRef.current, updatedCanvasData, journalEntriesRef.current);
            pendingDocumentSaveRef.current = document;
            flushDocumentSave();
            
            console.log(`💾 saveCurrentState: Salvato pagina ${currentPageId} - ${snapshot.length} bytes`);
            console.log(`💾 saveCurrentState: Documento salvato con ${document.pages.length} pagine e ${Object.keys(document.pageCanvasData).length} canvas data`);
          }
        } else {
          console.log(`💾 saveCurrentState: Snapshot troppo corto o nullo (${snapshot?.length || 0} bytes)`);
        }
      } else {
        console.log(`💾 saveCurrentState: Nessuna pagina corrente trovata`);
      }
      
      // Salva anche il giornale se necessario
      if (journalEntriesRef.current.length > 0) {
        console.log(`💾 saveCurrentState: Salvato giornale con ${journalEntriesRef.current.length} voci`);
      }
      
      console.log("💾 saveCurrentState: COMPLETATO");
    } catch (error) {
      console.error("💾 saveCurrentState: ERRORE:", error);
    }
  }, [buildPersistedDocument, flushDocumentSave, getCurrentPageId, snapshotCanvasByPageId]);

  const setCurrentPageFromIndex = useCallback(async (index: number) => {
    const clampedIndex = clamp(index, 0, Math.max(0, pagesRef.current.length - 1));
    if (clampedIndex === currentPageIndexRef.current) {
      return;
    }
    
    // Usa la funzione di salvataggio unificata
    await saveCurrentState();
    
    currentPageIndexRef.current = clampedIndex;
    setCurrentPageIndex(clampedIndex);
  }, [saveCurrentState]);

  const archiveCurrentDocument = useCallback(
    async (silent: boolean) => {
      // 🎯 SOLUZIONE: Forza salvataggio di TUTTE le pagine prima di archiviare!
      console.log("🔍 Inizio archiviazione con salvataggio completo di tutte le pagine...");
      
      // 🚨 CRITICO: Forza salvataggio di TUTTI i canvas disponibili prima di creare snapshot
      console.log("🔸 Forza salvataggio completo canvas prima di archiviare...");
      for (let i = 0; i < pagesRef.current.length; i += 1) {
        const page = pagesRef.current[i];
        const canvas = getCanvasByPageId(page.id);
        if (canvas) {
          const snapshot = snapshotCanvasByPageId(page.id);
          if (snapshot && snapshot.length > 32) {
            const existingData = pageCanvasDataRef.current[page.id];
            if (!existingData || snapshot.length >= existingData.length) {
              const updatedCanvasData = {
                ...pageCanvasDataRef.current,
                [page.id]: snapshot
              };
              console.log(`🔸 Salvataggio forzato pagina ${page.name} - ${snapshot.length} bytes`);
              pageCanvasDataRef.current = updatedCanvasData;
            }
          }
        }
      }
      
      // 🚨 CRITICO: Forza salvataggio anche delle pagine virtualizzate con dati esistenti
      console.log("🔸 Verifica dati canvas esistenti prima di archiviare...");
      Object.entries(pageCanvasDataRef.current).forEach(([pageId, data]) => {
        if (data && data.length > 32) {
          console.log(`🔸 Dati esistenti ${pageId}: ${data.length} bytes - PRESERVATI`);
        }
      });
      
      // Salva lo stato corrente
      await saveCurrentState(true);
      
      console.log("🔸 Inizio buildCurrentDocumentSnapshot...");
      const currentDocument = buildCurrentDocumentSnapshot();
      
      // 🚨 DEBUG: Verifica dati nel documento
      console.log(`🔸 Documento creato con ${Object.keys(currentDocument.pageCanvasData).length} canvas data`);
      Object.entries(currentDocument.pageCanvasData).forEach(([pageId, data]) => {
        console.log(`🔸 Canvas data ${pageId}: ${data?.length || 0} bytes`);
      });
      console.log("🔸 Inizio buildArchivePreviewImages...");
      const previewImages = await buildArchivePreviewImages();
      console.log(`🔸 buildArchivePreviewImages completato: ${previewImages.length} immagini generate`);
      
      try {
        const archivedKey = await archiveBoardDocument(
          currentDocument,
          activeArchiveDocumentIdRef.current,
          previewImages
        );
        if (!archivedKey || silent) {
          return;
        }
        setActiveArchiveDocumentId(archivedKey);
        await loadArchiveEntries();
        setArchiveMessage("Documento archiviato");
        console.log("✅ Archiviazione completata con successo!");
      } catch {
        if (!silent) {
          setArchiveMessage("Archiviazione fallita");
          console.error("❌ Archiviazione fallita!");
        }
      }
    },
    [buildArchivePreviewImages, buildCurrentDocumentSnapshot, loadArchiveEntries, setActiveArchiveDocumentId, saveCurrentState, snapshotCanvasByPageId, getCanvasByPageId]
  );

  const saveAndArchiveOnExit = useCallback(() => {
    const currentDocument = buildCurrentDocumentSnapshot();
    const previewImages = buildArchivePreviewImagesSyncFallback();
    pendingDocumentSaveRef.current = currentDocument;
    flushPendingDocumentSaveNow();

    if (hasArchivedOnExitRef.current) {
      return;
    }
    hasArchivedOnExitRef.current = true;
    void archiveBoardDocument(currentDocument, activeArchiveDocumentIdRef.current, previewImages)
      .then((archivedKey) => {
        if (archivedKey) {
          setActiveArchiveDocumentId(archivedKey);
        }
      })
      .catch(() => undefined);
  }, [buildArchivePreviewImagesSyncFallback, buildCurrentDocumentSnapshot, flushPendingDocumentSaveNow, setActiveArchiveDocumentId]);

  const pushHistoryState = useCallback((pageId?: string | null) => {
    if (isRestoringRef.current) {
      return;
    }
    const resolvedPageId = pageId ?? getCurrentPageId();
    if (!resolvedPageId) {
      return;
    }
    const snapshot = snapshotCanvasByPageId(resolvedPageId);
    if (!snapshot) {
      // Se non c'è nuovo snapshot (canvas non montato), mantieni i dati esistenti
      return;
    }

    const pageHistory = historyStacksRef.current[resolvedPageId] ?? { undo: [], redo: [] };
    if (pageHistory.undo[pageHistory.undo.length - 1] === snapshot) {
      return;
    }

    pageHistory.undo.push(snapshot);
    if (pageHistory.undo.length > MAX_HISTORY) {
      pageHistory.undo.shift();
    }
    pageHistory.redo = [];
    historyStacksRef.current[resolvedPageId] = pageHistory;

    // Salva sempre il nuovo snapshot
    const nextPageCanvasData = {
      ...pageCanvasDataRef.current,
      [resolvedPageId]: snapshot
    };
    persistDocument(pagesRef.current, nextPageCanvasData);
  }, [getCurrentPageId, persistDocument, snapshotCanvasByPageId]);

  const handlePathCreated = useCallback(
    (pageId: string, event: unknown) => {
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
      const pageCanvas = getCanvasByPageId(pageId);
      pageCanvas?.requestRenderAll();
      pushHistoryState(pageId);

      if (activeToolRef.current === "pen" && path?.getBoundingRect && isOcrEnabledRef.current) {
        const rect = path.getBoundingRect({ absolute: true, stroke: true });
        scheduleAutoOcrForRectRef.current(pageId, rect);
      }
    },
    [getCanvasByPageId, pushHistoryState]
  );

  const detachToolHandlers = useCallback((pageId?: string | null) => {
    const resolvedPageId = pageId ?? activeCanvasPageIdRef.current;
    const canvas = getCanvasByPageId(resolvedPageId);
    if (!canvas) {
      return;
    }

    const handlers = toolHandlersRef.current;
    const lowerCanvas = canvas.getElement();
    const upperCanvas = (canvas as unknown as { upperCanvasEl?: HTMLCanvasElement }).upperCanvasEl;

    if (handlers.down) {
      lowerCanvas?.removeEventListener("pointerdown", handlers.down as EventListener);
      upperCanvas?.removeEventListener("pointerdown", handlers.down as EventListener);
    }
    if (handlers.move) {
      lowerCanvas?.removeEventListener("pointermove", handlers.move as EventListener);
      upperCanvas?.removeEventListener("pointermove", handlers.move as EventListener);
    }
    if (handlers.up) {
      lowerCanvas?.removeEventListener("pointerup", handlers.up as EventListener);
      upperCanvas?.removeEventListener("pointerup", handlers.up as EventListener);
    }
    if (handlers.leave) {
      lowerCanvas?.removeEventListener("pointerleave", handlers.leave as EventListener);
      upperCanvas?.removeEventListener("pointerleave", handlers.leave as EventListener);
    }

    if (handlers.down) {
      canvas.off("mouse:down", handlers.down);
    }
    if (handlers.move) {
      canvas.off("mouse:move", handlers.move);
    }
    if (handlers.up) {
      canvas.off("mouse:up", handlers.up);
    }
    if (handlers.leave) {
      canvas.off("mouse:out", handlers.leave);
    }
    handlers.cleanup?.();
    setCanvasPanObjectInteractivity(canvas, false);
    toolHandlersRef.current = {};
  }, [getCanvasByPageId, setCanvasPanObjectInteractivity]);

  const configureActiveTool = useCallback(() => {
    const pageId = getCurrentPageId();
    const canvas = getCanvasByPageId(pageId);
    const fabricModule = fabricModuleRef.current;
    const container = containerRef.current;
    if (!canvas || !pageId) {
      return;
    }
    container?.classList.remove("is-panning");

    if (activeCanvasPageIdRef.current && activeCanvasPageIdRef.current !== pageId) {
      detachToolHandlers(activeCanvasPageIdRef.current);
    }
    detachToolHandlers(pageId);
    activeCanvasPageIdRef.current = pageId;
    for (const mappedCanvas of fabricCanvasMapRef.current.values()) {
      if (mappedCanvas === canvas) {
        continue;
      }
      mappedCanvas.isDrawingMode = false;
      mappedCanvas.selection = false;
      (mappedCanvas as unknown as { skipTargetFind?: boolean }).skipTargetFind = true;
      setCanvasPanObjectInteractivity(mappedCanvas, false);
      const mappedTopContext = (mappedCanvas as unknown as { contextTop?: CanvasRenderingContext2D }).contextTop;
      if (mappedTopContext) {
        mappedTopContext.globalCompositeOperation = "source-over";
      }
    }
    syncCanvasOffset();
    activeToolRef.current = tool;

    activeLineRef.current = null;
    (canvas as unknown as { skipTargetFind?: boolean }).skipTargetFind = true;
    setCanvasPanObjectInteractivity(canvas, false);

    if (tool === "pen") {
      canvas.isDrawingMode = true;
      canvas.selection = false;
      const topContext = (canvas as unknown as { contextTop?: CanvasRenderingContext2D }).contextTop;
      if (topContext) {
        topContext.globalCompositeOperation = "source-over";
      }
      applyBrushSettings(canvas);
      return;
    }

    if (tool === "eraser") {
      if (!fabricModule) {
        return;
      }

      class EraserBrush extends fabricModule.PencilBrush {
        _setBrushStyles(ctx: CanvasRenderingContext2D): void {
          super._setBrushStyles(ctx);
          // Show a visible preview stroke while dragging.
          // The actual erase is still applied on path:created with destination-out.
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
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
      brush.decimate = PEN_DECIMATE;
      canvas.isDrawingMode = true;
      canvas.selection = false;
      const topContext = (canvas as unknown as { contextTop?: CanvasRenderingContext2D }).contextTop;
      if (topContext) {
        topContext.globalCompositeOperation = "source-over";
      }
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
      const stopPanning = () => {
        if (!isPanning) {
          container?.classList.remove("is-panning");
          return;
        }
        isPanning = false;
        container?.classList.remove("is-panning");
      };

      (canvas as unknown as { skipTargetFind?: boolean }).skipTargetFind = false;
      canvas.selection = false;
      setCanvasPanObjectInteractivity(canvas, true);

      const down = (event: unknown) => {
        const opt = event as { e: Event; target?: unknown };
        if (opt.target) {
          return;
        }
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
        stopPanning();
      };
      const leave = () => {
        stopPanning();
      };
      const onWindowPointerUp = () => {
        stopPanning();
      };
      const onWindowBlur = () => {
        stopPanning();
      };

      window.addEventListener("pointerup", onWindowPointerUp, { passive: true });
      window.addEventListener("blur", onWindowBlur);

      canvas.on("mouse:down", down);
      canvas.on("mouse:move", move);
      canvas.on("mouse:up", up);
      canvas.on("mouse:out", leave);
      toolHandlersRef.current = {
        down,
        move,
        up,
        leave,
        cleanup: () => {
          window.removeEventListener("pointerup", onWindowPointerUp);
          window.removeEventListener("blur", onWindowBlur);
          stopPanning();
        }
      };
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
      pushHistoryState(pageId);
    };

    canvas.on("mouse:down", down);
    canvas.on("mouse:move", move);
    canvas.on("mouse:up", up);
    toolHandlersRef.current = { down, move, up };
  }, [applyBrushSettings, color, detachToolHandlers, eraserStrokeWidth, getCanvasByPageId, getCurrentPageId, penStrokeWidth, pushHistoryState, setCanvasPanObjectInteractivity, syncCanvasOffset, tool]);

  const resizeCanvases = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const width = Math.max(1, Math.floor(container.clientWidth));
    for (const [slotId, canvas] of fabricCanvasMapRef.current.entries()) {
      canvas.setDimensions({ width, height: PAGE_HEIGHT });
      canvas.calcOffset();
      canvas.requestRenderAll();

      const selectionCanvas = selectionCanvasElementsRef.current.get(slotId);
      if (selectionCanvas) {
        selectionCanvas.width = width;
        selectionCanvas.height = PAGE_HEIGHT;
        selectionCanvas.style.width = `${width}px`;
        selectionCanvas.style.height = `${PAGE_HEIGHT}px`;
      }
    }
  }, []);

  const getWorker = useCallback(async (): Promise<OcrWorker> => {
    if (workerRef.current) {
      return workerRef.current;
    }
    if (!workerInitPromiseRef.current) {
      workerInitPromiseRef.current = lazyImportTesseract().then((tesseract) =>
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
    // 🎯 Usa la funzione di salvataggio unificata prima di aggiungere
    await saveCurrentState();
    
    const nextPage = createPage(pagesRef.current.length);
    const nextPages = [...pagesRef.current, nextPage];
    const nextPageCanvasData = {
      ...pageCanvasDataRef.current,
      [nextPage.id]: null
    };
    persistDocument(nextPages, nextPageCanvasData);
    historyStacksRef.current[nextPage.id] = { undo: [], redo: [] };
    resizeCanvases();
  }, [persistDocument, resizeCanvases, saveCurrentState]);

  const clearAllPages = useCallback(async () => {
    if (!window.confirm("Vuoi cancellare tutte le pagine?")) {
      return;
    }

    const firstPage = createPage(0);
    const emptyPageCanvasData: PageCanvasDataMap = { [firstPage.id]: null };
    const nextDocument: PersistedDocument = {
      pages: [firstPage],
      canvasData: null,
      pageCanvasData: emptyPageCanvasData,
      journalEntries: createJournalEntries(MIN_VISIBLE_JOURNAL_ENTRIES)
    };
    persistDocument(nextDocument.pages, nextDocument.pageCanvasData);
    lastOcrChunkRef.current = "";
    autoOcrRectRef.current = null;
    clearAutoOcrScheduleRef.current();
    currentPageIndexRef.current = 0;
    setCurrentPageIndex(0);
    historyStacksRef.current = {};
    setTool("pen");
    setIsSelectionMode(false);
    setIsOcrRunning(false);
    setOcrStatus("");
  }, [persistDocument]);

  // 🆕 FUNZIONE CANCELLA INTELLIGENTE
  const deleteSelectedObjects = useCallback(() => {
    const currentPageId = pages[currentPageIndex]?.id;
    if (!currentPageId) return;
    
    const canvas = getCanvasByPageId(currentPageId);
    if (!canvas) return;
    
    // Controlla se ci sono oggetti selezionati
    const activeObject = canvas.getActiveObject();
    const selectedObjects = selectedObjectsRef.current;
    
    if (activeObject || selectedObjects.size > 0) {
      // Ci sono oggetti selezionati → cancella solo quelli
      console.log('🗑️ Deleting selected objects...');
      
      // Raccogli tutti gli oggetti da cancellare
      const objectsToDelete: any[] = [];
      
      if (activeObject) {
        if (activeObject.type === 'activeSelection') {
          // È una selezione multipla
          objectsToDelete.push(...(activeObject as any)._objects);
        } else {
          // È un oggetto singolo
          objectsToDelete.push(activeObject);
        }
      }
      
      // Aggiungi oggetti dalla selezione multipla (se presenti)
      selectedObjects.forEach(obj => {
        if (!objectsToDelete.includes(obj)) {
          objectsToDelete.push(obj);
        }
      });
      
      console.log(`🗑️ Deleting ${objectsToDelete.length} objects`);
      
      // Rimuovi gli oggetti dal canvas
      objectsToDelete.forEach(obj => {
        canvas.remove(obj);
      });
      
      // Pulisci le selezioni
      canvas.discardActiveObject();
      selectedObjectsRef.current.clear();
      
      // Renderizza
      canvas.renderAll();
      
      console.log('✅ Selected objects deleted successfully');
    } else {
      // Nessun oggetto selezionato → comportamento esistente
      console.log('🗑️ No objects selected, using clearAllPages...');
      void clearAllPages();
    }
  }, [pages, currentPageIndex, getCanvasByPageId, clearAllPages]);

  const createNewDocument = useCallback(async () => {
    if (!window.confirm("Creare un nuovo documento vuoto?")) {
      return;
    }

    // 🚨 DEPRECATED: Non usare forceSaveAllPages - salva solo pagina corrente
    // Salvataggio manuale della pagina corrente
    const currentPageId = getCurrentPageId();
    if (currentPageId) {
      const snapshot = snapshotCanvasByPageId(currentPageId);
      if (snapshot && snapshot.length > 32) {
        const existingData = pageCanvasDataRef.current[currentPageId];
        if (!existingData || snapshot.length >= existingData.length) {
          const updatedCanvasData = {
            ...pageCanvasDataRef.current,
            [currentPageId]: snapshot
          };
          
          // Salva immediatamente senza debounce
          if (documentSaveTimeoutRef.current !== null) {
            window.clearTimeout(documentSaveTimeoutRef.current);
            documentSaveTimeoutRef.current = null;
          }
          
          pageCanvasDataRef.current = updatedCanvasData;
          setPages(pagesRef.current);
          
          const document = buildPersistedDocument(pagesRef.current, updatedCanvasData, journalEntriesRef.current);
          pendingDocumentSaveRef.current = document;
          flushDocumentSave();
        }
      }
    }

    // Attendi che il salvataggio sia completato
    await waitForSaveComplete(100);

    // Archivia sempre il documento corrente (come archiveAndCreateNew)
    const currentDocument = buildCurrentDocumentSnapshot();
    const previewImages = await buildArchivePreviewImages();
    try {
      const archivedKey = await archiveBoardDocument(
        currentDocument,
        activeArchiveDocumentIdRef.current,
        previewImages
      );
      if (archivedKey) {
        setActiveArchiveDocumentId(archivedKey);
      }
    } catch {
      // Continua anche se l'archiviazione fallisce
    }

    const emptyDocument: PersistedDocument = {
      pages: [createPage(0)],
      canvasData: null,
      pageCanvasData: {},
      journalEntries: createJournalEntries(MIN_VISIBLE_JOURNAL_ENTRIES)
    };
    emptyDocument.pageCanvasData = {
      [emptyDocument.pages[0].id]: null
    };

    await applyPersistedDocument(emptyDocument);
    setActiveArchiveDocumentId(null);
    pendingDocumentSaveRef.current = emptyDocument;
    flushPendingDocumentSaveNow();
    setIsArchiveOpen(false);
    setArchiveMessage("Nuovo documento creato");
  }, [applyPersistedDocument, buildArchivePreviewImages, buildCurrentDocumentSnapshot, flushPendingDocumentSaveNow, setActiveArchiveDocumentId, snapshotCanvasByPageId]);

  const archiveAndCreateNew = useCallback(async () => {
    // 🚨 DEPRECATED: Non usare forceSaveAllPages - salva solo pagina corrente
    // Salvataggio manuale della pagina corrente
    const currentPageId = getCurrentPageId();
    if (currentPageId) {
      const snapshot = snapshotCanvasByPageId(currentPageId);
      if (snapshot && snapshot.length > 32) {
        const existingData = pageCanvasDataRef.current[currentPageId];
        if (!existingData || snapshot.length >= existingData.length) {
          const updatedCanvasData = {
            ...pageCanvasDataRef.current,
            [currentPageId]: snapshot
          };
          
          // Salva immediatamente senza debounce
          if (documentSaveTimeoutRef.current !== null) {
            window.clearTimeout(documentSaveTimeoutRef.current);
            documentSaveTimeoutRef.current = null;
          }
          
          pageCanvasDataRef.current = updatedCanvasData;
          setPages(pagesRef.current);
          
          const document = buildPersistedDocument(pagesRef.current, updatedCanvasData, journalEntriesRef.current);
          pendingDocumentSaveRef.current = document;
          flushDocumentSave();
        }
      }
    }

    // Attendi che il salvataggio sia completato
    await waitForSaveComplete(100);

    const currentDocument = buildCurrentDocumentSnapshot();
    const previewImages = await buildArchivePreviewImages();
    try {
      // Archive current document
      const archivedKey = await archiveBoardDocument(
        currentDocument,
        activeArchiveDocumentIdRef.current,
        previewImages
      );
      if (archivedKey) {
        setActiveArchiveDocumentId(archivedKey);
      }
      
      // Create new empty document
      const emptyDocument: PersistedDocument = {
        pages: [createPage(0)],
        canvasData: null,
        pageCanvasData: {},
        journalEntries: createJournalEntries(MIN_VISIBLE_JOURNAL_ENTRIES)
      };
      emptyDocument.pageCanvasData = {
        [emptyDocument.pages[0].id]: null
      };

      await applyPersistedDocument(emptyDocument);
      setActiveArchiveDocumentId(null);
      pendingDocumentSaveRef.current = emptyDocument;
      flushPendingDocumentSaveNow();
      
      // Refresh archive entries and close panel
      await loadArchiveEntries();
      setIsArchiveOpen(false);
      setArchiveMessage("Documento archiviato e nuovo documento creato");
    } catch {
      setArchiveMessage("Archiviazione fallita");
    }
  }, [buildArchivePreviewImages, buildCurrentDocumentSnapshot, applyPersistedDocument, flushPendingDocumentSaveNow, loadArchiveEntries, setActiveArchiveDocumentId, snapshotCanvasByPageId]);

  const downloadBlob = useCallback((blob: Blob, fileName: string) => {
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }, []);

  const buildJournalExportPayload = useCallback(
    () =>
      journalEntries.map((entry) => ({
        date: entry.date,
        accountName: entry.accountName,
        description: entry.description,
        debit: entry.debit,
        credit: entry.credit
      })),
    [journalEntries]
  );

  const buildJournalWorkbookBlob = useCallback(
    async (datePart: string) =>
      exportJournalWorkbook(buildJournalExportPayload(), `giornale_data_${datePart}`),
    [buildJournalExportPayload]
  );

  const renderPageToFlattenedCanvas = useCallback(
    async (pageId: string, width: number, height: number, gridMultiplier: number): Promise<HTMLCanvasElement | null> => {
      const flattenedCanvas = document.createElement("canvas");
      flattenedCanvas.width = Math.max(1, Math.round(width));
      flattenedCanvas.height = Math.max(1, Math.round(height));
      const flattenedContext = flattenedCanvas.getContext("2d");
      if (!flattenedContext) {
        return null;
      }

      flattenedContext.fillStyle = "#ffffff";
      flattenedContext.fillRect(0, 0, flattenedCanvas.width, flattenedCanvas.height);
      if (backgroundMode === "grid") {
        drawGridBackground(flattenedContext, flattenedCanvas.width, flattenedCanvas.height, gridMultiplier);
      }

      const mountedCanvas = getCanvasByPageId(pageId);
      const mountedSource = mountedCanvas
        ? (mountedCanvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl
        : null;
      if (mountedSource) {
        flattenedContext.drawImage(
          mountedSource,
          0,
          0,
          Math.max(1, mountedSource.width),
          Math.max(1, mountedSource.height),
          0,
          0,
          flattenedCanvas.width,
          flattenedCanvas.height
        );
        return flattenedCanvas;
      }

      const snapshot = pageCanvasDataRef.current[pageId];
      if (!snapshot) {
        return flattenedCanvas;
      }

      try {
        const fabricModule = fabricModuleRef.current ?? (await lazyImportFabric());
        if (!fabricModuleRef.current) {
          fabricModuleRef.current = fabricModule;
        }
        const tempCanvasEl = document.createElement("canvas");
        const tempCanvas = new fabricModule.StaticCanvas(tempCanvasEl, {
          enableRetinaScaling: false,
          renderOnAddRemove: false
        });
        try {
          const baseWidth = Math.max(1, Math.floor(containerRef.current?.clientWidth ?? width));
          tempCanvas.setDimensions({ width: baseWidth, height: PAGE_HEIGHT });
          const parsed = JSON.parse(snapshot) as Record<string, unknown>;
          await tempCanvas.loadFromJSON(parsed);
          tempCanvas.requestRenderAll();
          const source = (tempCanvas as unknown as { lowerCanvasEl?: HTMLCanvasElement }).lowerCanvasEl ?? tempCanvasEl;
          flattenedContext.drawImage(
            source,
            0,
            0,
            Math.max(1, source.width),
            Math.max(1, source.height),
            0,
            0,
            flattenedCanvas.width,
            flattenedCanvas.height
          );
        } finally {
          tempCanvas.dispose();
        }
      } catch {
        // Keep white page when snapshot cannot be rendered.
      }

      return flattenedCanvas;
    },
    [backgroundMode, getCanvasByPageId]
  );

  const buildPdfBlob = useCallback(async (): Promise<Blob | null> => {
    // 🚨 SOLUZIONE DRASTICA: Navigazione sequenziale per garantire dati
    console.log("🔍 Inizio generazione PDF con navigazione sequenziale...");
    
    const pagesSnapshot = pagesRef.current;
    if (pagesSnapshot.length === 0) {
      return null;
    }

    // Salva la pagina corrente originale
    const originalPageIndex = currentPageIndexRef.current;
    
    const { jsPDF } = await lazyImportJsPDF();
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
    let hasAtLeastOnePage = false;

    for (let i = 0; i < pagesSnapshot.length; i += 1) {
      const page = pagesSnapshot[i];
      
      // 🚨 CRITICO: Vai alla pagina i e rendila corrente
      console.log(`📍 Navigando alla pagina ${i + 1}: ${page.name}`);
      setCurrentPageFromIndex(i);
      
      // Attendi che React aggiorni il DOM
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Salva i dati della pagina corrente
      const currentPageId = pagesRef.current[i]?.id;
      if (currentPageId) {
        const snapshot = snapshotCanvasByPageId(currentPageId);
        if (snapshot && snapshot.length > 32) {
          const updatedCanvasData = {
            ...pageCanvasDataRef.current,
            [currentPageId]: snapshot
          };
          pageCanvasDataRef.current = updatedCanvasData;
          
          // Flush immediato
          if (documentSaveTimeoutRef.current !== null) {
            window.clearTimeout(documentSaveTimeoutRef.current);
            documentSaveTimeoutRef.current = null;
          }
          
          const document = buildPersistedDocument(pagesRef.current, updatedCanvasData, journalEntriesRef.current);
          pendingDocumentSaveRef.current = document;
          flushDocumentSave();
          
          await waitForSaveComplete(50);
        }
      }
      
      // Ora genera il canvas per questa pagina
      const baseWidth = Math.max(1, Math.floor(containerRef.current?.clientWidth ?? 1200));
      const flattenedCanvas = await renderPageToFlattenedCanvas(
        page.id,
        baseWidth * PDF_EXPORT_MULTIPLIER,
        PAGE_HEIGHT * PDF_EXPORT_MULTIPLIER,
        PDF_EXPORT_MULTIPLIER
      );
      
      if (!flattenedCanvas) {
        console.log(`⚠️ Pagina ${page.name} - canvas non generato, salto`);
        continue;
      }

      const image = flattenedCanvas.toDataURL("image/jpeg", PDF_EXPORT_JPEG_QUALITY);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const ratio = Math.max(1, flattenedCanvas.width) / Math.max(1, flattenedCanvas.height);
      const drawWidth = pageWidth - 30;
      const drawHeight = drawWidth / ratio;
      const y = (pageHeight - drawHeight) / 2;

      if (i > 0) {
        doc.addPage();
      }
      doc.addImage(image, "JPEG", 15, y, drawWidth, drawHeight, undefined, "MEDIUM");
      hasAtLeastOnePage = true;
      
      console.log(`✅ Pagina ${page.name} aggiunta al PDF`);
    }

    // Ripristina la pagina originale
    console.log(`🔙 Ripristino pagina originale: ${originalPageIndex + 1}`);
    setCurrentPageFromIndex(originalPageIndex);

    if (!hasAtLeastOnePage) {
      return null;
    }
    
    console.log("🎉 PDF generato con successo!");
    return doc.output("blob");
  }, [buildPersistedDocument, flushDocumentSave, renderPageToFlattenedCanvas, setCurrentPageFromIndex, snapshotCanvasByPageId, waitForSaveComplete]);

  const exportPdf = useCallback(async () => {
    setIsPdfExporting(true);  // 🎯 Inizia loading
    try {
      const pdfBlob = await buildPdfBlob();
      if (!pdfBlob) {
        return;
      }

      const defaultName = buildDocumentBaseName(Date.now());
      const promptedName = window.prompt("Nome PDF", defaultName);
      const fileName = (promptedName ?? defaultName).trim() || defaultName;
      downloadBlob(pdfBlob, `${fileName}.pdf`);
    } finally {
      setIsPdfExporting(false);  // 🎯 Fine loading
    }
  }, [buildPdfBlob, downloadBlob]);

  const undo = useCallback(async () => {
    const pageId = getCurrentPageId();
    if (!pageId) {
      return;
    }
    const pageHistory = historyStacksRef.current[pageId];
    if (!pageHistory || pageHistory.undo.length <= 1) {
      return;
    }

    const currentState = pageHistory.undo.pop();
    if (!currentState) {
      return;
    }

    pageHistory.redo.push(currentState);
    const previousState = pageHistory.undo[pageHistory.undo.length - 1];
    if (!previousState) {
      return;
    }

    historyStacksRef.current[pageId] = pageHistory;
    await loadCanvasDataForPage(pageId, previousState);
    persistDocument(pagesRef.current, {
      ...pageCanvasDataRef.current,
      [pageId]: previousState
    });
  }, [getCurrentPageId, loadCanvasDataForPage, persistDocument]);

  const redo = useCallback(async () => {
    const pageId = getCurrentPageId();
    if (!pageId) {
      return;
    }
    const pageHistory = historyStacksRef.current[pageId];
    if (!pageHistory) {
      return;
    }

    const nextState = pageHistory.redo.pop();
    if (!nextState) {
      return;
    }

    pageHistory.undo.push(nextState);
    historyStacksRef.current[pageId] = pageHistory;
    await loadCanvasDataForPage(pageId, nextState);
    persistDocument(pagesRef.current, {
      ...pageCanvasDataRef.current,
      [pageId]: nextState
    });
  }, [getCurrentPageId, loadCanvasDataForPage, persistDocument]);

  const addJournalEntry = useCallback(() => {
    setJournalEntries((previous) => {
      if (previous.length >= MAX_JOURNAL_ENTRIES) {
        window.alert(`Hai raggiunto il limite massimo di ${MAX_JOURNAL_ENTRIES} righe compilabili.`);
        return previous;
      }
      
      const newEntry = createJournalEntry();
      
      // Copia data dalla riga precedente, o usa data di oggi per la prima riga
      if (previous.length === 0) {
        newEntry.date = new Date().toISOString().split('T')[0];
      } else {
        const lastEntry = previous[previous.length - 1];
        newEntry.date = lastEntry.date;
      }
      
      return [...previous, newEntry];
    });
  }, []);

  const clearJournalEntries = useCallback(() => {
    if (!window.confirm("Vuoi svuotare tutte le righe del Libro Giornale?")) {
      return;
    }
    setJournalEntries(createJournalEntries(MIN_VISIBLE_JOURNAL_ENTRIES));
  }, []);

  const removeJournalEntry = useCallback((entryId: string) => {
    setJournalEntries((previous) => {
      if (previous.length <= MIN_VISIBLE_JOURNAL_ENTRIES) {
        return previous;
      }
      const nextEntries = previous.filter((entry) => entry.id !== entryId);
      return nextEntries.length > 0
        ? nextEntries
        : createJournalEntries(MIN_VISIBLE_JOURNAL_ENTRIES);
    });
  }, []);

  const updateJournalEntry = useCallback((entryId: string, patch: Partial<JournalEntry>) => {
    setJournalEntries((previous) => {
      const updated = previous.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }
        return {
          ...entry,
          ...patch
        };
      });

      // Se la data è stata aggiornata O se è stata attivata la linea di chiusura O se è stato inserito importo, 
      // copia alla riga successiva se vuota
      if (patch.date || patch.closeLine || patch.debit || patch.credit) {
        const currentIndex = updated.findIndex(entry => entry.id === entryId);
        const nextIndex = currentIndex + 1;
        
        if (nextIndex < updated.length && !updated[nextIndex].date) {
          const currentEntry = updated[currentIndex];
          updated[nextIndex] = {
            ...updated[nextIndex],
            date: currentEntry.date
          };
        }
      }

      return updated;
    });
  }, []);

  const extractJournalData = useCallback(async () => {
    setIsJournalExtracting(true);
    try {
      const datePart = new Date().toISOString().slice(0, 10);
      const blob = await buildJournalWorkbookBlob(datePart);
      downloadBlob(blob, `giornale_data_${datePart}.xlsx`);
    } catch {
      window.alert(
        "Estrazione non riuscita. Verifica che API sia avviata e che il template sia configurato in JOURNAL_TEMPLATE_PATH."
      );
    } finally {
      setIsJournalExtracting(false);
    }
  }, [buildJournalWorkbookBlob, downloadBlob]);

  const shareBoardAndJournal = useCallback(async () => {
    setIsSharingFiles(true);
    setIsPdfExporting(true);  // Disabilita anche PDF export durante share
    try {
      const now = Date.now();
      const datePart = new Date(now).toISOString().slice(0, 10);
      const pdfBaseName = buildDocumentBaseName(now);
      
      // Genera PDF
      const pdfBlob = await buildPdfBlob();
      
      if (!pdfBlob) {
        window.alert("Condivisione non disponibile: impossibile generare il PDF.");
        return;
      }

      const pdfFile = new File([pdfBlob], `${pdfBaseName}.pdf`, { type: "application/pdf" });
      
      // 🚨 FIX TEMPORANEO: Salta XLSX se backend non disponibile
      let xlsxBlob: Blob | null = null;
      let xlsxFile: File | null = null;
      
      try {
        xlsxBlob = await buildJournalWorkbookBlob(datePart);
        xlsxFile = new File([xlsxBlob], `giornale_data_${datePart}.xlsx`, {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
      } catch (error) {
        console.warn("⚠️ Backend XLSX non disponibile, procedo solo con PDF:", error);
      }

      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      
      // Condividi solo PDF o entrambi i file
      const files = xlsxFile ? [pdfFile, xlsxFile] : [pdfFile];
      const canShareFiles =
        typeof nav.canShare === "function" ? nav.canShare({ files }) : true;

      if (typeof nav.share === "function" && canShareFiles) {
        try {
          await nav.share({
            title: "MYAccounting",
            text: xlsxFile ? "Lavagna PDF + giornale_data XLSX" : "Lavagna PDF",
            files
          });
          return; // Successo, esci dalla funzione
        } catch (shareError) {
          console.warn("⚠️ Web Share API fallita, procedo con download:", shareError);
          
          // Se è Permission denied, mostra messaggio specifico
          if (shareError instanceof Error && shareError.name === 'NotAllowedError') {
            window.alert("Permessi di condivisione negati. Scarico i file direttamente.");
          } else {
            window.alert("Condivisione nativa non disponibile. Scarico i file direttamente.");
          }
          
          // Procedi con download fallback
          downloadBlob(pdfBlob, pdfFile.name);
          if (xlsxFile && xlsxBlob) {
            downloadBlob(xlsxBlob, xlsxFile.name);
          }
          return;
        }
      }

      // Fallback download diretto
      downloadBlob(pdfBlob, pdfFile.name);
      if (xlsxFile && xlsxBlob) {
        downloadBlob(xlsxBlob, xlsxFile.name);
      }
      
      const message = xlsxFile 
        ? "Condivisione nativa non disponibile su questo dispositivo. Ho scaricato i due file separati."
        : "Condivisione nativa non disponibile su questo dispositivo. Ho scaricato il PDF.";
      window.alert(message);
    } catch (error) {
      console.error("❌ Errore condivisione:", error);
      window.alert("Condivisione non riuscita. Verifica API e riprova.");
    } finally {
      setIsSharingFiles(false);
      setIsPdfExporting(false);  // Riabilita PDF export
    }
  }, [buildJournalWorkbookBlob, buildPdfBlob, downloadBlob]);

  const handleJournalAmountClick = useCallback((amount: string) => {
    // Inserisci l'importo nella calcolatrice solo se non è già aperta
    if (!isCalculatorOpen) {
      setDisplay((previous) => {
        // Se c' già un'operazione, aggiungi l'importo
        if (previous && !previous.includes('=')) {
          return `${previous}+${amount}`;
        }
        return amount;
      });
      
      // Apri la calcolatrice
      setIsCalculatorOpen(true);
    }
  }, []);

  const appendDisplay = useCallback((value: string) => {
    setDisplay((previous) => `${previous}${value}`);
  }, []);

  const solveDisplayExpression = useCallback(
    async (rawInput: string, fromOcr = false): Promise<boolean> => {
      const leftSide = rawInput.includes("=") ? rawInput.split("=")[0] ?? "" : rawInput;
      const expression = normalizeExpression(leftSide);
      
      // Validazione migliorata
      const validation = validateExpression(expression);
      if (!validation.valid) {
        const errorMsg = validation.error || "Espressione non valida";
        if (fromOcr) {
          setOcrStatus(`OCR: ${errorMsg}`);
        } else {
          setOcrStatus(errorMsg);
          // Non mostrare alert per errori comuni
          if (!errorMsg.includes("vuota") && !errorMsg.includes("consecutivi")) {
            // Mostra tooltip solo per errori gravi
            console.log(`⚠️ ${errorMsg}`);
          }
        }
        return false;
      }

      let result: number;
      let usedNative = false;

      try {
        // Prova prima con mathjs
        const { evaluate } = await lazyImportMathJS();
        result = evaluate(expression);
      } catch (error) {
        // Fallback alla calcolatrice nativa
        console.log("🔄 MathJS fallito, uso calcolatrice nativa:", error);
        try {
          result = evaluateExpressionNative(expression);
          usedNative = true;
        } catch (nativeError) {
          const errorMsg = `Errore calcolo: ${nativeError instanceof Error ? nativeError.message : 'sconosciuto'}`;
          if (fromOcr) {
            setOcrStatus(`OCR: ${errorMsg}`);
          } else {
            setOcrStatus(errorMsg);
            console.log(`❌ ${errorMsg}`);
          }
          return false;
        }
      }

      const resolved = `${formatExpressionForDisplay(expression)}=${result}`;
      setDisplay(resolved);
      if (fromOcr) {
        setOcrStatus(`OCR ok: ${resolved}${usedNative ? ' (nativo)' : ''}`);
      } else {
        setOcrStatus(`✅ ${resolved}${usedNative ? ' (nativo)' : ''}`);
      }
      return true;
    },
    []
  );

  const calculate = useCallback(async () => {
    await solveDisplayExpression(display);
  }, [display, solveDisplayExpression]);

  const cloneCanvasObject = useCallback(async (source: unknown): Promise<unknown | null> => {
    if (!source || typeof source !== "object") {
      return null;
    }
    const cloneFn = (source as { clone?: () => Promise<unknown> }).clone;
    if (typeof cloneFn !== "function") {
      return null;
    }
    try {
      return await cloneFn.call(source);
    } catch {
      return null;
    }
  }, []);

  const copyCanvasSelection = useCallback(async () => {
    const canvas = getActiveCanvas();
    const pageId = getCurrentPageId();
    if (!canvas || !pageId) {
      return;
    }

    const canvasApi = canvas as unknown as {
      getActiveObject?: () => unknown;
    };
    const activeObject = canvasApi.getActiveObject?.() ?? null;
    if (!activeObject) {
      setOcrStatus("Seleziona un oggetto da copiare");
      return;
    }

    const clonedObject = await cloneCanvasObject(activeObject);
    if (!clonedObject) {
      return;
    }
    clipboardObjectRef.current = clonedObject;
    clipboardSourcePageIdRef.current = pageId;
    setOcrStatus("Oggetto copiato");
  }, [cloneCanvasObject, getActiveCanvas, getCurrentPageId]);

  const pasteCanvasSelection = useCallback(async () => {
    const source = clipboardObjectRef.current;
    if (!source) {
      return;
    }
    const pageId = getCurrentPageId();
    const canvas = getCanvasByPageId(pageId);
    if (!canvas || !pageId) {
      return;
    }

    const clonedObject = await cloneCanvasObject(source);
    if (!clonedObject) {
      return;
    }

    const canvasApi = canvas as unknown as {
      add?: (object: unknown) => void;
      setActiveObject?: (object: unknown) => void;
      discardActiveObject?: () => void;
    };

    const offsetObject = (object: unknown) => {
      const objApi = object as {
        left?: number;
        top?: number;
        set?: (props: Record<string, unknown>) => void;
        setCoords?: () => void;
      };
      objApi.set?.({
        left: (typeof objApi.left === "number" ? objApi.left : 0) + COPY_PASTE_OFFSET,
        top: (typeof objApi.top === "number" ? objApi.top : 0) + COPY_PASTE_OFFSET,
        evented: true,
        selectable: true
      });
      objApi.setCoords?.();
    };

    canvasApi.discardActiveObject?.();
    const clonedApi = clonedObject as {
      type?: string;
      canvas?: unknown;
      forEachObject?: (callback: (object: unknown) => void) => void;
    };

    if (clonedApi.type === "activeSelection" && typeof clonedApi.forEachObject === "function") {
      clonedApi.canvas = canvas;
      const pastedObjects: unknown[] = [];
      clonedApi.forEachObject((object) => {
        offsetObject(object);
        canvasApi.add?.(object);
        pastedObjects.push(object);
      });

      if (pastedObjects.length > 1) {
        const fabricModule = fabricModuleRef.current ?? (await lazyImportFabric());
        if (!fabricModuleRef.current) {
          fabricModuleRef.current = fabricModule;
        }
        const selection = new fabricModule.ActiveSelection(pastedObjects as never[], { canvas });
        canvasApi.setActiveObject?.(selection);
      } else if (pastedObjects.length === 1) {
        canvasApi.setActiveObject?.(pastedObjects[0]);
      }
    } else {
      offsetObject(clonedObject);
      canvasApi.add?.(clonedObject);
      canvasApi.setActiveObject?.(clonedObject);
    }

    clipboardObjectRef.current = clonedObject;
    clipboardSourcePageIdRef.current = pageId;
    canvas.requestRenderAll();
    pushHistoryState(pageId);
    setOcrStatus("Oggetto incollato");
  }, [cloneCanvasObject, getCanvasByPageId, getCurrentPageId, pushHistoryState]);

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
    const pendingRect = autoOcrRectRef.current;
    if (!pendingRect || !isOcrEnabledRef.current || isSelectionMode || isAutoOcrBusyRef.current) {
      return;
    }
    if (pendingRect.rect.width < 8 || pendingRect.rect.height < 8) {
      autoOcrRectRef.current = null;
      return;
    }

    const canvas = getCanvasByPageId(pendingRect.pageId);
    if (!canvas) {
      return;
    }
    autoOcrRectRef.current = null;
    isAutoOcrBusyRef.current = true;
    setIsOcrRunning(true);
    setOcrStatus("OCR automatico...");

    try {
      const rect = pendingRect.rect;
      const imageData = canvas.toDataURL({
        format: "png",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        multiplier: 2
      });

      // NEW: Try Math Recognition first (DISABLED)
      // if (useMathRec && mathRec.isReady) {
      //   try {
      //     console.log('🧠 Using Math Recognition...');
      //     const tempCanvas = document.createElement('canvas');
      //     tempCanvas.width = rect.width;
      //     tempCanvas.height = rect.height;
      //     const tempCtx = tempCanvas.getContext('2d')!;
      //     const img = new Image();
      //     img.onload = async () => {
      //       tempCtx.drawImage(img, 0, 0);
      //       const result = await mathRec.recognize(tempCanvas);
      //       
      //       // Handle delete gesture
      //       if (result.expression === 'DELETE') {
      //         console.log('🗑️ Delete gesture detected');
      //         const activeObject = canvas.getActiveObject();
      //         if (activeObject) {
      //           canvas.remove(activeObject);
      //           canvas.requestRenderAll();
      //         }
      //         setIsOcrRunning(false);
      //         setOcrStatus("Cancellato");
      //         isAutoOcrBusyRef.current = false;
      //         return;
      //       }
      //       
      //       if (result.expression) {
      //         setDisplay(result.expression);
      //         setOcrStatus(`Math: ${(result.confidence * 100).toFixed(0)}%`);
      //         console.log(`✅ Math recognized: "${result.expression}" (${(result.confidence * 100).toFixed(0)}% confidence)`);
      //         setIsOcrRunning(false);
      //         isAutoOcrBusyRef.current = false;
      //         return;
      //       }
      //     };
      //     img.src = imageData;
      //     return;
      //   } catch (error) {
      //     console.error('❌ Math recognition failed, fallback to Tesseract:', error);
      //     // Continue to Tesseract below
      //   }
      // }

      // EXISTING: Tesseract logic (unchanged)
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
  }, [getCanvasByPageId, getWorker, isSelectionMode, solveDisplayExpression]);

  const scheduleAutoOcrForRect = useCallback(
    (pageId: string, rect: SelectionRect) => {
      const canvas = getCanvasByPageId(pageId);
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
      autoOcrRectRef.current = previousRect && previousRect.pageId === pageId
        ? {
            pageId,
            rect: {
              left: Math.min(previousRect.rect.left, normalizedRect.left),
              top: Math.min(previousRect.rect.top, normalizedRect.top),
              width:
                Math.max(previousRect.rect.left + previousRect.rect.width, normalizedRect.left + normalizedRect.width) -
                Math.min(previousRect.rect.left, normalizedRect.left),
              height:
                Math.max(previousRect.rect.top + previousRect.rect.height, normalizedRect.top + normalizedRect.height) -
                Math.min(previousRect.rect.top, normalizedRect.top)
            }
          }
        : { pageId, rect: normalizedRect };

      clearAutoOcrSchedule();
      autoOcrTimeoutRef.current = window.setTimeout(() => {
        autoOcrTimeoutRef.current = null;
        void runAutoOcrFromPendingRect();
      }, AUTO_OCR_DEBOUNCE_MS);
    },
    [clearAutoOcrSchedule, getCanvasByPageId, runAutoOcrFromPendingRect]
  );
  scheduleAutoOcrForRectRef.current = scheduleAutoOcrForRect;

  const runOcrForRect = useCallback(
    async (pageId: string, rect: SelectionRect) => {
      const canvas = getCanvasByPageId(pageId);
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
        clearSelectionOverlay(pageId);
        selectionDragRef.current.active = false;
        selectionDragRef.current.pageId = null;
        setIsSelectionMode(false);
        setIsOcrRunning(false);
      }
    },
    [clearSelectionOverlay, getCanvasByPageId, getWorker, solveDisplayExpression]
  );

  // Funzioni per la selezione multipla di oggetti
  const getObjectsInRect = useCallback((pageId: string, rect: SelectionRect): FabricObject[] => {
    const canvas = getCanvasByPageId(pageId);
    if (!canvas) return [];

    const objects = canvas.getObjects();
    const objectsInRect: FabricObject[] = [];

    for (const obj of objects) {
      const bounds = obj.getBoundingRect();
      if (
        bounds.left < rect.left + rect.width &&
        bounds.left + bounds.width > rect.left &&
        bounds.top < rect.top + rect.height &&
        bounds.top + bounds.height > rect.top
      ) {
        objectsInRect.push(obj);
      }
    }

    return objectsInRect;
  }, [getCanvasByPageId]);

  const selectObjectsInRect = useCallback((pageId: string, rect: SelectionRect) => {
    const canvas = getCanvasByPageId(pageId);
    if (!canvas) return;

    const objectsInRect = getObjectsInRect(pageId, rect);
    
    // Pulisci selezione precedente
    selectedObjectsRef.current.clear();
    canvas.discardActiveObject();

    if (objectsInRect.length > 0) {
      // Crea un gruppo di selezione
      const fabricModule = fabricModuleRef.current;
      if (fabricModule) {
        const selection = new fabricModule.ActiveSelection(objectsInRect, {
          canvas: canvas
        });
        canvas.setActiveObject(selection);
        
        // Salva i riferimenti agli oggetti selezionati (usiamo un hash univoco)
        objectsInRect.forEach(obj => {
          const objHash = `${obj.left}_${obj.top}_${obj.width}_${obj.height}`;
          selectedObjectsRef.current.add(objHash);
        });
      }
    }

    canvas.renderAll();
  }, [getCanvasByPageId, getObjectsInRect]);

  const drawMultiSelectionRect = useCallback((pageId: string) => {
    const selectionCanvas = getSelectionCanvasByPageId(pageId);
    if (!selectionCanvas || !multiSelectionRef.current.active) return;

    const context = selectionCanvas.getContext("2d");
    if (!context) return;

    const { startPoint, currentPoint } = multiSelectionRef.current;
    if (!startPoint || !currentPoint) return;

    const left = Math.min(startPoint.x, currentPoint.x);
    const top = Math.min(startPoint.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - startPoint.x);
    const height = Math.abs(currentPoint.y - startPoint.y);

    clearSelectionOverlay(pageId);
    context.setLineDash([6, 5]);
    context.lineWidth = 2;
    context.strokeStyle = "#2563eb"; // Blu per selezione multipla
    context.fillStyle = "rgba(37, 99, 235, 0.1)"; // Fill trasparente
    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);
  }, [getSelectionCanvasByPageId, clearSelectionOverlay]);

  const handleSelectionPointerDown = useCallback(
    (pageId: string, event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isSelectionMode || isOcrRunning) {
        return;
      }

      const canvas = getCanvasByPageId(pageId);
      if (!canvas) return;

      // Controlla se si clicca su un oggetto esistente
      const target = canvas.findTarget(event.nativeEvent);
      
      if (target) {
        // Click su un oggetto: selezione singola
        canvas.setActiveObject(target);
        canvas.renderAll();
        
        // Resetta la selezione multipla
        multiSelectionRef.current = {
          active: false,
          startPoint: null,
          currentPoint: null,
          pageId: null
        };
      } else {
        // Click sul vuoto: inizia selezione area
        multiSelectionRef.current = {
          active: true,
          startPoint: { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY },
          currentPoint: { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY },
          pageId
        };
        
        // Disattiva la selezione corrente
        canvas.discardActiveObject();
        canvas.renderAll();
      }

      // Mantiene la compatibilità con OCR se abilitato
      if (isOcrEnabledRef.current) {
        selectionDragRef.current = {
          active: true,
          startX: event.nativeEvent.offsetX,
          startY: event.nativeEvent.offsetY,
          pageId
        };
        clearSelectionOverlay(pageId);
      }
    },
    [clearSelectionOverlay, getCanvasByPageId, isOcrRunning, isSelectionMode]
  );

  const handleSelectionPointerMove = useCallback(
    (pageId: string, event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isSelectionMode) {
        return;
      }

      // Gestione selezione multipla per area
      if (multiSelectionRef.current.active && multiSelectionRef.current.pageId === pageId) {
        multiSelectionRef.current.currentPoint = {
          x: event.nativeEvent.offsetX,
          y: event.nativeEvent.offsetY
        };
        drawMultiSelectionRect(pageId);
        return;
      }

      // Gestione OCR (se abilitato)
      if (!selectionDragRef.current.active || selectionDragRef.current.pageId !== pageId) {
        return;
      }
      
      const selectionCanvas = getSelectionCanvasByPageId(pageId);
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

      clearSelectionOverlay(pageId);
      context.setLineDash([6, 5]);
      context.lineWidth = 2;
      context.strokeStyle = "#d92d20";
      context.strokeRect(left, top, width, height);
    },
    [clearSelectionOverlay, getSelectionCanvasByPageId, isSelectionMode, drawMultiSelectionRect]
  );

  const handleSelectionPointerUp = useCallback(
    async (pageId: string, event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isSelectionMode) {
        return;
      }

      // Gestione selezione multipla per area
      if (multiSelectionRef.current.active && multiSelectionRef.current.pageId === pageId) {
        const { startPoint, currentPoint } = multiSelectionRef.current;
        if (!startPoint || !currentPoint) {
          // Resetta lo stato
          multiSelectionRef.current = {
            active: false,
            startPoint: null,
            currentPoint: null,
            pageId: null
          };
          return;
        }

        const left = Math.min(startPoint.x, currentPoint.x);
        const top = Math.min(startPoint.y, currentPoint.y);
        const width = Math.abs(currentPoint.x - startPoint.x);
        const height = Math.abs(currentPoint.y - startPoint.y);

        // Se l'area è sufficientemente grande, seleziona gli oggetti
        if (width > 5 && height > 5) {
          selectObjectsInRect(pageId, { left, top, width, height });
          
          // Disattiva la modalità selezione e attiva la modalità mano per spostare
          setIsSelectionMode(false);
          setTool("pan");
        }

        // Pulisci e resetta
        clearSelectionOverlay(pageId);
        multiSelectionRef.current = {
          active: false,
          startPoint: null,
          currentPoint: null,
          pageId: null
        };
        return;
      }

      // Gestione OCR (se abilitato)
      if (!selectionDragRef.current.active || selectionDragRef.current.pageId !== pageId) {
        return;
      }

      const endX = event.nativeEvent.offsetX;
      const endY = event.nativeEvent.offsetY;
      const left = Math.min(selectionDragRef.current.startX, endX);
      const top = Math.min(selectionDragRef.current.startY, endY);
      const width = Math.abs(endX - selectionDragRef.current.startX);
      const height = Math.abs(endY - selectionDragRef.current.startY);

      await runOcrForRect(pageId, { left, top, width, height });
    },
    [isSelectionMode, runOcrForRect, selectObjectsInRect, clearSelectionOverlay]
  );

  const initializeFabricCanvasForSlot = useCallback(
    (slotId: number, drawingCanvas: HTMLCanvasElement) => {
      const fabricModule = fabricModuleRef.current;
      if (!fabricModule || fabricCanvasMapRef.current.has(slotId)) {
        return;
      }

      const canvas = new fabricModule.Canvas(drawingCanvas, {
        isDrawingMode: false,
        selection: false,
        enableRetinaScaling: false
      });
      fabricCanvasMapRef.current.set(slotId, canvas);

      const onPathCreated = (event: unknown) => {
        const pageId = slotPageMapRef.current.get(slotId);
        if (!pageId) {
          return;
        }
        handlePathCreated(pageId, event);
      };
      const onObjectModified = () => {
        const pageId = slotPageMapRef.current.get(slotId);
        if (!pageId) {
          return;
        }
        pushHistoryState(pageId);
      };
      const onObjectRemoved = () => {
        const pageId = slotPageMapRef.current.get(slotId);
        if (!pageId) {
          return;
        }
        pushHistoryState(pageId);
      };

      canvas.on("path:created", onPathCreated);
      canvas.on("object:modified", onObjectModified);
      canvas.on("object:removed", onObjectRemoved);

      const canvasWithCleanup = canvas as unknown as { __cleanup?: () => void };
      canvasWithCleanup.__cleanup = () => {
        canvas.off("path:created", onPathCreated);
        canvas.off("object:modified", onObjectModified);
        canvas.off("object:removed", onObjectRemoved);
      };
      const assignedPageId = slotPageMapRef.current.get(slotId);
      if (assignedPageId) {
        const loadToken = (slotLoadTokenRef.current[slotId] ?? 0) + 1;
        slotLoadTokenRef.current[slotId] = loadToken;
        void loadCanvasDataIntoCanvas(canvas, pageCanvasDataRef.current[assignedPageId] ?? null, assignedPageId).then(
          () => {
            if (slotLoadTokenRef.current[slotId] !== loadToken) {
              return;
            }
            if (!historyStacksRef.current[assignedPageId]) {
              resetHistoryForPage(assignedPageId);
            }
            if (getCurrentPageId() === assignedPageId) {
              configureActiveTool();
            } else {
              canvas.isDrawingMode = false;
              canvas.selection = false;
            }
          }
        );
      }
      resizeCanvases();
      setIsCanvasReady(true);
    },
    [configureActiveTool, getCurrentPageId, handlePathCreated, loadCanvasDataIntoCanvas, pushHistoryState, resetHistoryForPage, resizeCanvases]
  );

  const disposeFabricCanvasForSlot = useCallback((slotId: number) => {
    const canvas = fabricCanvasMapRef.current.get(slotId);
    if (!canvas) {
      return;
    }
    const pageId = slotPageMapRef.current.get(slotId) ?? null;
    if (pageId && activeCanvasPageIdRef.current === pageId) {
      detachToolHandlers(pageId);
      activeCanvasPageIdRef.current = null;
    }
    if (pageId) {
      if (pageSlotMapRef.current.get(pageId) === slotId) {
        pageSlotMapRef.current.delete(pageId);
      }
      if (slotPageMapRef.current.get(slotId) === pageId) {
        slotPageMapRef.current.delete(slotId);
      }
    }
    const canvasWithCleanup = canvas as unknown as { __cleanup?: () => void };
    canvasWithCleanup.__cleanup?.();
    canvas.dispose();
    fabricCanvasMapRef.current.delete(slotId);
  }, [detachToolHandlers]);

  const bindDrawingCanvasRef = useCallback(
    (slotId: number, node: HTMLCanvasElement | null) => {
      if (node) {
        drawingCanvasElementsRef.current.set(slotId, node);
        initializeFabricCanvasForSlot(slotId, node);
        return;
      }
      drawingCanvasElementsRef.current.delete(slotId);
      disposeFabricCanvasForSlot(slotId);
    },
    [disposeFabricCanvasForSlot, initializeFabricCanvasForSlot]
  );

  const bindSelectionCanvasRef = useCallback((slotId: number, node: HTMLCanvasElement | null) => {
    if (node) {
      selectionCanvasElementsRef.current.set(slotId, node);
      return;
    }
    selectionCanvasElementsRef.current.delete(slotId);
  }, []);

  const bindPageSentinelRef = useCallback((pageId: string, node: HTMLDivElement | null) => {
    if (node) {
      pageSentinelElementsRef.current.set(pageId, node);
      return;
    }
    pageSentinelElementsRef.current.delete(pageId);
  }, []);

  const getDrawingCanvasRef = useCallback(
    (slotId: number) => {
      const existing = drawingCanvasRefCallbacksRef.current.get(slotId);
      if (existing) {
        return existing;
      }
      const callback = (node: HTMLCanvasElement | null) => {
        bindDrawingCanvasRef(slotId, node);
      };
      drawingCanvasRefCallbacksRef.current.set(slotId, callback);
      return callback;
    },
    [bindDrawingCanvasRef]
  );

  const getSelectionCanvasRef = useCallback(
    (slotId: number) => {
      const existing = selectionCanvasRefCallbacksRef.current.get(slotId);
      if (existing) {
        return existing;
      }
      const callback = (node: HTMLCanvasElement | null) => {
        bindSelectionCanvasRef(slotId, node);
      };
      selectionCanvasRefCallbacksRef.current.set(slotId, callback);
      return callback;
    },
    [bindSelectionCanvasRef]
  );

  const getPageSentinelRef = useCallback(
    (pageId: string) => {
      const existing = pageSentinelRefCallbacksRef.current.get(pageId);
      if (existing) {
        return existing;
      }
      const callback = (node: HTMLDivElement | null) => {
        bindPageSentinelRef(pageId, node);
      };
      pageSentinelRefCallbacksRef.current.set(pageId, callback);
      return callback;
    },
    [bindPageSentinelRef]
  );

  const assignPageToSlot = useCallback(
    async (slotId: number, nextPageId: string | null) => {
      const currentPageId = slotPageMapRef.current.get(slotId) ?? null;
      const canvas = fabricCanvasMapRef.current.get(slotId) ?? null;

      if (currentPageId === nextPageId) {
        return;
      }

      if (canvas && currentPageId) {
        const previousSnapshot = snapshotCanvasByPageId(currentPageId);
        if (previousSnapshot !== null) {
          pageCanvasDataRef.current = {
            ...pageCanvasDataRef.current,
            [currentPageId]: previousSnapshot
          };
        }
      }

      if (currentPageId) {
        if (pageSlotMapRef.current.get(currentPageId) === slotId) {
          pageSlotMapRef.current.delete(currentPageId);
        }
        if (slotPageMapRef.current.get(slotId) === currentPageId) {
          slotPageMapRef.current.delete(slotId);
        }
      }

      if (!nextPageId) {
        if (canvas) {
          await loadCanvasDataIntoCanvas(canvas, null, currentPageId ?? undefined);
          canvas.isDrawingMode = false;
          canvas.selection = false;
        }
        return;
      }

      const existingSlotForNextPage = pageSlotMapRef.current.get(nextPageId);
      if (existingSlotForNextPage !== undefined && existingSlotForNextPage !== slotId) {
        if (slotPageMapRef.current.get(existingSlotForNextPage) === nextPageId) {
          slotPageMapRef.current.delete(existingSlotForNextPage);
        }
      }
      pageSlotMapRef.current.set(nextPageId, slotId);
      slotPageMapRef.current.set(slotId, nextPageId);

      if (!canvas) {
        return;
      }

      const loadToken = (slotLoadTokenRef.current[slotId] ?? 0) + 1;
      slotLoadTokenRef.current[slotId] = loadToken;
      const pageData = pageCanvasDataRef.current[nextPageId] ?? null;
      await loadCanvasDataIntoCanvas(canvas, pageData, nextPageId);
      if (slotLoadTokenRef.current[slotId] !== loadToken) {
        return;
      }

      if (!historyStacksRef.current[nextPageId]) {
        resetHistoryForPage(nextPageId);
      }
      if (getCurrentPageId() === nextPageId) {
        configureActiveTool();
      } else {
        canvas.isDrawingMode = false;
        canvas.selection = false;
      }
    },
    [configureActiveTool, getCurrentPageId, loadCanvasDataIntoCanvas, resetHistoryForPage, snapshotCanvasByPageId]
  );

  useEffect(() => {
    setSlotAssignments((previous) => {
      const nextAssignments = Array.from({ length: CANVAS_POOL_SIZE }, () => null as string | null);
      const remaining = new Set(renderPageIds);

      for (let slotId = 0; slotId < previous.length; slotId += 1) {
        const pageId = previous[slotId];
        if (pageId && remaining.has(pageId)) {
          nextAssignments[slotId] = pageId;
          remaining.delete(pageId);
        }
      }

      for (let slotId = 0; slotId < nextAssignments.length; slotId += 1) {
        if (nextAssignments[slotId]) {
          continue;
        }
        const iterator = remaining.values().next();
        if (iterator.done) {
          break;
        }
        nextAssignments[slotId] = iterator.value;
        remaining.delete(iterator.value);
      }

      const unchanged =
        previous.length === nextAssignments.length &&
        previous.every((pageId, index) => pageId === nextAssignments[index]);
      return unchanged ? previous : nextAssignments;
    });
  }, [renderPageIds]);

  useEffect(() => {
    for (let slotId = 0; slotId < CANVAS_POOL_SIZE; slotId += 1) {
      void assignPageToSlot(slotId, slotAssignments[slotId] ?? null);
    }
  }, [assignPageToSlot, slotAssignments]);

  useEffect(() => {
    let unmounted = false;
    let onResize: (() => void) | null = null;

    void lazyImportFabric().then((fabricModule) => {
      if (unmounted) {
        return;
      }
      fabricModuleRef.current = fabricModule;
      onResize = () => {
        resizeCanvases();
        syncCanvasOffset();
      };
      window.addEventListener("resize", onResize);

      for (let slotId = 0; slotId < CANVAS_POOL_SIZE; slotId += 1) {
        const node = drawingCanvasElementsRef.current.get(slotId);
        if (node) {
          initializeFabricCanvasForSlot(slotId, node);
        }
      }
      resizeCanvases();
      setIsCanvasReady(fabricCanvasMapRef.current.size > 0);
    });

    return () => {
      unmounted = true;
      if (onResize) {
        window.removeEventListener("resize", onResize);
      }
      detachToolHandlers();
      for (const slotId of Array.from(fabricCanvasMapRef.current.keys())) {
        disposeFabricCanvasForSlot(slotId);
      }
      pageSlotMapRef.current.clear();
      slotPageMapRef.current.clear();
      fabricModuleRef.current = null;
      setIsCanvasReady(false);
    };
  }, [detachToolHandlers, disposeFabricCanvasForSlot, initializeFabricCanvasForSlot, resizeCanvases, syncCanvasOffset]);

  useEffect(() => {
    if (hasHydratedFromIndexedDbRef.current) {
      return;
    }
    hasHydratedFromIndexedDbRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const [indexedDocument, appSettings] = await Promise.all([
          loadLastBoardDocument(),
          loadAppSettings()
        ]);
        if (cancelled) {
          return;
        }
        if (appSettings) {
          if (appSettings.backgroundMode) {
            setBackgroundMode(appSettings.backgroundMode);
          }
          if (appSettings.activeArchiveDocumentId !== undefined) {
            activeArchiveDocumentIdRef.current = appSettings.activeArchiveDocumentId;
          }
        }
        setIsOcrEnabled(false);
        if (indexedDocument) {
          await applyPersistedDocument(indexedDocument);
          return;
        }
        void saveLastBoardDocument(initialDocumentRef.current).catch(() => undefined);
      } catch {
        void saveLastBoardDocument(initialDocumentRef.current).catch(() => undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyPersistedDocument]);

  useEffect(() => {
    const handleAppExit = () => {
      saveAndArchiveOnExit();
    };

    window.addEventListener("pagehide", handleAppExit);
    window.addEventListener("beforeunload", handleAppExit);
    return () => {
      window.removeEventListener("pagehide", handleAppExit);
      window.removeEventListener("beforeunload", handleAppExit);
    };
  }, [saveAndArchiveOnExit]);

  useEffect(() => {
    if (!isArchiveOpen) {
      return;
    }
    setArchiveMessage("");
    void loadArchiveEntries();
  }, [isArchiveOpen, loadArchiveEntries]);

  useEffect(() => {
    if (!isCanvasReady) {
      return;
    }
    configureActiveTool();
  }, [configureActiveTool, currentPageIndex, isCanvasReady]);

  useEffect(() => {
    if (!isCanvasReady || tool !== "pen") {
      return;
    }
    const canvas = getActiveCanvas();
    if (!canvas) {
      return;
    }
    syncCanvasOffset();
    canvas.isDrawingMode = true;
    canvas.selection = false;
    applyBrushSettings(canvas);
  }, [applyBrushSettings, getActiveCanvas, isCanvasReady, penSizeLevel, color, syncCanvasOffset, tool]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        void copyCanvasSelection();
        return;
      }
      if (key === "v") {
        event.preventDefault();
        void pasteCanvasSelection();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [copyCanvasSelection, pasteCanvasSelection]);

  useEffect(() => {
    if (!isCanvasReady) {
      return;
    }
    resizeCanvases();
  }, [isCanvasReady, pages.length, resizeCanvases]);

  useEffect(() => {
    if (!isSelectionMode) {
      clearSelectionOverlay();
      selectionDragRef.current.active = false;
      selectionDragRef.current.pageId = null;
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

      setCurrentPageFromIndex(index);
      setVirtualWindowRange(
        computeVirtualWindowRange(
          container.scrollTop,
          container.clientHeight,
          pagesRef.current.length,
          VIRTUALIZATION_BUFFER_PAGES
        )
      );

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
  }, [addPage, isCanvasReady, isOcrRunning, isSelectionMode, setCurrentPageFromIndex, syncCanvasOffset]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    setVirtualWindowRange(
      computeVirtualWindowRange(
        container.scrollTop,
        container.clientHeight,
        pages.length,
        VIRTUALIZATION_BUFFER_PAGES
      )
    );
  }, [pages.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let hasObserver = true;
    const visibleIds = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const pageId = target.dataset.pageId;
          if (!pageId) {
            continue;
          }
          if (entry.isIntersecting) {
            visibleIds.add(pageId);
          } else {
            visibleIds.delete(pageId);
          }
        }
        if (!hasObserver) {
          return;
        }
        setIntersectingPageIds((previous) => {
          const next = Array.from(visibleIds);
          if (previous.length === next.length && previous.every((id) => visibleIds.has(id))) {
            return previous;
          }
          return next;
        });
      },
      {
        root: container,
        rootMargin: `${PAGE_HEIGHT}px 0px ${PAGE_HEIGHT}px 0px`,
        threshold: 0.01
      }
    );

    for (const [pageId, node] of pageSentinelElementsRef.current.entries()) {
      node.dataset.pageId = pageId;
      observer.observe(node);
    }

    return () => {
      hasObserver = false;
      observer.disconnect();
    };
  }, [pages]);

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

      const canvas = getActiveCanvas();
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

      const canvas = getActiveCanvas();
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
  }, [getActiveCanvas, isCanvasReady]);

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
    journalEntriesRef.current = journalEntries;
    const snapshot = buildCurrentDocumentSnapshot();
    scheduleDocumentSave({
      ...snapshot,
      journalEntries
    });
  }, [buildCurrentDocumentSnapshot, journalEntries, scheduleDocumentSave]);

  useEffect(() => {
    void saveAppSettings({
      backgroundMode
    }).catch(() => undefined);
  }, [backgroundMode]);

  useEffect(() => {
    isOcrEnabledRef.current = isOcrEnabled;
    if (!isOcrEnabled) {
      // Non disattivare più la modalità selezione quando l'OCR viene disabilitato
      // setIsSelectionMode(false);
      clearAutoOcrSchedule();
      autoOcrRectRef.current = null;
      isAutoOcrBusyRef.current = false;
      setIsOcrRunning(false);
      setOcrStatus("OCR spento");
      return;
    }
    setOcrStatus("OCR attivo");
  }, [clearAutoOcrSchedule, isOcrEnabled]);


  const penSizePopoverStyle = getSizePopoverStyle(penToolRef.current);
  const eraserSizePopoverStyle = getSizePopoverStyle(eraserToolRef.current);
  const documentHeight = pages.length * PAGE_HEIGHT + Math.max(0, pages.length - 1) * PAGE_SEPARATOR_HEIGHT;
  const slotRenderItems = slotAssignments
    .map((pageId, slotId) => {
      if (!pageId) {
        return null;
      }
      const pageIndex = pageIndexById.get(pageId);
      if (pageIndex === undefined) {
        return null;
      }
      return {
        slotId,
        pageId,
        pageIndex
      };
    })
    .filter((item): item is { slotId: number; pageId: string; pageIndex: number } => item !== null);

  return (
    <main className="whiteboard-app">
      <div
        className={tool === "pan" ? "board-scroll-area pan-mode" : "board-scroll-area"}
        ref={containerRef}
        onPointerMove={handleBoardPointerMove}
        onPointerLeave={hideEraserPreview}
      >
        <div className="board-pages board-pages-virtual" ref={boardPagesRef} style={{ height: `${documentHeight}px` }}>
          {pages.map((page, index) => (
            <div
              className="board-page-sentinel"
              key={`${page.id}-sentinel`}
              ref={getPageSentinelRef(page.id)}
              style={{
                top: `${getPageTop(index)}px`,
                height: `${PAGE_HEIGHT}px`
              }}
            />
          ))}
          {pages.slice(0, -1).map((page, index) => (
            <div
              className="page-separator"
              key={`${page.id}-separator`}
              style={{ top: `${getPageTop(index) + PAGE_HEIGHT}px` }}
            />
          ))}
          {slotRenderItems.map(({ slotId, pageId, pageIndex }) => (
            <div
              className={pageIndex === currentPageIndex ? "board-page board-page-slot is-active" : "board-page board-page-slot"}
              key={`slot-${slotId}`}
              style={{ top: `${getPageTop(pageIndex)}px`, position: 'absolute', left: '0', right: '0' }}
              onPointerDown={() => {
                setCurrentPageFromIndex(pageIndex);
              }}
            >
              <div
                className={backgroundMode === "grid" ? "canvas-wrapper grid-background" : "canvas-wrapper"}
                style={{ height: `${PAGE_HEIGHT}px` }}
              >
                <canvas
                  ref={getDrawingCanvasRef(slotId)}
                />
                <canvas
                  className={`selection-canvas ${isSelectionMode && pageIndex === currentPageIndex ? "enabled" : ""}`}
                  ref={getSelectionCanvasRef(slotId)}
                  style={{ display: isSelectionMode && pageIndex === currentPageIndex ? "block" : "none" }}
                  onPointerDown={(event) => {
                    handleSelectionPointerDown(pageId, event);
                  }}
                  onPointerMove={(event) => {
                    handleSelectionPointerMove(pageId, event);
                  }}
                  onPointerUp={(event) => {
                    void handleSelectionPointerUp(pageId, event);
                  }}
                  onPointerLeave={() => {
                    if (selectionDragRef.current.active && selectionDragRef.current.pageId === pageId) {
                      selectionDragRef.current.active = false;
                      selectionDragRef.current.pageId = null;
                      clearSelectionOverlay(pageId);
                    }
                  }}
                />
              </div>
            </div>
          ))}
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
        <button
          className={`icon-button ${isSelectionMode ? "active" : ""}`}
          onClick={() => {
            const newSelectionMode = !isSelectionMode;
            setIsSelectionMode(newSelectionMode);
            if (newSelectionMode) {
              setTool("pan");
            }
          }}
          title="Selezione multipla"
          aria-label="Selezione multipla"
          type="button"
          disabled={isOcrRunning}
        >
          <i className="fa-solid fa-arrow-pointer" />
          <span className="sr-only">Selezione multipla</span>
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
        <button
          className="icon-button"
          title="Copia oggetto"
          aria-label="Copia oggetto"
          type="button"
          onClick={() => void copyCanvasSelection()}
        >
          <i className="fa-solid fa-copy" />
          <span className="sr-only">Copia oggetto</span>
        </button>
        <button
          className="icon-button"
          title="Incolla immagine da clipboard"
          aria-label="Incolla immagine da clipboard"
          type="button"
          onClick={() => void pasteCanvasSelection()}
        >
          <i className="fa-solid fa-paste" />
          <span className="sr-only">Incolla immagine da clipboard</span>
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
          title="Prima Nota"
          aria-label="Prima Nota"
          type="button"
          onClick={() => setIsJournalOpen((value) => !value)}
        >
          <i className="fa-solid fa-book-open" />
          <span>Prima Nota</span>
        </button>
        <button
          className={isArchiveOpen ? "icon-button active" : "icon-button"}
          title="Archivio"
          aria-label="Archivio"
          type="button"
          onClick={() => setIsArchiveOpen((value) => !value)}
        >
          <i className="fa-solid fa-box-archive" />
          <span className="sr-only">Archivio</span>
        </button>
        <button
          className="icon-button"
          title="Nuovo documento"
          aria-label="Nuovo documento"
          type="button"
          onClick={() => void createNewDocument()}
        >
          <i className="fa-solid fa-file" />
          <span className="sr-only">Nuovo documento</span>
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
        <label htmlFor="pageSelect"></label>
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

        <span className="toolbar-status">
        | di {pages.length} | {ocrStatus}
        </span>

        {/* Pulsanti principali - sempre visibili */}
        <button
          className="icon-button"
          title="Salva PDF"
          aria-label="Salva PDF"
          type="button"
          onClick={() => void exportPdf()}
          disabled={isPdfExporting}
        >
          <i className={`fa-solid ${isPdfExporting ? 'fa-spinner fa-spin' : 'fa-file-pdf'}`} />
          <span className="sr-only">Salva PDF</span>
        </button>
        <button
          className="icon-button"
          title="Condividi PDF + XLSX"
          aria-label="Condividi PDF + XLSX"
          type="button"
          onClick={() => void shareBoardAndJournal()}
          disabled={isSharingFiles || isJournalExtracting || isPdfExporting}
        >
          <i className={`fa-solid ${isSharingFiles ? 'fa-spinner fa-spin' : 'fa-share-nodes'}`} />
          <span className="sr-only">Condividi PDF + XLSX</span>
        </button>
        <button
          className="icon-button"
          title="Cancella oggetti selezionati"
          aria-label="Cancella oggetti selezionati"
          type="button"
          onClick={() => void deleteSelectedObjects()}
        >
          <i className="fa-solid fa-trash" />
          <span className="sr-only">Cancella oggetti selezionati</span>
        </button>

        {/* Menu Mobile Button */}
        <button
          className="mobile-menu-toggle"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Menu"
          type="button"
        >
          <i className="fa-solid fa-bars" />
        </button>

        {/* Mobile Menu Content - solo pulsanti secondari */}
        <div className={`mobile-menu ${isMobileMenuOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
          <div className="mobile-menu-row">
            <button
              className="icon-button"
              title="Copia oggetto"
              aria-label="Copia oggetto"
              type="button"
              onClick={() => {
                void copyCanvasSelection();
                setIsMobileMenuOpen(false);
              }}
            >
              <i className="fa-solid fa-copy" />
              <span className="sr-only">Copia oggetto</span>
            </button>
            <button
              className="icon-button"
              title="Incolla immagine da clipboard"
              aria-label="Incolla immagine da clipboard"
              type="button"
              onClick={() => {
                void pasteCanvasSelection();
                setIsMobileMenuOpen(false);
              }}
            >
              <i className="fa-solid fa-paste" />
              <span className="sr-only">Incolla immagine da clipboard</span>
            </button>
          </div>
        </div>
        {/* Math Recognition button - DISABLED */}
        {/* <button
          className={`icon-button ${useMathRec ? 'active' : ''}`}
          onClick={() => setUseMathRec(!useMathRec)}
          title={useMathRec ? 'Math Recognition ON' : 'Math Recognition OFF'}
          aria-label={useMathRec ? 'Disattiva riconoscimento matematico' : 'Attiva riconoscimento matematico'}
          type="button"
          disabled={mathRec.isProcessing}
        >
          <i className={`fa-solid ${useMathRec ? 'fa-calculator' : 'fa-font'}`} />
          <span className="sr-only">
            {useMathRec ? 'Math Recognition ON' : 'Math Recognition OFF'}
          </span>
        </button> */}
      </section>

      <JournalPanel
        isOpen={isJournalOpen}
        entries={journalEntries}
        accounts={PIANO_DEI_CONTI}
        isExtracting={isJournalExtracting}
        minRows={MIN_VISIBLE_JOURNAL_ENTRIES}
        onClose={() => setIsJournalOpen(false)}
        onExtract={() => void extractJournalData()}
        onAddEntry={addJournalEntry}
        onClearEntries={clearJournalEntries}
        onRemoveEntry={removeJournalEntry}
        onUpdateEntry={updateJournalEntry}
        onAmountClick={handleJournalAmountClick}
      />

      {isArchiveOpen && (
        <section className="archive-panel">
          <header className="archive-panel-header">
            <h3>Archivio documenti</h3>
            <div className="archive-panel-actions">
              <button
                className="icon-button"
                type="button"
                title="Archivia ora"
                aria-label="Archivia ora"
                onClick={() => void archiveCurrentDocument(false)}
              >
                <i className="fa-solid fa-box-archive" />
                <span className="sr-only">Archivia ora</span>
              </button>
              <button
                className="icon-button"
                type="button"
                title="Aggiorna"
                aria-label="Aggiorna"
                onClick={() => void loadArchiveEntries()}
              >
                <i className="fa-solid fa-rotate" />
                <span className="sr-only">Aggiorna</span>
              </button>
              <button
                className="icon-button"
                type="button"
                title="Nuovo"
                aria-label="Nuovo"
                onClick={() => void archiveAndCreateNew()}
              >
                <i className="fa-solid fa-file-circle-plus" />
                <span className="sr-only">Nuovo</span>
              </button>
              <button
                className="icon-button"
                type="button"
                title="Chiudi archivio"
                aria-label="Chiudi archivio"
                onClick={() => setIsArchiveOpen(false)}
              >
                <i className="fa-solid fa-xmark" />
                <span className="sr-only">Chiudi archivio</span>
              </button>
            </div>
          </header>
          <div className="archive-panel-body">
            <div className="archive-search">
              <i className="fa-solid fa-magnifying-glass" />
              <input
                value={archiveSearch}
                onChange={(event) => setArchiveSearch(event.target.value)}
                placeholder="Cerca file archivio..."
                aria-label="Cerca file archivio"
              />
            </div>
            {isArchiveLoading && <p className="archive-empty">Caricamento archivio...</p>}
            {!isArchiveLoading && archiveEntries.length === 0 && (
              <p className="archive-empty">Nessun documento archiviato.</p>
            )}
            {!isArchiveLoading && archiveEntries.length > 0 && filteredArchiveEntries.length === 0 && (
              <p className="archive-empty">Nessun risultato per la ricerca.</p>
            )}
            {!isArchiveLoading && filteredArchiveEntries.length > 0 && (
              <div className="archive-layout">
                <div className="archive-list">
                  {filteredArchiveEntries.map((entry) => (
                    <article
                      className={`archive-item ${selectedArchiveEntryId === entry.id ? "selected" : ""}`}
                      key={entry.id}
                    >
                      <button
                        className="archive-select-button"
                        type="button"
                        onClick={() => setSelectedArchiveEntryId(entry.id)}
                        title={`Anteprima ${entry.fileName}`}
                        aria-label={`Anteprima ${entry.fileName}`}
                      >
                        <strong>{entry.fileName}</strong>
                        <span>{formatArchiveDateTime(entry.updatedAt)}</span>
                        <span>{entry.pageCount} pagine</span>
                      </button>
                      <div className="archive-item-actions">
                        <button
                          className="icon-button"
                          type="button"
                          title="Apri documento"
                          aria-label="Apri documento"
                          onClick={() => void openArchiveDocument(entry.id)}
                        >
                          <i className="fa-solid fa-folder-open" />
                          <span className="sr-only">Apri documento</span>
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          title="Rinomina file"
                          aria-label="Rinomina file"
                          onClick={() => void renameArchiveDocument(entry.id, entry.fileName)}
                        >
                          <i className="fa-solid fa-pen" />
                          <span className="sr-only">Rinomina file</span>
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          title="Elimina dall'archivio"
                          aria-label="Elimina dall'archivio"
                          onClick={() => void removeArchiveDocument(entry.id)}
                        >
                          <i className="fa-solid fa-trash" />
                          <span className="sr-only">Elimina dall'archivio</span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <aside className="archive-preview-pane">
                  {!selectedArchiveEntry && <p className="archive-empty">Seleziona un documento.</p>}
                  {selectedArchiveEntry && (
                    <>
                      <header className="archive-preview-header">
                        <strong>{selectedArchiveEntry.fileName}</strong>
                        <span>{selectedArchiveEntry.pageCount} pagine</span>
                      </header>
                      <div className="archive-preview-grid">
                        {Array.from({ length: selectedArchiveEntry.pageCount }, (_unused, index) => {
                          const image = selectedArchiveEntry.previewImages[index] ?? null;
                          return (
                            <figure className="archive-page-thumb" key={`${selectedArchiveEntry.id}-page-${index}`}>
                              <div className="archive-page-canvas">
                                {image ? (
                                  <img
                                    src={image}
                                    alt={`Anteprima pagina ${index + 1}`}
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="archive-page-placeholder">Anteprima non disponibile</div>
                                )}
                              </div>
                              <figcaption>Pagina {index + 1}</figcaption>
                            </figure>
                          );
                        })}
                      </div>
                      <section className="archive-journal-preview">
                        <header>
                          <strong>Anteprima giornale_data</strong>
                        </header>
                        {selectedArchiveEntry.journalPreview.length === 0 && (
                          <p className="archive-empty">Nessuna registrazione giornale nel documento.</p>
                        )}
                        {selectedArchiveEntry.journalPreview.length > 0 && (
                          <div className="archive-journal-table-wrap">
                            <table className="archive-journal-table">
                              <thead>
                                <tr>
                                  <th>Data</th>
                                  <th>Cod.</th>
                                  <th>Conto</th>
                                  <th>Descrizione</th>
                                  <th>Dare</th>
                                  <th>Avere</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedArchiveEntry.journalPreview.map((entry) => (
                                  <tr key={entry.id}>
                                    <td>{entry.date || "-"}</td>
                                    <td>{entry.accountCode || "-"}</td>
                                    <td>{entry.accountName || "-"}</td>
                                    <td>{entry.description || "-"}</td>
                                    <td>{entry.debit || "-"}</td>
                                    <td>{entry.credit || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                    </>
                  )}
                </aside>
              </div>
            )}
          </div>
          <footer className="archive-panel-footer">
            <span>Salvataggio automatico in uscita attivo.</span>
            {archiveMessage && <span>{archiveMessage}</span>}
          </footer>
        </section>
      )}

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
