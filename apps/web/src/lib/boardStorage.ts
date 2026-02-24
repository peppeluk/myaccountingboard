export type BoardPage = {
  id: string;
  name: string;
};

export type BoardDocument = {
  pages: BoardPage[];
  canvasData: string | null;
};

type StoredBoardRecord = {
  id: string;
  format: "mbd-json-v1";
  fileName: string;
  updatedAt: number;
  data: BoardDocument;
};

const DATABASE_NAME = "myaccounting-board";
const DATABASE_VERSION = 1;
const STORE_NAME = "documents";
const LAST_OPENED_DOCUMENT_KEY = "last_opened";

let databasePromise: Promise<IDBDatabase> | null = null;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function buildBoardFileName(timestamp: number): string {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `myboard_data_${y}${m}${d}_${h}${min}${s}.mbd`;
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

  return {
    pages,
    canvasData: typeof raw.canvasData === "string" ? raw.canvasData : null
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
    fileName: buildBoardFileName(now),
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
