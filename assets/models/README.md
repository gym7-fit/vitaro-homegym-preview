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
