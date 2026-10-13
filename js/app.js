// MyEinkauf – Oberfläche und Navigation (Hash-Routing, ohne Framework).

import {
  getAllProducts,
  getProduct,
  findProductByEan,
  saveProduct,
  saveProducts,
  deleteProduct,
  requestPersistentStorage,
} from './db.js';
import { getCategories, saveCategories, guessCategory } from './categories.js';
import { lookupEan } from './off.js';
import { startScanner, cameraSupported, describeCameraError } from './scanner.js';
import { isValidEan, normalizeEan } from './ean.js';
import { exportCatalog, importCatalog } from './backup.js';
import {
  DEFAULT_REPO,
  connect,
  disconnect,
  getSyncConfig,
  getSyncStatus,
  queuePhotoDelete,
  scheduleSync,
  syncNow,
} from './sync.js';

export const APP_VERSION = '0.3.0';

const view = document.getElementById('view');
const NO_CATEGORY = 'Ohne Kategorie';

// Aufräumfunktionen der aktuellen Ansicht (Kamera stoppen, Object-URLs freigeben, ...).
let cleanups = [];
// Entwurf für ein neues Produkt zwischen Scan und Formular.
let draft = null;
// Filter der Katalogliste bleiben beim Zurückkehren erhalten.
const listFilter = { query: '', category: '' };

// ---------- Hilfsfunktionen ----------

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

function parseDecimal(value) {
  const cleaned = String(value ?? '').trim().replace(/\s|€/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

function formatDecimal(n) {
  return n == null ? '' : n.toFixed(2).replace('.', ',');
}

function newId() {
  return crypto.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  cleanups.push(() => URL.revokeObjectURL(url));
  return url;
}

function productImage(p) {
  if (p.photo instanceof Blob) return objectUrl(p.photo);
  return p.imageUrl || '';
}

let toastTimer;
function toast(message, { error = false, action } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast${error ? ' error' : ''}`;
  el.hidden = false;
  el.onclick = action ? () => { el.hidden = true; action(); } : () => { el.hidden = true; };
  el.style.cursor = action ? 'pointer' : 'default';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 10000 : 3500);
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// Fotos verkleinern, damit IndexedDB und Exportdatei klein bleiben.
async function shrinkImage(file, maxSize = 1000) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Foto konnte nicht verarbeitet werden'))),
      'image/jpeg', 0.82));
}

// ---------- Katalog ----------

async function renderCatalog() {
  const products = await getAllProducts();
  document.title = 'Katalog – MyEinkauf';

  if (!products.length) {
    view.innerHTML = `
      <div class="empty card">
        <div class="big">🛒</div>
        <h1>Dein Katalog ist noch leer</h1>
        <p class="muted">Scanne den Barcode deiner Lieblingsprodukte. Name, Marke und Bild
          kommen automatisch aus Open Food Facts.</p>
        <div class="btn-row" style="justify-content:center">
          <a class="btn primary" href="#/neu">Erstes Produkt scannen</a>
          <a class="btn" href="#/einstellungen">Katalog importieren</a>
        </div>
      </div>`;
    return;
  }

  const categories = await getCategories();
  const usedCategories = [...new Set(products.map((p) => p.category || NO_CATEGORY))];
  const categoryOptions = [...categories, NO_CATEGORY].filter((c) => usedCategories.includes(c));
  if (!categoryOptions.includes(listFilter.category)) listFilter.category = '';

  view.innerHTML = `
    <h1>Katalog <span class="muted small">(${products.length})</span></h1>
    <div class="toolbar">
      <input type="search" id="search" placeholder="Suchen …" aria-label="Suchen nach Name, Marke oder EAN" value="${esc(listFilter.query)}" autocomplete="off">
      <select id="category-filter" aria-label="Kategorie">
        <option value="">Alle Kategorien</option>
        ${categoryOptions.map((c) => `<option ${c === listFilter.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
    </div>
    <div id="list"></div>
    <a class="btn primary fab" href="#/neu">＋ Produkt</a>`;

  // Bild-URLs einmal erzeugen, nicht bei jedem Tastendruck.
  const images = new Map(products.map((p) => [p.id, productImage(p)]));
  const list = view.querySelector('#list');

  const renderList = () => {
    const q = listFilter.query.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (listFilter.category && (p.category || NO_CATEGORY) !== listFilter.category) return false;
      if (!q) return true;
      return [p.name, p.brand, p.ean, p.notes].some((v) => (v || '').toLowerCase().includes(q));
    });
    if (!filtered.length) {
      list.innerHTML = '<p class="muted center">Keine Treffer.</p>';
      return;
    }
    const order = [...categories, NO_CATEGORY];
    const groups = new Map();
    for (const p of filtered) {
      const key = p.category || NO_CATEGORY;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b, 'de');
    });
    list.innerHTML = sortedKeys.map((key) => {
      const items = groups.get(key).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      return `
        <div class="group-title">${esc(key)}</div>
        <ul class="product-list">
          ${items.map((p) => {
            const img = images.get(p.id);
            const meta = [p.brand, p.packageSize, p.usualQty > 1 ? `üblich ${p.usualQty}×` : '']
              .filter(Boolean).join(' · ');
            return `
              <li class="product-item">
                <a href="#/produkt/${encodeURIComponent(p.id)}">
                  ${img
                    ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy">`
                    : '<span class="thumb placeholder">📦</span>'}
                  <span class="product-info">
                    <span class="product-name">${esc(p.name)}</span>
                    <span class="product-meta">${esc(meta || '–')}</span>
                  </span>
                  ${p.priceLimit != null ? `<span class="price-limit" title="Schmerzgrenze">≤ ${euro.format(p.priceLimit)}</span>` : ''}
                </a>
              </li>`;
          }).join('')}
        </ul>`;
    }).join('');
  };

  view.querySelector('#search').addEventListener('input', (e) => {
    listFilter.query = e.target.value;
    renderList();
  });
  view.querySelector('#category-filter').addEventListener('change', (e) => {
    listFilter.category = e.target.value;
    renderList();
  });
  renderList();
}

// ---------- Neues Produkt: Scannen oder EAN eingeben ----------

function renderAdd() {
  document.title = 'Produkt hinzufügen – MyEinkauf';
  const canScan = cameraSupported();
  view.innerHTML = `
    <h1>Produkt hinzufügen</h1>
    ${canScan ? `
      <div class="scanner">
        <video muted playsinline></video>
        <div class="frame"></div>
        <div class="status" id="scan-status">Kamera wird gestartet …</div>
      </div>
      <div class="btn-row" id="retry-row" hidden>
        <button class="btn" id="retry">Kamera erneut starten</button>
      </div>`
    : `<div class="card muted">Die Kamera ist hier nicht verfügbar. Sie braucht HTTPS
        (oder localhost) und einen Browser mit Kamerazugriff. Du kannst die EAN unten eintippen.</div>`}

    <div class="divider">oder EAN eintippen</div>
    <form id="ean-form" class="input-row" autocomplete="off">
      <input id="ean-input" inputmode="numeric" pattern="[0-9 ]*" placeholder="z. B. 3017620422003" aria-label="EAN">
      <button class="btn primary" type="submit">Suchen</button>
    </form>

    <div class="divider">oder</div>
    <button class="btn" id="manual">Ohne Barcode anlegen</button>
    <div id="lookup"></div>`;

  let scanner = null;
  let busy = false;
  cleanups.push(() => scanner?.stop());

  const handleEan = async (ean) => {
    if (busy) return;
    busy = true;
    scanner?.stop();
    const existing = await findProductByEan(ean);
    if (existing) {
      toast('Schon im Katalog');
      navigate(`#/produkt/${encodeURIComponent(existing.id)}`);
      return;
    }
    view.querySelector('#lookup').innerHTML =
      `<div class="spinner"></div><p class="muted center">Suche ${esc(ean)} in Open Food Facts …</p>`;
    let data = null;
    try {
      data = await lookupEan(ean);
      if (!data) toast('Produkt nicht in der Datenbank – bitte selbst ausfüllen');
    } catch (err) {
      toast(err.message, { error: true });
    }
    if (data) {
      const { categoryTags, ...rest } = data;
      data = { ...rest, category: guessCategory(categoryTags, rest.source, await getCategories()) };
    }
    draft = { ean, ...(data || {}) };
    navigate('#/neu/formular');
  };

  if (canScan) {
    const video = view.querySelector('video');
    const status = view.querySelector('#scan-status');
    const retryRow = view.querySelector('#retry-row');
    const start = async () => {
      retryRow.hidden = true;
      status.textContent = 'Kamera wird gestartet …';
      try {
        scanner = await startScanner(video, handleEan);
        if (!busy) status.textContent = 'Barcode in den Rahmen halten';
      } catch (err) {
        console.warn(err);
        status.textContent = describeCameraError(err);
        retryRow.hidden = false;
      }
    };
    view.querySelector('#retry').addEventListener('click', start);
    start();
  }

  view.querySelector('#ean-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ean = normalizeEan(view.querySelector('#ean-input').value);
    if (!isValidEan(ean)) {
      toast('Ungültige EAN (8 oder 13 Ziffern, Prüfziffer stimmt nicht)', { error: true });
      return;
    }
    handleEan(ean);
  });

  view.querySelector('#manual').addEventListener('click', () => {
    draft = {};
    navigate('#/neu/formular');
  });
}

// ---------- Produktformular (neu und bearbeiten) ----------

async function renderForm(product, { isNew }) {
  const categories = await getCategories();
  // Kategorie behalten, auch wenn sie inzwischen gelöscht wurde.
  if (product.category && !categories.includes(product.category)) categories.push(product.category);
  document.title = `${isNew ? 'Neues Produkt' : product.name} – MyEinkauf`;
  // Bearbeitungsstand des Fotos, wird erst beim Speichern übernommen.
  let photo = product.photo instanceof Blob ? product.photo : null;
  let photoChanged = false;
  const imageUrl = product.imageUrl || '';

  view.innerHTML = `
    <h1>${isNew ? 'Neues Produkt' : 'Produkt bearbeiten'}</h1>
    <form id="product-form" class="card" autocomplete="off" novalidate>
      <div class="photo-box">
        <div id="photo-slot"></div>
        <div class="photo-actions">
          <label class="btn" style="margin:0">
            📷 Eigenes Foto
            <input type="file" id="photo-input" accept="image/*" capture="environment" hidden>
          </label>
          <button type="button" class="btn danger" id="photo-remove" hidden>Eigenes Foto entfernen</button>
        </div>
      </div>
      ${product.source ? `<p class="source-note">Daten aus <a href="${esc(product.sourceUrl)}" target="_blank" rel="noopener">${esc(product.source)}</a> (ODbL)</p>` : ''}

      <label for="f-name">Name *</label>
      <input id="f-name" name="name" required value="${esc(product.name)}" placeholder="z. B. Jacobs Krönung">

      <div class="grid-2">
        <div>
          <label for="f-brand">Marke</label>
          <input id="f-brand" name="brand" value="${esc(product.brand)}">
        </div>
        <div>
          <label for="f-size">Packungsgröße</label>
          <input id="f-size" name="packageSize" value="${esc(product.packageSize)}" placeholder="z. B. 500 g">
        </div>
      </div>

      <label for="f-category">Kategorie</label>
      <select id="f-category" name="category">
        <option value="">– bitte wählen –</option>
        ${categories.map((c) => `<option ${c === product.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>

      <div class="grid-2">
        <div>
          <label for="f-qty">Übliche Menge <span class="hint">(Packungen pro Einkauf)</span></label>
          <input id="f-qty" name="usualQty" type="number" inputmode="numeric" min="1" step="1" value="${esc(product.usualQty ?? 1)}">
        </div>
        <div>
          <label for="f-limit">Schmerzgrenze <span class="hint">(€ pro Packung)</span></label>
          <input id="f-limit" name="priceLimit" inputmode="decimal" value="${esc(formatDecimal(product.priceLimit))}" placeholder="teurer kaufe ich nicht">
        </div>
      </div>

      <label for="f-ean">EAN / Barcode</label>
      <input id="f-ean" name="ean" inputmode="numeric" value="${esc(product.ean)}">

      <label for="f-notes">Notizen</label>
      <textarea id="f-notes" name="notes" placeholder="z. B. nur die ganze Bohne">${esc(product.notes)}</textarea>

      <div class="btn-row">
        <button class="btn primary" type="submit">Speichern</button>
        <a class="btn" href="#/">Abbrechen</a>
        ${isNew ? '' : '<button type="button" class="btn danger" id="delete" style="margin-left:auto">Löschen</button>'}
      </div>
    </form>`;

  const form = view.querySelector('#product-form');
  const slot = view.querySelector('#photo-slot');
  const removeBtn = view.querySelector('#photo-remove');

  const renderPhoto = () => {
    const src = photo ? objectUrl(photo) : imageUrl;
    slot.innerHTML = src
      ? `<img class="photo" src="${esc(src)}" alt="Produktbild">`
      : '<div class="photo placeholder">📦</div>';
    removeBtn.hidden = !photo;
  };
  renderPhoto();

  view.querySelector('#photo-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      photo = await shrinkImage(file);
      photoChanged = true;
      renderPhoto();
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  removeBtn.addEventListener('click', () => {
    photo = null;
    photoChanged = true;
    renderPhoto();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get('name').trim();
    if (!name) {
      toast('Bitte einen Namen eingeben', { error: true });
      form.elements.name.focus();
      return;
    }
    const priceLimit = parseDecimal(fd.get('priceLimit'));
    if (Number.isNaN(priceLimit)) {
      toast('Schmerzgrenze bitte als Betrag eingeben, z. B. 4,99', { error: true });
      form.elements.priceLimit.focus();
      return;
    }
    const ean = normalizeEan(fd.get('ean'));
    if (ean && !isValidEan(ean)) {
      toast('Die EAN ist ungültig', { error: true });
      form.elements.ean.focus();
      return;
    }
    if (ean) {
      const other = await findProductByEan(ean);
      if (other && other.id !== product.id) {
        toast(`EAN gehört schon zu „${other.name}“`, { error: true });
        return;
      }
    }

    const now = new Date().toISOString();
    // Jedes neue Foto bekommt eine neue ID, damit der Abgleich es eindeutig zuordnen kann.
    const photoId = photo ? (photoChanged || !product.photoId ? newId() : product.photoId) : undefined;
    const saved = {
      ...product,
      id: product.id || newId(),
      name,
      brand: fd.get('brand').trim(),
      packageSize: fd.get('packageSize').trim(),
      category: fd.get('category'),
      usualQty: Math.max(1, parseInt(fd.get('usualQty'), 10) || 1),
      priceLimit,
      ean: ean || undefined,
      notes: fd.get('notes').trim(),
      imageUrl,
      photo,
      photoId,
      createdAt: product.createdAt || now,
      updatedAt: now,
    };
    try {
      await saveProduct(saved);
    } catch (err) {
      toast(`Speichern fehlgeschlagen: ${err.message}`, { error: true });
      return;
    }
    if (product.photoId && product.photoId !== photoId) queuePhotoDelete(product.photoId);
    requestPersistentStorage();
    scheduleSync();
    draft = null;
    toast(isNew ? 'Zum Katalog hinzugefügt' : 'Gespeichert');
    navigate(isNew ? '#/neu' : '#/');
  });

  view.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm(`„${product.name}“ wirklich aus dem Katalog löschen?`)) return;
    await deleteProduct(product.id);
    queuePhotoDelete(product.photoId);
    scheduleSync();
    toast('Gelöscht');
    navigate('#/');
  });

  if (isNew && !product.name) form.elements.name.focus();
}

async function renderEdit(id) {
  const product = await getProduct(id);
  if (!product) {
    toast('Produkt nicht gefunden', { error: true });
    navigate('#/');
    return;
  }
  await renderForm(product, { isNew: false });
}

// ---------- Einstellungen ----------

async function renderSettings() {
  document.title = 'Einstellungen – MyEinkauf';
  const products = await getAllProducts();
  const withPhoto = products.filter((p) => p.photo instanceof Blob).length;
  const withLimit = products.filter((p) => p.priceLimit != null).length;
  let storage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    if (est) {
      storage = `${(est.usage / 1024 / 1024).toFixed(1)} MB belegt` +
        (persisted ? ' · dauerhaft gespeichert' : ' · Browser darf bei Platzmangel löschen');
    }
  } catch { /* egal */ }

  view.innerHTML = `
    <h1>Einstellungen</h1>

    <div class="card stats">
      <div><strong>${products.length}</strong><span class="muted small">Produkte</span></div>
      <div><strong>${withLimit}</strong><span class="muted small">mit Schmerzgrenze</span></div>
      <div><strong>${withPhoto}</strong><span class="muted small">mit eigenem Foto</span></div>
    </div>
    ${storage ? `<p class="muted small">${esc(storage)}</p>` : ''}

    <h2>Kategorien</h2>
    <a class="card settings-link" href="#/kategorien">
      <span><strong>Kategorien verwalten</strong><br>
        <span class="muted small">Eigene anlegen, umbenennen, sortieren, löschen</span></span>
      <span aria-hidden="true">›</span>
    </a>

    <h2>Abgleich zwischen Geräten</h2>
    <div class="card" id="sync-card">${renderSyncCard()}</div>

    <h2>Sichern und übertragen</h2>
    <div class="card">
      <p class="muted small" style="margin-top:0">Die Daten liegen nur in diesem Browser. Mit dem Export
        sicherst du den Katalog als JSON-Datei und kannst ihn auf einem anderen Gerät importieren.</p>
      <div class="btn-row">
        <button class="btn primary" id="export" ${products.length ? '' : 'disabled'}>Katalog exportieren</button>
      </div>

      <label for="import-file">Katalog importieren</label>
      <input type="file" id="import-file" accept="application/json,.json">
      <label><input type="radio" name="import-mode" value="merge" checked style="width:auto;min-height:0">
        Zusammenführen <span class="hint">(neuerer Stand gewinnt)</span></label>
      <label style="margin-top:4px"><input type="radio" name="import-mode" value="replace" style="width:auto;min-height:0">
        Katalog vollständig ersetzen</label>
      <div class="btn-row">
        <button class="btn" id="import" disabled>Importieren</button>
      </div>
    </div>

    <h2>Über</h2>
    <div class="card small">
      <p style="margin-top:0">MyEinkauf ${APP_VERSION} · Phase 1: Katalog mit Abgleich</p>
      <p class="muted">Produktdaten und Bilder: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>,
        Open Beauty Facts und Open Products Facts, Lizenz ODbL.
        Barcode-Erkennung: BarcodeDetector des Browsers bzw. <a href="https://github.com/zxing-js/browser" target="_blank" rel="noopener">ZXing</a>.</p>
    </div>`;

  bindSyncCard();

  view.querySelector('#export').addEventListener('click', async () => {
    try {
      const n = await exportCatalog();
      toast(`${n} Produkte exportiert`);
    } catch (err) {
      toast(`Export fehlgeschlagen: ${err.message}`, { error: true });
    }
  });

  const fileInput = view.querySelector('#import-file');
  const importBtn = view.querySelector('#import');
  fileInput.addEventListener('change', () => { importBtn.disabled = !fileInput.files.length; });
  importBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const mode = view.querySelector('input[name="import-mode"]:checked').value;
    if (mode === 'replace' && products.length &&
        !confirm(`Der aktuelle Katalog (${products.length} Produkte) wird vollständig ersetzt. Fortfahren?`)) {
      return;
    }
    try {
      const n = await importCatalog(file, mode);
      requestPersistentStorage();
      scheduleSync(0);
      toast(`${n} Produkte übernommen`);
      navigate('#/');
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

// ---------- Kategorien verwalten ----------

async function renderCategories() {
  document.title = 'Kategorien – MyEinkauf';
  const categories = await getCategories();
  const products = await getAllProducts();
  const counts = new Map();
  for (const p of products) counts.set(p.category, (counts.get(p.category) || 0) + 1);

  view.innerHTML = `
    <p class="small" style="margin:0 0 4px"><a href="#/einstellungen">‹ Einstellungen</a></p>
    <h1>Kategorien</h1>
    <p class="muted small">Die Reihenfolge bestimmt die Gruppierung im Katalog.
      Eine Kategorie mit „Soja“, „Pflanzlich“ oder „Vegan“ im Namen bekommt pflanzliche
      Produkte beim Scannen automatisch vorgeschlagen.</p>
    <ul class="category-list">
      ${categories.map((c, i) => `
        <li data-index="${i}">
          <span class="category-name">${esc(c)} <span class="muted small">(${counts.get(c) || 0})</span></span>
          <button class="icon-btn" data-action="up" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-action="down" aria-label="Nach unten" ${i === categories.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn" data-action="rename" aria-label="Umbenennen">✎</button>
          <button class="icon-btn danger" data-action="delete" aria-label="Löschen">✕</button>
        </li>`).join('')}
    </ul>
    <form id="category-add" class="input-row" style="margin-top:16px" autocomplete="off">
      <input id="category-new" placeholder="Neue Kategorie, z. B. Soja" aria-label="Neue Kategorie" maxlength="40">
      <button class="btn primary" type="submit">Hinzufügen</button>
    </form>`;

  const exists = (name, except) =>
    categories.some((c) => c !== except && c.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));

  const commit = async (list, message) => {
    await saveCategories(list);
    scheduleSync();
    if (message) toast(message);
    await renderCategories();
  };

  // Produkte einer Kategorie umhängen (Umbenennen) oder leeren (Löschen).
  const moveProducts = async (from, to) => {
    const now = new Date().toISOString();
    const affected = products
      .filter((p) => p.category === from)
      .map((p) => ({ ...p, category: to, updatedAt: now }));
    if (affected.length) await saveProducts(affected);
    return affected.length;
  };

  view.querySelector('#category-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = view.querySelector('#category-new').value.trim();
    if (!name) return;
    if (exists(name)) {
      toast('Diese Kategorie gibt es schon', { error: true });
      return;
    }
    await commit([...categories, name], `„${name}“ angelegt`);
  });

  view.querySelector('.category-list').addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const i = Number(button.closest('li').dataset.index);
    const name = categories[i];
    const list = [...categories];
    switch (button.dataset.action) {
      case 'up':
      case 'down': {
        const j = button.dataset.action === 'up' ? i - 1 : i + 1;
        [list[i], list[j]] = [list[j], list[i]];
        await commit(list);
        break;
      }
      case 'rename': {
        const next = prompt('Neuer Name:', name)?.trim();
        if (!next || next === name) return;
        if (exists(next, name)) {
          toast('Diese Kategorie gibt es schon', { error: true });
          return;
        }
        list[i] = next;
        const n = await moveProducts(name, next);
        await commit(list, `Umbenannt${n ? ` (${n} Produkte)` : ''}`);
        break;
      }
      case 'delete': {
        const n = counts.get(name) || 0;
        const question = n
          ? `„${name}“ löschen? ${n} Produkte stehen danach unter „${NO_CATEGORY}“.`
          : `„${name}“ löschen?`;
        if (!confirm(question)) return;
        list.splice(i, 1);
        await moveProducts(name, '');
        await commit(list, 'Gelöscht');
        break;
      }
    }
  });
}

// ---------- Abgleich (Einstellungen) ----------

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

function syncStatusText() {
  const st = getSyncStatus();
  if (st.running) return 'Gleiche ab …';
  if (st.error) return `⚠️ ${st.error}`;
  if (st.lastSync) return `✓ Zuletzt abgeglichen: ${dateTime.format(new Date(st.lastSync))}`;
  return 'Noch nicht abgeglichen.';
}

function renderSyncCard() {
  const config = getSyncConfig();
  if (config) {
    return `
      <p style="margin-top:0">Verbunden mit <strong>${esc(config.repo)}</strong>.
        Änderungen werden automatisch abgeglichen.</p>
      <p class="small" id="sync-status">${esc(syncStatusText())}</p>
      <div class="btn-row">
        <button class="btn primary" id="sync-now">Jetzt abgleichen</button>
        <button class="btn danger" id="sync-disconnect">Trennen</button>
      </div>`;
  }
  return `
    <p class="muted small" style="margin-top:0">Hält den Katalog auf PC und Handy gleich. Die Daten
      liegen in deinem privaten GitHub-Repository. Auf jedem Gerät einmal einrichten:</p>
    <ol class="small" style="padding-left:20px">
      <li><a href="${TOKEN_URL}" target="_blank" rel="noopener">Token bei GitHub erstellen</a>
        (Fine-grained token):
        <ul>
          <li>Name z. B. „MyEinkauf“, Ablauf nach Wunsch (max. 1 Jahr)</li>
          <li><em>Repository access:</em> „Only select repositories“ → <strong>MyEinkauf-daten</strong></li>
          <li><em>Permissions → Repository permissions:</em> <strong>Contents: Read and write</strong></li>
        </ul>
      </li>
      <li>Token kopieren und hier einfügen. Er wird nur auf diesem Gerät gespeichert.</li>
    </ol>
    <form id="sync-form" autocomplete="off">
      <label for="sync-repo">Repository</label>
      <input id="sync-repo" value="${esc(DEFAULT_REPO)}" spellcheck="false" autocapitalize="off">
      <label for="sync-token">Token</label>
      <input id="sync-token" type="password" placeholder="github_pat_…" spellcheck="false" autocapitalize="off">
      <div class="btn-row">
        <button class="btn primary" type="submit">Verbinden und abgleichen</button>
      </div>
    </form>`;
}

function bindSyncCard() {
  const card = view.querySelector('#sync-card');
  const rerender = () => {
    card.innerHTML = renderSyncCard();
    bindSyncCard();
  };

  const onStatus = () => {
    const el = view.querySelector('#sync-status');
    if (el) el.textContent = syncStatusText();
  };
  window.addEventListener('myeinkauf:sync-status', onStatus);
  cleanups.push(() => window.removeEventListener('myeinkauf:sync-status', onStatus));

  card.querySelector('#sync-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.submitter || card.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await connect(card.querySelector('#sync-repo').value, card.querySelector('#sync-token').value);
      rerender();
      const result = await syncNow();
      toast(`Verbunden – ${result.received} Änderungen übernommen`);
    } catch (err) {
      toast(err.message, { error: true });
      button.disabled = false;
    }
  });

  card.querySelector('#sync-now')?.addEventListener('click', async () => {
    try {
      const result = await syncNow();
      toast(result.received ? `${result.received} Änderungen übernommen` : 'Alles aktuell');
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  card.querySelector('#sync-disconnect')?.addEventListener('click', () => {
    if (!confirm('Abgleich auf diesem Gerät beenden? Der Katalog bleibt auf dem Gerät erhalten, der Token wird entfernt.')) return;
    disconnect();
    rerender();
  });
}

// ---------- Router ----------

async function route({ keepScroll = false } = {}) {
  cleanups.forEach((fn) => { try { fn(); } catch { /* weiter */ } });
  cleanups = [];
  const scrollY = window.scrollY;

  const path = location.hash.replace(/^#/, '') || '/';
  try {
    if (path === '/') await renderCatalog();
    else if (path === '/neu') renderAdd();
    else if (path === '/neu/formular') {
      if (!draft) return navigate('#/neu');
      await renderForm({ usualQty: 1, ...draft }, { isNew: true });
    } else if (path.startsWith('/produkt/')) await renderEdit(decodeURIComponent(path.slice(9)));
    else if (path === '/einstellungen') await renderSettings();
    else if (path === '/kategorien') await renderCategories();
    else navigate('#/');
    window.scrollTo(0, keepScroll ? scrollY : 0);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><h1>Fehler</h1><p>${esc(err.message)}</p>
      <a class="btn" href="#/">Zum Katalog</a></div>`;
  }
}

window.addEventListener('hashchange', route);
route();

// ---------- Automatischer Abgleich ----------

// Nach eingehenden Änderungen Liste bzw. Einstellungen neu zeichnen, aber nie ein offenes Formular.
window.addEventListener('myeinkauf:synced', () => {
  const path = location.hash.replace(/^#/, '') || '/';
  if (['/', '/einstellungen', '/kategorien'].includes(path)) route({ keepScroll: true });
});

let lastAutoSync = 0;
function autoSync() {
  if (!getSyncConfig() || Date.now() - lastAutoSync < 30_000) return;
  lastAutoSync = Date.now();
  syncNow().catch((err) => console.warn('Abgleich:', err.message));
}
autoSync();
window.addEventListener('online', autoSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') autoSync();
});

// ---------- Offline-Fähigkeit ----------

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Neue Version verfügbar – hier tippen zum Neuladen', { action: () => location.reload() });
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker:', err));
  });
}
