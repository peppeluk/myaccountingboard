// Funzione per forzare il salvataggio di tutte le pagine
// DEPRECATED: Questa funzione è stata spostata in lib/saveManager.ts
// Usare forceSaveAllPages dal saveManager per forza salvataggio centralizzato
/*
export const forceSaveAllPages = (
  pages: any[],
  pageCanvasDataRef: React.MutableRefObject<Record<string, string | null>>,
  snapshotCanvasByPageId: (pageId: string) => string | null,
  persistDocument: (pages: any[], canvasData: Record<string, string | null>) => void
) => {
  const updatedCanvasData = { ...pageCanvasDataRef.current };
  
  for (const page of pages) {
    const snapshot = snapshotCanvasByPageId(page.id);
    if (snapshot) {
      updatedCanvasData[page.id] = snapshot;
    }
  }
  
  persistDocument(pages, updatedCanvasData);
  pageCanvasDataRef.current = updatedCanvasData;
};
*/
