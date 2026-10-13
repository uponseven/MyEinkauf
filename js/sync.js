// Abgleich des Katalogs zwischen Geräten über ein privates GitHub-Repository.
//
// Aufbau im Daten-Repository:
//   katalog/produkte.json   alle Produkte ohne Fotos, inkl. Lösch-Markierungen
//   fotos/<photoId>.jpg     eigene Fotos; eine photoId wird nie wiederverwendet
//   Einstellungen (Kategorien, Lieblingsfilialen, Ketten, Zuhause) stehen mit in produkte.json,
//   jeweils als Ganzes, neuerer Stand gewinnt.
//
// Zusammenführen: pro Produkt gewinnt der neuere Stand (updatedAt).
// Gelöschte Produkte bleiben als {id, deleted: true, updatedAt} erhalten,
// damit die Löschung auf allen Geräten ankommt.

import { getAllProducts, saveProducts, getSetting, saveSetting, SYNCED_SETTINGS } from './db.js';

const CONFIG_KEY = 'myeinkauf-sync';
const STATUS_KEY = 'myeinkauf-sync-status';
const PHOTO_DELETES_KEY = 'myeinkauf-photo-deletes';
const CATALOG_PATH = 'katalog/produkte.json';
const PHOTO_DIR = 'fotos';
const API = 'https://api.github.com';

export const DEFAULT_REPO = 'uponseven/MyEinkauf-daten';

// ---------- Einstellungen und Status (pro Gerät im Browser) ----------

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Speicher nicht verfügbar (z. B. privates Fenster): Abgleich bleibt dann aus.
  }
}

export function getSyncConfig() {
  const c = readJson(CONFIG_KEY, null);
  return c?.repo && c?.token ? c : null;
}

export function getSyncStatus() {
  return readJson(STATUS_KEY, {});
}

function setStatus(patch) {
  const status = { ...getSyncStatus(), ...patch };
  writeJson(STATUS_KEY, status);
  window.dispatchEvent(new CustomEvent('myeinkauf:sync-status', { detail: status }));
}

// Fotos, die nach Ersetzen oder Löschen im Repository entfernt werden sollen.
export function queuePhotoDelete(photoId) {
  if (!photoId) return;
  const list = readJson(PHOTO_DELETES_KEY, []);
  if (!list.includes(photoId)) writeJson(PHOTO_DELETES_KEY, [...list, photoId]);
}

// ---------- GitHub-API ----------

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function gh(config, method, path, { body, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    cache: 'no-store', // sonst liefert der Browser veraltete Stände (und alte sha)
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* egal */ }
    throw new GitHubError(res.status, describeHttpError(res.status, detail));
  }
  if (raw) return res.blob();
  return res.status === 204 ? null : res.json();
}

function describeHttpError(status, detail) {
  switch (status) {
    case 401: return 'Token ungültig oder abgelaufen.';
    case 403: return detail.includes('rate limit')
      ? 'GitHub-Anfragelimit erreicht, später erneut versuchen.'
      : 'Token hat keine Schreibrechte für das Repository (Contents: Read and write).';
    case 404: return 'Repository nicht gefunden oder Token hat keinen Zugriff darauf.';
    case 409: return 'Gleichzeitige Änderung von einem anderen Gerät.';
    default: return `GitHub-Fehler ${status}${detail ? `: ${detail}` : ''}`;
  }
}

const repoPath = (config, path = '') =>
  `/repos/${config.repo}${path ? `/contents/${path}` : ''}`;

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Browser';
}

// ---------- Verbinden ----------

/**
 * Prüft Repository und Token und speichert sie auf diesem Gerät.
 * Wirft mit verständlicher Meldung, wenn etwas nicht passt.
 */
export async function connect(repo, token) {
  repo = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
  token = token.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository bitte als „besitzer/name“ angeben.');
  if (!token) throw new Error('Bitte den Token eintragen.');
  const config = { repo, token };
  const info = await gh(config, 'GET', repoPath(config));
  if (!info) throw new Error(describeHttpError(404));
  if (!info.private) {
    throw new Error('Das Repository ist öffentlich. Für deine Daten bitte ein privates Repository verwenden.');
  }
  if (info.permissions && !info.permissions.push) {
    throw new Error(describeHttpError(403, ''));
  }
  writeJson(CONFIG_KEY, config);
  setStatus({ error: null });
  return config;
}

export function disconnect() {
  writeJson(CONFIG_KEY, null);
  writeJson(STATUS_KEY, null);
}

// ---------- Abgleich ----------

const stripPhoto = ({ photo, ...rest }) => rest;
const newer = (a, b) => (a.updatedAt || '') > (b.updatedAt || '');
const newId = () => crypto.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function serializeCatalog(products, settings) {
  const sorted = [...products].sort((a, b) => a.id.localeCompare(b.id)).map(stripPhoto);
  const data = { format: 'myeinkauf-sync', version: 1, products: sorted };
  for (const [key, { key: _, ...value }] of Object.entries(settings)) data[key] = value;
  return `${JSON.stringify(data, null, 1)}\n`;
}

async function syncOnce(config) {
  const label = deviceLabel();

  // 1. Stand im Repository und lokal holen.
  const remoteFile = await gh(config, 'GET', repoPath(config, CATALOG_PATH));
  const remoteText = remoteFile ? base64ToUtf8(remoteFile.content) : '';
  const remoteData = remoteText ? JSON.parse(remoteText) : {};
  const remoteProducts = remoteData.products || [];
  const local = await getAllProducts({ includeDeleted: true });
  const localById = new Map(local.map((p) => [p.id, p]));

  // Alte Produkte mit Foto, aber ohne photoId (vor dem Abgleich angelegt).
  const localUpdates = [];
  let received = 0;
  for (const p of local) {
    if (p.photo instanceof Blob && !p.photoId) {
      p.photoId = newId();
      p.updatedAt = new Date().toISOString();
      localUpdates.push(p);
    }
  }

  // 2. Zusammenführen: der neuere Stand gewinnt.
  const merged = new Map(local.map((p) => [p.id, p]));
  for (const r of remoteProducts) {
    const l = localById.get(r.id);
    if (!l || newer(r, l)) {
      const keepPhoto = l?.photo instanceof Blob && l.photoId && l.photoId === r.photoId;
      const next = { ...r, photo: keepPhoto ? l.photo : null };
      merged.set(r.id, next);
      localUpdates.push(next);
      received++;
    }
  }

  // 3. Fotos abgleichen: fehlende hochladen, fremde herunterladen.
  const remoteDir = (await gh(config, 'GET', repoPath(config, PHOTO_DIR))) || [];
  const remotePhotos = new Map(
    (Array.isArray(remoteDir) ? remoteDir : [])
      .filter((f) => f.type === 'file')
      .map((f) => [f.name.replace(/\.jpg$/, ''), f.sha]),
  );
  for (const p of merged.values()) {
    if (p.deleted || !p.photoId) continue;
    const path = `${PHOTO_DIR}/${p.photoId}.jpg`;
    if (p.photo instanceof Blob && !remotePhotos.has(p.photoId)) {
      try {
        const res = await gh(config, 'PUT', repoPath(config, path), {
          body: { message: `Foto ${p.name || p.id} (${label})`, content: await blobToBase64(p.photo) },
        });
        remotePhotos.set(p.photoId, res?.content?.sha);
      } catch (err) {
        // 422: Datei existiert bereits (paralleler Upload) – kein Problem.
        if (err.status !== 422) throw err;
      }
    } else if (!(p.photo instanceof Blob) && remotePhotos.has(p.photoId)) {
      p.photo = await gh(config, 'GET', repoPath(config, path), { raw: true });
      if (!localUpdates.includes(p)) { localUpdates.push(p); received++; }
    }
  }

  // Einstellungen (Kategorien, Lieblingsfilialen, ...): jeweils als Ganzes, neuerer Stand gewinnt.
  const settings = {};
  for (const key of SYNCED_SETTINGS) {
    let setting = await getSetting(key);
    const remote = remoteData[key];
    if (remote?.updatedAt && (!setting || newer(remote, setting))) {
      setting = { ...remote, key };
      await saveSetting(setting);
      received++;
    }
    if (setting) settings[key] = setting;
  }

  // 4. Lokal übernehmen.
  if (localUpdates.length) await saveProducts(localUpdates);

  // 5. Katalog ins Repository schreiben, falls sich etwas geändert hat.
  //    Bei gleichzeitiger Änderung (409) wirft das und der Aufrufer versucht es erneut.
  const mergedText = serializeCatalog([...merged.values()], settings);
  let pushed = false;
  if (mergedText !== remoteText) {
    await gh(config, 'PUT', repoPath(config, CATALOG_PATH), {
      body: {
        message: `Katalog abgeglichen (${label})`,
        content: utf8ToBase64(mergedText),
        ...(remoteFile ? { sha: remoteFile.sha } : {}),
      },
    });
    pushed = true;
  }

  // 6. Ersetzte oder gelöschte Fotos entfernen (auch die von anderen Geräten gelöschter Produkte).
  const stillUsed = new Set([...merged.values()].filter((p) => !p.deleted).map((p) => p.photoId));
  const candidates = new Set([
    ...readJson(PHOTO_DELETES_KEY, []),
    ...[...merged.values()].filter((p) => p.deleted && p.photoId).map((p) => p.photoId),
  ]);
  const remaining = [];
  for (const photoId of candidates) {
    if (stillUsed.has(photoId)) continue;
    const sha = remotePhotos.get(photoId);
    if (!sha) continue;
    try {
      await gh(config, 'DELETE', repoPath(config, `${PHOTO_DIR}/${photoId}.jpg`), {
        body: { message: `Altes Foto entfernt (${label})`, sha },
      });
    } catch (err) {
      if (err.status !== 404 && err.status !== 422) remaining.push(photoId);
    }
  }
  writeJson(PHOTO_DELETES_KEY, remaining);

  return { received, pushed };
}

let running = null;
let rerun = false;

/**
 * Führt einen Abgleich aus (oder hängt sich an einen laufenden an).
 * @returns {Promise<{received: number, pushed: boolean} | null>} null, wenn nicht eingerichtet
 */
export function syncNow() {
  const config = getSyncConfig();
  if (!config) return Promise.resolve(null);
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    setStatus({ running: true });
    let total = { received: 0, pushed: false };
    try {
      do {
        rerun = false;
        let result;
        for (let attempt = 1; ; attempt++) {
          try {
            result = await syncOnce(config);
            break;
          } catch (err) {
            if (!(err instanceof GitHubError && err.status === 409) || attempt >= 3) throw err;
          }
        }
        total = { received: total.received + result.received, pushed: total.pushed || result.pushed };
      } while (rerun);
      setStatus({ running: false, lastSync: new Date().toISOString(), error: null });
      if (total.received) window.dispatchEvent(new CustomEvent('myeinkauf:synced', { detail: total }));
      return total;
    } catch (err) {
      const message = err instanceof TypeError ? 'Keine Verbindung zu GitHub (offline?)' : err.message;
      setStatus({ running: false, error: message });
      throw new Error(message);
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer;
// Abgleich kurz nach einer Änderung, mehrere Änderungen werden gebündelt.
export function scheduleSync(delay = 2000) {
  if (!getSyncConfig()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), delay);
}
