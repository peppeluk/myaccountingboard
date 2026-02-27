export type BoardPage = {
  id: string;
  name: string;
};

export type BoardJournalEntry = {
  id: string;
  date: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: string;
  credit: string;
  closeLine: boolean;
};

export type BoardDocument = {
  pages: BoardPage[];
  canvasData: string | null;
  pageCanvasData: Record<string, string | null>;
  journalEntries: BoardJournalEntry[];
};

export type ArchivedBoardDocument = {
  id: string;
  fileName: string;
  updatedAt: number;
  pageCount: number;
  previewImages: string[];
  journalPreview: BoardJournalEntry[];
};

export type AppSettings = {
  theme?: 'light' | 'dark';
  autoSave?: boolean;
  backgroundMode?: 'plain' | 'grid';
  activeArchiveDocumentId?: string | null;
};

export const loadAppSettings = async (): Promise<AppSettings> => {
  try {
    const stored = localStorage.getItem('myaccounting-settings');
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

export const saveAppSettings = async (settings: AppSettings): Promise<void> => {
  try {
    localStorage.setItem('myaccounting-settings', JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save app settings:', error);
  }
};

type StoredBoardRecord = {
  id: string;
  format: "mbd-json-v1";
  fileName: string;
  updatedAt: number;
  previewImages?: string[];
  data: BoardDocument;
};

const DATABASE_NAME = "myaccounting-board";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";
const LAST_OPENED_DOCUMENT_KEY = "last_opened";
const ARCHIVE_KEY_PREFIX = "archive:";

let databasePromise: Promise<IDBDatabase> | null = null;

// 🎯 Contatore progressivo per nomi archivi - salvato in localStorage
function getArchiveCounter(): number {
  const saved = localStorage.getItem('myaccounting_archive_counter');
  return saved ? parseInt(saved, 10) : 1;
}

function incrementArchiveCounter(): void {
  const current = getArchiveCounter();
  localStorage.setItem('myaccounting_archive_counter', (current + 1).toString());
}

function buildArchiveFileName(): string {
  const counter = getArchiveCounter();
  const fileName = `MyAcc_${counter}.mbd`;
  incrementArchiveCounter(); // Incrementa contatore
  return fileName;
}

function isArchiveKey(value: string): boolean {
  return value.startsWith(ARCHIVE_KEY_PREFIX);
}

function buildArchiveKey(timestamp: number): string {
  return `${ARCHIVE_KEY_PREFIX}${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePreviewImages(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizeArchiveFileName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Nome file non valido");
  }
  return /\.mbd$/i.test(trimmed) ? trimmed : `${trimmed}.mbd`;
}

function buildJournalPreview(entries: BoardJournalEntry[]): BoardJournalEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.date ||
        entry.accountCode ||
        entry.accountName ||
        entry.description ||
        entry.debit ||
        entry.credit
    )
    .slice(0, 10);
}

function normalizeBoardDocument(input: unknown): BoardDocument | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const raw = input as Partial<BoardDocument>;
  const pages = Array.isArray(raw.pages)
    ? raw.pages
        .map((item, index) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const page = item as Partial<BoardPage>;
          return {
            id: typeof page.id === "string" && page.id.length > 0 ? page.id : `page-${index}`,
            name: typeof page.name === "string" && page.name.length > 0 ? page.name : `Pagina ${index + 1}`
          } satisfies BoardPage;
        })
        .filter((item): item is BoardPage => item !== null)
    : [];

  const journalEntries = Array.isArray(raw.journalEntries)
    ? raw.journalEntries
        .map((item, index) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const entry = item as Partial<BoardJournalEntry>;
          return {
            id: typeof entry.id === "string" && entry.id.length > 0 ? entry.id : `journal-${index}`,
            date: typeof entry.date === "string" ? entry.date : "",
            accountCode: typeof entry.accountCode === "string" ? entry.accountCode : "",
            accountName: typeof entry.accountName === "string" ? entry.accountName : "",
            description: typeof entry.description === "string" ? entry.description : "",
            debit: typeof entry.debit === "string" ? entry.debit : "",
            credit: typeof entry.credit === "string" ? entry.credit : "",
            closeLine: entry.closeLine === true
          } satisfies BoardJournalEntry;
        })
        .filter((item): item is BoardJournalEntry => item !== null)
    : [];

  const pageCanvasData = typeof raw.pageCanvasData === "object" && raw.pageCanvasData !== null
    ? raw.pageCanvasData as Record<string, string | null>
    : {};

  return {
    pages,
    canvasData: typeof raw.canvasData === "string" ? raw.canvasData : null,
    pageCanvasData,
    journalEntries
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) {
    return databasePromise;
  }
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB non disponibile"));
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Apertura IndexedDB fallita"));
    };
  });

  return databasePromise;
}

export async function loadLastBoardDocument(): Promise<BoardDocument | null> {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(LAST_OPENED_DOCUMENT_KEY);

    request.onsuccess = () => {
      const rawRecord = request.result as StoredBoardRecord | undefined;
      if (!rawRecord || typeof rawRecord !== "object") {
        resolve(null);
        return;
      }

      const normalized = normalizeBoardDocument(rawRecord.data);
      if (!normalized || normalized.pages.length === 0) {
        resolve(null);
        return;
      }
      resolve(normalized);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Lettura IndexedDB fallita"));
    };
  });
}

export async function saveLastBoardDocument(document: BoardDocument): Promise<void> {
  const normalized = normalizeBoardDocument(document);
  if (!normalized || normalized.pages.length === 0) {
    return;
  }

  const now = Date.now();
  const record: StoredBoardRecord = {
    id: LAST_OPENED_DOCUMENT_KEY,
    format: "mbd-json-v1",
    fileName: "MYAccounting_LastOpened.mbd",  // 🎯 Nome fisso per last document (non sovrascrive archivi)
    updatedAt: now,
    data: normalized
  };

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(record, LAST_OPENED_DOCUMENT_KEY);

    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Salvataggio IndexedDB fallito"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("Transazione IndexedDB annullata"));
    };
  });
}

export async function archiveBoardDocument(
  document: BoardDocument,
  archiveId?: string | null,
  previewImages?: string[]
): Promise<string | null> {
  const normalized = normalizeBoardDocument(document);
  if (!normalized || normalized.pages.length === 0) {
    return null;
  }

  const now = Date.now();
  const key = archiveId && isArchiveKey(archiveId) ? archiveId : buildArchiveKey(now);
  
  // 🎯 Se è un aggiornamento, mantieni il nome esistente
  let fileName: string;
  if (archiveId && isArchiveKey(archiveId)) {
    // Recupera il nome esistente per non sovrascriverlo
    try {
      const database = await openDatabase();
      const existingRecord = await new Promise<StoredBoardRecord | undefined>((resolve) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(archiveId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      });
      
      fileName = existingRecord?.fileName || buildArchiveFileName();
    } catch {
      fileName = buildArchiveFileName();
    }
  } else {
    // Nuovo archivio, usa contatore progressivo
    fileName = buildArchiveFileName();
  }
  
  const record: StoredBoardRecord = {
    id: key,
    format: "mbd-json-v1",
    fileName,  // 🎯 Mantiene nome esistente o usa progressivo
    updatedAt: now,
    previewImages: normalizePreviewImages(previewImages),
    data: normalized
  };

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(record, key);

    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Archiviazione IndexedDB fallita"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("Transazione IndexedDB annullata"));
    };
  });

  return key;
}

export async function listArchivedBoardDocuments(): Promise<ArchivedBoardDocument[]> {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? (request.result as StoredBoardRecord[]) : [];
      const items = rows
        .filter(
          (row) =>
            row &&
            typeof row.id === "string" &&
            isArchiveKey(row.id) &&
            typeof row.fileName === "string" &&
            typeof row.updatedAt === "number" &&
            row.data &&
            Array.isArray(row.data.pages)
        )
        .map((row) => ({
          id: row.id,
          fileName: row.fileName,
          updatedAt: row.updatedAt,
          pageCount: row.data.pages.length,
          previewImages: normalizePreviewImages(row.previewImages),
          journalPreview: buildJournalPreview(
            Array.isArray(row.data.journalEntries) ? row.data.journalEntries : []
          )
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);

      resolve(items);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Lettura archivio IndexedDB fallita"));
    };
  });
}

export async function loadArchivedBoardDocument(id: string): Promise<BoardDocument | null> {
  if (!isArchiveKey(id)) {
    return null;
  }

  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const row = request.result as StoredBoardRecord | undefined;
      if (!row || typeof row !== "object") {
        resolve(null);
        return;
      }
      const normalized = normalizeBoardDocument(row.data);
      if (!normalized || normalized.pages.length === 0) {
        resolve(null);
        return;
      }
      resolve(normalized);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Lettura documento archivio fallita"));
    };
  });
}

export async function deleteArchivedBoardDocument(id: string): Promise<void> {
  if (!isArchiveKey(id)) {
    return;
  }

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete(id);

    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Cancellazione documento archivio fallita"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("Transazione IndexedDB annullata"));
    };
  });
}

export async function renameArchivedBoardDocument(id: string, nextFileName: string): Promise<void> {
  if (!isArchiveKey(id)) {
    return;
  }

  const normalizedFileName = normalizeArchiveFileName(nextFileName);
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const row = request.result as StoredBoardRecord | undefined;
      if (!row || typeof row !== "object") {
        return;
      }

      const updatedRecord: StoredBoardRecord = {
        ...row,
        fileName: normalizedFileName,
        updatedAt: Date.now()
      };
      store.put(updatedRecord, id);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Lettura documento archivio fallita"));
    };

    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Rinomina documento archivio fallita"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("Transazione IndexedDB annullata"));
    };
  });
}
