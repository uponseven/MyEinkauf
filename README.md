# MyEinkauf

Persönlicher Einkaufsplaner als Web-App (PWA): Katalog der Lieblingsprodukte, später Angebote,
Märkte und optimierte Einkaufslisten. Ziele und Planung stehen in [CLAUDE.md](CLAUDE.md).

## Stand: Phase 1 – Katalog

- Barcode scannen mit der Kamera (BarcodeDetector des Browsers, sonst ZXing) oder EAN eintippen
- Name, Marke, Packungsgröße, Bild und Kategorievorschlag aus Open Food Facts
  (danach Open Beauty Facts und Open Products Facts für Drogerieartikel)
- Eigenes Foto als Ersatz, Kategorie, übliche Menge, Schmerzgrenze, Notizen
- Daten lokal im Browser (IndexedDB), Export/Import als JSON-Datei
- Installierbar (Homescreen-Symbol), funktioniert offline

## Lokal starten

Kein Build-Schritt nötig, nur ein statischer Webserver:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

oder `npm start`. Dann <http://localhost:8080> öffnen. Die Kamera funktioniert auf `localhost`
auch ohne HTTPS.

Tests (Node 20+):

```bash
npm test
```

## Am Handy testen (GitHub Pages)

Android gibt die Kamera nur über HTTPS frei. Deshalb über GitHub Pages veröffentlichen:

1. Repository auf GitHub anlegen und `main` pushen.
2. *Settings → Pages → Build and deployment*: Quelle „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
3. Nach ein bis zwei Minuten unter `https://<benutzer>.github.io/<repo>/` erreichbar.
4. Auf dem Handy in Chrome öffnen → Menü → „Zum Startbildschirm hinzufügen“.

Die Daten liegen pro Gerät im Browser. Zum Übertragen zwischen PC und Handy:
Einstellungen → Katalog exportieren, Datei auf das andere Gerät bringen, dort importieren.

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html`, `css/app.css` | Grundgerüst und Gestaltung |
| `js/app.js` | Oberfläche und Navigation (Hash-Routing) |
| `js/db.js` | IndexedDB-Zugriff |
| `js/scanner.js` | Kamera und Barcode-Erkennung |
| `js/off.js` | Abfrage Open Food Facts & Co. |
| `js/categories.js` | Kategorien und Zuordnung aus OFF-Daten |
| `js/backup.js` | Export/Import |
| `js/ean.js` | EAN-Prüfziffer |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (offline, installierbar) |
| `vendor/zxing/` | ZXing-Barcode-Bibliothek 0.2.1 (Apache-2.0), lokal abgelegt |

## Datenmodell Produkt

```js
{
  id, ean, name, brand, packageSize,   // packageSize als Text, z. B. "500 g"
  category, usualQty,                   // usualQty = Packungen pro Einkauf
  priceLimit,                           // Schmerzgrenze in € pro Packung oder null
  notes, imageUrl,                      // imageUrl von Open Food Facts
  photo,                                // eigenes Foto (Blob, im Export als Data-URL)
  source, sourceUrl, createdAt, updatedAt
}
```

## Lizenzen der Daten

Produktdaten und Bilder: Open Food Facts, Open Beauty Facts und Open Products Facts unter
[ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
