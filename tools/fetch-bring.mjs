// Liest die Bring!-Einkaufsliste und schreibt sie nach bring/liste.json ins Daten-Repository.
// Läuft per GitHub Actions im Repo MyEinkauf-daten (siehe tools/bring-workflow.yml).
// Zugangsdaten nur aus Umgebungsvariablen (GitHub-Secrets), nie aus Dateien:
//
//   BRING_EMAIL=... BRING_PASSWORD=... node tools/fetch-bring.mjs <pfad-zum-daten-repo>
//
// Bring! hat keine offizielle Schnittstelle; das hier nutzt dieselbe wie die Web-App.
// Es wird nur gelesen, nichts an der Liste verändert.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseBringList } from '../js/bring.js';

const API = 'https://api.getbring.com/rest';
// Öffentlicher Schlüssel der Bring!-Web-App (steht in deren Quelltext).
const API_KEY = 'cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp';

const [dataDir] = process.argv.slice(2);
if (!dataDir) {
  console.error('Aufruf: node tools/fetch-bring.mjs <pfad-zum-daten-repo>');
  process.exit(1);
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function headers(session) {
  return {
    'X-BRING-API-KEY': API_KEY,
    'X-BRING-CLIENT': 'webApp',
    'X-BRING-APPLICATION': 'bring',
    'X-BRING-COUNTRY': 'DE',
    ...(session ? { Authorization: `Bearer ${session.access_token}`, 'X-BRING-USER-UUID': session.uuid } : {}),
  };
}

async function login(email, password) {
  const res = await fetch(`${API}/v2/bringauth`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
  });
  if (res.status === 401 || res.status === 404) {
    throw new Error('Bring!-Anmeldung fehlgeschlagen: E-Mail oder Passwort stimmen nicht.');
  }
  if (!res.ok) throw new Error(`Bring!-Anmeldung: HTTP ${res.status}`);
  return res.json();
}

async function getJson(session, url) {
  const res = await fetch(url, { headers: headers(session) });
  if (!res.ok) throw new Error(`Bring!: HTTP ${res.status} bei ${new URL(url).pathname.replace(/[0-9a-f-]{36}/g, '…')}`);
  return res.json();
}

const outFile = path.join(dataDir, 'bring/liste.json');
const request = await readJson(path.join(dataDir, 'bring/anfrage.json'), {});
const previous = await readJson(outFile, {});

async function save(data) {
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify({
    format: 'myeinkauf-bring',
    version: 1,
    fetchedAt: new Date().toISOString(),
    requestedAt: request.requestedAt || null,
    ...data,
  }, null, 1)}\n`);
}

const email = process.env.BRING_EMAIL;
const password = process.env.BRING_PASSWORD;
if (!email || !password) {
  await save({
    error: 'Bring!-Zugang fehlt: bitte BRING_EMAIL und BRING_PASSWORD als Secrets im Daten-Repository anlegen.',
    lists: previous.lists || [],
    items: previous.items || [],
  });
  console.error('BRING_EMAIL/BRING_PASSWORD fehlen.');
  process.exit(0); // Fehler steht in liste.json, die App zeigt ihn an
}

try {
  const session = await login(email, password);
  const { lists = [] } = await getJson(session, `${API}/bringusers/${session.uuid}/lists`);
  const listUuid = lists.some((l) => l.listUuid === request.listUuid)
    ? request.listUuid
    : session.bringListUUID || lists[0]?.listUuid;
  if (!listUuid) throw new Error('Keine Bring!-Liste gefunden.');
  const list = await getJson(session, `${API}/v2/bringlists/${listUuid}`);
  const items = parseBringList(list);
  await save({
    error: null,
    user: session.name || '',
    lists: lists.map((l) => ({ uuid: l.listUuid, name: l.name })),
    listUuid,
    items,
  });
  console.log(`${items.length} Einträge aus „${lists.find((l) => l.listUuid === listUuid)?.name || 'Liste'}“ gelesen.`);
} catch (err) {
  // Nie Zugangsdaten ausgeben; nur die Meldung.
  await save({ error: err.message, lists: previous.lists || [], listUuid: previous.listUuid, items: previous.items || [] });
  console.error(err.message);
}
