// OCR Hook - Gestisce stato OCR e worker
import { useCallback, useRef, useState } from "react";
import type { OcrWorker, SelectionRect } from "../types";

export function useOCR() {
  const [isOcrEnabled, setIsOcrEnabled] = useState(false);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("OCR spento");
  
  const workerRef = useRef<OcrWorker | null>(null);
  const workerInitPromiseRef = useRef<Promise<OcrWorker> | null>(null);
  const autoOcrTimeoutRef = useRef<number | null>(null);
  const autoOcrRectRef = useRef<{ pageId: string; rect: SelectionRect } | null>(null);
  const isAutoOcrBusyRef = useRef(false);
  const lastOcrChunkRef = useRef<string>("");

  const getWorker = useCallback(async (): Promise<OcrWorker> => {
    if (workerRef.current) {
      return workerRef.current;
    }
    if (!workerInitPromiseRef.current) {
      workerInitPromiseRef.current = import("../lib/lazyImports").then(({ lazyImportTesseract }) =>
        lazyImportTesseract().then((tesseract) =>
          tesseract.createWorker("eng").then(async (worker) => {
            const configurableWorker = worker as OcrWorker & {
              setParameters?: (params: Record<string, string>) => Promise<unknown>;
            };
            if (configurableWorker.setParameters) {
              await configurableWorker.setParameters({
                tessedit_char_whitelist: "0123456789+-*/xX().,%=:;tT\u00D7\u00F7"
              });
            }
            const typedWorker = configurableWorker as OcrWorker;
            workerRef.current = typedWorker;
            return typedWorker;
          })
        )
      );
    }
    return workerInitPromiseRef.current;
  }, []);

  const clearAutoOcrSchedule = useCallback(() => {
    if (autoOcrTimeoutRef.current !== null) {
      window.clearTimeout(autoOcrTimeoutRef.current);
      autoOcrTimeoutRef.current = null;
    }
  }, []);

  const scheduleAutoOcrForRect = useCallback((pageId: string, rect: SelectionRect) => {
    clearAutoOcrSchedule();
    autoOcrRectRef.current = { pageId, rect };
    autoOcrTimeoutRef.current = window.setTimeout(() => {
      autoOcrRectRef.current = null;
    }, 550); // AUTO_OCR_DEBOUNCE_MS
  }, [clearAutoOcrSchedule]);

  return {
    isOcrEnabled,
    setIsOcrEnabled,
    isOcrRunning,
    setIsOcrRunning,
    ocrStatus,
    setOcrStatus,
    workerRef,
    getWorker,
    autoOcrTimeoutRef,
    autoOcrRectRef,
    isAutoOcrBusyRef,
    lastOcrChunkRef,
    clearAutoOcrSchedule,
    scheduleAutoOcrForRect
  };
}
