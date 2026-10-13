// Export und Import des Katalogs als JSON-Datei. Eigene Fotos werden als Data-URL eingebettet.

import { getAllProducts, saveProducts } from './db.js';

const FORMAT = 'myeinkauf-katalog';
const FORMAT_VERSION = 1;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

export async function exportCatalog() {
  const products = await getAllProducts();
  const serialized = await Promise.all(
    products.map(async (p) => ({
      ...p,
      photo: p.photo instanceof Blob ? await blobToDataUrl(p.photo) : null,
    })),
  );
  const data = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    products: serialized,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `myeinkauf-katalog-${date}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return products.length;
}

/**
 * Liest eine Exportdatei ein.
 * mode 'merge': vorhandene Produkte bleiben, bei gleicher ID gewinnt der neuere Stand.
 * mode 'replace': der Katalog wird vollständig durch die Datei ersetzt.
 * @returns {Promise<number>} Anzahl übernommener Produkte
 */
export async function importCatalog(file, mode = 'merge') {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  if (data?.format !== FORMAT || !Array.isArray(data.products)) {
    throw new Error('Die Datei ist kein MyEinkauf-Katalog.');
  }
  if (data.version > FORMAT_VERSION) {
    throw new Error('Die Datei stammt aus einer neueren App-Version. Bitte App aktualisieren.');
  }

  const incoming = [];
  for (const p of data.products) {
    if (!p?.id || !p?.name) continue;
    incoming.push({
      ...p,
      photo: typeof p.photo === 'string' && p.photo.startsWith('data:')
        ? await dataUrlToBlob(p.photo)
        : null,
    });
  }

  if (mode === 'replace') {
    await saveProducts(incoming, { replace: true });
    return incoming.length;
  }

  const existing = new Map((await getAllProducts()).map((p) => [p.id, p]));
  const toSave = incoming.filter((p) => {
    const current = existing.get(p.id);
    return !current || (p.updatedAt || '') > (current.updatedAt || '');
  });
  await saveProducts(toSave);
  return toSave.length;
}
