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

  // Planungs-Richthöhen je Kategorie in cm (ca.) — nur für die Box-Darstellung.
  var EQUIP_H = {
    rack: 230, bench: 50, cable: 220, chestpress: 125, legpress: 150,
    smith: 210, treadmill: 140, bike: 130, rower: 55, barbell: 25,
    plates: 95, dumbbells: 65, kettlebells: 35, flooring: 2
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
        items: Array.isArray(st.items) ? st.items : []
      };
    }
    var lEl = document.getElementById("roomLength"), bEl = document.getElementById("roomWidth");
    var L = (parseFloat(lEl && lEl.value) || 4.5) * 100;
    var B = (parseFloat(bEl && bEl.value) || 3.5) * 100;
    return {
      shape: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: B }, { x: 0, y: B }],
      doors: [{ edge: 2, pos: Math.max(10, L - 20 - 90), width: 90, hinge: "end" }],
      items: []
    };
  }
  function byId(catId) {
    if (typeof VITARO_EQUIPMENT === "undefined") return null;
    for (var i = 0; i < VITARO_EQUIPMENT.length; i++) if (VITARO_EQUIPMENT[i].id === catId) return VITARO_EQUIPMENT[i];
    return null;
  }

  /* ---------- kleine Geometrie-Helfer ---------- */
  function V(x, y, z) { return new THREE.Vector3(x, y, z); }

  /* ---------- Geräte-Darstellung: maßstäbliche Box ---------- */
  function buildBox(fp, tier, hCm) {
    var g = new THREE.Group();
    var h = (hCm || EQUIP_H_DEFAULT) / 100;
    var box = new THREE.Mesh(new THREE.BoxGeometry(fp.w / 100, h, fp.d / 100),
      new THREE.MeshStandardMaterial({ color: tier === "premium" ? 0xa85c3f : 0x5c7a5c, roughness: 0.8 }));
    box.position.y = h / 2; box.castShadow = true;
    g.add(box);
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry),
      new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.3 })).translateY(h / 2));
    return g;
  }

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
      var g = buildBox(fp, it.tier, hCm);
      g.position.set((it.x + w / 2) / 100 - cx, 0.01, (it.y + d / 2) / 100 - cz);
      g.rotation.y = -rot;
      roomGroup.add(g);
    });

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
