// Lokale Datenhaltung im Browser (IndexedDB).

const DB_NAME = 'myeinkauf';
const DB_VERSION = 2;
const STORE = 'products';
const SETTINGS = 'settings';

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
        // Version 2: Einstellungen, die mit abgeglichen werden (z. B. eigene Kategorien).
        if (!db.objectStoreNames.contains(SETTINGS)) {
          db.createObjectStore(SETTINGS, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Eine neuere App-Version in einem anderen Tab will die Datenbank umbauen: Platz machen.
        db.onversionchange = () => {
          db.close();
          location.reload();
        };
        resolve(db);
      };
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

async function withStore(mode, fn, storeName = STORE) {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const result = await fn(tx.objectStore(storeName));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return result;
}

// Gelöschte Produkte bleiben als Markierung {id, deleted: true, updatedAt} erhalten,
// damit der Abgleich die Löschung an andere Geräte weitergeben kann.
export async function getAllProducts({ includeDeleted = false } = {}) {
  const all = await withStore('readonly', (s) => promisify(s.getAll()));
  return includeDeleted ? all : all.filter((p) => !p.deleted);
}

export async function getProduct(id) {
  const p = await withStore('readonly', (s) => promisify(s.get(id)));
  return p?.deleted ? undefined : p;
}

export async function findProductByEan(ean) {
  if (!ean) return undefined;
  return withStore('readonly', (s) => promisify(s.index('ean').get(ean)));
}

export function saveProduct(product) {
  return withStore('readwrite', (s) => promisify(s.put(product)));
}

export function deleteProduct(id) {
  return withStore('readwrite', async (s) => {
    const existing = await promisify(s.get(id));
    // photoId bleibt erhalten, damit der Abgleich das Foto im Repository entfernen kann.
    const tombstone = { id, deleted: true, photoId: existing?.photoId, updatedAt: new Date().toISOString() };
    return promisify(s.put(tombstone));
  });
}

export function saveProducts(products, { replace = false } = {}) {
  return withStore('readwrite', async (s) => {
    if (replace) await promisify(s.clear());
    for (const p of products) s.put(p);
  });
}

// Einstellungen, die zwischen Geräten abgeglichen und mit exportiert werden.
// Jede wird als Ganzes behandelt: der neuere Stand (updatedAt) gewinnt.
export const SYNCED_SETTINGS = ['categories', 'favoriteMarkets', 'chains', 'home', 'offerDecisions'];

export function getSetting(key) {
  return withStore('readonly', (s) => promisify(s.get(key)), SETTINGS);
}

export function saveSetting(setting) {
  return withStore('readwrite', (s) => promisify(s.put(setting)), SETTINGS);
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
