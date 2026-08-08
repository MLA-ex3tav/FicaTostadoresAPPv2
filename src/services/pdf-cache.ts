/**
 * Caché persistente de PDFs generados usando IndexedDB.
 *
 * El webview de Tauri persiste IndexedDB en el perfil de la app, así que los
 * PDFs sobreviven reinicios. Cada entrada se guarda con un fingerprint: si el
 * contenido de la cotización/OT no cambió, se reutiliza el PDF guardado; si
 * cambió (edición), el fingerprint no coincide y se regenera.
 */

const DB_NAME = "fica-pdf-cache";
const DB_VERSION = 1;
const STORE = "pdfs";

interface PdfCacheRecord {
  key: string;
  fingerprint: string;
  blob: Blob;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T | void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      db.close();
      resolve(undefined);
    };
  });
}

/** Lee un PDF cacheado si el fingerprint coincide; si no, devuelve null. */
export async function readCachedPdf(
  key: string,
  fingerprint: string,
): Promise<Blob | null> {
  try {
    const result = await withStore<PdfCacheRecord | undefined>("readonly", (store) =>
      store.get(key),
    );
    const record = result as PdfCacheRecord | undefined;
    if (record && record.fingerprint === fingerprint && record.blob) {
      return record.blob;
    }
    return null;
  } catch (error) {
    console.warn("[pdf-cache] No se pudo leer de IndexedDB", error);
    return null;
  }
}

/** Guarda (o reemplaza) un PDF cacheado. */
export async function writeCachedPdf(
  key: string,
  fingerprint: string,
  blob: Blob,
): Promise<void> {
  try {
    const record: PdfCacheRecord = {
      key,
      fingerprint,
      blob,
      updatedAt: Date.now(),
    };
    await withStore<void>("readwrite", (store) => store.put(record));
  } catch (error) {
    console.warn("[pdf-cache] No se pudo guardar en IndexedDB", error);
  }
}

/** Elimina un PDF cacheado (tras edición). */
export async function deleteCachedPdf(key: string): Promise<void> {
  try {
    await withStore<void>("readwrite", (store) => store.delete(key));
  } catch (error) {
    console.warn("[pdf-cache] No se pudo eliminar de IndexedDB", error);
  }
}
