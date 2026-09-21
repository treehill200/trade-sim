/**
 * Minimal promise wrapper around IndexedDB.
 *
 * Every call is defensive: private browsing, blocked storage and quota errors
 * must degrade to "no saved data" rather than breaking the app, so all public
 * helpers resolve with null/false instead of rejecting.
 */

const DB_NAME = 'david-coin-sim';
const DB_VERSION = 1;

export const STORE_META = 'meta';
export const STORE_SERIES = 'series';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
        if (!db.objectStoreNames.contains(STORE_SERIES)) db.createObjectStore(STORE_SERIES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function idbGet<T>(store: string, key: string): Promise<T | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

export async function idbPut(store: string, key: string, value: unknown): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    return await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

/** Write several key/value pairs into one store in a single transaction. */
export async function idbPutMany(store: string, entries: [string, unknown][]): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    return await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const [k, v] of entries) os.put(v, k);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

export async function idbClearAll(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([STORE_META, STORE_SERIES], 'readwrite');
        tx.objectStore(STORE_META).clear();
        tx.objectStore(STORE_SERIES).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    /* storage unavailable; nothing to clear */
  }
}
