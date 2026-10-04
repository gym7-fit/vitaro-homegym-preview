# 3D-Gerätemodelle (GLB) — optionaler Zusatz

Gehört zum abtrennbaren 3D-Planer (`assets/js/planer-3d.js`). Fliegt der
3D-Planer raus, kann dieser Ordner mit weg.

## Herkunft

Die Modelle hier sind **selbst gebaut** — mit Blender (Python-Skript,
`bpy`), nach recherchierten Herstellermaßen und eigener Fotoanalyse der
Referenzgeräte. Kein Fremd-Asset-Pack, keine Lizenzfragen.

Build-Skripte liegen nicht im Repo (nur lokal beim Erstellen genutzt),
das Ergebnis (`*.glb`) schon. Ein Modell neu bauen/ändern:

1. Blender-Python-Skript schreiben (Helfer: `bar`, `tube`, `box`, `cyl`,
   `sphere`, `helix_spring` — JS-kompatible Koordinaten `(x, y_hoch,
   z_tief)`, intern nach Blender-Z-up umgerechnet).
2. Headless bauen + rendern + exportieren:
   `/Applications/Blender.app/Contents/MacOS/Blender --background --python <skript>.py -- <outdir>`
3. Die 3 Renders (`*_front.png`, `*_side.png`, `*_top.png`) gegen die
   Herstellerfotos prüfen, iterieren.
4. `<kategorie>.glb` hierher kopieren, in `planer-3d.js` unter
   `GLB_MODELS` eintragen (`{ url: "assets/models/<kategorie>.glb", yaw: 0 }`).

**Wichtig — Achsenkonvention:** lokal-X muss im fertigen GLB immer der
`w`-Wert aus `equipment-data.js` (Breite) entsprechen, lokal-Z immer
`d` (Tiefe) — `fitGlb()` in `planer-3d.js` skaliert sonst mit dem
falschen Seitenverhältnis und macht das Modell im Live-Planer winzig
oder verzerrt. Bei länglichen Geräten (Laufband/Bike/Rudergerät), bei
denen die lange Achse aus Bauplan-Sicht eher "Tiefe/Fahrtrichtung" ist,
NICHT einfach x/z vertauscht bauen — stattdessen normal bauen und vor
`render_and_export(...)` `swap_footprint_axes()` aufrufen (Helfer in
`common.py`, rotiert alles um 90° und backt es ein). Rundteile
(`tube`/`cyl`/`sphere`/`helix_spring`) werden von `common.py`
automatisch glatt schattiert (`shade_auto_smooth`) statt facettiert.

## Funktionsweise in der App

`GLB_MODELS` in `planer-3d.js` ordnet einer Kategorie-ID eine GLB-Datei
zu. Beim Platzieren wird sie geladen (`loadGLB`, gecacht pro URL) und
automatisch auf die Gerätegrundfläche skaliert (`fitGlb`, Bounding-Box,
Boden auf y=0). Bis das GLB da ist — oder falls Laden/Datei fehlschlägt
— steht lautlos das in `planer-3d.js` gebaute JS-Modell (`MODELS`) an
der Stelle. `yaw` (Grad) dreht das Modell nach, falls seine Blickrichtung
nicht +Z (nach vorn) entspricht.

## Aktuell vorhanden

- `chestpress.glb` — Taurus Brustpresse IFP (= Impulse IFP1201) nach
  B128×L98×H125 cm und den Referenzfotos (Front/Seite/Oben +
  Montageanleitung-Titelbild). Nur die Einstiegsstufe; Premium
  (Hammer Strength Select) nutzt weiter das gebaute JS-Modell.
- `bench.glb` — Gorilla Sports verstellbare Hantelbank. Beide Stufen
  nutzen dasselbe Modell (Bank unterscheidet sich zwischen den Stufen
  in `equipment-data.js` nicht wesentlich).
- `cable_budget.glb` — Gorilla Sports Kabelzugstation SmartGym H8,
  wandmontierte Einzelsäule (97×14,3×198 cm), Stahlrahmen, schwarze
  Acrylglas-Abdeckung, Lochraster, 2 Umlenkrollen.
- `cable_premium.glb` — NOHRD SlimBeam, schlanke Holzsäule (40 cm
  breit, 215 cm hoch), Edelstahl-Beschläge, 15er Gewichtsstapel,
  Klimmzugstange oben.
- `smith_budget.glb` — Gorilla Sports Multifunction Smith Machine:
  Stahlkäfig mit Lochraster-Führungsschienen, Klimmzugstange, Dip-
  Griffe, kleiner Kabelzug an der Rückseite.
- `smith_premium.glb` — ATX Power Smith Rack PSR-780: massiverer
  Power-Rack-Käfig mit Diagonalverstrebung, verchromten Führungen,
  J-Hooks auf 4 Höhen, 6 gepolsterten Safety-Spotter-Armen.
- `legpress_budget.glb` — Taurus Vertikale Beinpresse IFP: geneigter
  Schienenturm mit Schlitten, Plattenhörner, geneigte Rückenlehne.
- `legpress_premium.glb` — Hammer Strength SE Seated Leg Press:
  sitzend, selektorisiert (interner Gewichtsstapel statt Plattenladen,
  bei Recherche korrigiert), A-Bock mit Schlitten-Schienen.
- `rower_budget.glb` — Kettler Regatta 200: gerade Mittelschiene,
  schräg montierter Wassertank mit Widerstand über Füllstand.
- `rower_premium.glb` — Concept2 RowErg: Aluminium-Monoschiene,
  offenes Speichen-Schwungrad (Luftwiderstand), PM5-Monitorarm.
- `treadmill_budget.glb` — cardiostrong TX50: klassisches Motor-
  Laufband, Motorhaube vorn, konvergierende Lenkerholme zur Konsole.
- `treadmill_premium.glb` — NOHRD Sprintbok V.2: motorloses,
  gebogenes Lamellen-Laufband mit Echtholz-Seitenschienen.
- `bike_budget.glb` — cardiostrong IB50 Incline Bike: geneigte Aero-
  Rahmenspange, großes geneigtes Kapsel-Schwungradgehäuse mittig-vorn,
  Aero-Lenker mit Ellbogenpolstern.
- `bike_premium.glb` — Concept2 BikeErg: offenes Speichen-Schwungrad
  vorn (Luftwiderstand), Aluminium-Rahmen, PM5-Monitorarm.
