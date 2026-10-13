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
- **Datenhaltung**: zunächst lokal im Browser (IndexedDB) mit Export/Import als JSON.
  Sync zwischen PC und Handy kommt mit dem Hintergrunddienst (Phase 3).
- **Sprache der Oberfläche**: Deutsch.
- Erst einfach und lauffähig, dann ausbauen. Jede Phase soll für sich nutzbar sein.

## Stadt und Märkte
- Stadt: **Leipzig** (Annahme aus dem Planungsgespräch, bitte bestätigen).
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

## Offene Fragen
- Fortbewegung beim Einkaufen: zu Fuß, Rad oder Auto?
- Nutzt außer mir noch jemand die App (geteilte Daten nötig)?
- Wo läuft der Hintergrunddienst ab Phase 3?
- Stadt Leipzig bestätigen.

## Stand
- **Phase 1 (Katalog) umgesetzt** (Version 0.1.0, Oktober 2026): statische PWA ohne Build-Schritt
  (Vanilla-JS-Module), IndexedDB, Scanner mit BarcodeDetector bzw. ZXing (lokal unter `vendor/`),
  Produktdaten aus Open Food Facts / Open Beauty Facts / Open Products Facts, Export/Import JSON.
  Aufbau und Datenmodell: siehe README.md.
- Lokal starten: `python -m http.server 8080 --bind 127.0.0.1`, Tests: `npm test`.
- Bei geänderter Dateiliste `APP_FILES`/`VERSION` in `sw.js` anpassen, App-Version in `js/app.js`.

## Nächster Schritt
- Repository auf GitHub anlegen, GitHub Pages aktivieren, Scanner am Android-Handy testen.
- Danach Phase 2: Märkte aus OpenStreetMap.
