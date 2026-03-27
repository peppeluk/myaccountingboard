// MBD (Most Recent Data) Service
// Gestione sincronizzazione file più recente

export interface MBDDocument {
  id: string;
  fileName: string;
  lastModified: number;
  canvasData: string;
  journalData: any;
  userId?: string;
  deviceId?: string;
}

export class MBDService {
  private static instance: MBDService;
  private documents: Map<string, MBDDocument> = new Map();
  private readonly STORAGE_KEY = 'mbd_documents';

  static getInstance(): MBDService {
    if (!MBDService.instance) {
      MBDService.instance = new MBDService();
    }
    return MBDService.instance;
  }

  constructor() {
    this.loadFromStorage();
  }

  // Carica documenti dal localStorage
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const docs = JSON.parse(stored);
        this.documents = new Map(Object.entries(docs));
      }
    } catch (error) {
      console.error('[MBD] Error loading from storage:', error);
    }
  }

  // Salva documenti nel localStorage
  private saveToStorage(): void {
    try {
      const docs = Object.fromEntries(this.documents);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(docs));
    } catch (error) {
      console.error('[MBD] Error saving to storage:', error);
    }
  }

  // Salva/aggiorna un documento
  saveDocument(document: Omit<MBDDocument, 'lastModified'>): void {
    const doc: MBDDocument = {
      ...document,
      lastModified: Date.now()
    };

    this.documents.set(document.id, doc);
    this.saveToStorage();

    console.log('[MBD] Document saved:', document.id, 'at', new Date(doc.lastModified));
  }

  // Ottiene il documento più recente per un ID
  getMostRecentDocument(id: string): MBDDocument | null {
    const doc = this.documents.get(id);
    if (!doc) return null;

    console.log('[MBD] Most recent document for', id, 'from', new Date(doc.lastModified));
    return doc;
  }

  // Ottiene tutti i documenti ordinati per data
  getAllDocuments(): MBDDocument[] {
    return Array.from(this.documents.values())
      .sort((a, b) => b.lastModified - a.lastModified);
  }

  // Confronta due documenti e ritorna il più recente
  getMostRecentBetween(doc1Id: string, doc2Id: string): MBDDocument | null {
    const doc1 = this.documents.get(doc1Id);
    const doc2 = this.documents.get(doc2Id);

    if (!doc1 && !doc2) return null;
    if (!doc1) return doc2 || null;
    if (!doc2) return doc1;

    return doc1.lastModified > doc2.lastModified ? doc1 : doc2;
  }

  // Sincronizza con un documento remoto
  syncWithRemote(remoteDoc: MBDDocument): boolean {
    const localDoc = this.documents.get(remoteDoc.id);

    // Se non esiste localmente o il remoto è più recente
    if (!localDoc || remoteDoc.lastModified > localDoc.lastModified) {
      this.documents.set(remoteDoc.id, remoteDoc);
      this.saveToStorage();
      
      console.log('[MBD] Synced with newer remote document:', remoteDoc.id);
      return true; // Indica che il documento è stato aggiornato
    }

    console.log('[MBD] Local document is newer, ignoring remote:', remoteDoc.id);
    return false; // Indica che il documento locale era più recente
  }

  // Esporta i dati del canvas per il salvataggio
  exportCanvasData(canvas: any): string {
    if (!canvas) return '{}';
    
    try {
      return JSON.stringify(canvas.toJSON(['id', 'selectable', 'evented']));
    } catch (error) {
      console.error('[MBD] Error exporting canvas data:', error);
      return '{}';
    }
  }

  // Importa i dati del canvas
  importCanvasData(canvasData: string): any {
    try {
      return JSON.parse(canvasData);
    } catch (error) {
      console.error('[MBD] Error importing canvas data:', error);
      return {};
    }
  }

  // Pulisce documenti vecchi (opzionale)
  cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): void { // 7 giorni default
    const cutoff = Date.now() - maxAge;
    let deleted = 0;

    for (const [id, doc] of this.documents.entries()) {
      if (doc.lastModified < cutoff) {
        this.documents.delete(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      this.saveToStorage();
      console.log('[MBD] Cleaned up', deleted, 'old documents');
    }
  }
}

export const mbdService = MBDService.getInstance();
