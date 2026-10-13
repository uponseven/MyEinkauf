# MyEinkauf – persönlicher Einkaufsplaner

## Ziel
Bestmöglich sparen bei niedrigstem Luxusverzicht. Ich (Andreas) habe Lieblingsprodukte bestimmter
Marken (keine Eigenmarken). Die App kennt diesen Katalog, gleicht ihn mit aktuellen Angeboten der
Supermärkte in meiner Stadt ab und schlägt optimierte Einkaufslisten pro Markt plus Einkaufsroute vor.

## Grundsatzentscheidungen
- **Web-App (PWA)**: läuft am PC und auf Android (Homescreen-Symbol). Keine native App vorerst.
- **HTTPS ist Pflicht**, sonst gibt Android die Kamera fürs Scannen nicht frei.
  Lokal am PC testen ist ok, zum Testen am Handy über GitHub Pages veröffentlichen.
- **Code im Git-Repository**, Hosting über GitHub Pages.
- **Datenhaltung**: lokal im Browser (IndexedDB), Export/Import als JSON, Abgleich zwischen
  Geräten über ein privates GitHub-Repository.
- **Sprache der Oberfläche**: Deutsch.
- Erst einfach und lauffähig, dann ausbauen. Jede Phase soll für sich nutzbar sein.

## Stadt und Märkte
- Stadt: **Leipzig** (bestätigt).
- Ketten: **REWE, Kaufland, Penny, Lidl, Konsum (Leipzig), Edeka, dm**. Später erweiterbar.

## Datenquellen
| Zweck | Quelle | Hinweise |
|---|---|---|
| Produktdaten + Bilder | **Open Food Facts API** (Barcode/EAN) | Frei, ODbL. Fehlende Bilder: eigenes Foto. |
| Barcode scannen | Handykamera im Browser (z. B. ZXing / BarcodeDetector) | Braucht HTTPS. |
| Supermarkt-Standorte | **OpenStreetMap** (Overpass API) | Name, Kette, Koordinaten, Öffnungszeiten. |
| Angebote | **Marktguru** (inoffiziell, Suche nach Begriff + PLZ) | Hauptquelle für alle Ketten. Kann brechen, nur privat und sparsam nutzen. |
| Angebote (Ergänzung) | Direkt beim Händler, z. B. REWE-App-Schnittstelle | Nur bei Lücken. REWE braucht seit 2024 Zertifikate (siehe Projekt „rewerse-engineering“). |
| Angebote (Rückfall) | Manuelle Eingabe, evtl. Foto vom Preisschild | Wenn eine Quelle ausfällt. |
| Routing | Freier Routingdienst (z. B. OSRM / OpenRouteService) | Fortbewegungsart noch offen. |
| Einkaufsliste | **Bring!** (inoffizielle Schnittstelle, mein Login) | Ein- und Ausgabe, siehe unten. |

Prospekte wechseln meist Montag und Donnerstag. Edeka-Prospekte sind regional
(Region Nordbayern-Sachsen-Thüringen) und teils pro Markt verschieden.
Vorbild für die Kombination mehrerer Quellen: Open-Source-Projekt „Korbunio“ (GitHub).

## Bring!-Integration
- **Bring! → App**: Die App liest meine Bring!-Liste und prüft genau diese Artikel gegen die Angebote.
  Ich schreibe weiter wie gewohnt in Bring!.
- **App → Bring!**: Die optimierte Liste geht zurück nach Bring!, mit Markt und Preis im
  Hinweisfeld (z. B. „Kaufland, 2,99 €“) oder als eigene Liste pro Markt.
- Einmalige Zuordnung: Bring!-Eintrag („Kaffee“) → Katalogprodukt („Jacobs Krönung 500 g“).
- Login bleibt bei mir, wird nicht im Code oder Repo gespeichert.

## Coupons und Bonusprogramme
- **REWE Bonus**: Wöchentliche Bonus-Aktionen (ohne Aktivierung) als effektiven Preis
  verrechnen (Preis minus Bonus-Guthaben). Persönliche Coupons sind nicht automatisierbar:
  stattdessen vor einem REWE-Einkauf Hinweis „Coupons checken für: …“ mit den betroffenen Produkten.
- **dm, Lidl Plus, Penny-App**: ebenfalls nur als Hinweis „Coupons prüfen“.

## Phasen
1. **Katalog** – Barcode scannen, Daten + Bild von Open Food Facts, eigenes Foto als Ersatz,
   Kategorie, übliche Menge, Schmerzgrenze („teurer als X kaufe ich nicht“). Export/Import JSON.
2. **Märkte** – Leipziger Filialen der gewählten Ketten aus OSM laden, Favoriten markieren, Karte.
3. **Angebote** – Kleiner Hintergrunddienst (Server oder Raspberry Pi, noch offen), holt Marktguru-
   Angebote, gleicht mit Katalog ab, Benachrichtigung bei Treffern. Bring!-Anbindung.
4. **Einkaufsplanung** – Günstigster Markt pro Produkt, Abwägung Ersparnis vs. Zusatzweg
   (einstellbare Schwelle, z. B. zweiter Markt erst ab 3 € Ersparnis), Route, Ausgabe nach Bring!.
5. **Preisgedächtnis** – Bezahlte Preise erfassen (abhaken oder Kassenbon), eigene Preishistorie,
   echte Schnäppchen erkennen, „Vorrat anlegen“-Hinweise.

## Geklärt
- Fortbewegung: **zu Fuß, Fahrrad und Auto** – je nach Einkauf. Phase 4 soll die Art pro Einkauf
  wählbar machen (beeinflusst Radius und Umweg-Schwelle).
- Nutzer: aktuell nur Andreas, **später eventuell eine zweite Person** mit eigenem Handy.
  Dann gemeinsamer Katalog über dasselbe Daten-Repo (eigener Token); Regel „neuere Änderung gewinnt“
  reicht, solange nicht beide gleichzeitig dasselbe Produkt bearbeiten.

## Offene Fragen
- Bring!-Anbindung: inoffizielle Schnittstelle braucht Login – wo wird er sicher hinterlegt (GitHub-Secret?)

## Stand
- **Phase 1 (Katalog) umgesetzt** (Version 0.1.0, Oktober 2026): statische PWA ohne Build-Schritt
  (Vanilla-JS-Module), IndexedDB, Scanner mit BarcodeDetector bzw. ZXing (lokal unter `vendor/`),
  Produktdaten aus Open Food Facts / Open Beauty Facts / Open Products Facts, Export/Import JSON.
  Aufbau und Datenmodell: siehe README.md.
- Lokal starten: `MyEinkauf-starten.bat` (oder `python -m http.server 8080 --bind 127.0.0.1`), Tests: `npm test`.
- Online (GitHub Pages, Branch `main`): https://uponseven.github.io/MyEinkauf/ – Repo: https://github.com/uponseven/MyEinkauf (öffentlich). `git push` veröffentlicht Änderungen.
- **Abgleich PC ↔ Handy** (Version 0.2.0) vorgezogen: über privates Repo
  `uponseven/MyEinkauf-daten`, Fine-grained Token pro Gerät, neuerer Stand gewinnt, Lösch-Markierungen.
  Annahme: nur Andreas nutzt die App. Idee für Phase 3: Angebotsabruf als GitHub-Actions-Zeitplan,
  der ins selbe Daten-Repo schreibt (statt Raspberry Pi).
- **Eigene Kategorien** (Version 0.3.0): anlegen, umbenennen, sortieren, löschen; werden mit abgeglichen.
  Kategorie mit „Soja/Pflanzlich/Vegan“ im Namen bekommt pflanzliche Produkte automatisch vorgeschlagen.
- **Phase 2 (Märkte) umgesetzt** (Version 0.4.0): Filialen aus OSM als mitgelieferter Schnappschuss
  `data/maerkte-leipzig.json` (Overpass ist oft überlastet), Live-Aktualisierung in der App, Karte (Leaflet,
  lokal), Kettenauswahl (7 gewählte + Aldi, Netto, Norma, Rossmann zuschaltbar), Lieblingsfilialen,
  Zuhause, Öffnungsstatus. Favoriten/Ketten/Zuhause werden mit abgeglichen.
  Schnappschuss erneuern: `node tools/update-markets.mjs`.
- **Phase 3 (Angebote) umgesetzt** (Version 0.5.0): GitHub Actions im Daten-Repo
  (`.github/workflows/angebote.yml`, Vorlage `tools/angebote-workflow.yml`) läuft täglich 06:15 und nach jeder
  Katalogänderung, holt per `tools/fetch-offers.mjs` Marktguru-Angebote (Suchbegriff = eigener Suchbegriff
  oder Marke), gleicht mit dem Katalog ab (`js/offers.js`) und schreibt `angebote/aktuell.json`.
  Marktguru erlaubt kein CORS → Abruf nur serverseitig. App: Reiter „Angebote“, Treffer bestätigen/verwerfen
  (Entscheidungen werden abgeglichen), Grundpreis-Vergleich, REWE-Bonus, Schmerzgrenze, Coupon-Hinweis.
  Benachrichtigung: nur in der App (Abzeichen). Alle gewählten Ketten zählen.
  Erkenntnisse: Edeka Leipzig fehlt bei Marktguru (nur „EDEKA Foodservice“), dm/Konsum kaum vertreten,
  REWE-Bio-Eigenmarken selten im Prospekt.
- Abgleich übernimmt unbekannte Felder aus dem Repo unverändert (ältere App-Version hatte am 13.10.
  Einstellungen gelöscht).
- Bei geänderter Dateiliste `APP_FILES`/`VERSION` in `sw.js` anpassen, App-Version in `js/app.js`.

## Nächster Schritt
- Phase 4: Einkaufsplanung – günstigster Markt pro Produkt, Ersparnis vs. Zusatzweg (Fortbewegung pro
  Einkauf wählbar), Route, Bring!-Anbindung.
