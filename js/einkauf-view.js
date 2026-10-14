// Ansicht „Einkauf“: Bring!-Liste holen und Einträge Katalogprodukten zuordnen.
// (Phase 4, Schritt 1 – es wird noch nichts nach Bring! zurückgeschrieben.)

import { getAllProducts, getSetting, saveSetting } from './db.js';
import { resolveItems, suggestProducts } from './bring.js';
import { getSyncConfig, syncNow, writeRepoFile } from './sync.js';
import { CHAIN_BY_KEY, getSelectedChains } from './markets.js';
import { normalPrice, offerPackPrice } from './pricing.js';

const PENDING_KEY = 'myeinkauf-bring-pending';
const POLL_MS = 10_000;
const TIMEOUT_MS = 4 * 60_000;
const SECRETS_URL = 'https://github.com/uponseven/MyEinkauf-daten/settings/secrets/actions/new';

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const stampFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)); } catch { return null; }
}
function writePending(value) {
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* egal */ }
}

// Günstigstes bestätigtes, gültiges Angebot je Produkt, umgerechnet auf die eigene Packung.
function bestOffers(offersCache, decisions, chains, byId) {
  const now = new Date();
  const best = new Map();
  for (const m of offersCache?.matches || []) {
    const product = byId.get(m.productId);
    if (!product || decisions[m.key] !== 'yes' || !chains.has(m.chain)) continue;
    if (m.validTo && new Date(m.validTo) < now) continue;
    const price = offerPackPrice(product, m);
    if (price == null) continue;
    if (!best.has(m.productId) || price < best.get(m.productId).effective) best.set(m.productId, { ...m, effective: price });
  }
  return best;
}

/**
 * @param {object} ctx  { view, esc, toast, scheduleSync, rerender, onCleanup }
 */
export async function renderEinkauf({ view, esc, toast, scheduleSync, rerender, onCleanup }) {
  document.title = 'Einkauf – MyEinkauf';

  if (!getSyncConfig()) {
    view.innerHTML = `
      <h1>Einkauf</h1>
      <div class="card">
        <p style="margin-top:0">Die Bring!-Liste wird über dein privates Daten-Repository geholt.
          Richte dafür auf diesem Gerät zuerst den Abgleich ein.</p>
        <a class="btn primary" href="#/einstellungen">Zu den Einstellungen</a>
      </div>`;
    return;
  }

  const [products, cache, mappingSetting, offersCache, decisionsSetting, prices, history, chains] = await Promise.all([
    getAllProducts(),
    getSetting('bring-cache'),
    getSetting('bringMapping'),
    getSetting('offers-cache'),
    getSetting('offerDecisions'),
    getSetting('prices-cache'),
    getSetting('history-cache'),
    getSelectedChains(),
  ]);
  const mapping = { ...(mappingSetting?.map || {}) };
  const decisions = decisionsSetting?.map || {};
  const byId = new Map(products.map((p) => [p.id, p]));
  const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // Läuft gerade eine Anfrage? Erledigt, sobald liste.json zu dieser Anfrage passt.
  let pending = readPending();
  if (pending && cache?.requestedAt === pending.requestedAt) {
    writePending(null);
    pending = null;
  }

  const items = resolveItems(cache?.items || [], mapping, products);
  const open = items.filter((i) => i.status === 'open');
  const done = items.filter((i) => i.status !== 'open');
  const offers = bestOffers(offersCache, decisions, chains, byId);
  const missingAccess = cache?.error?.includes('Zugang fehlt') || cache?.error?.includes('Anmeldung fehlgeschlagen');

  const badge = (chainKey) => {
    const c = CHAIN_BY_KEY[chainKey];
    return c ? `<span class="chain-badge" style="background:${c.color};color:${c.text || '#fff'}">${esc(c.label)}</span>` : '';
  };

  const setupHelp = `
    <details class="setup-help" ${!cache || missingAccess ? 'open' : ''}>
      <summary class="small"><strong>Bring!-Zugang einrichten</strong> (einmalig)</summary>
      <ol class="small">
        <li>Öffne <a href="${SECRETS_URL}" target="_blank" rel="noopener">GitHub → MyEinkauf-daten → Secrets</a>.</li>
        <li>Name <code>BRING_EMAIL</code>, als Wert deine Bring!-E-Mail → „Add secret“.</li>
        <li>Nochmal „New repository secret“: Name <code>BRING_PASSWORD</code>, Wert dein Bring!-Passwort.</li>
        <li>Hier auf „Bring!-Liste holen“ tippen.</li>
      </ol>
      <p class="muted small">Meldest du dich bei Bring! mit Google oder Apple an, lege in der Bring!-App unter
        Einstellungen → Konto zuerst ein Passwort fest. Die Zugangsdaten liegen nur verschlüsselt bei GitHub,
        nicht in der App und nicht im Code.</p>
    </details>`;

  const listName = cache?.lists?.find((l) => l.uuid === cache.listUuid)?.name;
  const statusHtml = pending
    ? '<p class="small"><span class="spinner-inline"></span> Liste wird geholt … das dauert etwa eine Minute.</p>'
    : cache
      ? `<p class="muted small">Stand ${esc(stampFmt.format(new Date(cache.fetchedAt)))}${listName ? ` · Liste „${esc(listName)}“` : ''} · ${items.length} Einträge</p>`
      : '<p class="muted small">Noch nicht abgerufen.</p>';

  const priceText = (product) => {
    const offer = offers.get(product.id);
    if (offer) {
      return `${badge(offer.chain)} <span class="hint-good">Angebot ${euro.format(offer.effective)}</span>`;
    }
    const normal = normalPrice(product, { prices, history: history?.entries || [], decisions });
    return normal ? `<span class="muted">ca. ${euro.format(normal.value)}</span>` : '';
  };

  const optionList = (item) => {
    const suggestions = suggestProducts(item, products);
    const suggestedIds = new Set(suggestions.map((s) => s.product.id));
    return `
      <option value="">– zuordnen –</option>
      ${suggestions.length ? `<optgroup label="Vorschläge">${suggestions.map((s) =>
        `<option value="${esc(s.product.id)}">${esc(s.product.name)}${s.product.brand ? ` (${esc(s.product.brand)})` : ''}</option>`).join('')}</optgroup>` : ''}
      <optgroup label="Alle Produkte">${sortedProducts.filter((p) => !suggestedIds.has(p.id)).map((p) =>
        `<option value="${esc(p.id)}">${esc(p.name)}${p.brand ? ` (${esc(p.brand)})` : ''}</option>`).join('')}</optgroup>
      <option value="none">Nicht im Katalog – egal welcher Markt</option>`;
  };

  view.innerHTML = `
    <h1>Einkauf</h1>
    <div class="card">
      <div class="input-row" style="align-items:center">
        ${cache?.lists?.length > 1 ? `
          <select id="bring-list" aria-label="Bring!-Liste" style="flex:1">
            ${cache.lists.map((l) => `<option value="${esc(l.uuid)}" ${l.uuid === cache.listUuid ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
          </select>` : '<span style="flex:1"><strong>Bring!-Liste</strong></span>'}
        <button class="btn primary" id="bring-fetch" ${pending ? 'disabled' : ''}>Bring!-Liste holen</button>
      </div>
      ${statusHtml}
      ${cache?.error ? `<p class="small hint-warn">⚠️ ${esc(cache.error)}</p>` : ''}
      ${setupHelp}
    </div>

    ${open.length ? `
      <h2>Zuordnen <span class="muted small">(${open.length})</span></h2>
      <p class="muted small">Welches deiner Produkte meinst du mit dem Bring!-Eintrag? Das merkt sich die App für die Zukunft.</p>
      <ul class="bring-list">
        ${open.map((item) => `
          <li class="bring-item" data-key="${esc(item.key)}">
            <span class="bring-name"><strong>${esc(item.name)}</strong>${item.specification ? ` <span class="muted">${esc(item.specification)}</span>` : ''}</span>
            <select class="bring-map" aria-label="Produkt für ${esc(item.name)}">${optionList(item)}</select>
          </li>`).join('')}
      </ul>` : ''}

    ${done.length ? `
      <h2>Deine Einkaufsliste <span class="muted small">(${done.length})</span></h2>
      <ul class="bring-list">
        ${done.map((item) => {
          const product = item.productId ? byId.get(item.productId) : null;
          return `
          <li class="bring-item done" data-key="${esc(item.key)}">
            <span class="bring-name">
              <strong>${esc(item.name)}</strong>${item.specification ? ` <span class="muted">${esc(item.specification)}</span>` : ''}
              <span class="small muted bring-target">→ ${product ? `${esc(product.name)}${product.packageSize ? ` · ${esc(product.packageSize)}` : ''}` : 'nicht im Katalog, egal welcher Markt'}</span>
            </span>
            <span class="bring-price small">${product ? priceText(product) : ''}</span>
            <button class="link-btn small" data-reset>ändern</button>
          </li>`;
        }).join('')}
      </ul>
      <p class="muted small">Als Nächstes (Schritt 2): Einkauf für 1, 2 oder 3 Märkte durchrechnen.</p>` : ''}

    ${cache && !items.length && !cache.error ? '<p class="muted">Deine Bring!-Liste ist leer.</p>' : ''}`;

  // ---------- Aktionen ----------

  const saveMapping = async () => {
    await saveSetting({ key: 'bringMapping', map: mapping, updatedAt: new Date().toISOString() });
    scheduleSync();
    rerender();
  };

  view.querySelectorAll('.bring-map').forEach((select) => {
    select.addEventListener('change', async () => {
      if (!select.value) return;
      mapping[select.closest('.bring-item').dataset.key] = select.value;
      await saveMapping();
    });
  });
  view.querySelectorAll('[data-reset]').forEach((button) => {
    button.addEventListener('click', async () => {
      delete mapping[button.closest('.bring-item').dataset.key];
      await saveMapping();
    });
  });

  view.querySelector('#bring-fetch').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const requestedAt = new Date().toISOString();
    const listUuid = view.querySelector('#bring-list')?.value || cache?.listUuid || null;
    try {
      await writeRepoFile('bring/anfrage.json', { requestedAt, listUuid, action: 'lesen' }, 'Bring!-Liste anfordern');
      writePending({ requestedAt, startedAt: Date.now() });
      rerender();
    } catch (err) {
      toast(err.message, { error: true });
      e.target.disabled = false;
    }
  });

  // Während eine Anfrage läuft, regelmäßig nachsehen, ob die Liste da ist.
  if (pending) {
    const timer = setInterval(async () => {
      if (Date.now() - pending.startedAt > TIMEOUT_MS) {
        clearInterval(timer);
        writePending(null);
        toast('Bring! antwortet nicht – bitte später nochmal versuchen.', { error: true });
        rerender();
        return;
      }
      try {
        await syncNow();
      } catch { /* nächster Versuch */ }
      const latest = await getSetting('bring-cache');
      if (latest?.requestedAt === pending.requestedAt) {
        clearInterval(timer);
        writePending(null);
        if (!latest.error) toast(`${latest.items.length} Einträge aus Bring! geholt`);
        rerender();
      }
    }, POLL_MS);
    onCleanup(() => clearInterval(timer));
  }
}
