// Ansicht „Märkte“: Karte und Liste der Filialen, Kettenauswahl, Lieblingsfilialen, Zuhause.

import {
  CHAINS,
  CHAIN_BY_KEY,
  CITY_CENTER,
  loadMarkets,
  refreshMarkets,
  getFavoriteMarkets,
  saveFavoriteMarkets,
  getSelectedChains,
  saveSelectedChains,
  getHome,
  saveHome,
  openingStatus,
  formatOpeningHours,
  distanceKm,
  formatDistance,
} from './markets.js';

const ONLY_FAV_KEY = 'myeinkauf-only-favorites';
let leafletPromise;

function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      if (window.L) return resolve(window.L);
      const base = new URL('../vendor/leaflet/', import.meta.url).href;
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${base}leaflet.css`;
      document.head.append(css);
      const script = document.createElement('script');
      script.src = `${base}leaflet.js`;
      script.onload = () => resolve(window.L);
      script.onerror = () => {
        leafletPromise = undefined;
        reject(new Error('Karte konnte nicht geladen werden'));
      };
      document.head.append(script);
    });
  }
  return leafletPromise;
}

function readFlag(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* egal */ }
}

const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Standort wird von diesem Browser nicht unterstützt'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1
        ? 'Standortzugriff verweigert. Bitte in den Browser-Einstellungen erlauben.'
        : 'Standort konnte nicht ermittelt werden')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/**
 * @param {object} ctx  { view, esc, toast, onCleanup, scheduleSync }
 */
export async function renderMarkets({ view, esc, toast, onCleanup, scheduleSync }) {
  document.title = 'Märkte – MyEinkauf';
  view.innerHTML = '<div class="spinner"></div>';

  let data = await loadMarkets();
  const chains = await getSelectedChains();
  const favorites = await getFavoriteMarkets();
  let home = await getHome();
  let here = null; // aktueller Standort, nur in dieser Ansicht
  let onlyFavorites = readFlag(ONLY_FAV_KEY);
  let pickHome = false;

  view.innerHTML = `
    <h1>Märkte</h1>
    <div class="chips" id="chain-chips"></div>
    <details class="more-chains">
      <summary class="small muted">Weitere Ketten</summary>
      <div class="chips" id="chain-chips-more"></div>
    </details>
    <div class="map-tools">
      <label class="toggle"><input type="checkbox" id="only-fav" ${onlyFavorites ? 'checked' : ''}> ★ Nur Favoriten</label>
      <span class="spacer"></span>
      <button class="btn small-btn" id="locate" title="Meinen Standort zeigen">📍 Standort</button>
      <button class="btn small-btn" id="set-home" title="Zuhause auf der Karte festlegen">🏠 Zuhause</button>
    </div>
    <div id="map" class="map" role="application" aria-label="Karte der Märkte"></div>
    <p class="muted small map-meta" id="map-meta"></p>
    <ul class="market-list" id="market-list"></ul>`;

  const L = await loadLeaflet();
  const mapEl = view.querySelector('#map');
  const map = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView(CITY_CENTER, 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
  }).addTo(map);
  onCleanup(() => map.remove());

  const markerLayer = L.layerGroup().addTo(map);
  const markers = new Map();
  let homeMarker = null;
  let hereMarker = null;

  // ---------- Hilfen ----------

  const origin = () => here || home;

  const visibleMarkets = () => data.markets.filter((m) =>
    chains.has(m.chain) && (!onlyFavorites || favorites.has(m.id)));

  const statusHtml = (m) => {
    const st = openingStatus(m.openingHours);
    if (!st) return '';
    return st.open
      ? `<span class="open">● geöffnet bis ${esc(st.until)}</span>`
      : `<span class="closed">● geschlossen${st.next ? ` · öffnet ${esc(st.next)}` : ''}</span>`;
  };

  const badge = (chainKey) => {
    const c = CHAIN_BY_KEY[chainKey];
    return `<span class="chain-badge" style="background:${c.color};color:${c.text || '#fff'}">${esc(c.label)}</span>`;
  };

  const navUrl = (m) => `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lon}`;

  const popupHtml = (m) => `
    <div class="market-popup">
      <strong>${esc(m.name)}</strong><br>
      ${m.address ? `<span>${esc(m.address)}</span><br>` : ''}
      ${statusHtml(m)}
      ${m.openingHours ? `<div class="hours">${esc(formatOpeningHours(m.openingHours))}</div>` : ''}
      <div class="popup-actions">
        <button class="btn small-btn" data-fav="${esc(m.id)}">${favorites.has(m.id) ? '★ Favorit' : '☆ Als Favorit'}</button>
        <a class="btn small-btn" href="${navUrl(m)}" target="_blank" rel="noopener">Navigation</a>
      </div>
    </div>`;

  const markerIcon = (m) => {
    const c = CHAIN_BY_KEY[m.chain];
    const fav = favorites.has(m.id);
    return L.divIcon({
      className: '',
      html: `<span class="pin${fav ? ' fav' : ''}" style="background:${c.color};color:${c.text || '#fff'}">${esc(c.label)}</span>`,
      iconSize: fav ? [34, 34] : [26, 26],
      iconAnchor: fav ? [17, 17] : [13, 13],
      popupAnchor: [0, -12],
    });
  };

  // ---------- Darstellung ----------

  function renderChips() {
    const counts = {};
    for (const m of data.markets) counts[m.chain] = (counts[m.chain] || 0) + 1;
    const chip = (c) => `
      <button class="chip${chains.has(c.key) ? ' active' : ''}" data-chain="${c.key}" aria-pressed="${chains.has(c.key)}">
        ${badge(c.key)} ${esc(c.name)} <span class="muted">${counts[c.key] || 0}</span>
      </button>`;
    view.querySelector('#chain-chips').innerHTML = CHAINS.filter((c) => c.default).map(chip).join('');
    view.querySelector('#chain-chips-more').innerHTML = CHAINS.filter((c) => !c.default).map(chip).join('');
  }

  function renderMarkers() {
    markerLayer.clearLayers();
    markers.clear();
    for (const m of visibleMarkets()) {
      const marker = L.marker([m.lat, m.lon], { icon: markerIcon(m), title: m.name, riseOnHover: true })
        .bindPopup(() => popupHtml(m), { maxWidth: 260 });
      marker.addTo(markerLayer);
      markers.set(m.id, marker);
    }
    if (homeMarker) homeMarker.remove();
    homeMarker = home
      ? L.marker([home.lat, home.lon], {
        icon: L.divIcon({ className: '', html: '<span class="pin home">🏠</span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: 'Zuhause',
        zIndexOffset: 1000,
      }).bindPopup('<strong>Zuhause</strong><br><button class="btn small-btn" data-remove-home>Entfernen</button>').addTo(map)
      : null;
  }

  function renderList() {
    const from = origin();
    const list = visibleMarkets().map((m) => ({ m, km: from ? distanceKm(from, m) : null }));
    list.sort((a, b) =>
      (favorites.has(b.m.id) - favorites.has(a.m.id)) ||
      (a.km != null ? a.km - b.km : a.m.name.localeCompare(b.m.name, 'de')));

    const ul = view.querySelector('#market-list');
    if (!list.length) {
      ul.innerHTML = `<li class="muted center small" style="padding:16px">${onlyFavorites
        ? 'Noch keine Favoriten. Tippe in der Liste oder auf der Karte auf ☆.'
        : 'Keine Kette ausgewählt.'}</li>`;
    } else {
      ul.innerHTML = list.map(({ m, km }) => `
        <li class="market-item" data-id="${esc(m.id)}">
          ${badge(m.chain)}
          <span class="market-info">
            <span class="market-name">${esc(m.name)}</span>
            <span class="market-meta">${esc([km != null ? formatDistance(km) : '', m.address].filter(Boolean).join(' · ') || 'Adresse unbekannt')}</span>
            <span class="market-meta">${statusHtml(m)}</span>
          </span>
          <button class="icon-btn star${favorites.has(m.id) ? ' on' : ''}" data-fav="${esc(m.id)}"
            aria-label="${favorites.has(m.id) ? 'Favorit entfernen' : 'Als Favorit markieren'}">${favorites.has(m.id) ? '★' : '☆'}</button>
        </li>`).join('');
    }

    const basis = here ? 'vom aktuellen Standort' : home ? 'von Zuhause' : '';
    view.querySelector('#map-meta').innerHTML = `
      ${list.length} Filialen${basis ? `, Entfernung ${basis}` : ''} ·
      Stand ${esc(dateFmt.format(new Date(data.loadedAt)))}${data.source === 'snapshot' ? ' (mitgeliefert)' : ''} ·
      <button class="link-btn" id="refresh">aktualisieren</button>`;
  }

  function renderAll() {
    renderChips();
    renderMarkers();
    renderList();
  }

  function fitToVisible() {
    const pts = visibleMarkets().map((m) => [m.lat, m.lon]);
    if (home) pts.push([home.lat, home.lon]);
    if (pts.length) map.fitBounds(pts, { padding: [24, 24], maxZoom: 15 });
  }

  // ---------- Aktionen ----------

  async function toggleFavorite(id) {
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    await saveFavoriteMarkets(favorites);
    scheduleSync();
    const open = markers.get(id)?.isPopupOpen();
    renderMarkers();
    renderList();
    if (open) markers.get(id)?.openPopup();
  }

  const onClick = async (e) => {
    const chip = e.target.closest('[data-chain]');
    if (chip) {
      const key = chip.dataset.chain;
      if (chains.has(key)) chains.delete(key);
      else chains.add(key);
      await saveSelectedChains(chains);
      scheduleSync();
      renderAll();
      return;
    }
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      await toggleFavorite(fav.dataset.fav);
      return;
    }
    if (e.target.closest('[data-remove-home]')) {
      home = null;
      await saveHome(null);
      scheduleSync();
      map.closePopup();
      renderAll();
      toast('Zuhause entfernt');
      return;
    }
    if (e.target.closest('#refresh')) {
      const btn = e.target.closest('#refresh');
      btn.disabled = true;
      btn.textContent = 'lädt …';
      try {
        data = await refreshMarkets();
        renderAll();
        toast(`${data.markets.length} Filialen aktualisiert`);
      } catch (err) {
        toast(`${err.message} – die bisherigen Daten bleiben.`, { error: true });
        renderList();
      }
      return;
    }
    const item = e.target.closest('.market-item');
    if (item) {
      const marker = markers.get(item.dataset.id);
      if (!marker) return;
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
      marker.openPopup();
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  // #view bleibt über Ansichten hinweg bestehen: Listener beim Verlassen wieder entfernen.
  view.addEventListener('click', onClick);
  onCleanup(() => view.removeEventListener('click', onClick));

  view.querySelector('#only-fav').addEventListener('change', (e) => {
    onlyFavorites = e.target.checked;
    writeFlag(ONLY_FAV_KEY, onlyFavorites);
    renderMarkers();
    renderList();
  });

  view.querySelector('#locate').addEventListener('click', async () => {
    try {
      here = await currentPosition();
      if (hereMarker) hereMarker.remove();
      hereMarker = L.circleMarker([here.lat, here.lon], {
        radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1,
      }).bindPopup('Du bist hier').addTo(map);
      map.setView([here.lat, here.lon], 14);
      renderList();
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  const homeButton = view.querySelector('#set-home');
  homeButton.addEventListener('click', () => {
    pickHome = !pickHome;
    mapEl.classList.toggle('picking', pickHome);
    homeButton.classList.toggle('active', pickHome);
    if (pickHome) {
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Tippe auf der Karte auf dein Zuhause');
    }
  });

  map.on('click', async (e) => {
    if (!pickHome) return;
    pickHome = false;
    mapEl.classList.remove('picking');
    homeButton.classList.remove('active');
    home = { lat: e.latlng.lat, lon: e.latlng.lng };
    await saveHome(home);
    scheduleSync();
    renderAll();
    toast('Zuhause gespeichert – die Liste ist jetzt nach Entfernung sortiert');
  });

  renderAll();
  fitToVisible();
  // Karte braucht nach dem Einfügen die endgültige Größe.
  setTimeout(() => map.invalidateSize(), 0);
}
