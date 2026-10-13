// Lokale Datenhaltung im Browser (IndexedDB).

const DB_NAME = 'myeinkauf';
const DB_VERSION = 1;
const STORE = 'products';

let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('ean', 'ean', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  const tx = db.transaction(STORE, mode);
  const result = await fn(tx.objectStore(STORE));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return result;
}

export function getAllProducts() {
  return withStore('readonly', (s) => promisify(s.getAll()));
}

export function getProduct(id) {
  return withStore('readonly', (s) => promisify(s.get(id)));
}

export async function findProductByEan(ean) {
  if (!ean) return undefined;
  return withStore('readonly', (s) => promisify(s.index('ean').get(ean)));
}

export function saveProduct(product) {
  return withStore('readwrite', (s) => promisify(s.put(product)));
}

export function deleteProduct(id) {
  return withStore('readwrite', (s) => promisify(s.delete(id)));
}

export function saveProducts(products, { replace = false } = {}) {
  return withStore('readwrite', async (s) => {
    if (replace) await promisify(s.clear());
    for (const p of products) s.put(p);
  });
}

// Bittet den Browser, die Daten nicht automatisch zu löschen, wenn der Speicher knapp wird.
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Nicht kritisch.
  }
}
