// Canvas Hook - Gestisce canvas, virtualization e tool handlers
import { useCallback, useRef, useState } from "react";
import type { Page, Tool, SizeLevel } from "../types";

export function useCanvas() {
  const [pages, setPages] = useState<Page[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#000000");
  const [penSizeLevel, setPenSizeLevel] = useState<SizeLevel>("medium");
  const [eraserSizeLevel, setEraserSizeLevel] = useState<SizeLevel>("medium");
  const [isPenSizeMenuOpen, setIsPenSizeMenuOpen] = useState(false);
  const [isEraserSizeMenuOpen, setIsEraserSizeMenuOpen] = useState(false);
  const [virtualWindowRange, setVirtualWindowRange] = useState({ startIndex: 0, endIndex: 0 });
  const [intersectingPageIds, setIntersectingPageIds] = useState<string[]>([]);

  // Refs per canvas management
  const fabricCanvasMapRef = useRef<Map<number, any>>(new Map()); // FabricCanvas
  const pageSlotMapRef = useRef<Map<string, number>>(new Map());
  const slotPageMapRef = useRef<Map<number, string>>(new Map());
  const slotLoadTokenRef = useRef<Record<number, number>>({});
  const activeCanvasPageIdRef = useRef<string | null>(null);
  const activeLineRef = useRef<any>(null); // FabricLine
  const fabricModuleRef = useRef<typeof import("fabric") | null>(null);
  const toolHandlersRef = useRef<Record<string, any>>({});
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

  // Constants
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

  const getCurrentPageId = useCallback(() => {
    if (pages.length === 0) return null;
    return pages[currentPageIndex]?.id ?? null;
  }, [pages, currentPageIndex]);

  const getCanvasByPageId = useCallback((pageId: string): any => { // FabricCanvas
    const slot = pageSlotMapRef.current.get(pageId);
    return slot !== undefined ? fabricCanvasMapRef.current.get(slot) ?? null : null;
  }, []);

  // 🆕 FUNZIONE PER INCOLLARE IMMAGINI
  const pasteImageFromClipboard = useCallback(async (pageId: string) => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            
            // Converti blob in URL
            const imageUrl = URL.createObjectURL(blob);
            
            // Carica Fabric.js se non già caricato
            if (!fabricModuleRef.current) {
              fabricModuleRef.current = await import('fabric');
            }
            
            const fabric = fabricModuleRef.current;
            
            // Crea immagine Fabric.js
            fabric.Image.fromURL(imageUrl, {
              crossOrigin: 'anonymous'
            } as any, (img: any) => {
              const canvas = getCanvasByPageId(pageId);
              if (!canvas) return;
              
              // Dimensioni massime per evitare immagini troppo grandi
              const maxWidth = 400;
              const maxHeight = 300;
              
              let width = img.width || 200;
              let height = img.height || 150;
              
              // Scala se necessario
              if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;
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
              
              // Aggiungi al canvas
              canvas.add(img);
              canvas.setActiveObject(img);
              canvas.renderAll();
              
              // Pulisci URL dopo l'uso
              URL.revokeObjectURL(imageUrl);
              
              console.log('🖼️ Immagine incollata con successo:', { width, height });
            });
            
            return; // Esci dopo aver processato la prima immagine
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ Impossibile incollare immagine:', error);
      // Prova fallback per browser meno recenti
      try {
        const text = await navigator.clipboard.readText();
        if (text.startsWith('data:image')) {
          // È un data URL di immagine
          const img = new Image();
          img.onload = () => {
            // Qui potresti implementare il data URL processing
            console.log('📋 Data URL immagine rilevato:', text.substring(0, 50) + '...');
          };
          img.src = text;
        }
      } catch (fallbackError) {
        console.warn('⚠️ Fallback incollaggio fallito:', fallbackError);
      }
    }
  }, [getCanvasByPageId]);

  const pushHistoryState = useCallback(() => {
    // History management logic here
  }, []);

  const resetHistoryForPage = useCallback(() => {
    // Reset history logic here
  }, []);

  return {
    // State
    pages,
    setPages,
    currentPageIndex,
    setCurrentPageIndex,
    tool,
    setTool,
    color,
    setColor,
    penSizeLevel,
    setPenSizeLevel,
    eraserSizeLevel,
    setEraserSizeLevel,
    isPenSizeMenuOpen,
    setIsPenSizeMenuOpen,
    isEraserSizeMenuOpen,
    setIsEraserSizeMenuOpen,
    virtualWindowRange,
    setVirtualWindowRange,
    intersectingPageIds,
    setIntersectingPageIds,
    
    // Refs
    fabricCanvasMapRef,
    pageSlotMapRef,
    slotPageMapRef,
    slotLoadTokenRef,
    activeCanvasPageIdRef,
    activeLineRef,
    fabricModuleRef,
    toolHandlersRef,
    activeToolRef,
    clipboardObjectRef,
    clipboardSourcePageIdRef,
    selectionDragRef,
    multiSelectionRef,
    selectedObjectsRef,
    
    // Constants
    PEN_WIDTH_BY_LEVEL,
    ERASER_WIDTH_BY_LEVEL,
    
    // Core functions
    getCurrentPageId,
    getCanvasByPageId,
    pushHistoryState,
    resetHistoryForPage,
    
    // 🆕 Funzione incolla immagine
    pasteImageFromClipboard
  };
}
