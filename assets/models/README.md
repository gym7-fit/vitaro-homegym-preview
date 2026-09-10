# 3D-Gerätemodelle (GLB/glTF) — optionaler Zusatz

Dieser Ordner gehört zum **abtrennbaren 3D-Planer** (`assets/js/planer-3d.js`).
Wird der 3D-Planer entfernt, kann dieser Ordner mit weg.

## Aktuell im Einsatz

`gym-equipment.glb` — Pack **„Gym Equipment" von Low Poly Models**
(sketchfab.com/LowPolyModelsWorld), Lizenz **CC BY 4.0**. Enthält 12 Geräte
als benannte Knoten; `GLB_MODELS` wählt per `node` das passende Teilobjekt:

```
Bench press_0 · Treadmill_1 · Bench press-up_2 · Armpit_3 · Butterfly_4 ·
Bench press-dn_5 · Shoulder_6 · Parallel_7 · Arc Bench_8 · Dumbbell stand_9 ·
Hulter stand_10 · Feetpress_11
```

Attribution steht in `planer.html` in der 3D-Panel-Notiz (CC-BY-Pflicht).

## Wie es funktioniert

`planer-3d.js` hat oben eine Zuordnung:

```js
var GLB_MODELS = {
  chestpress: { url: "assets/models/chestpress.glb", yaw: 0 }
};
```

Liegt die angegebene Datei hier im Ordner, wird sie beim Öffnen der
3D-Ansicht geladen und **automatisch maßstäblich** auf die Gerätegrundfläche
skaliert (Breite × Tiefe aus `equipment-data.js`), auf den Boden gesetzt und
mittig über den Platzierungspunkt gestellt. Fehlt die Datei oder scheitert das
Laden, greift lautlos das gebaute Klötzchen-Modell — der Planer bleibt nutzbar.

## Anforderungen an die Datei

- Format: **`.glb`** (binär, eine Datei). `.gltf`+Ordner geht auch, dann `url`
  auf die `.gltf` zeigen und die Zusatzdateien hier ablegen.
- Blickrichtung: das Modell sollte **nach +Z schauen** (dorthin, wo der/die
  Trainierende blickt). Stimmt die Drehung nicht, `yaw` in `GLB_MODELS`
  anpassen (Grad, z. B. `yaw: 180` oder `yaw: 90`).
- Aufrecht (Y = oben), Maßstab egal — wird auf die Grundfläche gerechnet.
- Draco-komprimierte GLBs werden unterstützt (DRACOLoader ist eingebunden).
- Größe möglichst < 5 MB, damit die Seite schnell bleibt.

## Woher ein Modell nehmen

Ein frei nutzbares Modell **genau dieser** sitzenden Brustpresse ist selten.
Geprüfte Optionen (Stand der Recherche):

| Quelle | Modell | Lizenz / Preis |
|---|---|---|
| Sketchfab Store | „Chest Press Machine" (Elvair Lima) | kostenpflichtig (Royalty-Free), GLB/FBX |
| Sketchfab Store | „Inclined chest press machine" (dragosburian) | kostenpflichtig, real bemaßt, mehrere Formate |
| Sketchfab Store | „Technogym Plate Loaded Chest Press" (Frezzy) | kostenpflichtig |
| Meshy / Tripo (KI) | Text-zu-3D: „plate loaded seated chest press" | GLB-Export, meist CC0 — Qualität schwankt |
| poly.pizza | nur generische Gym-Objekte (keine Brustpresse) | CC0 |

Vorgehen: gewünschtes Modell besorgen → als `chestpress.glb` hier ablegen →
3D-Ansicht neu öffnen. Bei Bedarf `yaw` justieren.

Weitere Geräte später analog: Eintrag in `GLB_MODELS` ergänzen und Datei
hier ablegen.
