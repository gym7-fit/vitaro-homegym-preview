/* ============================================================================
   VITARO 3D-Planer  —  ZUSATZMODUL, komplett abtrennbar.
   Ändert NICHTS am 2D-Planer. Liest nur dessen gespeicherten Zustand
   (localStorage "vitaroPlannerState") bzw. die L/B-Felder und baut daraus
   eine 3D-Ansicht (Wände, Türöffnungen, Geräte).

   Vollständig entfernen:
     1. diese Datei löschen  (assets/js/planer-3d.js)
     2. assets/css/planer-3d.css löschen
     3. in planer.html entfernen: den <link ... planer-3d.css>, den Block
        <div class="planner-3d-wrap">…</div> und die beiden <script>-Zeilen
        (three.min.js + planer-3d.js).
   Danach ist der 2D-Planer exakt wie vorher.
   ========================================================================== */
(function () {
  "use strict";

  var STORAGE_KEY = "vitaroPlannerState";
  var WALL_H_CM = 250;
  var DOOR_H_CM = 200;
  var WALL_T_CM = 10;

  // Richthöhen je Kategorie in cm (ca., recherchiert) — Fallback-Boxhöhe.
  var EQUIP_H = {
    rack: 225, bench: 50, cable: 215, chestpress: 150, legpress: 145,
    smith: 212, treadmill: 150, bike: 132, rower: 53, barbell: 30,
    plates: 100, dumbbells: 40, kettlebells: 35, flooring: 2
  };
  var EQUIP_H_DEFAULT = 120;

  var toggleBtn, panel, heightInput, heightLabel, wallBtn, zoomInBtn, zoomOutBtn;
  var renderer, scene, camera, roomGroup, wallEdges = [], raf = null, built = false;
  var target, theta = Math.PI * 0.72, phi = Math.PI * 0.34, radius = 9, radiusMin = 2.2, radiusMax = 40;
  var wallMode = "front"; // "all" | "front" | "none"
  var WALL_MODES = ["front", "all", "none"];
  var WALL_LABEL = { all: "Wände: alle", front: "Wände: vorne aus", none: "Wände: keine" };

  document.addEventListener("DOMContentLoaded", function () {
    toggleBtn = document.getElementById("planner3dToggle");
    panel = document.getElementById("planner3dPanel");
    if (!toggleBtn || !panel) return;
    toggleBtn.addEventListener("click", function () {
      var show = panel.hidden;
      panel.hidden = !show;
      toggleBtn.classList.toggle("is-open", show);
      toggleBtn.textContent = show ? "3D-Ansicht schließen" : "3D-Ansicht";
      if (show) openPanel(); else closePanel();
    });
  });

  function openPanel() {
    if (typeof THREE === "undefined") {
      panel.insertAdjacentHTML("beforeend", '<p class="planner-3d-msg">3D-Bibliothek konnte nicht geladen ' +
        'werden (keine Internetverbindung?). Der 2D-Planer ist davon nicht betroffen.</p>');
      return;
    }
    if (!built && !renderer) buildOnce();
    if (!built) return;
    rebuildRoom();
    resize();
    loop();
  }
  function closePanel() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  /* ---------- Zustand lesen (ohne den 2D-Planer anzufassen) ---------- */
  function readState() {
    var st = null;
    try { st = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) {}
    if (st && st.room && Array.isArray(st.room.shape) && st.room.shape.length >= 3) {
      return {
        shape: st.room.shape,
        doors: Array.isArray(st.room.doors) ? st.room.doors : [],
        items: Array.isArray(st.items) ? st.items : [],
        accessories: Array.isArray(st.accessories) ? st.accessories : [],
        flooring: st.flooring && st.flooring.included ? st.flooring : null
      };
    }
    var lEl = document.getElementById("roomLength"), bEl = document.getElementById("roomWidth");
    var L = (parseFloat(lEl && lEl.value) || 4.5) * 100;
    var B = (parseFloat(bEl && bEl.value) || 3.5) * 100;
    return {
      shape: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: B }, { x: 0, y: B }],
      doors: [{ edge: 2, pos: Math.max(10, L - 20 - 90), width: 90, hinge: "end" }],
      items: [], accessories: [], flooring: null
    };
  }
  function byId(catId) {
    if (typeof VITARO_EQUIPMENT === "undefined") return null;
    for (var i = 0; i < VITARO_EQUIPMENT.length; i++) if (VITARO_EQUIPMENT[i].id === catId) return VITARO_EQUIPMENT[i];
    return null;
  }

  /* ======================================================================
     GERÄTE-3D-MODELLE — low-poly, nach echten Produktbildern/Maßen (recher-
     chiert), maßstäblich zueinander. Jedes Modell wird in METERN nach realen
     Abmessungen gebaut; place() skaliert nur X/Z sanft auf die Planer-Grund-
     fläche (Höhe bleibt real). Farben je Herstellerdesign.
     ==================================================================== */
  function V(x, y, z) { return new THREE.Vector3(x, y, z); }
  function M(hex, rough, metal) {
    return new THREE.MeshStandardMaterial({ color: hex,
      roughness: rough == null ? 0.7 : rough, metalness: metal == null ? 0.1 : metal });
  }
  function box(g, w, h, d, mat, x, y, z, rx, ry, rz) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx) m.rotation.x = rx; if (ry) m.rotation.y = ry; if (rz) m.rotation.z = rz;
    m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  function tube(g, a, b, r, mat, seg) {
    var dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    if (len < 1e-4) return null;
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 12), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    m.castShadow = true; g.add(m); return m;
  }
  function cyl(g, r, h, mat, x, y, z, axis, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 18), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (axis === "x") m.rotation.z = Math.PI / 2;
    if (axis === "z") m.rotation.x = Math.PI / 2;
    m.castShadow = true; g.add(m); return m;
  }
  // kurze Endkappe, Achse entlang Z (Rohrenden, Griffkappen, Puffer)
  function capZ(g, x, y, z, r, len, mat) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  }
  // Kugel-Gelenk an Rohrknoten (Verbindung statt frei endender Zylinder)
  function joint(g, p, r, mat) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
    m.position.copy(p); m.castShadow = true; g.add(m); return m;
  }
  // X/Z sanft auf Grundfläche bringen (Verhältnis bleibt glaubwürdig)
  function place(g, realW, realD, fp) {
    var sx = Math.max(0.8, Math.min(1.25, (fp.w / 100) / realW));
    var sz = Math.max(0.8, Math.min(1.25, (fp.d / 100) / realD));
    g.scale.set(sx, 1, sz);
    return g;
  }
  // Stapel runder Hantelscheiben entlang einer Achse
  function plateStack(g, cx, cy, cz, axis, count, r, thick, mat, gap) {
    for (var i = 0; i < count; i++) {
      var off = (i - (count - 1) / 2) * (thick + (gap || 0.004));
      cyl(g, r, thick, mat,
        cx + (axis === "x" ? off : 0), cy + (axis === "y" ? off : 0), cz + (axis === "z" ? off : 0),
        axis, 20);
    }
  }

  /* ---------- Fallback: maßstäbliche Box ---------- */
  function buildBox(fp, tier, hCm) {
    var g = new THREE.Group();
    var h = (hCm || EQUIP_H_DEFAULT) / 100;
    var b = new THREE.Mesh(new THREE.BoxGeometry(fp.w / 100, h, fp.d / 100),
      new THREE.MeshStandardMaterial({ color: tier === "premium" ? 0xa85c3f : 0x5c7a5c, roughness: 0.8 }));
    b.position.y = h / 2; b.castShadow = true;
    g.add(b);
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry),
      new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.3 })).translateY(h / 2));
    return g;
  }

  // gemeinsame Materialien
  function mats() {
    return {
      blk:   M(0x1c1c1e, 0.78, 0.15),
      dark:  M(0x2b2c30, 0.7, 0.2),
      pad:   M(0x121216, 0.95, 0.0),
      chrome:M(0xcfd3d8, 0.25, 0.85),
      rub:   M(0x0c0c0d, 1.0, 0.0),
      red:   M(0xb42322, 0.5, 0.2),   // Hammer Strength
      yellow:M(0xe0c02f, 0.5, 0.1),
      grey:  M(0x3b3d42, 0.6, 0.2),
      silver:M(0x9aa0a7, 0.4, 0.5),
      white: M(0xe8e8ec, 0.6, 0.05),
      wood:  M(0x6f4a2c, 0.72, 0.0),  // NOHRD Walnuss
      screen:M(0x0a0d12, 0.35, 0.3),
      iron:  M(0x17181a, 0.85, 0.1)
    };
  }

  /* ---- Power Rack / Kraftstation ---- */
  function buildRack(fp, tier) {
    var g = new THREE.Group(), c = mats();
    var prem = tier === "premium";
    var rw = prem ? 1.22 : 1.15, rd = prem ? 1.67 : 1.15, H = prem ? 2.28 : 2.12;
    var ux = rw / 2 - 0.05, uz = rd / 2 - 0.05, r = prem ? 0.045 : 0.038;
    var holeCount = prem ? 12 : 8, holeSpan = H - (prem ? 0.24 : 0.36), holeStart = prem ? 0.14 : 0.18;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      tube(g, V(p[0] * ux, 0, p[1] * uz), V(p[0] * ux, H, p[1] * uz), r, c.blk);
      box(g, 0.16, 0.05, 0.16, c.dark, p[0] * ux, 0.03, p[1] * uz);      // Fußplatte
      cyl(g, 0.012, 0.02, c.chrome, p[0] * ux + p[0] * 0.055, 0.02, p[1] * uz, "y", 8); // Bodendübel
      // Lochraster: Reihe Steckbohrungen auf der raumzugewandten Innenkante
      for (var hi = 0; hi < holeCount; hi++) {
        var hy = holeStart + holeSpan * (hi / (holeCount - 1));
        cyl(g, r * 0.42, r * 1.3, c.iron, p[0] * (ux - r * 0.9), hy, p[1] * uz, "x", 8);
      }
    });
    // Fuß-Längsholme + oberer Rahmen (3-seitig: hinten + beide Seiten)
    [-1, 1].forEach(function (sx) {
      tube(g, V(sx * ux, 0.05, -uz), V(sx * ux, 0.05, uz), r * 0.8, c.blk);
      tube(g, V(sx * ux, H - 0.04, -uz), V(sx * ux, H - 0.04, uz), r * 0.8, c.blk);
      joint(g, V(sx * ux, H - 0.04, -uz), r, c.blk);
      joint(g, V(sx * ux, H - 0.04, uz), r, c.blk);
    });
    tube(g, V(-ux, H - 0.04, -uz), V(ux, H - 0.04, -uz), r * 0.8, c.blk);
    tube(g, V(-ux, 0.14, -uz), V(ux, 0.14, -uz), r * 0.65, c.dark);        // untere Rückenquere
    // Klimmzugstange vorn — gerade Mitte, Premium zusätzlich Neutral- + Weitgriff
    tube(g, V(-ux, H - 0.02, uz - 0.02), V(ux, H - 0.02, uz - 0.02), 0.021, c.blk, 16);
    capZ(g, -ux, H - 0.02, uz - 0.02, 0.028, 0.025, c.dark);
    capZ(g, ux, H - 0.02, uz - 0.02, 0.028, 0.025, c.dark);
    if (prem) {
      [-1, 1].forEach(function (s) { tube(g, V(s * 0.1, H - 0.02, uz - 0.02), V(s * 0.1, H - 0.15, uz - 0.02), 0.017, c.blk); }); // Neutralgriffe
      tube(g, V(-0.26, H - 0.02, uz - 0.02), V(-0.26, H - 0.16, uz - 0.24), 0.017, c.blk);
      tube(g, V(0.26, H - 0.02, uz - 0.02), V(0.26, H - 0.16, uz - 0.24), 0.017, c.blk);
      tube(g, V(-0.26, H - 0.16, uz - 0.24), V(0.26, H - 0.16, uz - 0.24), 0.017, c.blk, 16); // Weitgriff-Bogen
    }
    // J-Haken: zweifarbig (Metallschale + Kunststoffeinlage)
    [-1, 1].forEach(function (sx) {
      box(g, 0.07, 0.05, 0.14, c.dark, sx * ux, 1.02, uz - 0.07);
      box(g, 0.05, 0.03, 0.1, prem ? c.red : c.grey, sx * ux, 1.045, uz - 0.06);
    });
    // Safety-Bars quer mit Endkappen
    tube(g, V(-ux, 0.42, -0.08), V(ux, 0.42, -0.08), 0.022, c.dark, 12);
    capZ(g, -ux, 0.42, -0.08, 0.028, 0.02, c.chrome);
    capZ(g, ux, 0.42, -0.08, 0.028, 0.02, c.chrome);
    if (prem) { // Spotter-Arme + seitliche Weight-Horns mit Scheiben
      [-1, 1].forEach(function (sx) {
        tube(g, V(sx * ux, 0.9, uz - 0.04), V(sx * ux, 0.86, uz - 0.5), 0.022, c.red);
        capZ(g, sx * ux, 0.86, uz - 0.5, 0.026, 0.02, c.dark);
        cyl(g, 0.022, 0.22, c.blk, sx * (ux + 0.14), 0.5, -uz + 0.1, "x");
        capZ(g, sx * (ux + 0.14 + 0.11), 0.5, -uz + 0.1, 0.024, 0.02, c.dark);
        plateStack(g, sx * (ux + 0.14), 0.5, -uz + 0.1, "x", 3, 0.16, 0.035, c.iron);
      });
    }
    return place(g, rw, rd, fp);
  }

  /* ---- Verstellbare Hantelbank ---- */
  function buildBench(fp, tier) {
    var g = new THREE.Group(), c = mats();
    var prem = tier === "premium";
    var rw = 1.35, rd = 0.55, seatY = 0.48;
    var frame = prem ? c.blk : c.dark;
    // Fußausleger vorn/hinten (H-Form)
    box(g, 0.08, 0.08, rd, frame, -rw / 2 + 0.12, 0.05, 0);
    box(g, 0.08, 0.08, rd, frame, rw / 2 - 0.12, 0.05, 0);
    box(g, rw - 0.2, 0.07, 0.09, frame, 0, 0.05, 0);
    box(g, 0.4, 0.05, 0.4, frame, -rw / 2 + 0.16, 0.03, 0);
    box(g, 0.4, 0.05, 0.4, frame, rw / 2 - 0.16, 0.03, 0);
    // Längsholm auf Kniehöhe + Sitzsäule + Lehnenstütze
    box(g, rw - 0.3, 0.06, 0.08, frame, 0.02, 0.30, 0);
    tube(g, V(0.14, 0.08, 0), V(0.14, seatY - 0.04, 0), 0.035, frame);
    tube(g, V(-0.30, 0.08, 0), V(-0.16, seatY - 0.04, 0), 0.04, frame);
    // Sitzpolster
    box(g, 0.30, 0.08, 0.30, c.pad, 0.14, seatY, 0);
    // Rückenpolster als eigene Gruppe, um die Hinterkante gekippt
    var brInc = prem ? 0.5 : 0.22;            // rad Neigung
    var br = new THREE.Group();
    box(br, 0.32, 0.08, 0.58, c.pad, 0, 0, -0.29);   // wächst nach -Z (hinten)
    br.position.set(-0.04, seatY, -0.02);
    br.rotation.x = -brInc;
    g.add(br);
    // Verstell-Zahnbogen hinten
    for (var i = 0; i < 6; i++) box(g, 0.03, 0.02, 0.08, frame, -0.34, seatY - 0.06 + i * 0.05, -0.02);
    if (prem) { // MBX-520: Beinfixierrolle vorn
      tube(g, V(0.42, seatY - 0.02, -0.16), V(0.42, seatY - 0.02, 0.16), 0.03, frame);
      cyl(g, 0.06, 0.12, c.pad, 0.42, seatY + 0.04, -0.13, "z");
      cyl(g, 0.06, 0.12, c.pad, 0.42, seatY + 0.04, 0.13, "z");
    }
    return place(g, rw, rd, fp);
  }

  /* ---- Kabelturm / Cable ---- */
  function buildCable(fp, tier) {
    var g = new THREE.Group(), c = mats();
    if (tier === "premium") {
      // NOHRD SlimBeam: schlanke Holzsäule an der Wand, gebogene Silhouette
      var H = 2.15;
      box(g, 0.34, H, 0.12, c.wood, 0, H / 2, -0.02);
      box(g, 0.30, 0.05, 0.14, c.silver, 0, H - 0.06, 0.02);
      box(g, 0.30, 0.05, 0.14, c.silver, 0, 0.10, 0.02);
      // Gewichtsblock (Gummiplatten) mittig hinter Holz
      plateStack(g, 0, 0.9, -0.06, "y", 12, 0.13, 0.045, c.rub);
      // dual pulley + Griffe
      [-1, 1].forEach(function (s) {
        cyl(g, 0.035, 0.03, c.silver, s * 0.14, 1.6, 0.09, "z");
        tube(g, V(s * 0.14, 1.6, 0.09), V(s * 0.2, 1.1, 0.16), 0.006, c.chrome);
        box(g, 0.03, 0.11, 0.03, c.blk, s * 0.2, 1.05, 0.16);
      });
      // Oak-Klimmzugstange oben
      cyl(g, 0.022, 0.5, M(0xc79a5b, 0.7, 0), 0, H + 0.02, 0.16, "x");
      return place(g, 0.4, 0.2, fp);
    }
    // Budget: freistehender Doppelturm-Funktionstrainer, schwarz
    var rw = 1.5, rd = 1.0, HT = 2.1;
    [-1, 1].forEach(function (s) {
      tube(g, V(s * (rw / 2 - 0.1), 0, -rd / 2 + 0.15), V(s * (rw / 2 - 0.1), HT, -rd / 2 + 0.15), 0.05, c.blk);
      box(g, 0.34, 1.2, 0.28, c.grey, s * (rw / 2 - 0.1), 0.62, -rd / 2 + 0.15);   // Gewichtsblock-Verkleidung
      plateStack(g, s * (rw / 2 - 0.1), 0.62, -rd / 2 + 0.15, "y", 14, 0.14, 0.03, c.iron);
      cyl(g, 0.04, 0.05, c.silver, s * (rw / 2 - 0.1), HT - 0.06, -rd / 2 + 0.3, "z");
      box(g, 0.05, 0.14, 0.05, c.blk, s * (rw / 2 - 0.24), HT - 0.5, -rd / 2 + 0.32);  // Griff
    });
    box(g, rw - 0.2, 0.08, 0.1, c.blk, 0, 0.05, -rd / 2 + 0.15);        // hinterer Fußholm
    tube(g, V(-(rw / 2 - 0.1), 0.05, -rd / 2 + 0.15), V(-(rw / 2 - 0.1), 0.05, rd / 2 - 0.1), 0.04, c.blk);
    tube(g, V(rw / 2 - 0.1, 0.05, -rd / 2 + 0.15), V(rw / 2 - 0.1, 0.05, rd / 2 - 0.1), 0.04, c.blk);
    tube(g, V(-(rw / 2 - 0.1), HT - 0.04, -rd / 2 + 0.15), V(rw / 2 - 0.1, HT - 0.04, -rd / 2 + 0.15), 0.03, c.blk);
    return place(g, rw, rd, fp);
  }

  /* ---- Brustpresse ---- */
  function buildChestPress(fp, tier) {
    var g = new THREE.Group(), c = mats();
    var prem = tier === "premium";
    var rw = prem ? 1.45 : 1.28, rd = prem ? 1.05 : 0.98, H = prem ? 1.63 : 1.25;
    var frame = prem ? c.blk : c.blk, accent = prem ? c.red : c.yellow;
    // Bodenrahmen
    [-1, 1].forEach(function (s) {
      tube(g, V(s * (rw / 2 - 0.06), 0.07, rd / 2 - 0.05), V(s * (rw / 2 - 0.06), 0.07, -rd / 2 + 0.05), 0.04, frame);
    });
    tube(g, V(-(rw / 2 - 0.06), 0.07, rd / 2 - 0.06), V(rw / 2 - 0.06, 0.07, rd / 2 - 0.06), 0.035, frame);
    tube(g, V(-(rw / 2 - 0.06), 0.07, -rd / 2 + 0.06), V(rw / 2 - 0.06, 0.07, -rd / 2 + 0.06), 0.035, frame);
    // Lehnenmast
    tube(g, V(-0.13, 0.08, -rd / 2 + 0.18), V(-0.11, H - 0.05, -0.08), 0.05, frame);
    tube(g, V(0.13, 0.08, -rd / 2 + 0.18), V(0.11, H - 0.05, -0.08), 0.05, frame);
    tube(g, V(-0.11, H - 0.06, -0.08), V(0.11, H - 0.06, -0.08), 0.035, frame);
    // Sitz + Lehne
    box(g, 0.38, 0.09, 0.38, c.pad, 0, 0.47, 0.16, -0.05);
    box(g, 0.40, 0.10, prem ? 0.66 : 0.58, c.pad, 0, prem ? 0.9 : 0.82, -0.05, -0.2);
    if (prem) box(g, 0.16, 0.05, 0.02, c.red, 0, 1.06, -0.16);   // HS Akzent
    // Drucktürme + Griffe (an den Seiten, nach vorn)
    [-1, 1].forEach(function (s) {
      var Bo = V(s * (rw / 2 - 0.06), 0.09, 0.20), T = V(s * (rw / 2 - 0.06), H - 0.18, 0.26);
      tube(g, Bo, T, 0.05, frame);
      var Pv = V(s * (rw / 2 - 0.06), 0.58, 0.24);
      tube(g, Pv, V(s * (rw / 2 - 0.12), 0.90, 0.5), 0.045, frame);
      cyl(g, 0.06, 0.12, frame, s * (rw / 2 - 0.06), 0.6, 0.24, "x");
      tube(g, V(s * (rw / 2 - 0.12), 0.78, 0.56), V(s * (rw / 2 - 0.12), 1.06, 0.56), 0.03, c.rub);  // senkr. Griff
      tube(g, V(s * (rw / 2 - 0.12), 0.9, 0.4), V(s * (rw / 2 - 0.12), 0.9, 0.56), 0.026, c.rub);
    });
    if (prem) { // Gewichtsblock hinten (selektorisiert)
      box(g, 0.3, 1.0, 0.28, c.grey, 0, 0.6, -rd / 2 + 0.16);
      plateStack(g, 0, 0.6, -rd / 2 + 0.16, "y", 14, 0.13, 0.03, c.iron);
    } else { // Taurus: gelbe Level-Scheiben + Scheibendorne
      [-1, 1].forEach(function (s) {
        cyl(g, 0.055, 0.03, c.yellow, s * (rw / 2 - 0.02), 0.6, 0.24, "x");
        cyl(g, 0.028, 0.28, frame, s * (rw / 2 - 0.1), 0.3, 0.5, "z");
        plateStack(g, s * (rw / 2 - 0.1), 0.3, 0.52, "z", 2, 0.15, 0.05, c.iron);
      });
    }
    return place(g, rw, rd, fp);
  }

  /* ---- Beinpresse ---- */
  function buildLegPress(fp, tier) {
    var g = new THREE.Group(), c = mats();
    if (tier === "premium") {
      // HS SE Seated Leg Press: liegend, schwarz+rot, Längsachse X (Sitz −X, Fußplatte +X)
      var rl = 2.01, rw = 1.02, H = 1.35;
      tube(g, V(rl / 2 - 0.1, 0.08, -rw / 2 + 0.08), V(-rl / 2 + 0.1, 0.08, -rw / 2 + 0.08), 0.05, c.blk);
      tube(g, V(rl / 2 - 0.1, 0.08, rw / 2 - 0.08), V(-rl / 2 + 0.1, 0.08, rw / 2 - 0.08), 0.05, c.blk);
      box(g, 0.5, 0.1, 0.5, c.pad, -rl / 2 + 0.42, 0.5, 0, 0, 0, -0.15);    // Sitz
      box(g, 0.62, 0.12, 0.5, c.pad, -rl / 2 + 0.18, 0.92, 0, 0, 0, -0.35); // Rückenlehne
      box(g, 0.5, 0.12, 0.56, c.pad, rl / 2 - 0.5, 0.72, 0, 0, 0, 0.5);     // Fußplatte schräg
      tube(g, V(-rl / 2 + 0.3, 0.5, -0.28), V(rl / 2 - 0.5, 0.75, -0.34), 0.05, c.red); // Hebel
      tube(g, V(-rl / 2 + 0.3, 0.5, 0.28), V(rl / 2 - 0.5, 0.75, 0.34), 0.05, c.red);
      box(g, 0.3, 1.05, 0.32, c.grey, -rl / 2 + 0.02, 0.6, 0);              // Gewichtsblock
      plateStack(g, -rl / 2 + 0.02, 0.6, 0, "y", 15, 0.14, 0.03, c.iron);
      return place(g, rl, rw, fp);
    }
    // Taurus IFP1613 vertikale Beinpresse: 121 x 165 x 141
    var RW = 1.21, RD = 1.65, HH = 1.41;
    [-1, 1].forEach(function (s) {
      tube(g, V(s * (RW / 2 - 0.08), 0, RD / 2 - 0.4), V(s * (RW / 2 - 0.08), HH, -RD / 2 + 0.3), 0.05, c.blk);
      tube(g, V(s * (RW / 2 - 0.08), 0.06, RD / 2 - 0.1), V(s * (RW / 2 - 0.08), 0.06, -RD / 2 + 0.1), 0.04, c.blk);
    });
    box(g, 0.5, 0.12, 0.42, c.pad, 0, 0.24, RD / 2 - 0.34, 0.08);       // Rückenpolster am Boden (liegt schräg)
    box(g, 0.52, 0.1, 0.5, c.blk, 0, 1.16, -RD / 2 + 0.42, -0.5);       // Schlitten/Fußplatte oben schräg
    plateStack(g, -RW / 2 + 0.02, 0.9, -RD / 2 + 0.5, "x", 2, 0.17, 0.05, c.iron);
    plateStack(g, RW / 2 - 0.02, 0.9, -RD / 2 + 0.5, "x", 2, 0.17, 0.05, c.iron);
    cyl(g, 0.045, 0.03, c.yellow, RW / 2 - 0.02, 0.7, RD / 2 - 0.5, "x");
    return place(g, RW, RD, fp);
  }

  /* ---- Multipresse / Smith ---- */
  function buildSmith(fp, tier) {
    var g = new THREE.Group(), c = mats();
    var prem = tier === "premium";
    var rw = prem ? 1.4 : 1.5, rd = prem ? 1.4 : 1.3, H = prem ? 2.15 : 2.1;
    var ux = rw / 2 - 0.06, uz = rd / 2 - 0.06;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      tube(g, V(p[0] * ux, 0, p[1] * uz), V(p[0] * ux, H, p[1] * uz), 0.045, c.blk);
      box(g, 0.15, 0.05, 0.15, c.dark, p[0] * ux, 0.03, p[1] * uz);
    });
    tube(g, V(-ux, H - 0.04, -uz), V(ux, H - 0.04, -uz), 0.03, c.blk);
    tube(g, V(-ux, H - 0.04, uz), V(ux, H - 0.04, uz), 0.03, c.blk);
    tube(g, V(-ux, H - 0.02, uz - 0.02), V(ux, H - 0.02, uz - 0.02), 0.02, c.blk, 16); // Klimmzug
    // Smith-Führungsschienen + Hantelstange
    [-1, 1].forEach(function (s) { tube(g, V(s * (ux - 0.06), 0.1, 0.06), V(s * (ux - 0.06), H - 0.1, 0.06), 0.018, c.silver); });
    cyl(g, 0.016, rw - 0.24, c.chrome, 0, 1.1, 0.06, "x");
    plateStack(g, -(rw / 2 - 0.02), 1.1, 0.06, "x", 2, 0.16, 0.045, c.iron);
    plateStack(g, rw / 2 - 0.02, 1.1, 0.06, "x", 2, 0.16, 0.045, c.iron);
    if (!prem) { // Gorilla: Kabelzug-Turm hinten + Dipgriffe
      box(g, 0.24, 1.0, 0.22, c.grey, 0, 0.6, -uz - 0.06);
      tube(g, V(-0.2, 1.0, uz + 0.02), V(-0.2, 0.95, uz + 0.24), 0.02, c.blk);
      tube(g, V(0.2, 1.0, uz + 0.02), V(0.2, 0.95, uz + 0.24), 0.02, c.blk);
    } else { // ATX PSR-780: Transportrollen
      [-1, 1].forEach(function (s) { cyl(g, 0.05, 0.04, c.dark, s * ux, 0.04, uz, "x"); });
    }
    return place(g, rw, rd, fp);
  }

  /* ---- Laufband ---- (Laufrichtung/Länge immer entlang X, Konsole an +X) */
  function buildTreadmill(fp, tier) {
    var g = new THREE.Group(), c = mats();
    if (tier === "premium") {
      // NOHRD Sprintbok: gebogenes Holz-Curve, L180 x B86 x H170
      var rl = 1.8, rw = 0.86;
      [-1, 1].forEach(function (s) {
        var pts = [];
        for (var i = 0; i <= 10; i++) {
          var t = i / 10, xx = -rl / 2 + t * rl;
          var yy = 0.16 + Math.pow((t - 0.5) * 2, 2) * 0.5;   // U-Kurve
          pts.push(V(xx, yy, s * (rw / 2 - 0.03)));
        }
        var geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.05, 8, false);
        var m = new THREE.Mesh(geo, c.wood); m.castShadow = true; g.add(m);
      });
      for (var k = 0; k <= 18; k++) {
        var t2 = k / 18, x2 = -rl / 2 + 0.1 + t2 * (rl - 0.2);
        var y2 = 0.18 + Math.pow((t2 - 0.5) * 2, 2) * 0.42;
        box(g, 0.06, 0.02, rw - 0.14, c.dark, x2, y2, 0, 0, 0, (t2 - 0.5) * 1.1);
      }
      box(g, 0.1, 0.06, rw - 0.1, c.wood, rl / 2 - 0.06, 0.95, 0);   // vordere Griffquere (+X)
      return place(g, rl, rw, fp);
    }
    // cardiostrong TX50: L188 x B89 x H147, schwarz + Konsole an +X
    var RL = 1.88, RW = 0.89, H = 1.47;
    box(g, RL * 0.62, 0.12, RW, c.blk, -RL * 0.06, 0.1, 0);                // Deck-Basis
    box(g, RL * 0.54, 0.04, RW - 0.06, c.dark, -RL * 0.08, 0.17, 0);       // Lauffläche
    [-1, 1].forEach(function (s) {
      box(g, RL * 0.5, 0.28, 0.09, c.grey, -RL * 0.08, 0.28, s * (RW / 2 - 0.05));  // Seitenholme
      tube(g, V(RL / 2 - 0.4, 0.3, s * (RW / 2 - 0.06)), V(RL / 2 - 0.3, H - 0.25, s * (RW / 2 - 0.06)), 0.03, c.blk);
      tube(g, V(RL / 2 - 0.33, H - 0.4, s * (RW / 2 - 0.06)), V(RL / 2 - 0.08, H - 0.42, s * (RW / 2 - 0.06)), 0.024, c.blk); // Haltegriff
    });
    box(g, 0.06, 0.4, RW - 0.12, c.screen, RL / 2 - 0.24, H - 0.12, 0);   // Touch-Konsole
    return place(g, RL, RW, fp);
  }

  /* ---- Indoor-Bike / Ergometer ---- (Länge entlang X, Schwungrad an +X) */
  function buildBike(fp, tier) {
    var g = new THREE.Group(), c = mats();
    if (tier === "premium") {
      // Concept2 BikeErg: L122 x B61 x H132, Schwungrad vorn (+X)
      var rl = 1.22;
      box(g, 0.5, 0.06, 0.09, c.blk, 0, 0.05, 0);                       // Standfuß (Mitte)
      box(g, 0.09, 0.06, 0.5, c.blk, rl / 2 - 0.16, 0.05, 0);           // Fuß vorn (unter Schwungrad)
      cyl(g, 0.22, 0.12, c.silver, rl / 2 - 0.16, 0.5, 0, "z", 24);     // Schwungrad
      box(g, 0.14, 0.46, 0.3, c.grey, rl / 2 - 0.16, 0.5, 0);           // Käfig-Abdeckung
      tube(g, V(rl / 2 - 0.16, 0.5, 0), V(-rl / 2 + 0.34, 1.02, 0), 0.04, c.blk);  // Oberrohr
      tube(g, V(-rl / 2 + 0.4, 0.1, 0), V(-rl / 2 + 0.34, 1.0, 0), 0.04, c.blk);   // Sattelrohr
      box(g, 0.16, 0.06, 0.26, c.pad, -rl / 2 + 0.38, 1.03, 0);         // Sattel
      tube(g, V(rl / 2 - 0.46, 1.0, -0.16), V(rl / 2 - 0.46, 1.0, 0.16), 0.016, c.blk); // Lenker
      box(g, 0.03, 0.28, 0.2, c.screen, rl / 2 - 0.44, 1.16, 0);        // PM5
      cyl(g, 0.11, 0.05, c.blk, 0, 0.32, 0, "z");                       // Kurbel/Tretlager
      return place(g, rl, 0.61, fp);
    }
    // cardiostrong IB50 Incline Bike: L130 x B63 x H120, schwarz/weiß, Schwungrad an +X
    var RL = 1.3;
    box(g, 0.1, 0.07, 0.5, c.blk, -RL / 2 + 0.14, 0.05, 0);
    box(g, 0.1, 0.07, 0.5, c.blk, RL / 2 - 0.14, 0.05, 0);
    box(g, 0.34, 0.5, 0.34, c.white, RL / 2 - 0.22, 0.32, 0);          // Schwungrad-Gehäuse
    tube(g, V(RL / 2 - 0.22, 0.5, 0), V(-RL / 2 + 0.3, 1.0, 0), 0.045, c.blk);
    tube(g, V(-RL / 2 + 0.24, 0.1, 0), V(-RL / 2 + 0.3, 0.98, 0), 0.045, c.blk);
    box(g, 0.07, 0.07, 0.24, c.pad, -RL / 2 + 0.3, 1.0, 0);             // Sattel
    tube(g, V(RL / 2 - 0.26, 0.9, 0), V(RL / 2 - 0.34, 1.18, 0), 0.03, c.blk); // Lenkersäule
    tube(g, V(RL / 2 - 0.34, 1.18, -0.18), V(RL / 2 - 0.34, 1.18, 0.18), 0.016, c.blk);
    box(g, 0.03, 0.16, 0.2, c.screen, RL / 2 - 0.3, 1.24, 0);
    cyl(g, 0.1, 0.05, c.blk, 0.02, 0.34, 0, "z");
    return place(g, RL, 0.63, fp);
  }

  /* ---- Rudergerät ---- (Länge entlang X, Schwungrad/Tank an −X) */
  function buildRower(fp, tier) {
    var g = new THREE.Group(), c = mats();
    if (tier === "premium") {
      // Concept2 RowErg: 244 lang, graues Schwungradgehäuse, Alu-Monorail
      var rl = 2.44;
      cyl(g, 0.24, 0.16, c.grey, -rl / 2 + 0.2, 0.26, 0, "z", 24);     // Schwungrad
      box(g, 0.28, 0.34, 0.34, c.blk, -rl / 2 + 0.2, 0.28, 0);          // Gehäuse-Abdeckung
      box(g, 0.16, 0.06, 0.5, c.blk, -rl / 2 + 0.16, 0.04, 0);          // Frontfuß
      tube(g, V(-rl / 2 + 0.28, 0.34, 0), V(rl / 2 - 0.2, 0.3, 0), 0.03, c.silver);  // Monorail
      box(g, 0.05, 0.26, 0.22, c.pad, rl / 2 - 0.6, 0.36, 0);           // Sitz
      box(g, 0.4, 0.1, 0.12, c.blk, rl / 2 - 0.16, 0.06, 0);            // Hinterfuß
      tube(g, V(-rl / 2 + 0.42, 0.32, -0.22), V(-rl / 2 + 0.42, 0.32, 0.22), 0.014, c.blk); // Zuggriff
      box(g, 0.03, 0.24, 0.16, c.screen, -rl / 2 + 0.16, 0.6, 0);       // PM5 Arm
      return place(g, rl, 0.61, fp);
    }
    // Kettler Regatta 200: Wasserrudergerät, silber/schwarz, Tank an −X
    var RL = 1.8;
    cyl(g, 0.2, 0.24, M(0x2f6f8f, 0.35, 0.1), -RL / 2 + 0.24, 0.3, 0, "z", 20); // Wassertank (Achse quer, Z)
    box(g, 0.16, 0.08, 0.44, c.silver, -RL / 2 + 0.2, 0.05, 0);
    tube(g, V(-RL / 2 + 0.32, 0.28, 0), V(RL / 2 - 0.16, 0.22, 0), 0.03, c.silver);
    box(g, 0.06, 0.06, 0.22, c.pad, RL / 2 - 0.5, 0.3, 0);
    box(g, 0.1, 0.1, 0.34, c.silver, RL / 2 - 0.14, 0.06, 0);
    tube(g, V(-RL / 2 + 0.42, 0.3, -0.2), V(-RL / 2 + 0.42, 0.3, 0.2), 0.014, c.blk);
    box(g, 0.03, 0.2, 0.16, c.screen, -RL / 2 + 0.2, 0.56, 0);
    return place(g, RL, 0.45, fp);
  }

  /* ---- Zubehör ---- */
  function buildBarbell(fp, tier) {
    var g = new THREE.Group(), c = mats();
    var L = 2.2;
    cyl(g, 0.014, L * 0.62, c.chrome, 0, 0.5, 0, "x", 16);            // Schaft
    [-1, 1].forEach(function (s) {
      cyl(g, 0.025, L * 0.17, c.chrome, s * L * 0.4, 0.5, 0, "x", 14);// Hülsen
      plateStack(g, s * L * 0.34, 0.5, 0, "x", tier === "premium" ? 2 : 3,
        tier === "premium" ? 0.22 : 0.17, tier === "premium" ? 0.06 : 0.035,
        tier === "premium" ? c.rub : c.iron);
    });
    // liegt auf niedrigem Ständer
    box(g, 0.08, 0.5, 0.14, c.blk, -0.5, 0.25, 0);
    box(g, 0.08, 0.5, 0.14, c.blk, 0.5, 0.25, 0);
    return place(g, L, 0.5, fp);
  }
  function buildPlates(fp, tier) {
    var g = new THREE.Group(), c = mats();
    var prem = tier === "premium";
    // kleiner Scheibenbaum
    tube(g, V(0, 0, 0), V(0, 1.0, 0), 0.04, c.blk);
    box(g, 0.5, 0.05, 0.5, c.dark, 0, 0.03, 0);
    [-1, 1].forEach(function (s) {
      cyl(g, 0.03, 0.32, c.blk, 0, 0.3 + (s > 0 ? 0.32 : 0), 0, "x");
    });
    plateStack(g, 0, 0.3, 0.18, "z", prem ? 3 : 4, prem ? 0.22 : 0.2, prem ? 0.06 : 0.04, prem ? c.rub : c.iron);
    plateStack(g, 0, 0.62, 0.18, "z", prem ? 3 : 4, prem ? 0.17 : 0.16, prem ? 0.05 : 0.035, prem ? c.rub : c.iron);
    return place(g, 0.6, 0.5, fp);
  }
  function buildDumbbells(fp, tier) {
    var g = new THREE.Group(), c = mats();
    var prem = tier === "premium";
    // Paar auf kleinem Rack
    box(g, 0.7, 0.16, 0.3, c.dark, 0, 0.16, 0, 0, 0, 0.06);
    box(g, 0.7, 0.05, 0.3, c.blk, 0, 0.03, 0);
    [-1, 1].forEach(function (s) {
      var y = 0.3;
      cyl(g, 0.02, 0.34, c.chrome, s * 0.16, y, 0, "x", 12);
      [-1, 1].forEach(function (e) {
        cyl(g, 0.08, 0.06, c.rub, s * 0.16 + e * 0.14, y, 0, "x", 14);
        cyl(g, 0.075, 0.09, c.rub, s * 0.16 + e * 0.1, y, 0, "x", 6); // Hex-Anmutung
      });
    });
    return place(g, 0.7, 0.4, fp);
  }
  function buildKettlebells(fp, tier) {
    var g = new THREE.Group(), c = mats();
    var prem = tier === "premium";
    // Premium 32 kg = rot (Wettkampf-Farbcode); Budget Gusseisen schwarz
    var body = prem ? M(0xb42322, 0.55, 0.15) : c.iron;
    [-0.16, 0.16].forEach(function (x) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), body);
      m.position.set(x, 0.12, 0); m.scale.set(1, 0.9, 1); m.castShadow = true; g.add(m);
      var h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 8, 16), prem ? body : c.blk);
      h.position.set(x, 0.24, 0); h.rotation.x = Math.PI / 2; g.add(h);
    });
    return place(g, 0.5, 0.35, fp);
  }

  var MODELS = {
    rack: buildRack, bench: buildBench, cable: buildCable, chestpress: buildChestPress,
    legpress: buildLegPress, smith: buildSmith, treadmill: buildTreadmill, bike: buildBike,
    rower: buildRower, barbell: buildBarbell, plates: buildPlates,
    dumbbells: buildDumbbells, kettlebells: buildKettlebells
  };
  // Zubehör hat im 2D-Planer bewusst keine x/y-Position (reine Kostenrechner-
  // Menge, siehe planer.js "palette: accessories (no canvas placement)"). Für
  // die 3D-Ansicht bekommt es hier eine kompakte, nicht editierbare Lagerecke.
  // Diese Maße sind rein interne Display-Größen, KEIN Kundenwert (erscheinen
  // nirgends als "Platzbedarf").
  var ACCESSORY_FP = {
    barbell: { w: 220, d: 50 }, plates: { w: 60, d: 50 },
    dumbbells: { w: 70, d: 40 }, kettlebells: { w: 50, d: 35 }
  };

  /* ---------- Three.js-Grundgerüst (einmalig) ---------- */
  function buildOnce() {
    var host = document.createElement("div");
    host.className = "planner-3d-stage";
    panel.appendChild(host);

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      host.remove();
      panel.insertAdjacentHTML("beforeend", '<p class="planner-3d-msg">Dieses Gerät/dieser Browser ' +
        'stellt kein 3D (WebGL) bereit. Der 2D-Planer funktioniert unverändert.</p>');
      return;
    }
    built = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1ede4);
    camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8f7d, 0.75));
    var key = new THREE.DirectionalLight(0xfff3e0, 0.95);
    key.position.set(5, 11, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -8; key.shadow.camera.right = 8;
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 40;
    key.shadow.bias = -0.0008;
    scene.add(key);
    scene.add(new THREE.DirectionalLight(0xdfe6ff, 0.25).translateZ(-6).translateY(4));

    roomGroup = new THREE.Group();
    scene.add(roomGroup);

    heightInput = document.getElementById("planner3dWallH");
    heightLabel = document.getElementById("planner3dWallHVal");
    if (heightInput) heightInput.addEventListener("input", function () {
      WALL_H_CM = parseInt(heightInput.value, 10) || 250;
      if (heightLabel) heightLabel.textContent = (WALL_H_CM / 100).toFixed(2).replace(".", ",") + " m";
      rebuildRoom();
    });
    wallBtn = document.getElementById("planner3dWalls");
    if (wallBtn) {
      wallBtn.textContent = WALL_LABEL[wallMode];
      wallBtn.addEventListener("click", function () {
        wallMode = WALL_MODES[(WALL_MODES.indexOf(wallMode) + 1) % WALL_MODES.length];
        wallBtn.textContent = WALL_LABEL[wallMode];
      });
    }
    zoomInBtn = document.getElementById("planner3dZoomIn");
    zoomOutBtn = document.getElementById("planner3dZoomOut");
    if (zoomInBtn) zoomInBtn.addEventListener("click", function () { zoomBy(-0.18); });
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", function () { zoomBy(0.18); });

    setupControls(renderer.domElement);
    window.addEventListener("resize", function () { if (!panel.hidden) resize(); });
  }

  function zoomBy(f) { radius = Math.max(radiusMin, Math.min(radiusMax, radius * (1 + f))); }

  // Orbit per Drag, Zoom per Mausrad UND Zwei-Finger-Pinch.
  function setupControls(el) {
    el.style.touchAction = "none";
    var pts = {}; var pinchDist = 0;
    el.addEventListener("pointerdown", function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      if (Object.keys(pts).length === 2) pinchDist = twoDist();
    });
    el.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      var prev = pts[e.pointerId];
      var keys = Object.keys(pts);
      if (keys.length >= 2) {
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var nd = twoDist();
        if (pinchDist > 0 && nd > 0) zoomBy((pinchDist - nd) / pinchDist * 0.9);
        pinchDist = nd;
      } else {
        theta -= (e.clientX - prev.x) * 0.006;
        phi = Math.max(0.1, Math.min(1.47, phi - (e.clientY - prev.y) * 0.006));
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      }
    });
    function up(e) { delete pts[e.pointerId]; pinchDist = 0; }
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", function (e) { e.preventDefault(); zoomBy(e.deltaY > 0 ? 0.12 : -0.12); }, { passive: false });
    function twoDist() {
      var k = Object.keys(pts); if (k.length < 2) return 0;
      var a = pts[k[0]], b = pts[k[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function resize() {
    var w = panel.clientWidth || 600;
    var h = window.innerWidth <= 860 ? 340 : 460;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---------- Raum + Geräte (bei jedem Öffnen neu aus dem 2D-Zustand) ---- */
  function rebuildRoom() {
    while (roomGroup.children.length) roomGroup.remove(roomGroup.children[0]);
    wallEdges = [];

    var s = readState();
    var pts = s.shape.map(function (p) { return { x: p.x / 100, y: p.y / 100 }; });
    var minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    pts.forEach(function (p) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minZ) minZ = p.y; if (p.y > maxZ) maxZ = p.y;
    });
    var cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    var P = pts.map(function (p) { return { x: p.x - cx, z: p.y - cz }; });
    var wallH = WALL_H_CM / 100, doorH = DOOR_H_CM / 100, wallT = WALL_T_CM / 100;

    // Boden
    var shp = new THREE.Shape();
    P.forEach(function (p, i) { i ? shp.lineTo(p.x, p.z) : shp.moveTo(p.x, p.z); });
    shp.closePath();
    var floor = new THREE.Mesh(new THREE.ShapeGeometry(shp),
      new THREE.MeshStandardMaterial({ color: 0xe9e1d1, roughness: 0.95, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    roomGroup.add(floor);
    var span = Math.max(maxX - minX, maxZ - minZ) + 1;
    var grid = new THREE.GridHelper(span, Math.max(4, Math.round(span / 0.5)), 0xc9bda6, 0xded3bd);
    grid.position.y = 0.004;
    roomGroup.add(grid);

    // Bodenbelag (Gummiboden), falls im 2D-Planer aktiviert — gleiche
    // Tönung wie die CSS-Vorschau dort (.planner-flooring-fill).
    if (s.flooring) {
      var flMat = new THREE.MeshStandardMaterial({
        color: s.flooring.tier === "premium" ? 0xa85c3f : 0x5c7a5c,
        roughness: 0.92, transparent: true, opacity: 0.4, side: THREE.DoubleSide
      });
      var flShape = new THREE.Shape();
      P.forEach(function (p, i) { i ? flShape.lineTo(p.x, p.z) : flShape.moveTo(p.x, p.z); });
      flShape.closePath();
      var flMesh = new THREE.Mesh(new THREE.ShapeGeometry(flShape), flMat);
      flMesh.rotation.x = -Math.PI / 2;
      flMesh.position.y = 0.006;
      flMesh.receiveShadow = true;
      roomGroup.add(flMesh);
    }

    var wallMat = new THREE.MeshStandardMaterial({ color: 0xc4b7a1, roughness: 0.95 });
    var leafMat = new THREE.MeshStandardMaterial({ color: 0xa68a73, roughness: 0.8 });

    for (var i = 0; i < P.length; i++) {
      var a = P[i], b = P[(i + 1) % P.length];
      var dx = b.x - a.x, dz = b.z - a.z;
      var len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      var ang = Math.atan2(dz, dx);
      var eg = new THREE.Group();

      var gaps = s.doors.filter(function (d) { return d.edge === i; })
        .map(function (d) { var p0 = Math.max(0, d.pos / 100); return [p0, Math.min(len, p0 + d.width / 100)]; })
        .sort(function (u, v) { return u[0] - v[0]; });

      var piece = function (s0, s1, yB, yT) {
        var L = s1 - s0;
        if (L < 0.02 || yT - yB < 0.02) return;
        var m = new THREE.Mesh(new THREE.BoxGeometry(L, yT - yB, wallT), wallMat);
        var t = ((s0 + s1) / 2) / len;
        m.position.set(a.x + dx * t, (yB + yT) / 2, a.z + dz * t);
        m.rotation.y = -ang;
        m.castShadow = true; m.receiveShadow = true;
        eg.add(m);
      }
      var cursor = 0;
      for (var gi = 0; gi < gaps.length; gi++) {
        var g = gaps[gi];
        if (g[0] > cursor) piece(cursor, g[0], 0, wallH);
        piece(g[0], g[1], doorH, wallH);
        var lt = ((g[0] + g[1]) / 2) / len;
        var leaf = new THREE.Mesh(new THREE.BoxGeometry((g[1] - g[0]) * 0.98, doorH * 0.98, 0.045), leafMat);
        leaf.position.set(a.x + dx * lt, doorH / 2, a.z + dz * lt);
        leaf.rotation.y = -ang; leaf.castShadow = true;
        eg.add(leaf);
        cursor = Math.max(cursor, g[1]);
      }
      if (cursor < len) piece(cursor, len, 0, wallH);

      // Außen-Normale (zeigt vom Raummittelpunkt ~Ursprung weg)
      var mid = V(a.x + dx / 2, wallH / 2, a.z + dz / 2);
      var n = V(-dz / len, 0, dx / len);
      if (n.dot(mid) < 0) n.multiplyScalar(-1);
      eg.userData = { center: mid, normal: n };
      wallEdges.push(eg);
      roomGroup.add(eg);
    }

    // Geräte
    s.items.forEach(function (it) {
      var cat = byId(it.catId);
      if (!cat || !cat.footprint || !cat.footprint[it.tier]) return;
      var fp = cat.footprint[it.tier];
      var rot = ((it.rot || 0) * Math.PI) / 180;
      var w = Math.abs(fp.w * Math.cos(rot)) + Math.abs(fp.d * Math.sin(rot));
      var d = Math.abs(fp.w * Math.sin(rot)) + Math.abs(fp.d * Math.cos(rot));
      var hCm = EQUIP_H[it.catId] || EQUIP_H_DEFAULT;
      var g = MODELS[it.catId] ? MODELS[it.catId](fp, it.tier) : buildBox(fp, it.tier, hCm);
      g.position.set((it.x + w / 2) / 100 - cx, 0.01, (it.y + d / 2) / 100 - cz);
      g.rotation.y = -rot;
      roomGroup.add(g);
    });

    // Zubehör: kompakte Lagerecke (keine 2D-Position vorhanden, siehe oben)
    if (s.accessories && s.accessories.length) {
      var roomW = maxX - minX, roomD = maxZ - minZ;
      var alongX = roomW >= roomD;   // in der längeren Raumrichtung aufreihen
      var inset = 0.35;
      var baseX = minX - cx + inset, baseZ = minZ - cz + inset;
      var cursor = 0;
      s.accessories.forEach(function (a) {
        var fpA = ACCESSORY_FP[a.catId];
        if (!fpA || !MODELS[a.catId]) return;
        var am = MODELS[a.catId](fpA, a.tier);
        if (a.catId === "barbell") {
          // liegt flach an der nächstgelegenen Wand entlang
          am.rotation.y = alongX ? 0 : Math.PI / 2;
          am.position.set(baseX + (alongX ? 1.1 : 0.25), 0.01, baseZ + (alongX ? 0.25 : 1.1));
        } else {
          am.position.set(
            baseX + (alongX ? cursor + 0.35 : 0.35),
            0.01,
            baseZ + (alongX ? 0.35 : cursor + 0.35)
          );
          cursor += 0.8;
        }
        roomGroup.add(am);
      });
    }

    radius = Math.max(3.2, Math.hypot(maxX - minX, maxZ - minZ) * 1.15 + 1.5);
    radiusMin = Math.max(1.2, radius * 0.22);
    radiusMax = radius * 3.2;
    target = V(0, wallH * 0.35, 0);
  }

  function applyWallMode() {
    if (!wallEdges.length) return;
    for (var i = 0; i < wallEdges.length; i++) {
      var e = wallEdges[i];
      if (wallMode === "all") { e.visible = true; continue; }
      if (wallMode === "none") { e.visible = false; continue; }
      // "front": Wand ausblenden, wenn die Kamera auf ihrer Außenseite steht
      var toCam = new THREE.Vector3().subVectors(camera.position, e.userData.center).normalize();
      e.visible = toCam.dot(e.userData.normal) < 0.2;
    }
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!target) return;
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.sin(theta)
    );
    camera.lookAt(target);
    applyWallMode();
    renderer.render(scene, camera);
  }
})();
