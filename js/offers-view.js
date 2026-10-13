// Ansicht „Angebote“: gefundene Prospekt-Angebote für Katalogprodukte, bestätigen oder verwerfen.

import { getAllProducts, getSetting, saveSetting } from './db.js';
import { CHAIN_BY_KEY, getFavoriteMarkets, getSelectedChains, loadMarkets } from './markets.js';
import { parsePackageSize, sizeDiffers } from './offers.js';
import { getSyncConfig, syncNow } from './sync.js';

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const stampFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Hinweise auf Coupons, die sich nicht automatisch einlösen lassen (siehe CLAUDE.md).
const COUPON_APPS = { rewe: 'REWE-App', lidl: 'Lidl Plus', penny: 'Penny-App', dm: 'dm-App', kaufland: 'Kaufland Card' };

async function loadState() {
  const [products, cache, decisionsSetting, chains] = await Promise.all([
    getAllProducts(),
    getSetting('offers-cache'),
    getSetting('offerDecisions'),
    getSelectedChains(),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const decisions = { ...(decisionsSetting?.map || {}) };
  const now = new Date();
  const matches = (cache?.matches || []).filter((m) =>
    byId.has(m.productId) &&
    chains.has(m.chain) &&
    (!m.validTo || new Date(m.validTo) >= now));
  return { byId, cache, decisions, matches };
}

/** Anzahl für das Abzeichen am Reiter: zu prüfende plus bestätigte Angebote. */
export async function offerBadgeCount() {
  const { matches, decisions } = await loadState();
  return matches.filter((m) => decisions[m.key] !== 'no').length;
}

/**
 * @param {object} ctx  { view, esc, toast, scheduleSync, rerender }
 */
export async function renderOffers({ view, esc, toast, scheduleSync, rerender }) {
  document.title = 'Angebote – MyEinkauf';

  if (!getSyncConfig()) {
    view.innerHTML = `
      <h1>Angebote</h1>
      <div class="card">
        <p style="margin-top:0">Die Angebote werden täglich und nach jeder Katalogänderung bei GitHub für deinen Katalog gesucht und
          über den Abgleich in die App geholt.</p>
        <p class="muted small">Richte dafür auf diesem Gerät den Abgleich ein.</p>
        <a class="btn primary" href="#/einstellungen">Zu den Einstellungen</a>
      </div>`;
    return;
  }

  const { byId, cache, decisions, matches } = await loadState();

  if (!cache) {
    view.innerHTML = `
      <h1>Angebote</h1>
      <div class="card">
        <p style="margin-top:0">Noch keine Angebote abgerufen. Der erste Abruf startet automatisch nach einer
          Katalogänderung und dauert ein paar Minuten.</p>
        <button class="btn primary" id="sync">Jetzt nachsehen</button>
      </div>`;
    view.querySelector('#sync').addEventListener('click', async () => {
      try {
        await syncNow();
        rerender();
      } catch (err) {
        toast(err.message, { error: true });
      }
    });
    return;
  }

  // Ketten mit Lieblingsfiliale hervorheben.
  const favorites = await getFavoriteMarkets();
  const { markets } = await loadMarkets();
  const favoriteChains = new Set(markets.filter((m) => favorites.has(m.id)).map((m) => m.chain));

  const confirmed = matches.filter((m) => decisions[m.key] === 'yes');
  const review = matches.filter((m) => !decisions[m.key]);
  const rejected = matches.filter((m) => decisions[m.key] === 'no');

  const badge = (chainKey) => {
    const c = CHAIN_BY_KEY[chainKey];
    return c ? `<span class="chain-badge" style="background:${c.color};color:${c.text || '#fff'}">${esc(c.label)}</span>` : '';
  };

  const priceHints = (m, product) => {
    const hints = [];
    const effective = m.reweBonus ? m.price - m.reweBonus : null;
    if (effective != null) hints.push(`<span class="hint-good">mit REWE Bonus effektiv ${euro.format(effective)}</span>`);
    if (m.loyalty) hints.push('<span class="hint-warn">nur mit Kundenkarte/App</span>');
    const otherSize = sizeDiffers(product, m);
    if (otherSize) hints.push(`<span class="hint-warn">andere Größe als deine Packung (${esc(product.packageSize)})</span>`);
    if (product.priceLimit != null && m.price != null) {
      let ok;
      let note = '';
      const own = parsePackageSize(product.packageSize);
      if (otherSize && own && m.referencePrice != null) {
        ok = m.referencePrice <= product.priceLimit / own.amount;
        note = ' (umgerechnet auf den Grundpreis)';
      } else {
        ok = (effective ?? m.price) <= product.priceLimit;
      }
      hints.push(ok
        ? `<span class="hint-good">✓ unter deiner Schmerzgrenze ${euro.format(product.priceLimit)}${note}</span>`
        : `<span class="hint-warn">über deiner Schmerzgrenze ${euro.format(product.priceLimit)}${note}</span>`);
    }
    return hints.join('');
  };

  const offerCard = (m, mode) => {
    const product = byId.get(m.productId);
    const unitPrice = m.referencePrice != null && m.unit ? `${euro.format(m.referencePrice)}/${esc(m.unit)}` : '';
    return `
      <li class="offer" data-key="${esc(m.key)}">
        ${m.image ? `<img class="offer-img" src="${esc(m.image)}" alt="" loading="lazy">` : '<span class="offer-img placeholder">🏷️</span>'}
        <div class="offer-body">
          <div class="offer-head">
            ${badge(m.chain)} <strong>${esc(m.retailer)}</strong>
            ${favoriteChains.has(m.chain) ? '<span class="fav-mark" title="Du hast hier eine Lieblingsfiliale">★</span>' : ''}
            <span class="muted small">${m.validTo ? `bis ${esc(dayFmt.format(new Date(m.validTo)))}` : ''}</span>
          </div>
          <div class="offer-title">${esc([m.brand, m.title].filter(Boolean).join(' '))}</div>
          ${m.description ? `<div class="muted small offer-desc">${esc(m.description)}</div>` : ''}
          <div class="offer-price">
            <strong>${m.price != null ? euro.format(m.price) : '–'}</strong>
            ${m.oldPrice ? `<s class="muted">${euro.format(m.oldPrice)}</s>` : ''}
            ${unitPrice ? `<span class="muted small">(${unitPrice})</span>` : ''}
          </div>
          <div class="offer-hints">${priceHints(m, product)}</div>
          ${mode === 'review' ? `
            <div class="offer-for small">Für: <strong>${esc(product.name)}</strong>${product.packageSize ? ` · ${esc(product.packageSize)}` : ''}</div>
            <div class="btn-row" style="margin-top:8px">
              <button class="btn primary small-btn" data-decide="yes">✓ Passt</button>
              <button class="btn small-btn" data-decide="no">✕ Passt nicht</button>
            </div>` : ''}
          ${mode === 'confirmed' ? '<button class="link-btn small" data-decide="reset">nicht passend?</button>' : ''}
          ${mode === 'rejected' ? `
            <div class="offer-for small">Für: ${esc(product.name)}</div>
            <button class="link-btn small" data-decide="reset">doch prüfen</button>` : ''}
        </div>
      </li>`;
  };

  // Bestätigte Angebote nach Produkt gruppieren, günstigstes zuerst.
  const effectivePrice = (m) => (m.price ?? Infinity) - (m.reweBonus || 0);
  const groups = new Map();
  for (const m of confirmed) {
    if (!groups.has(m.productId)) groups.set(m.productId, []);
    groups.get(m.productId).push(m);
  }
  const confirmedHtml = [...groups.entries()]
    .sort(([a], [b]) => byId.get(a).name.localeCompare(byId.get(b).name, 'de'))
    .map(([productId, list]) => {
      const p = byId.get(productId);
      list.sort((a, b) => effectivePrice(a) - effectivePrice(b));
      return `
        <div class="group-title">${esc(p.name)}${p.packageSize ? ` · ${esc(p.packageSize)}` : ''}</div>
        <ul class="offer-list">${list.map((m) => offerCard(m, 'confirmed')).join('')}</ul>`;
    }).join('');

  const couponChains = [...new Set(confirmed.map((m) => m.chain))].filter((c) => COUPON_APPS[c]);

  view.innerHTML = `
    <h1>Angebote</h1>
    <p class="muted small" style="margin-top:-8px">
      Stand ${esc(stampFmt.format(new Date(cache.fetchedAt)))} · PLZ ${esc(cache.zipCode || '')} · Quelle: Marktguru
      ${cache.errors?.length ? `<br><span class="hint-warn">${cache.errors.length} Suchen beim letzten Abruf fehlgeschlagen</span>` : ''}
    </p>

    ${review.length ? `
      <h2>Bitte prüfen <span class="muted small">(${review.length})</span></h2>
      <p class="muted small">Passt das Angebot zu deinem Produkt? Die Entscheidung gilt auch für dasselbe Angebot in künftigen Prospekten.</p>
      <ul class="offer-list">${review.map((m) => offerCard(m, 'review')).join('')}</ul>` : ''}

    <h2>Deine Produkte im Angebot</h2>
    ${confirmedHtml || `<p class="muted small">${review.length
      ? 'Noch nichts bestätigt.'
      : 'Diese Woche keine Angebote für deine Produkte.'}</p>`}

    ${couponChains.length ? `
      <div class="card small coupon-hint">💡 Vor dem Einkauf Coupons prüfen:
        ${couponChains.map((c) => esc(COUPON_APPS[c])).join(', ')}</div>` : ''}

    ${rejected.length ? `
      <details class="rejected">
        <summary class="small muted">Ausgeblendet (${rejected.length})</summary>
        <ul class="offer-list">${rejected.map((m) => offerCard(m, 'rejected')).join('')}</ul>
      </details>` : ''}

    <p class="muted small">Tipp: Findet die Suche ein Produkt nicht, trage im Produkt einen eigenen
      Suchbegriff ein (z. B. „Bavaria Blu“ statt der Marke).</p>`;

  view.querySelectorAll('[data-decide]').forEach((button) => {
    button.addEventListener('click', async () => {
      const key = button.closest('.offer').dataset.key;
      const choice = button.dataset.decide;
      if (choice === 'reset') delete decisions[key];
      else decisions[key] = choice;
      await saveSetting({ key: 'offerDecisions', map: decisions, updatedAt: new Date().toISOString() });
      scheduleSync();
      if (choice === 'yes') toast('Gemerkt – passt');
      rerender();
    });
  });
}
