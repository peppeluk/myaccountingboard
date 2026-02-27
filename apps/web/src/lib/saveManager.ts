// Funzione centralizzata per forza salvataggio di tutte le pagine
// 🚨 DEPRECATED - PROBLEMA: Salva anche pagine virtualizzate e può svuotarle!
// export const forceSaveAllPages = (
//   pagesRef: React.MutableRefObject<any[]>,
//   pageCanvasDataRef: React.MutableRefObject<Record<string, string | null>>,
//   snapshotCanvasByPageId: (pageId: string) => string | null,
//   flushDocumentSave: () => void,
//   buildPersistedDocument: (pages: any[], canvasData: Record<string, string | null>, journalEntries: any[]) => any,
//   journalEntriesRef: React.MutableRefObject<any[]>,
//   documentSaveTimeoutRef: React.MutableRefObject<number | null>,
//   pendingDocumentSaveRef: React.MutableRefObject<any>
// ) => {
//   // FORZA SALVATAGGIO IMMEDIATO di tutte le pagine
//   const updatedCanvasData = { ...pageCanvasDataRef.current };
//   for (const page of pagesRef.current) {
//     const snapshot = snapshotCanvasByPageId(page.id);
//     if (snapshot && snapshot.length > 32) { // 32 = canvas vuoto di base
//       const existingData = pageCanvasDataRef.current[page.id];
//       if (!existingData || snapshot.length >= existingData.length) {
//         updatedCanvasData[page.id] = snapshot;
//       }
//     }
//   }
//   
//   // Salva immediatamente tutti i dati senza debounce
//   if (documentSaveTimeoutRef.current !== null) {
//     window.clearTimeout(documentSaveTimeoutRef.current);
//     documentSaveTimeoutRef.current = null;
//   }
//   
//   // Aggiorna refs
//   pageCanvasDataRef.current = updatedCanvasData;
//   
//   const document = buildPersistedDocument(pagesRef.current, updatedCanvasData, journalEntriesRef.current);
//   pendingDocumentSaveRef.current = document;
//   
//   flushDocumentSave(); // Salvataggio immediato!
//   
//   return updatedCanvasData;
// };

// Funzione per attendere completamento salvataggio
export const waitForSaveComplete = async (ms: number = 100) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};
