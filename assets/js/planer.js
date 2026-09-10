/* ---------- PLANER + KOSTENRECHNER ----------
   Guarded on #plannerApp existing, so this is a no-op on every other page.
   Room + placed equipment live in one state object, re-rendered on every
   change; the cost panel is just another view over the same state, so
   Planer and Kostenrechner can never drift apart - that IS the "verknüpft"
   requirement, not a separate sync step. State is mirrored to
   localStorage so a returning visitor keeps their layout. */
(function(){
  var app = document.getElementById("plannerApp");
  if(!app || typeof VITARO_EQUIPMENT === "undefined") return;

  var FLOOR_CATS = VITARO_EQUIPMENT.filter(function(c){ return c.placement === "floor"; });
  var ACCESSORY_CATS = VITARO_EQUIPMENT.filter(function(c){ return c.placement === "accessory"; });
  var FLOORING = VITARO_EQUIPMENT.filter(function(c){ return c.placement === "covering"; })[0];

  var byId = {};
  VITARO_EQUIPMENT.forEach(function(c){ byId[c.id] = c; });

  var eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  var num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

  var STORAGE_KEY = "vitaroPlannerState";
  var CANVAS_MAX_W = 640, CANVAS_MAX_H = 520;

  var state = {
    room: { L: 4.5, B: 3.5, shape: null, doors: null }, // shape: [{x,y}cm] Polygon, doors: [{edge,pos,width}], beide werden beim Laden erzeugt, falls leer
    items: [],       // {uid, catId, tier, x, y, rot}  x/y/footprint in cm
    accessories: [],  // {uid, catId, tier, qty}
    flooring: { included: false, tier: "budget", qty: null, auto: true },
    paletteTier: {},  // catId -> "budget"|"premium", pending choice before adding
    pkg: "essential", // gewähltes Paket für die Servicepauschale
    pkgManual: false, // true sobald der Nutzer das Paket selbst umgeschaltet hat
    showClearance: true, // Sicherheitsabstände im Grundriss ein-/ausblenden
    snapEnabled: false // Geräte beim Verschieben am Raster einrasten statt frei
  };
  var SNAP_STEP_CM = 50; // deckt sich mit dem sichtbaren 50cm-Rasterlinienabstand
  // Beim Anpassen der Raumkontur wird - anders als beim Geräte-Raster oben -
  // IMMER (nicht ab-/anschaltbar) eingerastet: der Winkel zum vorherigen
  // Eckpunkt IMMER auf ein 15°-Vielfaches (kein "Magnet" mit freier Zone
  // dazwischen mehr - jede Wand landet auf 0/15/30/45/.../345°), die Distanz
  // entlang dieses Winkels zusätzlich aufs 10cm-Raster. Soll Laien
  // zuverlässig vor einer krummen Freiform-Kontur bewahren, ohne die exakte
  // Anpassung per Klick auf ein Maß zu verbauen (siehe editEdgeDimension).
  var ROOM_SNAP_CM = 10;
  var ROOM_ANGLE_SNAP_DEG = 15;

  var uidCounter = 1;
  function nextUid(){ return "i" + (uidCounter++); }

  // Which placed item currently has its name label pinned on (click-to-reveal).
  // Kept outside `state` on purpose - it's transient UI, not part of the plan -
  // but still tracked explicitly rather than left as a DOM class, so any
  // re-render (adding another item, rotating, a window resize) reapplies it
  // instead of silently losing it the moment renderItems() rebuilds the DOM.
  var activeItemUid = null;
  var activeDoorIdx = null; // Index in state.room.doors, oder null - für Breite-Feld/Löschkreuz
  // renderRoom() beim Auswählen einer Tür baut das DOM neu auf - der native
  // "click", der nach einem reinen Antippen (ohne Ziehen) folgt, würde
  // dadurch beim Hochblubbern zum Canvas-Klick-Handler auf ein bereits
  // ersetztes Element treffen und die Tür sofort wieder abwählen. Dieses
  // Flag unterdrückt genau diesen einen nachfolgenden Klick.
  var suppressNextCanvasDeselect = false;
  // Während eine Wand im Anpassmodus aktiv geschoben wird: leichte
  // gestrichelte Hilfslinien entlang aller (fast) kolinearen anderen Wände,
  // damit man sieht, wann die geschobene Wand bündig ist. null = kein
  // aktiver Wand-Zug. Jede Linie: {x1,y1,x2,y2} in Raum-cm, on = bündig.
  var wallDragGuides = null;

  /* ---------- persistence ---------- */
  /* ---------- Verlauf (Rückgängig/Wiederholen) ----------
     Jeder save() (also jede echte Änderung - Gerät verschoben, Raum
     angepasst, Tür verschoben, ...) landet als Schnappschuss im Verlauf.
     Rückgängig/Wiederholen springt einfach im Verlauf hin und her - deckt
     dadurch automatisch ALLE Änderungsarten ab, ohne pro Aktion eine
     eigene Undo-Logik schreiben zu müssen. */
  var history = [], historyIdx = -1, restoringHistory = false;
  function save(){
    var snap = JSON.stringify(state);
    try{ localStorage.setItem(STORAGE_KEY, snap); }catch(e){}
    if(restoringHistory) return;
    if(history[historyIdx] === snap) return; // keine echte Änderung
    history = history.slice(0, historyIdx + 1);
    history.push(snap);
    historyIdx = history.length - 1;
    updateUndoRedoButtons();
  }
  function restoreSnapshot(snap){
    restoringHistory = true;
    try{
      var parsed = JSON.parse(snap);
      ["room", "items", "accessories", "flooring", "paletteTier", "pkg", "pkgManual", "showClearance", "snapEnabled"].forEach(function(k){
        if(k in parsed) state[k] = parsed[k];
      });
      activeItemUid = null;
      try{ localStorage.setItem(STORAGE_KEY, snap); }catch(e){}
      lengthInput.value = state.room.L; widthInput.value = state.room.B;
      renderRoom(); renderPalette(); renderAccessoryPalette(); renderCostPanel();
    } finally { restoringHistory = false; }
  }
  function undo(){ if(historyIdx > 0){ historyIdx--; restoreSnapshot(history[historyIdx]); updateUndoRedoButtons(); } }
  function redo(){ if(historyIdx < history.length - 1){ historyIdx++; restoreSnapshot(history[historyIdx]); updateUndoRedoButtons(); } }
  function updateUndoRedoButtons(){
    if(undoBtn) undoBtn.disabled = historyIdx <= 0;
    if(redoBtn) redoBtn.disabled = historyIdx >= history.length - 1;
  }
  function load(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) throw 0; // kein gespeicherter Plan - unten direkt zur Migration/Default-Kontur springen
      var parsed = JSON.parse(raw);
      if(parsed && parsed.room) state.room = parsed.room;
      if(Array.isArray(parsed.items)){
        state.items = parsed.items.filter(function(it){ return byId[it.catId]; });
      }
      if(Array.isArray(parsed.accessories)){
        state.accessories = parsed.accessories.filter(function(a){ return byId[a.catId]; });
      }
      if(parsed.flooring) state.flooring = parsed.flooring;
      if(parsed.pkg) state.pkg = parsed.pkg;
      if(parsed.pkgManual) state.pkgManual = true;
      if(typeof parsed.showClearance === "boolean") state.showClearance = parsed.showClearance;
      if(typeof parsed.snapEnabled === "boolean") state.snapEnabled = parsed.snapEnabled;
      var maxUid = 0;
      state.items.concat(state.accessories).forEach(function(o){
        var n = parseInt(String(o.uid).replace("i",""), 10);
        if(!isNaN(n) && n > maxUid) maxUid = n;
      });
      uidCounter = maxUid + 1;
    }catch(e){}
    // Ältere gespeicherte Pläne kennen nur L/B (Rechteck) - daraus wird beim
    // ersten Laden ein 4-Punkte-Rechteck-Polygon erzeugt, damit alle Geräte-
    // Positionen unverändert erhalten bleiben, nur intern läuft ab jetzt
    // alles über die Kontur (shape).
    if(!state.room.shape || !Array.isArray(state.room.shape) || state.room.shape.length < 3){
      state.room.shape = rectShape(state.room.L * 100, state.room.B * 100);
    }
    ensureDoors();
  }
  // Türmaße nach DIN 18101 (Türblattgrößen Wohnungsbau: 610/735/860/985/
  // 1110/1235 mm) und DIN 18040 (barrierefrei):
  //  - lichte Mindestbreite: 80 cm ist das bauübliche Minimum für Wohnräume,
  //    90 cm der barrierefreie Richtwert - für ein Home-Gym praxisgerecht,
  //    damit Geräte durchpassen. Wir setzen 90 cm als Minimum.
  //  - größtes Einzelblatt nach DIN 18101 = 1110 mm; bis ~1,10 m ist eine
  //    einflügelige Tür Standard.
  //  - ab 1,50 m beginnt der sinnvolle Einsatzbereich der zweiflügeligen Tür
  //    (ein Einzelflügel wäre zu schwer und müsste zu weit schwenken).
  //  - größtes zweiflügeliges Standardmaß ≈ 1985 mm, daher Deckel 2,00 m.
  // WICHTIG: vor load() definieren - load() ruft ensureDoors() auf, das diese
  // Werte braucht (sonst wurde die Türbreite beim Laden zu NaN und dann auf
  // das Minimum zurückgesetzt).
  var DOOR_MIN_CM = 90, DOOR_SINGLE_MAX_CM = 110, DOOR_DOUBLE_FROM_CM = 150, DOOR_MAX_CM = 200;
  // Pflicht-Abstand Türkante <-> Raumecke auf JEDER Seite. Eine Wand, die
  // kürzer wird als Mindestbreite + 2x dieser Abstand (= 110 cm), kann keine
  // Tür mehr tragen -> die Tür wird automatisch entfernt (vorher so weit wie
  // möglich auf das Mindestmaß geschrumpft).
  var DOOR_EDGE_CLEAR_CM = 10;
  var DOOR_WALL_MIN_CM = DOOR_MIN_CM + 2 * DOOR_EDGE_CLEAR_CM;
  load();
  history = [JSON.stringify(state)]; historyIdx = 0; // Ausgangszustand ist die erste Verlauf-Station, kein Sprung davor


  /* ---------- helpers ---------- */
  function tierData(catId, tier){ return byId[catId].tiers[tier]; }
  function priceLabel(cat, tier){
    var t = tierData(cat.id, tier);
    var p = (t.priceNote ? t.priceNote + " " : "") + eur.format(t.price);
    if(cat.unit === "kg") return p + "/kg";
    if(cat.unit === "m²") return p + "/m²";
    return p;
  }
  function footprintFor(catId, tier){ return byId[catId].footprint[tier]; }

  /* ---------- Raumkontur (Polygon statt festem Rechteck) ----------
     state.room.shape ist eine Liste von {x,y}-Eckpunkten in cm, im
     Uhrzeigersinn. Ein einfaches Rechteck ist nur der Sonderfall aus 4
     Punkten (rectShape) - alle Geometrie-Funktionen unten arbeiten generell
     auf dem Polygon, damit Nutzer per "Raum anpassen" auch Erker, Nischen
     oder eine abgeschnittene Ecke abbilden können. */
  function rectShape(Lcm, Bcm){
    return [{ x: 0, y: 0 }, { x: Lcm, y: 0 }, { x: Lcm, y: Bcm }, { x: 0, y: Bcm }];
  }
  function polygonBBox(shape){
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    shape.forEach(function(p){
      if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
      if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y;
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: maxX - minX, h: maxY - minY };
  }
  // CSS clip-path in Prozent relativ zur Bounding Box - schneidet Hintergrund/
  // Raster exakt auf die Kontur zu, bei einem Rechteck deckungsgleich mit der
  // Box (keine sichtbare Änderung gegenüber vorher).
  function polygonClipPath(shape, bb){
    return "polygon(" + shape.map(function(p){
      return (((p.x - bb.minX) / bb.w) * 100) + "% " + (((p.y - bb.minY) / bb.h) * 100) + "%";
    }).join(",") + ")";
  }
  function polygonAreaCm2(shape){
    var a = 0;
    for(var i = 0; i < shape.length; i++){
      var p1 = shape[i], p2 = shape[(i + 1) % shape.length];
      a += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(a) / 2;
  }
  function roomAreaM2(){ return Math.round((polygonAreaCm2(state.room.shape) / 10000) * 10) / 10; }
  function pointInPolygon(x, y, shape){
    var inside = false;
    for(var i = 0, j = shape.length - 1; i < shape.length; j = i++){
      var xi = shape[i].x, yi = shape[i].y, xj = shape[j].x, yj = shape[j].y;
      var hit = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }
  // Kreuzen sich die beiden Strecken a-b und c-d echt (nicht nur Berührung
  // an einem Endpunkt)?
  function segmentsCross(a, b, c, d){
    function o(p, q, r){ return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
    var o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    var EPS = 1e-6;
    if(Math.abs(o1) < EPS || Math.abs(o2) < EPS || Math.abs(o3) < EPS || Math.abs(o4) < EPS) return false;
    return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0));
  }
  // Liegen a-b und c-d auf derselben Geraden UND überlappen sie sich (mehr
  // als nur ein Berührpunkt)? Genau der Fall, wenn man eine Nischen-Wand
  // durch die gegenüberliegende schiebt: zwei Wandstücke liegen dann
  // deckungsgleich übereinander, ohne sich im Sinne von segmentsCross zu
  // "kreuzen".
  function segmentsOverlapCollinear(a, b, c, d){
    function cr(o, p, q){ return (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x); }
    if(Math.abs(cr(a, b, c)) > 1 || Math.abs(cr(a, b, d)) > 1) return false; // nicht kollinear
    // Dieselben zwei (ggf. zusammengefallenen) Punkte -> das ist eine
    // Faltung, die removeCollinearVertices sauber auflöst (z.B. wenn eine
    // Nischen-Wand exakt bündig auf ihre Gegenwand rastet), kein Knoten.
    if((Math.hypot(a.x - c.x, a.y - c.y) < 2 && Math.hypot(b.x - d.x, b.y - d.y) < 2) ||
       (Math.hypot(a.x - d.x, a.y - d.y) < 2 && Math.hypot(b.x - c.x, b.y - c.y) < 2)) return false;
    var dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    var tc = ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2;
    var td = ((d.x - a.x) * dx + (d.y - a.y) * dy) / len2;
    var lo = Math.min(tc, td), hi = Math.max(tc, td);
    return hi > 0.01 && lo < 0.99; // echte Überlappung im Inneren von a-b
  }
  // Überschneidet sich der Umriss selbst (zwei nicht benachbarte Wände
  // kreuzen sich oder liegen deckungsgleich übereinander)? Solche
  // verschachtelten/verknoteten Formen werden beim Ziehen blockiert.
  function polygonSelfIntersects(shape){
    var n = shape.length;
    if(n < 4) return false;
    for(var i = 0; i < n; i++){
      var a = shape[i], b = shape[(i + 1) % n];
      for(var j = i + 1; j < n; j++){
        if((i + 1) % n === j || (j + 1) % n === i) continue; // benachbarte Kanten teilen einen Eckpunkt
        var c = shape[j], d = shape[(j + 1) % n];
        if(segmentsCross(a, b, c, d) || segmentsOverlapCollinear(a, b, c, d)) return true;
      }
    }
    return false;
  }
  function polygonSignedArea(shape){
    var a = 0, n = shape.length;
    for(var i = 0; i < n; i++){ var p = shape[i], q = shape[(i + 1) % n]; a += p.x * q.y - q.x * p.y; }
    return a / 2;
  }
  // Bleibt der Umriss nach einer Ecken-/Wand-Änderung eine saubere Form?
  // Blockiert wird: Selbstüberschneidung, Umklappen der Orientierung (Wand
  // über die gegenüberliegende hinausgezogen) und ein Kollaps unter 0,5 m².
  // Liegt der rote Schwenkbereich jeder Tür noch vollständig im (neuen)
  // Grundriss? Sonst hätte eine Wand hineingeschnitten -> Änderung sperren.
  function doorSwingsClear(shape){
    // nur bei gleichbleibender Eckenzahl zuverlässig (sonst sind die Tür-
    // Kantenindizes noch nicht an eingefügte/entfernte Ecken angepasst).
    if(state.room.shape && shape.length !== state.room.shape.length) return true;
    return (state.room.doors || []).every(function(d){
      return doorSectorPolys(d, shape).every(function(p){
        var cx = 0, cy = 0;
        p.forEach(function(pt){ cx += pt.x; cy += pt.y; });
        cx /= p.length; cy /= p.length;
        return p.every(function(pt){
          var vx = cx - pt.x, vy = cy - pt.y, vl = Math.hypot(vx, vy) || 1;
          return pointInPolygon(pt.x + (vx / vl) * 4, pt.y + (vy / vl) * 4, shape);
        });
      });
    });
  }
  function shapeStaysValid(newShape, refShape){
    if(polygonSelfIntersects(newShape)) return false;
    var an = polygonSignedArea(newShape);
    if(Math.abs(an) < 5000) return false;
    if(refShape){
      var ar = polygonSignedArea(refShape);
      if(ar !== 0 && an * ar <= 0) return false;
    }
    if(!doorSwingsClear(newShape)) return false;
    return true;
  }
  // Nur ECHTE Kreuzungen (Figur-8), nicht das bloße Aufeinanderliegen zweier
  // Wände. Beim Schieben einer Wand darf sie sich flächig an eine andere
  // anlegen (das schließt einen Schlitz) - das wird danach aufgelöst.
  function polygonHasCrossing(shape){
    var n = shape.length;
    for(var i = 0; i < n; i++){
      var a = shape[i], b = shape[(i + 1) % n];
      for(var j = i + 1; j < n; j++){
        if((i + 1) % n === j || (j + 1) % n === i) continue;
        if(segmentsCross(a, b, shape[j], shape[(j + 1) % n])) return true;
      }
    }
    return false;
  }
  // Wie shapeStaysValid, aber flächiges Anliegen (Schlitz schließen) ist
  // erlaubt - der so entstehende innen umschlossene Bereich wird beim
  // Loslassen von dropEnclosedRegions() entfernt.
  function dragShapeOk(newShape, refShape){
    if(polygonHasCrossing(newShape)) return false;
    var an = polygonSignedArea(newShape);
    if(Math.abs(an) < 5000) return false;
    var ar = polygonSignedArea(refShape);
    if(ar !== 0 && an * ar <= 0) return false;
    if(!doorSwingsClear(newShape)) return false;
    return true;
  }
  // Schließt man einen schmalen Schlitz komplett, kann eine Teilfläche innen
  // umschlossen werden (Loch im Grundriss). Solche Löcher sind nicht erlaubt:
  // an der Berührstelle (zwei nicht benachbarte Eckpunkte fallen zusammen)
  // wird der Ring in zwei Schleifen getrennt und nur die größere behalten.
  // Türen werden über ihre WELT-Position gerettet (nicht über den Kanten-
  // Index, der dabei komplett neu wird) - sie sollen nicht "wegfliegen".
  function dropEnclosedRegions(){
    var doorMids = (state.room.doors || []).map(function(d){
      var sp = doorSpan(d);
      return { x: (sp.p1.x + sp.p2.x) / 2, y: (sp.p1.y + sp.p2.y) / 2 };
    });
    var changed = false;
    for(var guard = 0; guard < 20; guard++){
      var s = state.room.shape, n = s.length, hit = null;
      for(var i = 0; i < n && !hit; i++){
        for(var j = i + 2; j < n; j++){
          if(i === 0 && j === n - 1) continue; // benachbart (Wrap)
          if(Math.hypot(s[i].x - s[j].x, s[i].y - s[j].y) < 4){ hit = [i, j]; break; }
        }
      }
      if(!hit) break;
      var loopA = s.slice(hit[0], hit[1]);
      var loopB = s.slice(hit[1]).concat(s.slice(0, hit[0]));
      var keep = Math.abs(polygonSignedArea(loopA)) >= Math.abs(polygonSignedArea(loopB)) ? loopA : loopB;
      if(keep.length < 3) break;
      state.room.shape = keep.map(function(p){ return { x: p.x, y: p.y }; });
      changed = true;
    }
    if(!changed) return;
    // Türen wieder auf die (jetzt) nächstgelegene Wand an ihrer alten
    // Weltposition setzen - Kanten-Index und Position neu bestimmen.
    (state.room.doors || []).forEach(function(d, k){
      var m = doorMids[k]; if(!m) return;
      var cp = closestPerimeterPoint(state.room.shape, m.x, m.y);
      d.edge = cp.edge;
      d.pos = Math.max(0, Math.min(cp.pos - d.width / 2, Math.max(0, cp.edgeLen - d.width)));
    });
  }
  // Verschiebt Kontur + alle platzierten Geräte gemeinsam so, dass die
  // Bounding Box wieder bei (0,0) beginnt - nötig, weil das Ziehen einer
  // Ecke nach links/oben sonst negative Koordinaten erzeugen würde und
  // damit der Nullpunkt verrutscht, an dem sich Geräte-Positionen und
  // Raster orientieren. Eine reine Verschiebung ändert an der Tür-Position
  // nichts, da die relativ zu ihrer Kante gespeichert ist.
  function normalizeRoom(){
    var bb = polygonBBox(state.room.shape);
    if(Math.abs(bb.minX) < 0.01 && Math.abs(bb.minY) < 0.01) return;
    state.room.shape.forEach(function(p){ p.x -= bb.minX; p.y -= bb.minY; });
    state.items.forEach(function(it){ it.x -= bb.minX; it.y -= bb.minY; });
  }
  function updateRoomLB(){
    var bb = polygonBBox(state.room.shape);
    state.room.L = Math.round((bb.w / 100) * 100) / 100;
    state.room.B = Math.round((bb.h / 100) * 100) / 100;
  }

  /* ---------- Zugang (Türen) in der Wand ----------
     state.room.doors = [{edge, pos, width}, ...]: edge ist der Index der
     Kante (von shape[edge] nach shape[edge+1]), pos der Abstand vom
     Kantenanfang bis zum Türanfang, width die Türbreite - alles in cm.
     doors[0] ist beim Start die vorgegebene Standardtür; weitere kommen
     über den "+ Weitere Tür platzieren"-Button dazu. Jede Tür ist löschbar,
     solange danach noch mindestens eine übrig bleibt (welche das ist, ist
     egal). Eine Tür lässt sich frei am gesamten Umriss entlangziehen
     (auch um Ecken herum, siehe closestPerimeterPoint) statt nur auf einer
     fest gewählten Wand. */
  function longestEdgeIndex(){
    var bi = 0, bl = -1;
    for(var i = 0; i < state.room.shape.length; i++){
      var l = edgeInfo(state.room.shape, i).len;
      if(l > bl){ bl = l; bi = i; }
    }
    return bi;
  }
  function edgeInfo(shape, i){
    var a = shape[i], b = shape[(i + 1) % shape.length];
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    return { a: a, b: b, ux: dx / len, uy: dy / len, len: len };
  }
  // Nächster Punkt auf dem GESAMTEN Umriss (nicht nur einer Kante) zu einem
  // beliebigen Raumpunkt - Grundlage fürs freie Ziehen einer Tür über
  // Eckpunkte hinweg: welche Kante "gewinnt" ergibt sich einfach daraus,
  // welche dem Mauszeiger gerade am nächsten ist.
  function closestPerimeterPoint(shape, x, y){
    var best = null;
    for(var i = 0; i < shape.length; i++){
      var a = shape[i], b = shape[(i + 1) % shape.length];
      var dx = b.x - a.x, dy = b.y - a.y;
      var len2 = dx * dx + dy * dy || 1;
      var t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      var px = a.x + dx * t, py = a.y + dy * t;
      var dist = Math.hypot(px - x, py - y);
      if(best === null || dist < best.dist) best = { dist: dist, edge: i, pos: t * Math.sqrt(len2), edgeLen: Math.sqrt(len2) };
    }
    return best;
  }
  // Sorgt dafür, dass jede Tür nach jeder Formänderung (Kante entfernt,
  // Raum verkleinert...) weiterhin auf einer existierenden, ausreichend
  // langen Kante liegt - sonst würde sie unsichtbar/ungültig werden.
  // Migriert nebenbei das alte Einzeltür-Format (state.room.door) einmalig.
  // Anschlagseite (Scharnier) nach der 0,2-m-Regel: sitzt die Tür auf einer
  // Seite <= 20 cm an der Raumecke, scharniert sie automatisch DORT (Türblatt
  // schlägt gegen die nahe Wand auf). Sind beide Abstände > 20 cm, bleibt die
  // (ggf. manuell per Flip-Knopf gesetzte) Seite unverändert.
  function autoHinge(d, elen){
    if(d.hinge !== "start" && d.hinge !== "end") d.hinge = "start";
    if(d.hingeManual) return; // von Hand gewählte Seite nicht überschreiben
    var gS = d.pos, gE = elen - d.pos - d.width, TH = 20;
    if(gS <= TH && gE <= TH) d.hinge = gS <= gE ? "start" : "end";
    else if(gS <= TH) d.hinge = "start";
    else if(gE <= TH) d.hinge = "end";
  }
  // Umfangs-Position/-Länge für den Mindestabstand zwischen Türen.
  function perimeterLen(shape){
    var s = 0;
    for(var i = 0; i < shape.length; i++) s += edgeInfo(shape, i).len;
    return s;
  }
  function doorPerimSpan(dr, shape){
    var start = 0;
    for(var i = 0; i < dr.edge && i < shape.length; i++) start += edgeInfo(shape, i).len;
    return { a: start + dr.pos, b: start + dr.pos + dr.width };
  }
  // Überlappen zwei Tür-Umfangsspannen (inkl. Puffer je Seite) auf dem
  // geschlossenen Umriss?
  function doorSpansClash(sa, sb, P, buffer){
    var lo = sb.a - buffer, hi = sb.b + buffer;
    for(var k = -1; k <= 1; k++){
      if(sa.a + k * P < hi && sa.b + k * P > lo) return true;
    }
    return false;
  }
  // Schiebt Türen, die sich (nach einer Formänderung o.ä.) zu nah gekommen
  // sind, entlang ihrer Wand auseinander (>= 10 cm Abstand). Best effort.
  function resolveDoorSpacing(){
    var shape = state.room.shape, doors = state.room.doors || [];
    if(doors.length < 2) return;
    var P = perimeterLen(shape);
    for(var pass = 0; pass < 4; pass++){
      var moved = false;
      for(var i = 1; i < doors.length; i++){
        var di = doors[i], e = edgeInfo(shape, di.edge);
        var maxPos = Math.max(10, e.len - di.width - 10);
        for(var j = 0; j < i; j++){
          if(doorSpansClash(doorPerimSpan(di, shape), doorPerimSpan(doors[j], shape), P, 10)){
            var np = Math.min(maxPos, di.pos + 20);
            if(np <= di.pos){ np = Math.max(10, di.pos - 20); }
            if(np !== di.pos){ di.pos = np; moved = true; }
          }
        }
      }
      if(!moved) break;
    }
  }
  function ensureDoors(prune){
    if(prune === undefined) prune = true; // beim reinen Render (nicht Commit) NICHT löschen
    var shape = state.room.shape;
    if(!Array.isArray(state.room.doors) || state.room.doors.length === 0){
      if(state.room.door){ state.room.doors = [state.room.door]; }
      else {
        // Standardtür: unten (Ursprungswand), 20 cm von der linken Ecke,
        // Anschlag an dieser Ecke.
        var be = shape.length > 2 ? 2 : longestEdgeIndex();
        var bl = edgeInfo(shape, be).len;
        var w0 = Math.max(DOOR_MIN_CM, Math.min(DOOR_MIN_CM, bl - 2 * DOOR_EDGE_CLEAR_CM));
        state.room.doors = [{ edge: be, pos: Math.max(DOOR_EDGE_CLEAR_CM, bl - 20 - w0), width: w0, hinge: "end" }];
      }
    }
    delete state.room.door;
    for(var i = state.room.doors.length - 1; i >= 0; i--){
      var d = state.room.doors[i];
      if(d.edge == null || d.edge < 0 || d.edge >= shape.length) d.edge = 0;
      var e = edgeInfo(shape, d.edge);
      // Wand zu kurz für eine Tür (Mindestbreite + 10 cm je Seite)?
      if(e.len < DOOR_WALL_MIN_CM){
        if(i === 0){
          // Die Standardtür bleibt erhalten - sie wandert auf die längste
          // Wand, sofern die überhaupt lang genug ist.
          var li = longestEdgeIndex();
          if(edgeInfo(shape, li).len >= DOOR_WALL_MIN_CM){ d.edge = li; e = edgeInfo(shape, li); }
        } else if(prune){
          // Zusätzliche Tür in einer zu kurz gewordenen Wand -> automatisch
          // entfernen. Nur beim Commit (Drag-Ende etc.), nicht schon während
          // des Ziehens - sonst wäre die Tür beim Zurückziehen für immer weg.
          state.room.doors.splice(i, 1);
          if(activeDoorIdx === i) activeDoorIdx = null;
          else if(activeDoorIdx !== null && activeDoorIdx > i) activeDoorIdx--;
          continue;
        }
      }
      // Breite automatisch mit der Wand schrumpfen lassen - bis aufs
      // Mindestmaß, immer 10 cm Luft zu jeder Raumecke.
      var maxW = Math.max(DOOR_MIN_CM, Math.min(DOOR_MAX_CM, e.len - 2 * DOOR_EDGE_CLEAR_CM));
      d.width = Math.max(DOOR_MIN_CM, Math.min(d.width || DOOR_MIN_CM, maxW));
      var minPos = DOOR_EDGE_CLEAR_CM;
      var maxPos = Math.max(minPos, e.len - d.width - DOOR_EDGE_CLEAR_CM);
      if(d.pos == null || d.pos < minPos) d.pos = minPos;
      if(d.pos > maxPos) d.pos = maxPos;
      autoHinge(d, e.len);
    }
    if(state.room.doors.length === 0){
      state.room.doors = [{ edge: longestEdgeIndex(), pos: DOOR_EDGE_CLEAR_CM, width: DOOR_MIN_CM, hinge: "start" }];
    }
    if(prune) resolveDoorSpacing(); // nur beim Commit auseinanderschieben, nicht mitten im Ziehen
  }
  // Tür-Endpunkte in Raum-cm, für Zeichnen + Ziehen.
  function doorSpanOn(d, shape){
    var e = edgeInfo(shape, d.edge % shape.length);
    return {
      p1: { x: e.a.x + e.ux * d.pos, y: e.a.y + e.uy * d.pos },
      p2: { x: e.a.x + e.ux * (d.pos + d.width), y: e.a.y + e.uy * (d.pos + d.width) },
      e: e
    };
  }
  function doorSpan(d){ return doorSpanOn(d, state.room.shape); }
  // Scharnierpunkt einer (einflügeligen) Tür je nach Anschlagseite.
  function doorHingePt(d, sp){
    sp = sp || doorSpan(d);
    return d.hinge === "end" ? sp.p2 : sp.p1;
  }
  // Der rote Schwenkbereich einer Tür als Polygon(e) in Raum-cm (Viertel-
  // kreis-Sektor je Türblatt). Basis für: keine Wand / andere Tür darf
  // hinein.
  function doorSectorPolys(d, shape){
    shape = shape || state.room.shape;
    if(d.edge == null || d.edge < 0 || d.edge >= shape.length) return [];
    // Breite/Position so, wie ensureDoors sie an dieser Wand einrasten würde
    // (sonst ragt eine Tür auf einer schrumpfenden Nachbarwand rechnerisch
    // aus der Wand und der Sektor wäre Unsinn).
    var e = edgeInfo(shape, d.edge);
    var w = Math.max(DOOR_MIN_CM, Math.min(d.width || DOOR_MIN_CM, e.len - 2 * DOOR_EDGE_CLEAR_CM));
    var pos = Math.max(DOOR_EDGE_CLEAR_CM, Math.min(d.pos, Math.max(DOOR_EDGE_CLEAR_CM, e.len - w - DOOR_EDGE_CLEAR_CM)));
    var sp = {
      p1: { x: e.a.x + e.ux * pos, y: e.a.y + e.uy * pos },
      p2: { x: e.a.x + e.ux * (pos + w), y: e.a.y + e.uy * (pos + w) },
      e: e
    };
    var nx = -sp.e.uy, ny = sp.e.ux;
    var mx = (sp.p1.x + sp.p2.x) / 2, my = (sp.p1.y + sp.p2.y) / 2;
    if(!pointInPolygon(mx + nx * 15, my + ny * 15, shape)){ nx = -nx; ny = -ny; }
    function sector(H, C, r){
      var a0 = Math.atan2(C.y - H.y, C.x - H.x);
      var aO = Math.atan2(ny, nx);
      var da = aO - a0;
      while(da > Math.PI) da -= 2 * Math.PI;
      while(da < -Math.PI) da += 2 * Math.PI;
      var pts = [{ x: H.x, y: H.y }];
      for(var i = 0; i <= 7; i++){
        var a = a0 + da * (i / 7);
        pts.push({ x: H.x + Math.cos(a) * r, y: H.y + Math.sin(a) * r });
      }
      return pts;
    }
    if(w >= DOOR_DOUBLE_FROM_CM){
      var mid = { x: mx, y: my };
      return [sector(sp.p1, mid, w / 2), sector(sp.p2, mid, w / 2)];
    }
    var H = d.hinge === "end" ? sp.p2 : sp.p1;
    var C = d.hinge === "end" ? sp.p1 : sp.p2;
    return [sector(H, C, w)];
  }
  function polysOverlap(A, B){
    for(var i = 0; i < A.length; i++){
      var a1 = A[i], a2 = A[(i + 1) % A.length];
      for(var j = 0; j < B.length; j++){
        if(segmentsCross(a1, a2, B[j], B[(j + 1) % B.length])) return true;
      }
    }
    return pointInPolygon(A[1].x, A[1].y, B) || pointInPolygon(B[1].x, B[1].y, A);
  }

  var scale = 1; // px per cm, recomputed on render
  function computeScale(){
    var bb = polygonBBox(state.room.shape);
    // CANVAS_MAX_W is the desktop ceiling - on narrow screens (Handy) the
    // actual rendered width of canvasOuter is smaller than that, so use
    // whichever is tighter. Otherwise the canvas stayed desktop-sized and
    // forced the whole room either to overflow sideways or (once that grid
    // bug was fixed) to only be reachable by scrolling inside a tiny box -
    // neither is "optimiert für mobile". 40 = canvasOuter's 20px padding
    // on each side (see .planner-canvas-outer in style.css).
    var availableW = canvasOuter.clientWidth ? canvasOuter.clientWidth - 40 : CANVAS_MAX_W;
    var maxW = Math.max(220, Math.min(CANVAS_MAX_W, availableW));
    scale = Math.min(maxW / bb.w, CANVAS_MAX_H / bb.h);
  }

  // Belegte Fläche (Bounding Box) bei beliebigem Drehwinkel: die 90°/270°-
  // Fälle tauschen w/d exakt (cos/sin ergeben genau 0/1), 0°/180° behalten
  // sie, und 45°-Schritte (seit der Erweiterung auf freiere Drehung) fallen
  // automatisch als Zwischenwert heraus - dieselbe Formel deckt alle
  // Winkel ab, keine Sonderfälle mehr nötig.
  function rectFor(it){
    var fp = footprintFor(it.catId, it.tier);
    var rad = ((it.rot || 0) * Math.PI) / 180;
    var w = Math.abs(fp.w * Math.cos(rad)) + Math.abs(fp.d * Math.sin(rad));
    var d = Math.abs(fp.w * Math.sin(rad)) + Math.abs(fp.d * Math.cos(rad));
    return { x: it.x, y: it.y, w: w, d: d };
  }

  // Hält ein Gerät innerhalb der Raumkontur. Erster Schritt: die Bounding
  // Box in die Bounding Box des Raums klemmen (billig, deckt das normale
  // Rechteck bereits vollständig ab). Bei einer eingezogenen Ecke/Nische
  // kann das Gerät danach aber noch teilweise außerhalb der echten Kontur
  // liegen - dann in kleinen Schritten Richtung Raummitte schieben, bis
  // alle vier Ecken wirklich im Polygon liegen.
  function clampItem(it){
    var bb = polygonBBox(state.room.shape);
    var r = rectFor(it);
    it.x = Math.max(bb.minX, Math.min(it.x, Math.max(bb.minX, bb.minX + bb.w - r.w)));
    it.y = Math.max(bb.minY, Math.min(it.y, Math.max(bb.minY, bb.minY + bb.h - r.d)));
    if(state.room.shape.length <= 4) return; // reines Rechteck: obiger Schritt reicht bereits exakt
    var cx = bb.minX + bb.w / 2, cy = bb.minY + bb.h / 2;
    for(var tries = 0; tries < 40; tries++){
      var obb = obbFor(it);
      var corners = obbCorners(obb);
      // Ecken vor dem Test einen winzigen Schritt Richtung Gerätemitte
      // einziehen (1cm) - pointInPolygon ist für Punkte, die EXAKT auf der
      // Kontur liegen, unzuverlässig (kann je nach Rundung/zusätzlichem,
      // kollinearem Eckpunkt auf der Wand fälschlich "außerhalb" liefern).
      // Ohne das rutschte ein Gerät, das flächenbündig an einer Wand
      // anliegt, wieder von ihr weg, sobald der Raum mehr als 4 Eckpunkte
      // hat - genau der gemeldete "kann nicht ganz an die Wand"-Fehler.
      var allIn = corners.every(function(c){
        var dx = obb.cx - c[0], dy = obb.cy - c[1];
        var len = Math.hypot(dx, dy) || 1;
        var tx = c[0] + (dx / len) * 1, ty = c[1] + (dy / len) * 1;
        return pointInPolygon(tx, ty, state.room.shape);
      });
      if(allIn) break;
      it.x += (cx - obb.cx) * 0.12;
      it.y += (cy - obb.cy) * 0.12;
    }
  }
  /* ---------- echte Rechteck-Kollision (auch bei schräger Drehung) ----------
     rectFor()/zoneAabb() liefern nur die achsenparallele Bounding Box - bei
     45°/135°/... ist die deutlich GRÖSSER als das tatsächliche gedrehte
     Rechteck (bei 45° bis zu doppelt so groß), weil sie auch die leeren
     Ecken mit einschließt. Ein einfacher overlaps()-Test auf diesen Boxen
     meldet dadurch bei diagonalen Winkeln oft eine Kollision, obwohl sich
     die echten Formen gar nicht berühren. Für "darf sich nie überlappen"
     (Geräte untereinander, Zugangszone vs. Gerät) reicht das nicht - hier
     also ein echter Rechteck-gegen-Rechteck-Test per Trennachsen-Theorem
     (SAT), der auch bei beliebigem Drehwinkel korrekt ist. */
  function obbFor(it){
    var fp = footprintFor(it.catId, it.tier);
    var r = rectFor(it); // Mittelpunkt ist bei jedem Winkel exakt richtig, nur w/d sind hier die AABB
    return { cx: r.x + r.w / 2, cy: r.y + r.d / 2, hw: fp.w / 2, hh: fp.d / 2, rot: ((it.rot || 0) * Math.PI) / 180 };
  }
  function obbForZone(zr){
    return { cx: zr.cx, cy: zr.cy, hw: zr.w / 2, hh: zr.h / 2, rot: ((zr.rot || 0) * Math.PI) / 180 };
  }
  function obbCorners(o){
    var c = Math.cos(o.rot), s = Math.sin(o.rot);
    var ax = [c, s], ay = [-s, c];
    var pts = [];
    [-1, 1].forEach(function(sx){
      [-1, 1].forEach(function(sy){
        pts.push([
          o.cx + sx * o.hw * ax[0] + sy * o.hh * ay[0],
          o.cy + sx * o.hw * ax[1] + sy * o.hh * ay[1]
        ]);
      });
    });
    return pts;
  }
  function projectOntoAxis(pts, axis){
    var min = Infinity, max = -Infinity;
    pts.forEach(function(p){
      var d = p[0] * axis[0] + p[1] * axis[1];
      if(d < min) min = d;
      if(d > max) max = d;
    });
    return [min, max];
  }
  function obbOverlap(a, b){
    var pa = obbCorners(a), pb = obbCorners(b);
    var ca = Math.cos(a.rot), sa = Math.sin(a.rot);
    var cb = Math.cos(b.rot), sb = Math.sin(b.rot);
    var axes = [[ca, sa], [-sa, ca], [cb, sb], [-sb, cb]];
    for(var i = 0; i < axes.length; i++){
      var ia = projectOntoAxis(pa, axes[i]), ib = projectOntoAxis(pb, axes[i]);
      if(ia[1] < ib[0] || ib[1] < ia[0]) return false; // Trennachse gefunden - keine Überlappung
    }
    return true;
  }

  // Geräte-FOOTPRINTS dürfen sich nie überlappen (harte Regel) - anders als
  // ihre Sicherheitszonen, die sich untereinander frei überlappen dürfen.
  function footprintCollides(it){
    var a = obbFor(it);
    return state.items.some(function(other){
      return other.uid !== it.uid && obbOverlap(a, obbFor(other));
    });
  }

  /* ---------- Sicherheitsabstände ("Freiraum") rund um platzierte Geräte ----------
     clearance in equipment-data.js ist in den nativen, ungedrehten Kanten des
     Footprints angegeben (top=Y0, bottom=Y1, left=X0, right=X1 bei rot=0).
     Die Zonen werden nativ aufgebaut und dann - wie das Gerät selbst über
     CSS transform:rotate() - um it.rot gedreht (siehe rotateOffset unten),
     das funktioniert bei JEDEM Winkel, auch 45°/135°/... Recherchiert
     (Herstellerhandbücher, DSSV, Fitness-Planungsratgeber) - keine
     DIN/DGUV-Norm schreibt diese Werte vor, siehe sourceLabel je Kategorie.
     Rein informativ, blockiert nichts (außer dem Zugangsbereich, siehe
     accessRectFor). */

  // Dreht einen Versatz-Vektor (in nativen, ungedrehten cm) um denselben
  // Winkel, mit dem das Gerät selbst per CSS transform:rotate() gedreht
  // wird - dieselbe Rotationsrichtung, damit eine Zone bei JEDEM Winkel
  // (nicht nur den vier Himmelsrichtungen) exakt am Gerät "kleben" bleibt.
  function rotateOffset(offX, offY, rotDeg){
    var rad = ((rotDeg || 0) * Math.PI) / 180;
    var c = Math.cos(rad), s = Math.sin(rad);
    return { x: offX * c - offY * s, y: offX * s + offY * c };
  }

  // Zone wird jetzt als rotiertes Rechteck beschrieben (Mittelpunkt + native,
  // ungedrehte Breite/Höhe + Winkel) statt als achsenparalleles x/y/w/d -
  // gerendert wird sie wie das Gerät selbst per CSS transform:rotate() um
  // ihren eigenen Mittelpunkt, dadurch passt sie bei jedem Winkel, auch
  // 45°/135°/... (vorher gab es dort nur einen groben, ungerichteten
  // Mittelwert-Puffer statt einer echten gedrehten Zone).
  function clearanceRectFor(it){
    var cat = byId[it.catId];
    var cl = cat.clearance;
    if(!cl) return null;
    var fp = footprintFor(it.catId, it.tier);
    var r = rectFor(it);
    var cx = r.x + r.w / 2, cy = r.y + r.d / 2;
    var off = rotateOffset((cl.right - cl.left) / 2, (cl.bottom - cl.top) / 2, it.rot);
    return {
      cx: cx + off.x, cy: cy + off.y,
      w: fp.w + cl.left + cl.right, h: fp.d + cl.top + cl.bottom,
      rot: it.rot || 0
    };
  }

  // Der Zugangsbereich ist die eine Seite des Freiraums, die man tatsächlich
  // braucht, um ans Gerät heranzutreten/aufzusteigen (z.B. hinter dem
  // Laufband) - anders als der übrige Freiraum darf hier kein ANDERES Gerät
  // mit seinem eigenen Footprint hineinstehen. Dass sich zwei Freiraum-Zonen
  // überlappen, bleibt dagegen ausdrücklich erlaubt (siehe renderItems).
  // cl.access nennt eine der vier NATIVEN Kanten (top/bottom/left/right bei
  // rot=0); die Zone wird dafür nativ (unrotiert) aufgebaut und dann - wie
  // das Gerät selbst - um it.rot gedreht. Funktioniert dadurch bei jedem
  // Winkel, nicht nur den vier Himmelsrichtungen.
  function accessRectFor(it){
    var cat = byId[it.catId];
    var cl = cat.clearance;
    if(!cl || !cl.access) return null;
    var fp = footprintFor(it.catId, it.tier);
    var r = rectFor(it);
    var cx = r.x + r.w / 2, cy = r.y + r.d / 2;
    var dist = cl[cl.access];
    var offX0 = 0, offY0 = 0, w, h;
    switch(cl.access){
      case "top":    offY0 = -(fp.d + dist) / 2; w = fp.w; h = dist; break;
      case "bottom": offY0 =  (fp.d + dist) / 2; w = fp.w; h = dist; break;
      case "left":   offX0 = -(fp.w + dist) / 2; w = dist; h = fp.d; break;
      case "right":  offX0 =  (fp.w + dist) / 2; w = dist; h = fp.d; break;
    }
    var off = rotateOffset(offX0, offY0, it.rot);
    return { cx: cx + off.x, cy: cy + off.y, w: w, h: h, rot: it.rot || 0 };
  }

  // Achsenparallele Bounding Box einer (ggf. gedrehten) Zone - für die
  // Wand-/Überlappungsprüfungen, die nur ein einfaches x/y/w/d brauchen.
  // Bei den 4 Himmelsrichtungen (die einzigen Winkel, die tryAutoRotate...
  // testet) ist das exakt, sonst eine leicht konservativere Näherung -
  // genau dieselbe Näherung, die schon für die Geräte-Überlappung selbst
  // verwendet wird (rects[] aus rectFor).
  function zoneAabb(zr){
    var rad = ((zr.rot || 0) * Math.PI) / 180;
    var w = Math.abs(zr.w * Math.cos(rad)) + Math.abs(zr.h * Math.sin(rad));
    var d = Math.abs(zr.w * Math.sin(rad)) + Math.abs(zr.h * Math.cos(rad));
    return { x: zr.cx - w / 2, y: zr.cy - d / 2, w: w, d: d };
  }

  // Passt die Drehung automatisch an, wenn entweder der Zugangsbereich über
  // die Raumgrenze hinausragen würde ("in eine Wand ragt") ODER der
  // Zugangsbereich ein anderes platziertes Gerät (dessen echten Footprint)
  // trifft - probiert dafür ausschließlich die vier rechtwinkligen
  // Ausrichtungen (eine Diagonale "passend drehen" ergibt geometrisch keinen
  // sinnvollen Sinn) und übernimmt die mit der geringsten "Schlechte"
  // (Wand-Überstand in cm, ein Treffer auf ein anderes Gerät zählt schwer).
  // Das Gerät selbst überlappt dabei nie ein anderes - das verhindert schon
  // das Ziehen selbst (siehe footprintCollides in wireDragHandlers), hier
  // geht es nur um dessen Zugangsbereich. Greift nur, wenn es tatsächlich
  // ein Problem gibt - eine bewusst frei/schräg platzierte Aufstellung wird
  // nicht angetastet, solange sie passt.
  function tryAutoRotateForFit(it){
    var cat = byId[it.catId];
    if(!cat.clearance || !cat.clearance.access) return false;
    function badnessAt(rot){
      var saved = it.rot;
      it.rot = rot;
      var ar = accessRectFor(it);
      var fpObb = obbFor(it);
      var hitsDevice = state.items.some(function(other){
        return other.uid !== it.uid && obbOverlap(fpObb, obbFor(other));
      });
      it.rot = saved;
      if(hitsDevice) return Infinity; // diese Drehung würde selbst ein anderes Gerät überlappen - nie wählen
      if(!ar) return 0;
      var o = 0;
      // Wandüberstand: echte Kontur statt nur der Bounding Box prüfen - bei
      // einer Nische/einem Erker reicht "innerhalb der Box" nicht, die Ecke
      // der Zugangszone kann dort trotzdem außerhalb der Wand landen.
      var aabb = zoneAabb(ar);
      var corners = [[aabb.x, aabb.y], [aabb.x + aabb.w, aabb.y], [aabb.x, aabb.y + aabb.d], [aabb.x + aabb.w, aabb.y + aabb.d]];
      corners.forEach(function(c){
        if(!pointInPolygon(c[0], c[1], state.room.shape)) o += 500;
      });
      var arObb = obbForZone(ar); // Kollision mit anderen Geräten: hier zählt die echte (ggf. gedrehte) Form
      state.items.forEach(function(other){
        if(other.uid !== it.uid && obbOverlap(arObb, obbFor(other))) o += 1000;
      });
      return o;
    }
    var current = it.rot || 0;
    var currentBadness = badnessAt(current);
    if(currentBadness <= 0) return false;
    var best = current, bestBadness = currentBadness;
    [0, 90, 180, 270].forEach(function(rot){
      var b = badnessAt(rot);
      if(b < bestBadness){ bestBadness = b; best = rot; }
    });
    if(best !== current){
      it.rot = best;
      clampItem(it);
      return true;
    }
    return false;
  }

  /* ---------- DOM refs ---------- */
  var canvas = document.getElementById("plannerCanvas");
  var canvasOuter = document.getElementById("plannerCanvasOuter");
  var lengthInput = document.getElementById("roomLength");
  var widthInput = document.getElementById("roomWidth");
  var areaLabel = document.getElementById("plannerRoomArea");
  var flooringToggle = document.getElementById("flooringToggle");
  var clearanceToggle = document.getElementById("clearanceToggle");
  var undoBtn = document.getElementById("planUndoBtn");
  var redoBtn = document.getElementById("planRedoBtn");
  var shapeEditToggle = document.getElementById("roomShapeToggle");
  var shapeResetBtn = document.getElementById("roomShapeReset");
  var shapePanelBody = document.getElementById("roomShapePanelBody");
  var doorWidthInput = document.getElementById("doorWidthInput");
  var doorWidthField = document.getElementById("doorWidthField");
  var addDoorBtn = document.getElementById("addDoorBtn");
  var snapToggle = document.getElementById("snapToggle");
  var flooringTierSwitch = document.getElementById("flooringTierSwitch");
  var fitMsg = document.getElementById("plannerFitMsg");
  var selectedInfo = document.getElementById("plannerSelectedInfo");
  var palette = document.getElementById("plannerPalette");
  var accessoryPalette = document.getElementById("plannerAccessoryPalette");
  var costList = document.getElementById("plannerCostList");
  var totalEl = document.getElementById("plannerTotal");
  var resetBtn = document.getElementById("plannerReset");
  var handoverBtn = document.getElementById("plannerHandover");
  var pdfBtn = document.getElementById("plannerPdf");
  var packageSwitch = document.getElementById("packageSwitch");
  var packageSuggestNote = document.getElementById("packageSuggestNote");
  var breakdownEl = document.getElementById("plannerBreakdown");
  var mobileTabs = document.getElementById("plannerMobileTabs");
  var mobilePricebar = document.getElementById("plannerMobilePricebar");
  var mobileTotalEl = document.getElementById("plannerMobileTotal");
  var mobilePricebarBtn = document.getElementById("plannerMobilePricebarBtn");
  var gateInner = document.getElementById("plannerGateInner");
  var gateOverlay = document.getElementById("costGateOverlay");
  var costGateText = document.getElementById("costGateText");
  var timerBadge = document.getElementById("plannerTimerBadge");

  /* ---------- render: room + grid + flooring ---------- */
  function renderRoom(){
    computeScale();
    var bb = polygonBBox(state.room.shape);
    var wPx = Math.round(bb.w * scale);
    var hPx = Math.round(bb.h * scale);
    canvas.style.width = wPx + "px";
    canvas.style.height = hPx + "px";
    canvas.innerHTML = "";

    // Boden/Raster/Wandlinie stecken in einer eigenen, geclippten Ebene -
    // schneidet exakt auf die echte Kontur zu (bei einem Rechteck deckungs-
    // gleich mit der Box, keine sichtbare Änderung; bei einer angepassten
    // Form fällt der Bereich außerhalb weg). Eckpunkte/Maß-Badges/Geräte
    // bleiben bewusst AUSSERHALB dieser Ebene (Geschwister von ihr), sonst
    // würde ein Maß, das leicht nach außen versetzt ist (z.B. an einer nach
    // innen gezogenen Nische), von genau dieser Kontur mit abgeschnitten.
    var floorLayer = document.createElement("div");
    floorLayer.className = "planner-floor-layer";
    floorLayer.style.clipPath = polygonClipPath(state.room.shape, bb);
    canvas.appendChild(floorLayer);

    if(state.flooring.included){
      var fill = document.createElement("div");
      fill.className = "planner-flooring-fill";
      fill.dataset.tier = state.flooring.tier;
      var tileCm = 50 * scale;
      fill.style.backgroundSize = tileCm + "px " + tileCm + "px";
      floorLayer.appendChild(fill);
    }

    // grid lines every 20cm, stronger every 100cm
    var Lcm = bb.w, Bcm = bb.h;
    for(var x = 0; x <= Lcm + 0.01; x += 20){
      var line = document.createElement("div");
      line.className = "planner-grid-line" + (x % 100 < 1 ? " strong" : "");
      line.style.left = Math.round(x * scale) + "px";
      line.style.top = "0"; line.style.width = "1px"; line.style.height = hPx + "px";
      floorLayer.appendChild(line);
    }
    for(var y = 0; y <= Bcm + 0.01; y += 20){
      var lineH = document.createElement("div");
      lineH.className = "planner-grid-line" + (y % 100 < 1 ? " strong" : "");
      lineH.style.top = Math.round(y * scale) + "px";
      lineH.style.left = "0"; lineH.style.height = "1px"; lineH.style.width = wPx + "px";
      floorLayer.appendChild(lineH);
    }
    // Maßleiste wie in einem üblichen Koordinatensystem: Nullpunkt UNTEN
    // LINKS, x-Zahlen laufen unten am Planer entlang nach rechts, y-Zahlen
    // links daneben nach oben. Nur die Zahl je Marke, ohne Einheit - die
    // steht als Hinweis über der Ansicht ("Alle Maße in Metern").
    var xMarks = [];
    for(var m = 1; m * 100 < Lcm; m++) xMarks.push(m);
    xMarks.forEach(function(m){
      var lx = document.createElement("span");
      lx.className = "planner-grid-label";
      lx.style.left = Math.round(m * 100 * scale) + "px"; lx.style.top = (hPx + 5) + "px";
      lx.style.transform = "translateX(-50%)"; // auf der Marke zentriert
      lx.textContent = m.toFixed(2).replace(".", ",");
      canvas.appendChild(lx);
    });
    var yMarks = [];
    for(var mb = 1; mb * 100 < Bcm; mb++) yMarks.push(mb);
    yMarks.forEach(function(mb){
      var ly = document.createElement("span");
      ly.className = "planner-grid-label";
      // von unten gezählt: Marke mb Meter über dem Boden; rechtsbündig an
      // die y-Achse geschoben (translate -100%) statt links abgeschnitten.
      ly.style.top = Math.round(hPx - mb * 100 * scale) + "px"; ly.style.left = "-8px";
      ly.style.transform = "translate(-100%, -50%)";
      ly.textContent = mb.toFixed(2).replace(".", ",");
      canvas.appendChild(ly);
    });
    // "0" im Ursprung unten links: senkrecht auf einer Höhe mit den
    // x-Zahlen (unten am Planer), waagerecht rechtsbündig in der y-Spalte -
    // gilt so für beide Achsen.
    var lz = document.createElement("span");
    lz.className = "planner-grid-label";
    lz.style.left = "-8px"; lz.style.top = (hPx + 5) + "px"; lz.style.transform = "translate(-100%, 0)";
    lz.textContent = "0";
    canvas.appendChild(lz);

    renderRoomOutline(bb, floorLayer);
    renderDoorControls();
    areaLabel.textContent = "≈ " + num.format(roomAreaM2()) + " m²";
    renderItems();
    renderShapeEditor(bb);
  }

  // Zeichnet die Wandlinie als SVG (statt CSS-border) - so kann sie den
  // echten, ggf. angepassten Ecken folgen UND an der Türposition eine Lücke
  // zeigen. Bei einem unveränderten Rechteck sieht das Ergebnis identisch
  // zur vorherigen CSS-border-Lösung aus.
  function renderRoomOutline(bb, floorLayer){
    ensureDoors(false); // beim Zeichnen nur anpassen, nie löschen (siehe Commit-Aufrufe)
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "planner-room-outline");
    svg.setAttribute("width", Math.round(bb.w * scale));
    svg.setAttribute("height", Math.round(bb.h * scale));
    function toPx(p){ return [(p.x - bb.minX) * scale, (p.y - bb.minY) * scale]; }

    // Wand als einzelne Segmente je Kante zeichnen und die Türöffnungen
    // dabei echt AUSSPAREN (statt sie hinterher mit der Hintergrundfarbe zu
    // übermalen) - so bleibt an der Tür wirklich eine Lücke in der Wand.
    var shape = state.room.shape;
    for(var ei = 0; ei < shape.length; ei++){
      var ea = shape[ei], e = edgeInfo(shape, ei);
      var doorGaps = state.room.doors
        .filter(function(dd){ return dd.edge === ei; })
        .map(function(dd){ return [Math.max(0, dd.pos), Math.min(e.len, dd.pos + dd.width)]; })
        .sort(function(x, y){ return x[0] - y[0]; });
      var cursor = 0;
      (function(edgeStart, edgeInfoRef){
        function wallSeg(s0, s1){
          if(s1 - s0 < 0.5) return;
          var p0 = toPx({ x: edgeStart.x + edgeInfoRef.ux * s0, y: edgeStart.y + edgeInfoRef.uy * s0 });
          var p1 = toPx({ x: edgeStart.x + edgeInfoRef.ux * s1, y: edgeStart.y + edgeInfoRef.uy * s1 });
          var seg = document.createElementNS(svgNS, "line");
          seg.setAttribute("x1", p0[0]); seg.setAttribute("y1", p0[1]);
          seg.setAttribute("x2", p1[0]); seg.setAttribute("y2", p1[1]);
          seg.setAttribute("style", "stroke:var(--text-dim);stroke-width:4;stroke-linecap:square");
          svg.appendChild(seg);
        }
        doorGaps.forEach(function(g){
          if(g[0] > cursor) wallSeg(cursor, g[0]);
          cursor = Math.max(cursor, g[1]);
        });
        if(cursor < edgeInfoRef.len) wallSeg(cursor, edgeInfoRef.len);
      })(ea, e);
    }

    state.room.doors.forEach(function(d, di){
      var span = doorSpan(d);
      var d1 = toPx(span.p1), d2 = toPx(span.p2);
      // Kurze Laibungsstriche quer zur Wand an beiden Türkanten - üblicher
      // Bestandteil eines Grundriss-Türsymbols ("Durchbruch in der Wand"),
      // macht auf den ersten Blick klarer, dass hier eine Öffnung ist statt
      // nur eine andersfarbige Wandstelle.
      var jambLen = 6;
      var jux = -span.e.uy * jambLen, juy = span.e.ux * jambLen;
      [d1, d2].forEach(function(pt){
        var jamb = document.createElementNS(svgNS, "line");
        jamb.setAttribute("x1", pt[0] - jux); jamb.setAttribute("y1", pt[1] - juy);
        jamb.setAttribute("x2", pt[0] + jux); jamb.setAttribute("y2", pt[1] + juy);
        jamb.setAttribute("style", "stroke:var(--text-dim);stroke-width:2");
        svg.appendChild(jamb);
      });

      // Öffnungsrichtung ins Rauminnere bestimmen (Normale auf die Wand,
      // welche Seite tatsächlich im Polygon liegt) - Grundlage für
      // Schwenklinie(n) + roten Schwenkbereich.
      var nx = -span.e.uy, ny = span.e.ux;
      var midX = (span.p1.x + span.p2.x) / 2, midY = (span.p1.y + span.p2.y) / 2;
      if(!pointInPolygon(midX + nx * 20, midY + ny * 20, state.room.shape)){ nx = -nx; ny = -ny; }
      var isDouble = d.width >= DOOR_DOUBLE_FROM_CM;
      var blocked = doorBlocked(d, di);
      var zoneCls = "planner-door-swing" + (blocked ? " is-blocked" : "");
      function leafGeometry(hinge, closedTip, radius){
        var openEnd = { x: hinge.x + nx * radius, y: hinge.y + ny * radius };
        var hPx = toPx(hinge), cPx = toPx(closedTip), oPx = toPx(openEnd);
        var cross = (cPx[0] - hPx[0]) * (oPx[1] - hPx[1]) - (cPx[1] - hPx[1]) * (oPx[0] - hPx[0]);
        var sweep = cross > 0 ? 1 : 0;
        var rPx = radius * scale;
        return {
          // Zahlen direkt zurückgeben statt als Pfad-String, der später per
          // Regex zerlegt wird - bei Koordinaten in Exponentialschreibweise
          // (z.B. 5.6e-14 durch Float-Rundung) zerbrach die Regex und das
          // Türblatt wurde als schräge Linie quer durch den Raum gezeichnet.
          hPx: hPx, oPx: oPx,
          arc: "M " + cPx[0] + " " + cPx[1] + " A " + rPx + " " + rPx + " 0 0 " + sweep + " " + oPx[0] + " " + oPx[1],
          sector: "M " + hPx[0] + " " + hPx[1] + " L " + cPx[0] + " " + cPx[1] +
                  " A " + rPx + " " + rPx + " 0 0 " + sweep + " " + oPx[0] + " " + oPx[1] + " Z"
        };
      }
      var leaves = [];
      if(isDouble){
        var midPt = { x: midX, y: midY };
        leaves.push(leafGeometry(span.p1, midPt, d.width / 2));
        leaves.push(leafGeometry(span.p2, midPt, d.width / 2));
      } else {
        // Anschlagseite: Scharnier an p1 (Kantenanfang) oder p2 (Kantenende)
        var hp = d.hinge === "end" ? span.p2 : span.p1;
        var tp = d.hinge === "end" ? span.p1 : span.p2;
        leaves.push(leafGeometry(hp, tp, d.width));
      }
      var doorParts = [];
      leaves.forEach(function(lf){
        var sector = document.createElementNS(svgNS, "path");
        sector.setAttribute("d", lf.sector);
        sector.setAttribute("class", zoneCls);
        svg.appendChild(sector);
        // Das Türblatt selbst - durchgezogene Linie (die Schwenk-Kurve
        // bleibt gestrichelt, das ist nur die Bahn, nicht die Tür).
        var swingLine = document.createElementNS(svgNS, "line");
        swingLine.setAttribute("x1", lf.hPx[0]); swingLine.setAttribute("y1", lf.hPx[1]);
        swingLine.setAttribute("x2", lf.oPx[0]); swingLine.setAttribute("y2", lf.oPx[1]);
        swingLine.setAttribute("class", "planner-door-leaf");
        svg.appendChild(swingLine);
        // Schwenkbahn (Viertelkreis-Bogen) - gestrichelt, dünn.
        var arc = document.createElementNS(svgNS, "path");
        arc.setAttribute("d", lf.arc);
        arc.setAttribute("class", "planner-door-swing-line");
        svg.appendChild(arc);
        doorParts.push(sector, swingLine);
      });

      // Verschieben/Auswählen einer Tür nur im "Grundriss anpassen"-Modus.
      // Greifbar ist jetzt der ganze Schwenkbereich UND das Türblatt (nicht
      // nur ein schmaler Streifen an der Wand) - das war bei der ersten Tür
      // an der Ecke oft gar nicht zu treffen. Dazu ein breiter, unsichtbarer
      // Streifen entlang der Wand, etwas ins Rauminnere versetzt (der
      // clip-path der Boden-Ebene endet genau an der Wand).
      if(state.roomEditMode){
        var hitOff = 10 * scale;
        var hit = document.createElementNS(svgNS, "line");
        hit.setAttribute("x1", d1[0] + nx * hitOff); hit.setAttribute("y1", d1[1] + ny * hitOff);
        hit.setAttribute("x2", d2[0] + nx * hitOff); hit.setAttribute("y2", d2[1] + ny * hitOff);
        hit.setAttribute("class", "planner-door-hit");
        hit.setAttribute("style", "stroke:transparent;stroke-width:26");
        svg.appendChild(hit);
        wireDoorDrag(hit, di);
        doorParts.forEach(function(p){
          p.style.cursor = "grab";
          p.style.pointerEvents = "auto"; // Schwenkbereich/Türblatt selbst greifbar machen
          wireDoorDrag(p, di);
        });

        // --- Maße an der Tür (beide direkt antippbar zum Ändern) ---
        //  1) Abstand von der näheren Türkante zur näheren Raumecke der
        //     Wand, auf der die Tür sitzt - wird automatisch erzeugt.
        //  2) die Türbreite selbst - hier wird die Breite eingestellt
        //     (nicht mehr im Formular oben).
        var e0 = span.e;
        var gapStart = d.pos, gapEnd = e0.len - d.pos - d.width;
        var nearIsStart = gapStart <= gapEnd;
        var nearOffset = nearIsStart ? gapStart : gapEnd;
        var cornerPt = nearIsStart
          ? { x: e0.a.x, y: e0.a.y }
          : { x: e0.a.x + e0.ux * e0.len, y: e0.a.y + e0.uy * e0.len };
        var doorNearPt = nearIsStart ? span.p1 : span.p2;
        var dimRot = Math.round((Math.atan2(e0.uy, e0.ux) * 180) / Math.PI);
        if(dimRot > 90 || dimRot < -90) dimRot += 180; // immer aufrecht lesbar
        function doorDimBadge(fromPt, toPt, meters, kind, offPx){
          var mmx = (fromPt.x + toPt.x) / 2, mmy = (fromPt.y + toPt.y) / 2;
          var off = offPx / scale;
          // Tür-Maße auf die AUSSENseite der Tür (weg vom Rauminneren),
          // im gleichen Abstand wie die Wand-Maße zu ihren Linien.
          var bx = (mmx - nx * off - bb.minX) * scale, by = (mmy - ny * off - bb.minY) * scale;
          var badge = document.createElement("button");
          badge.type = "button";
          badge.className = "planner-shape-dim planner-door-dim" + (kind === "width" ? " is-width" : "");
          badge.style.left = Math.round(bx) + "px";
          badge.style.top = Math.round(by) + "px";
          badge.style.transform = "translate(-50%,-50%) rotate(" + dimRot + "deg)";
          badge.textContent = meters.toFixed(2).replace(".", ",");
          badge.title = kind === "offset"
            ? "Abstand Tür zur Wand - antippen zum Ändern"
            : "Türbreite - antippen zum Ändern (0,90 m bis 2,00 m)";
          badge.addEventListener("click", function(ev){
            ev.stopPropagation();
            if(kind === "offset") editDoorOffset(di, nearIsStart);
            else editDoorWidth(di);
          });
          canvas.appendChild(badge);
        }
        if(nearOffset > 1) doorDimBadge(cornerPt, doorNearPt, nearOffset / 100, "offset", 20);
        doorDimBadge(span.p1, span.p2, d.width / 100, "width", 20);
      }

      // Löschkreuz - für JEDE ausgewählte Tür (auch die zuerst gesetzte),
      // solange danach noch mindestens eine Tür übrig bleibt. Bei nur noch
      // einer Tür wird kein Kreuz gezeigt.
      if(state.roomEditMode && di === activeDoorIdx && state.room.doors.length > 1){
        var midPx = toPx({ x: midX, y: midY });
        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "planner-door-remove";
        delBtn.style.left = Math.round(midPx[0]) + "px";
        delBtn.style.top = Math.round(midPx[1]) + "px";
        delBtn.textContent = "×";
        delBtn.title = "Diese Tür entfernen";
        (function(idx){
          delBtn.addEventListener("click", function(e){
            e.stopPropagation();
            state.room.doors.splice(idx, 1);
            activeDoorIdx = null;
            save(); renderRoom(); renderCostPanel();
          });
        })(di);
        canvas.appendChild(delBtn);
      }

      // Anschlag-Flip-Knopf - für die gerade ausgewählte einflügelige Tür,
      // sitzt mittig AUF dem Türblatt (Scharnier -> offen). Sitzt die Tür an
      // einer Ecke (0,2-m-Regel), setzt autoHinge die Seite gleich wieder
      // zurück; frei in der Wand bleibt die manuelle Wahl erhalten.
      if(state.roomEditMode && di === activeDoorIdx && !isDouble){
        var fH = d.hinge === "end" ? span.p2 : span.p1;
        var fbx = (fH.x + nx * (d.width / 2) - bb.minX) * scale;
        var fby = (fH.y + ny * (d.width / 2) - bb.minY) * scale;
        var flipBtn = document.createElement("button");
        flipBtn.type = "button";
        flipBtn.className = "planner-door-flip";
        flipBtn.style.left = Math.round(fbx) + "px";
        flipBtn.style.top = Math.round(fby) + "px";
        // Das ⇄-Symbol zeigt entlang der Wand (an einer senkrechten Wand also
        // hoch/runter), weil der Anschlag zwischen den beiden Türkanten an
        // der Wand wechselt.
        var flipRot = Math.round((Math.atan2(span.e.uy, span.e.ux) * 180) / Math.PI);
        flipBtn.style.transform = "translate(-50%,-50%) rotate(" + flipRot + "deg)";
        flipBtn.textContent = "⇄";
        flipBtn.title = "Anschlagseite der Tür wechseln";
        (function(idx){
          flipBtn.addEventListener("click", function(e){
            e.stopPropagation();
            var dr = state.room.doors[idx];
            dr.hinge = dr.hinge === "end" ? "start" : "end";
            dr.hingeManual = true; // bleibt so, auch nah an einer Ecke
            save(); renderRoom();
          });
        })(di);
        canvas.appendChild(flipBtn);
      }
    });
    floorLayer.appendChild(svg);
  }

  // Prüft, ob der Schwenkbereich einer Tür von einem Gerät blockiert wird
  // (grobe Näherung über die Bounding Box des Schwenkkreises, analog zu den
  // Zugangszonen der Geräte) - rein informativ (rote Markierung), verhindert
  // das Platzieren nicht aktiv, genau wie bei den Geräte-Zugangszonen.
  // Alle Türschwenkbereiche als Kreise (Scharnierpunkt + Radius) - bei einer
  // zweiflügeligen Tür zwei halb so große Kreise (einer je Türblatt), sonst
  // ein Kreis mit vollem Radius. Grundlage sowohl für die rote Anzeige als
  // auch für die harte Kollision (Geräte dürfen dort nicht hineingezogen
  // werden bzw. werden automatisch herausgeschoben, siehe unten).
  function doorSwingCircles(){
    var circles = [];
    state.room.doors.forEach(function(d){
      var span = doorSpan(d);
      if(d.width >= DOOR_DOUBLE_FROM_CM){
        circles.push({ cx: span.p1.x, cy: span.p1.y, r: d.width / 2 });
        circles.push({ cx: span.p2.x, cy: span.p2.y, r: d.width / 2 });
      } else {
        var hpc = doorHingePt(d, span);
        circles.push({ cx: hpc.x, cy: hpc.y, r: d.width });
      }
    });
    return circles;
  }
  // Exakter Kreis-gegen-Rechteck-Test (nächster Punkt auf dem Rechteck zum
  // Kreismittelpunkt) statt einer groben Bounding-Box-Näherung.
  function circleOverlapsRect(circle, rect){
    var px = Math.max(rect.x, Math.min(circle.cx, rect.x + rect.w));
    var py = Math.max(rect.y, Math.min(circle.cy, rect.y + rect.d));
    var dx = circle.cx - px, dy = circle.cy - py;
    return dx * dx + dy * dy < circle.r * circle.r;
  }
  function doorBlocked(d, di){
    var span = doorSpan(d);
    return state.items.some(function(it){
      var ir = rectFor(it);
      var h1 = d.width >= DOOR_DOUBLE_FROM_CM ? span.p1 : doorHingePt(d, span);
      var hinge1 = { cx: h1.x, cy: h1.y, r: d.width >= DOOR_DOUBLE_FROM_CM ? d.width / 2 : d.width };
      if(circleOverlapsRect(hinge1, ir)) return true;
      if(d.width >= DOOR_DOUBLE_FROM_CM){
        var hinge2 = { cx: span.p2.x, cy: span.p2.y, r: d.width / 2 };
        if(circleOverlapsRect(hinge2, ir)) return true;
      }
      return false;
    });
  }
  // Schiebt jedes Gerät, das gerade in einem Türschwenkbereich steht,
  // automatisch heraus - zuerst radial vom Scharnierpunkt weg (dahin, wo es
  // "eigentlich herkam"), landet es dabei auf einem anderen Gerät, stattdessen
  // in die Gegenrichtung. Wird nach jeder Tür-/Raumänderung aufgerufen, die
  // einen neuen Konflikt erzeugen könnte.
  function resolveDoorConflicts(){
    var circles = doorSwingCircles();
    if(!circles.length) return;
    state.items.forEach(function(it){
      var r0 = rectFor(it);
      var hitCircle = null;
      for(var i = 0; i < circles.length; i++){
        if(circleOverlapsRect(circles[i], r0)){ hitCircle = circles[i]; break; }
      }
      if(!hitCircle) return;
      var origX = it.x, origY = it.y;
      var cx = r0.x + r0.w / 2, cy = r0.y + r0.d / 2;
      var dx = cx - hitCircle.cx, dy = cy - hitCircle.cy;
      var len = Math.hypot(dx, dy) || 1;
      var dirs = [[dx / len, dy / len], [-dx / len, -dy / len]];
      for(var d2 = 0; d2 < dirs.length; d2++){
        it.x = origX; it.y = origY;
        var ok = false;
        for(var tries = 0; tries < 30; tries++){
          var r = rectFor(it);
          var stillHit = circles.some(function(c){ return circleOverlapsRect(c, r); });
          if(!stillHit && !footprintCollides(it)){ ok = true; break; }
          it.x += dirs[d2][0] * 15;
          it.y += dirs[d2][1] * 15;
          clampItem(it);
        }
        if(ok) break;
      }
    });
  }

  // Zieht eine Tür frei am gesamten Umriss entlang (läuft dabei auch um
  // Ecken herum, siehe closestPerimeterPoint) statt nur auf einer fest
  // gewählten Wand - rastet dabei wie die Eckpunkte auf ein 10cm-Raster.
  // Reines Antippen (ohne nennenswerte Bewegung) wählt die Tür stattdessen
  // nur aus (zeigt Breite-Feld + ggf. Löschkreuz).
  function wireDoorDrag(hitEl, doorIdx){
    hitEl.addEventListener("pointerdown", function(e){
      e.preventDefault(); e.stopPropagation();
      try { hitEl.setPointerCapture(e.pointerId); } catch(err){}
      var startX = e.clientX, startY = e.clientY;
      var moved = false;
      function onMove(ev){
        if(Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
        var rect = canvas.getBoundingClientRect();
        var x = (ev.clientX - rect.left) / scale, y = (ev.clientY - rect.top) / scale;
        var hit = closestPerimeterPoint(state.room.shape, x, y);
        var d = state.room.doors[doorIdx];
        var snapped = Math.round(hit.pos / ROOM_SNAP_CM) * ROOM_SNAP_CM;
        snapped = Math.max(0, Math.min(snapped, Math.max(0, hit.edgeLen - d.width)));
        // Nicht in eine andere Tür schieben: mind. 10 cm Abstand am Umriss
        // UND der rote Schwenkbereich darf sich nicht mit dem einer anderen
        // Tür überschneiden (auch über Eck). Kandidat verletzt das -> Frame
        // verwerfen, die Tür bleibt vor der anderen stehen.
        var cand = { edge: hit.edge, pos: snapped, width: d.width, hinge: d.hinge, hingeManual: d.hingeManual };
        autoHinge(cand, hit.edgeLen);
        var P = perimeterLen(state.room.shape);
        var candSpan = doorPerimSpan(cand, state.room.shape);
        var candPolys = doorSectorPolys(cand, state.room.shape);
        var clash = state.room.doors.some(function(od, oi){
          if(oi === doorIdx) return false;
          if(doorSpansClash(candSpan, doorPerimSpan(od, state.room.shape), P, 10)) return true;
          var op = doorSectorPolys(od, state.room.shape);
          return candPolys.some(function(cp){ return op.some(function(o){ return polysOverlap(cp, o); }); });
        });
        if(clash) return;
        if(moved) d.hingeManual = false; // nach dem Verschieben entscheidet wieder die 0,2-m-Regel
        d.edge = hit.edge; d.pos = snapped;
        renderRoom();
      }
      function onUp(){
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if(moved){
          // Landet ein Gerät durch die neue Türposition im Schwenkbereich,
          // wird es automatisch herausgeschoben statt dort stehen zu bleiben.
          resolveDoorConflicts();
          save(); renderRoom();
        } else {
          activeDoorIdx = doorIdx;
          suppressNextCanvasDeselect = true;
          renderDoorControls();
          renderRoom();
        }
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  // Türbreite direkt am Tür-Maß ändern (statt im Formular oben). Grenzen:
  // 0,90 m (lichtes Mindestmaß) bis 2,00 m; ab 1,50 m wird automatisch
  // zweiflügelig gezeichnet. Zusätzlich durch die Wandlänge minus 10 cm je
  // Seite gedeckelt.
  function editDoorWidth(di){
    var d = state.room.doors[di];
    if(!d) return;
    var e = edgeInfo(state.room.shape, d.edge);
    var cur = (d.width / 100).toFixed(2).replace(".", ",");
    var s = window.prompt("Türbreite in Metern (0,90 - 2,00; ab 1,50 zweiflügelig):", cur);
    if(s === null) return;
    var w = parseFloat(String(s).replace(",", ".")) * 100;
    if(!isFinite(w)) return;
    w = Math.max(DOOR_MIN_CM, Math.min(w, DOOR_MAX_CM, Math.max(DOOR_MIN_CM, e.len - 2 * DOOR_EDGE_CLEAR_CM)));
    d.width = w;
    ensureDoors();
    resolveDoorConflicts();
    save(); renderRoom(); renderDoorControls();
  }
  // Abstand der näheren Türkante zur näheren Raumecke der Trägerwand ändern.
  function editDoorOffset(di, nearIsStart){
    var d = state.room.doors[di];
    if(!d) return;
    var e = edgeInfo(state.room.shape, d.edge);
    var maxOff = Math.max(0, e.len - d.width);
    var cur = ((nearIsStart ? d.pos : maxOff - d.pos) / 100).toFixed(2).replace(".", ",");
    var s = window.prompt("Abstand Türkante zur Wand in Metern:", cur);
    if(s === null) return;
    var off = parseFloat(String(s).replace(",", ".")) * 100;
    if(!isFinite(off) || off < 0) return;
    off = Math.min(off, maxOff);
    d.pos = nearIsStart ? off : (maxOff - off);
    ensureDoors();
    resolveDoorConflicts();
    save(); renderRoom();
  }

  // "Raum anpassen"-Modus: Eckpunkte als ziehbare Punkte, Kantenmitten als
  // "+"-Button zum Einfügen eines neuen Eckpunkts. Ein Eckpunkt, der auf
  // einen Nachbarn gezogen wird, verschwindet wieder (siehe wireVertexDrag).
  function renderShapeEditor(bb){
    if(!state.roomEditMode) return;
    var layer = document.createElement("div");
    layer.style.position = "absolute"; layer.style.inset = "0"; layer.style.zIndex = "18";
    // WICHTIG: die Ebene selbst darf keine Klicks abfangen (sie liegt über
    // dem Grundriss inkl. Tür-Greifstreifen) - nur ihre echten Griffe/
    // Badges sind anklickbar (pointer-events:auto in der CSS). Sonst wäre
    // die Tür im Anpassmodus nicht mehr erreichbar.
    layer.style.pointerEvents = "none";
    canvas.appendChild(layer);
    // Referenzlinie + Bogen für schräge Wände leben in einer eigenen SVG-
    // Ebene darunter (rein optisch, daher pointer-events:none) - der
    // eigentliche Klick-/Antipp-Bereich ist die separate Winkel-Badge.
    var svgNS = "http://www.w3.org/2000/svg";
    var arcSvg = document.createElementNS(svgNS, "svg");
    arcSvg.setAttribute("class", "planner-angle-arcs");
    arcSvg.setAttribute("width", Math.round(bb.w * scale));
    arcSvg.setAttribute("height", Math.round(bb.h * scale));
    layer.appendChild(arcSvg);
    // Hilfslinien beim aktiven Wand-Schieben: entlang jeder (fast) kolinearen
    // anderen Wand eine leichte graue gestrichelte Linie - bündig wird sie
    // etwas kräftiger. Verschwindet beim Loslassen (wallDragGuides = null).
    if(wallDragGuides){
      wallDragGuides.forEach(function(g){
        var gl = document.createElementNS(svgNS, "line");
        gl.setAttribute("x1", (g.x1 - bb.minX) * scale);
        gl.setAttribute("y1", (g.y1 - bb.minY) * scale);
        gl.setAttribute("x2", (g.x2 - bb.minX) * scale);
        gl.setAttribute("y2", (g.y2 - bb.minY) * scale);
        gl.setAttribute("class", "planner-align-guide" + (g.on ? " is-on" : ""));
        arcSvg.appendChild(gl);
      });
    }
    var shape = state.room.shape;
    shape.forEach(function(p, i){
      var v = document.createElement("div");
      v.className = "planner-shape-vertex";
      v.style.left = Math.round((p.x - bb.minX) * scale) + "px";
      v.style.top = Math.round((p.y - bb.minY) * scale) + "px";
      v.title = "Ziehen zum Verschieben, antippen zum Entfernen";
      layer.appendChild(v);
      wireVertexDrag(v, i);
    });
    for(var i = 0; i < shape.length; i++){
      var a = shape[i], b = shape[(i + 1) % shape.length];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "planner-shape-edge-add";
      addBtn.style.left = Math.round((mx - bb.minX) * scale) + "px";
      addBtn.style.top = Math.round((my - bb.minY) * scale) + "px";
      addBtn.textContent = "+";
      addBtn.title = "Eckpunkt hier einfügen";
      (function(idx, px, py, edgeLen){
        addBtn.addEventListener("click", function(){
          // Kanten-Indizes der Türen mitziehen: ein neuer Eckpunkt VOR
          // (bzw. auf) einer Tür-Kante verschiebt deren Index. Der neue
          // Punkt sitzt in der Kantenmitte - eine Tür in der zweiten Hälfte
          // wandert auf die neu entstehende Folge-Kante.
          var half = edgeLen / 2;
          state.room.doors.forEach(function(dd){
            if(dd.edge > idx){ dd.edge += 1; }
            else if(dd.edge === idx && dd.pos + dd.width > half){
              dd.edge = idx + 1;
              dd.pos = Math.max(0, dd.pos - half);
            }
          });
          state.room.shape.splice(idx + 1, 0, { x: px, y: py });
          ensureDoors();
          save(); renderRoom(); renderCostPanel();
        });
      })(i, mx, my, Math.hypot(b.x - a.x, b.y - a.y));
      layer.appendChild(addBtn);

      // Maß an jeder Wand, leicht seitlich versetzt (damit es nicht auf dem
      // "+"-Button liegt) - per Antippen exakt nachjustierbar (z.B. auf
      // 2,12 m statt der eingerasteten 2,10 m). Der Winkel steht NICHT mehr
      // mit im Maß, sondern als eigene Bogen-Bemaßung genau dort, wo die
      // Wand tatsächlich von der Waagerechten abknickt (siehe unten).
      var lenM = Math.hypot(b.x - a.x, b.y - a.y) / 100;
      var angDeg = Math.round((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360));
      // Winkel zur Anzeige auf 0-90° gefaltet ("Neigung zur Waagerechten")
      // statt der Bewegungsrichtung entlang der Kontur - sonst zeigen zwei
      // spiegelbildliche Schrägen (z.B. eine V-förmige Nische)
      // verwirrenderweise 45° und 135° statt beide verständlich 45°.
      var mod180 = ((angDeg % 180) + 180) % 180;
      var acuteAng = mod180 > 90 ? 180 - mod180 : mod180;
      var isDiagonal = acuteAng % 90 !== 0;
      // Badge dreht sich mit der Wand (wie eine echte Bemaßung), bleibt
      // dabei aber immer aufrecht lesbar statt kopfüber.
      var labelRot = angDeg;
      if(labelRot > 90 && labelRot < 270) labelRot -= 180;
      var nx = -(b.y - a.y), ny = b.x - a.x;
      var nlen = Math.hypot(nx, ny) || 1;
      // Nah an der Wand (gleicher Abstand wie die Tür-Maße), aber noch weit
      // genug, dass das Maß-/Ziehband nicht mit den Eckpunkt-Griffen und
      // "+"-Buttons direkt auf der Wandlinie überlappt.
      var offCm = 20 / scale;
      var lx = mx + (nx / nlen) * offCm, ly = my + (ny / nlen) * offCm;
      var dim = document.createElement("button");
      dim.type = "button";
      dim.className = "planner-shape-dim";
      dim.style.left = Math.round((lx - bb.minX) * scale) + "px";
      dim.style.top = Math.round((ly - bb.minY) * scale) + "px";
      dim.style.transform = "translate(-50%,-50%) rotate(" + labelRot + "deg)";
      dim.textContent = lenM.toFixed(2).replace(".", ",");
      dim.title = "Ziehen verschiebt die ganze Wand, antippen öffnet die genaue Längeneingabe";
      wireEdgeMidDrag(dim, i);
      layer.appendChild(dim);

      // Winkel-Bemaßung: Referenzlinie zur Waagerechten (immer nach außen,
      // rund um die Kontur herum, nie ins Rauminnere) + Bogen dazwischen -
      // sitzt an der Ecke, wo die Wand tatsächlich abknickt, statt im Maß
      // mitgeschrieben zu werden. Antippen der Zahl erlaubt einen freien
      // (nicht auf 15° gerasteten) Winkel; zieht man die Ecke danach wieder,
      // rastet sie beim Ziehen wie gewohnt erneut auf 15° ein.
      if(isDiagonal){
        var R = 26, extra = 14; // Bogenradius / wie weit die Referenzlinie über den Bogen hinausragt, in px
        var wallAngle = angDeg;
        // Referenz ist immer die Waagerechte - links (180°) oder rechts (0°),
        // je nachdem welche Seite näher an der Wand UND außerhalb der Kontur
        // liegt (bei Gleichstand gewinnt "außerhalb"). Der Vergleich per
        // kürzestem Winkel-Abstand stellt sicher, dass der Bogen nie den
        // "langen Weg" nimmt, auch wenn die außenliegende Seite mal nicht
        // die geometrisch nähere ist.
        var candidates = [0, 180].map(function(ref){
          return { ref: ref, d: ((wallAngle - ref + 540) % 360) - 180 };
        });
        candidates.sort(function(x, y){ return Math.abs(x.d) - Math.abs(y.d); });
        var outward = candidates[0].ref, diff = candidates[0].d;
        if(Math.abs(Math.abs(candidates[0].d) - Math.abs(candidates[1].d)) < 0.01){
          // echter Gleichstand (exakt 90°) - dann die tatsächlich außerhalb
          // liegende Seite nehmen, statt willkürlich die erste.
          var preferOutside = pointInPolygon(a.x + 40, a.y, shape) ? candidates[1] : candidates[0];
          outward = preferOutside.ref; diff = preferOutside.d;
        }
        var refRad = (outward * Math.PI) / 180;
        var wallRad = ((outward + diff) * Math.PI) / 180;
        var ax = (a.x - bb.minX) * scale, ay = (a.y - bb.minY) * scale;
        var p1x = ax + Math.cos(refRad) * (R + extra), p1y = ay + Math.sin(refRad) * (R + extra);
        var arcStartX = ax + Math.cos(refRad) * R, arcStartY = ay + Math.sin(refRad) * R;
        var arcEndX = ax + Math.cos(wallRad) * R, arcEndY = ay + Math.sin(wallRad) * R;
        var refLine = document.createElementNS(svgNS, "line");
        refLine.setAttribute("x1", ax); refLine.setAttribute("y1", ay);
        refLine.setAttribute("x2", p1x); refLine.setAttribute("y2", p1y);
        refLine.setAttribute("style", "stroke:var(--text-dim);stroke-width:1;stroke-dasharray:3,3");
        arcSvg.appendChild(refLine);
        var arcPath = document.createElementNS(svgNS, "path");
        var sweepFlag = diff > 0 ? 1 : 0;
        arcPath.setAttribute("d", "M " + arcStartX + " " + arcStartY + " A " + R + " " + R + " 0 0 " + sweepFlag + " " + arcEndX + " " + arcEndY);
        arcPath.setAttribute("style", "fill:none;stroke:var(--accent);stroke-width:1.5");
        arcSvg.appendChild(arcPath);
        var midRad = ((outward + diff / 2) * Math.PI) / 180;
        var labelR = R + 20;
        var angBadge = document.createElement("button");
        angBadge.type = "button";
        angBadge.className = "planner-shape-angle";
        angBadge.style.left = Math.round(ax + Math.cos(midRad) * labelR) + "px";
        angBadge.style.top = Math.round(ay + Math.sin(midRad) * labelR) + "px";
        angBadge.textContent = acuteAng + "°";
        angBadge.title = "Antippen zum freien Anpassen des Winkels (rastet beim nächsten Ziehen der Ecke wieder auf 15°)";
        (function(idx){
          angBadge.addEventListener("click", function(e){
            e.stopPropagation();
            editEdgeAngle(idx, angBadge, layer);
          });
        })(i);
        layer.appendChild(angBadge);
      }
    }
  }

  // Freie (nicht auf 15° gerasterte) Nachjustierung nur des Winkels einer
  // Wand - Länge bleibt dabei unverändert, nur der zweite Punkt der Kante
  // dreht sich um den ersten. Zieht man denselben Eckpunkt danach direkt im
  // Grundriss, greift wieder der normale 15°-Magnet (siehe wireVertexDrag).
  // Freie Nachjustierung NUR des Winkels (0-90°, dieselbe Zahl wie an der
  // Bogen-Bemaßung angezeigt - nicht die Himmelsrichtung) - eigenes kleines
  // Eingabefeld statt window.prompt, damit ein ungültiger Wert (außerhalb
  // 0-90°) direkt rot markiert werden kann statt nur stillschweigend
  // abgelehnt zu werden. Länge bleibt unverändert, nur der zweite
  // Kantenpunkt dreht sich um den ersten. Zieht man dieselbe Ecke danach
  // direkt im Grundriss, greift beim Ziehen wieder der normale 15°-Magnet.
  function editEdgeAngle(i, badgeEl, layer){
    var existing = layer.querySelector(".planner-angle-edit-popup");
    if(existing) existing.remove();

    var shape = state.room.shape;
    var a = shape[i], b = shape[(i + 1) % shape.length];
    var curLen = Math.hypot(b.x - a.x, b.y - a.y);
    var curDeg = ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360;
    var mod180 = ((Math.round(curDeg * 10) / 10) % 180 + 180) % 180;
    var curAcute = Math.round((mod180 > 90 ? 180 - mod180 : mod180) * 10) / 10;

    var popup = document.createElement("div");
    popup.className = "planner-angle-edit-popup";
    popup.style.left = badgeEl.style.left;
    popup.style.top = badgeEl.style.top;
    popup.innerHTML =
      '<input type="number" min="0" max="90" step="0.1" value="' + curAcute + '">' +
      '<div class="planner-angle-edit-hint" hidden>Winkel muss zwischen 0° und 90° liegen</div>';
    layer.appendChild(popup);
    var input = popup.querySelector("input");
    var hint = popup.querySelector(".planner-angle-edit-hint");
    input.focus(); input.select();

    function validate(){
      var v = parseFloat(String(input.value).replace(",", "."));
      var ok = isFinite(v) && v >= 0 && v <= 90;
      input.classList.toggle("invalid", !ok);
      hint.hidden = ok;
      return ok ? v : null;
    }
    function close(){ popup.remove(); document.removeEventListener("pointerdown", onOutside, true); }
    function onOutside(e){ if(!popup.contains(e.target)) close(); }
    function commit(){
      var v = validate();
      if(v === null) return false;
      // Ursprüngliche "Himmelsrichtung" (welches der 4 Spiegelbilder des
      // 0-90°-Werts) beibehalten, nur die Neigung selbst ändert sich -
      // sonst würde die Wand beim Eingeben unerwartet auf eine andere
      // Seite umklappen.
      var newDeg;
      if(curDeg <= 90) newDeg = v;
      else if(curDeg <= 180) newDeg = 180 - v;
      else if(curDeg <= 270) newDeg = 180 + v;
      else newDeg = 360 - v;
      // Nur DIESER Winkel (a->b) darf sich ändern - die anliegende Wand
      // (b->c) muss ihren eigenen Winkel exakt behalten, nur ihre Länge
      // darf sich anpassen. b wandert deshalb an den Schnittpunkt aus der
      // neuen a->b-Richtung und der UNVERÄNDERTEN b->c-Richtung, statt
      // einfach um a gedreht zu werden (das hätte b->c mitverändert).
      var c = shape[(i + 2) % shape.length];
      var oldNextAngle = (Math.atan2(c.y - b.y, c.x - b.x) * 180) / Math.PI;
      var snap0 = shape.map(function(p){ return { x: p.x, y: p.y }; });
      var pt = rayIntersection(a, newDeg, c, oldNextAngle + 180);
      if(pt){
        b.x = pt.x; b.y = pt.y;
      } else {
        // Parallel (seltener Grenzfall) - Rückfall: einfache Drehung um a.
        var rad = (newDeg * Math.PI) / 180;
        b.x = a.x + Math.cos(rad) * curLen;
        b.y = a.y + Math.sin(rad) * curLen;
      }
      // Verschachtelte/umgeklappte Form -> Änderung verwerfen.
      if(!shapeStaysValid(shape, snap0)){
        shape.forEach(function(p, k){ p.x = snap0[k].x; p.y = snap0[k].y; });
        input.classList.add("invalid");
        hint.textContent = "Dieser Winkel würde die Raumform verschachteln";
        hint.hidden = false;
        return false;
      }
      normalizeRoom();
      updateRoomLB();
      state.items.forEach(function(it){ clampItem(it); });
      ensureDoors();
      save(); renderRoom(); renderCostPanel();
      return true;
    }
    input.addEventListener("input", validate);
    input.addEventListener("keydown", function(e){
      if(e.key === "Enter"){ if(commit()) close(); }
      else if(e.key === "Escape"){ close(); }
    });
    setTimeout(function(){ document.addEventListener("pointerdown", onOutside, true); }, 0);
  }

  // Exakte Nachjustierung einer Wand über zwei einfache Eingabefelder
  // (Länge, Winkel) - bewusst als schlichter Dialog statt eines eigenen
  // Inline-Editors, passend zum Wunsch "einfach gehalten". Bewegt nur den
  // ZWEITEN Punkt der Kante, der erste bleibt fest stehen.
  // Exakte Nachjustierung nur der Länge - der Winkel hat mit editEdgeAngle
  // (siehe unten) inzwischen sein eigenes, validiertes Eingabefeld an der
  // Ecke selbst, deshalb hier keine zweite (und mit anderer Konvention
  // verwirrende) Winkel-Nachfrage mehr.
  // Entfernt Eckpunkte, die (praktisch) auf der Geraden zwischen ihren
  // beiden Nachbarn liegen - so verschwindet z.B. eine Nische automatisch
  // wieder, sobald man ihre Wand bündig zur äußeren Wand zurückschiebt.
  // Passt dabei die Kanten-Indizes der Türen mit an.
  function removeCollinearVertices(){
    var s = state.room.shape;
    // In mehreren Durchgängen, bis nichts mehr wegfällt: nach einem splice
    // rücken Nachbarn zusammen und können SELBST kollinear werden (z.B.
    // wenn eine Nische vollständig auf ihre Gegenwand geschoben wurde -
    // dann liegen anschließend drei Wandpunkte auf einer Geraden).
    var changed = true, guard = 0;
    while(changed && s.length > 3 && guard++ < 40){
      changed = false;
      for(var k = s.length - 1; k >= 0 && s.length > 3; k--){
        var prev = s[(k - 1 + s.length) % s.length], cur = s[k], nxt = s[(k + 1) % s.length];
        var coincident = Math.hypot(cur.x - prev.x, cur.y - prev.y) < 2 || Math.hypot(cur.x - nxt.x, cur.y - nxt.y) < 2;
        var cross = (cur.x - prev.x) * (nxt.y - prev.y) - (cur.y - prev.y) * (nxt.x - prev.x);
        var base = Math.hypot(nxt.x - prev.x, nxt.y - prev.y) || 1;
        if(coincident || Math.abs(cross) / base < 2){ // deckungsgleich ODER < 2cm zur Verbindungslinie -> weg
          state.room.doors.forEach(function(dd){ if(dd.edge >= k) dd.edge = Math.max(0, dd.edge - 1); });
          s.splice(k, 1);
          changed = true;
        }
      }
    }
  }

  // Zieht man eine ganze Wand (am Maß-Griff) senkrecht zu sich selbst,
  // entsteht automatisch eine NISCHE: an den beiden Enden der Wand werden
  // zwei neue Eckpunkte eingefügt, sodass zwei Seitenwände (rechtwinklig)
  // und die zurückversetzte Wand entstehen. Schiebt man die Wand wieder
  // bündig zur ursprünglichen Flucht, fallen die zwei Eckpunkte per
  // removeCollinearVertices() von selbst wieder weg. Reines Antippen (ohne
  // Bewegung) öffnet wie gewohnt die Längeneingabe.
  function wireEdgeMidDrag(el, i){
    el.addEventListener("pointerdown", function(e){
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch(err){}
      var origShape = state.room.shape.map(function(p){ return { x: p.x, y: p.y }; });
      var n0 = origShape.length;
      var a0 = origShape[i], b0 = origShape[(i + 1) % n0];
      var prevP0 = origShape[(i - 1 + n0) % n0], nextP0 = origShape[(i + 2) % n0];
      var ex = b0.x - a0.x, ey = b0.y - a0.y;
      var elen = Math.hypot(ex, ey) || 1;
      var ux = ex / elen, uy = ey / elen;
      var nrmx = -uy, nrmy = ux; // Wand-Normale (senkrecht) - in diese Richtung wird die Nische tief
      // NEUE Nische anlegen (2 Punkte einfügen, beide Endpunkte bleiben)
      // vs. bestehende Wand VERSCHIEBEN. Entscheidend ist, ob ein Nachbar
      // WIRKLICH KOLINEAR ist (gleiche Gerade, kein Versatz) - dann liegt
      // die Wand in einem geraden Zug und beim Ziehen soll dort ein
      // Eselsohr/eine Nische entstehen, OHNE dass der geteilte Mittelpunkt
      // wieder verschwindet. Ein nur PARALLELER Nachbar mit Versatz (z.B.
      // die lange Wand neben einer schmalen Lücke) zählt NICHT als kolinear
      // -> dort wird verschoben, damit sich die Lücke schließen lässt.
      var pdx = a0.x - prevP0.x, pdy = a0.y - prevP0.y, plen = Math.hypot(pdx, pdy) || 1;
      var ndx = nextP0.x - b0.x, ndy = nextP0.y - b0.y, nlen = Math.hypot(ndx, ndy) || 1;
      function neighborCollinear(farPt, nearPt){
        var vx = nearPt.x - farPt.x, vy = nearPt.y - farPt.y, vl = Math.hypot(vx, vy) || 1;
        if(Math.abs((vx * ux + vy * uy) / vl) < 0.85) return false; // nicht parallel
        var perp = Math.abs((farPt.x - nearPt.x) * -uy + (farPt.y - nearPt.y) * ux);
        return perp < 3; // liegt (fast) exakt auf der Wand-Geraden
      }
      var colPrev = neighborCollinear(prevP0, a0);
      var colNext = neighborCollinear(nextP0, b0);
      var isJog = !colPrev && !colNext && plen > 1 && nlen > 1;
      var startX = e.clientX, startY = e.clientY;
      var moved = false;
      function onMove(ev){
        var dx = (ev.clientX - startX) / scale, dy = (ev.clientY - startY) / scale;
        if(Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        if(!moved) return;
        var depth = dx * nrmx + dy * nrmy; // Bewegung auf die Wand-Normale projiziert
        if(isJog){
          // ABSOLUTE Lage der Wand (Projektion auf die Normale) aufs
          // 10cm-Raster einrasten, nicht nur die relative Verschiebung -
          // sonst bleibt eine Wand, die z.B. durch eine frühere Winkel-
          // Eingabe auf 1,88 m sitzt, beim Ziehen bei 1,78 / 1,98 ... statt
          // sauber bei 1,80 / 1,90 einzurasten.
          var curOff = a0.x * nrmx + a0.y * nrmy;
          depth = Math.round((curOff + depth) / ROOM_SNAP_CM) * ROOM_SNAP_CM - curOff;
          // Die verschobene Wand darf nicht über die GEGENÜBERLIEGENDE Wand
          // der Nische hinaus - sonst schöbe man zwei Wände übereinander und
          // die Form verknotet. dFlushPrev/dFlushNext = Tiefe, bei der die
          // jeweilige Seitenwand der Nische auf 0 geschrumpft ist. Je nach
          // Zugrichtung ist die nächstgelegene davon die Grenze; kommt die
          // Wand auf <10 cm heran, rastet sie exakt bündig ein und die
          // Nische fällt beim Loslassen per removeCollinearVertices komplett
          // weg (die beiden aufeinandergeschobenen Wände verschwinden).
          var dFlushPrev = (prevP0.x - a0.x) * nrmx + (prevP0.y - a0.y) * nrmy;
          var dFlushNext = (nextP0.x - b0.x) * nrmx + (nextP0.y - b0.y) * nrmy;
          var limPos = Infinity, limNeg = -Infinity;
          [dFlushPrev, dFlushNext].forEach(function(f){
            if(f > 0.01) limPos = Math.min(limPos, f);
            else if(f < -0.01) limNeg = Math.max(limNeg, f);
          });
          if(depth > 0 && limPos !== Infinity){
            if(depth >= limPos - ROOM_SNAP_CM) depth = limPos;
            if(depth > limPos) depth = limPos;
          } else if(depth < 0 && limNeg !== -Infinity){
            if(depth <= limNeg + ROOM_SNAP_CM) depth = limNeg;
            if(depth < limNeg) depth = limNeg;
          }
        } else {
          depth = Math.round(depth / ROOM_SNAP_CM) * ROOM_SNAP_CM; // neue Nische: Tiefe aufs 10cm-Raster
        }
        // Ausrichte-Fang + Hilfslinien: alle parallelen, nicht benachbarten
        // Wände in der Nähe. Liegt die geschobene Wand einer davon <12 cm
        // nah, exakt auf deren Linie einrasten (überstimmt das 10-cm-Raster)
        // - so schließt sich auch eine schmale, nicht rastergenaue Lücke.
        var probe = { x: a0.x + nrmx * depth, y: a0.y + nrmy * depth };
        var parallels = [], snapOff = null, snapAbs = 12;
        for(var j = 0; j < n0; j++){
          if(j === i || (j + 1) % n0 === i || (i + 1) % n0 === j) continue;
          var gc = origShape[j], gd = origShape[(j + 1) % n0];
          var gjl = Math.hypot(gd.x - gc.x, gd.y - gc.y) || 1;
          var gjx = (gd.x - gc.x) / gjl, gjy = (gd.y - gc.y) / gjl;
          if(Math.abs(ux * gjy - uy * gjx) > 0.07) continue; // nicht parallel
          var off = (gc.x - probe.x) * nrmx + (gc.y - probe.y) * nrmy; // Abstand entlang Normale
          parallels.push({ c: gc, d: gd, jx: gjx, jy: gjy, off: off });
          if(Math.abs(off) < snapAbs){ snapAbs = Math.abs(off); snapOff = off; }
        }
        function buildJogShape(dep){
          var ns = origShape.map(function(p){ return { x: p.x, y: p.y }; });
          var _a = { x: a0.x + nrmx * dep, y: a0.y + nrmy * dep };
          var _b = { x: b0.x + nrmx * dep, y: b0.y + nrmy * dep };
          if(isJog){
            var wAng = (Math.atan2(uy, ux) * 180) / Math.PI;
            var pAng = (Math.atan2(a0.y - prevP0.y, a0.x - prevP0.x) * 180) / Math.PI;
            var nAng = (Math.atan2(b0.y - nextP0.y, b0.x - nextP0.x) * 180) / Math.PI;
            var _ia = rayIntersection(prevP0, pAng, _a, wAng) || _a;
            var _ib = rayIntersection(nextP0, nAng, _b, wAng) || _b;
            ns[i].x = _ia.x; ns[i].y = _ia.y;
            ns[(i + 1) % n0].x = _ib.x; ns[(i + 1) % n0].y = _ib.y;
          } else if(Math.abs(dep) >= ROOM_SNAP_CM){
            ns.splice(i + 1, 0, { x: _a.x, y: _a.y }, { x: _b.x, y: _b.y });
          }
          return ns;
        }
        // Zuerst mit Ausrichte-Fang versuchen; wäre das Ergebnis ungültig
        // (Figur-8 / Umklappen / Kollaps), ohne Fang. Flächiges Anliegen an
        // eine andere Wand (Schlitz schließen) ist erlaubt - der ggf. innen
        // umschlossene Bereich fällt beim Loslassen per dropEnclosedRegions
        // weg.
        var newShape = buildJogShape(snapOff !== null ? depth + snapOff : depth);
        if(!dragShapeOk(newShape, origShape)){
          newShape = buildJogShape(depth);
          if(!dragShapeOk(newShape, origShape)) return;
        } else if(snapOff !== null){
          depth += snapOff;
        }
        state.room.shape = newShape;
        var dragA = state.room.shape[isJog ? i : (i + 1) % state.room.shape.length];
        var guides = [];
        parallels.forEach(function(pw){
          var perp = (pw.c.x - dragA.x) * nrmx + (pw.c.y - dragA.y) * nrmy;
          if(Math.abs(perp) > 25) return; // nur zeigen, wenn schon nah dran
          var gmx = (pw.c.x + pw.d.x) / 2, gmy = (pw.c.y + pw.d.y) / 2;
          guides.push({
            x1: gmx - pw.jx * 4000, y1: gmy - pw.jy * 4000,
            x2: gmx + pw.jx * 4000, y2: gmy + pw.jy * 4000,
            on: Math.abs(perp) < 2
          });
        });
        wallDragGuides = guides.length ? guides : null;
        renderRoom();
      }
      function onUp(){
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        wallDragGuides = null; // Hilfslinien beim Loslassen wieder ausblenden
        if(moved){
          var inserted = state.room.shape.length - n0;
          if(inserted > 0){
            state.room.doors.forEach(function(dd){ if(dd.edge > i) dd.edge += inserted; });
          }
          removeCollinearVertices();
          dropEnclosedRegions(); // innen umschlossene Teilflächen (Loch) entfernen
          removeCollinearVertices();
          normalizeRoom();
          updateRoomLB();
          state.items.forEach(function(it){ clampItem(it); });
          ensureDoors();
          resolveDoorConflicts();
          save(); renderRoom(); renderCostPanel();
        } else {
          editEdgeDimension(i);
        }
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  // Ändert NUR die Länge dieser Wand - kein Winkel ändert sich irgendwo,
  // stattdessen passt sich die Länge der NÄCHSTEN Wand (b->c) entsprechend
  // an: b wandert exakt auf die neue Länge (gleicher Winkel wie vorher),
  // c wandert anschließend an den Schnittpunkt aus der (unveränderten)
  // b->c-Richtung und der (unveränderten) c->d-Richtung - dadurch bleiben
  // wirklich alle Winkel im Raum erhalten, nur zwei Längen (diese Wand und
  // ihre direkte Nachbarwand) passen sich an.
  function editEdgeDimension(i){
    var shape = state.room.shape;
    var snap0 = shape.map(function(p){ return { x: p.x, y: p.y }; });
    var a = shape[i], b = shape[(i + 1) % shape.length];
    var c = shape[(i + 2) % shape.length];
    var d = shape[(i + 3) % shape.length];
    var curLen = Math.hypot(b.x - a.x, b.y - a.y) / 100;
    var angle = Math.atan2(b.y - a.y, b.x - a.x);
    var lenStr = window.prompt("Wandlänge in Metern:", curLen.toFixed(2).replace(".", ","));
    if(lenStr === null) return;
    var newLen = parseFloat(String(lenStr).replace(",", "."));
    if(!isFinite(newLen) || newLen <= 0) return;
    newLen = Math.max(0.3, Math.min(newLen, 20));
    var oldAngleBC = (Math.atan2(c.y - b.y, c.x - b.x) * 180) / Math.PI;
    var oldAngleCD = (Math.atan2(d.y - c.y, d.x - c.x) * 180) / Math.PI;
    b.x = a.x + Math.cos(angle) * newLen * 100;
    b.y = a.y + Math.sin(angle) * newLen * 100;
    if(shape.length > 3){
      var newC = rayIntersection(b, oldAngleBC, d, oldAngleCD + 180);
      if(newC){ c.x = newC.x; c.y = newC.y; }
    }
    // Erst zusammengefallene/kollineare Ecken auflösen (eine so auf 0
    // geschrumpfte Nische verschwindet dann sauber) - danach prüfen, ob die
    // Form gültig bleibt; sonst die Änderung komplett zurücknehmen.
    removeCollinearVertices();
    if(!shapeStaysValid(shape, snap0)){
      state.room.shape.length = 0;
      snap0.forEach(function(p){ state.room.shape.push({ x: p.x, y: p.y }); });
      ensureDoors();
      renderRoom();
      return;
    }
    normalizeRoom();
    updateRoomLB();
    state.items.forEach(function(it){ clampItem(it); });
    ensureDoors();
    save(); renderRoom(); renderCostPanel();
  }

  // Winkel von "anchor" zu (x,y), gerastet aufs nächste 15°-Vielfache.
  function snappedAngleTo(anchor, x, y){
    var ang = (Math.atan2(y - anchor.y, x - anchor.x) * 180) / Math.PI;
    return Math.round(ang / ROOM_ANGLE_SNAP_DEG) * ROOM_ANGLE_SNAP_DEG;
  }
  // Schnittpunkt zweier Halbgeraden (p1 in Richtung ang1Deg, p2 in Richtung
  // ang2Deg) - null, wenn beide (praktisch) dieselbe Richtung haben.
  function rayIntersection(p1, ang1Deg, p2, ang2Deg){
    var r1 = (ang1Deg * Math.PI) / 180, r2 = (ang2Deg * Math.PI) / 180;
    var d1x = Math.cos(r1), d1y = Math.sin(r1);
    var d2x = Math.cos(r2), d2y = Math.sin(r2);
    var denom = d1x * d2y - d1y * d2x;
    if(Math.abs(denom) < 1e-6) return null;
    var t = ((p2.x - p1.x) * d2y - (p2.y - p1.y) * d2x) / denom;
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }

  function wireVertexDrag(el, idx){
    el.addEventListener("pointerdown", function(e){
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch(err){}
      var startX = e.clientX, startY = e.clientY;
      var shapeRef = state.room.shape;
      var p = shapeRef[idx];
      var origX = p.x, origY = p.y;
      var lastGoodX = origX, lastGoodY = origY;
      var origShapeSnap = shapeRef.map(function(q){ return { x: q.x, y: q.y }; });
      var prevP = shapeRef[(idx - 1 + shapeRef.length) % shapeRef.length];
      var nextP = shapeRef[(idx + 1) % shapeRef.length];
      var moved = false;
      function onMove(ev){
        var dx = (ev.clientX - startX) / scale;
        var dy = (ev.clientY - startY) / scale;
        if(Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        var rawX = origX + dx, rawY = origY + dy;
        // Ein gezogener Eckpunkt hat IMMER zwei Nachbarn/zwei angrenzende
        // Wände - beide müssen auf einem 15°-Vielfachen landen, nicht nur
        // die zum vorherigen Punkt (genau das wurde zurückgemeldet: nur
        // eine Seite war sauber, die andere blieb krumm/frei wählbar).
        // Dafür wird der Winkel zu JEDEM Nachbarn einzeln gerastet, der
        // Punkt landet dann exakt im Schnittpunkt dieser beiden Linien -
        // dort sind zwangsläufig beide Wände gleichzeitig sauber.
        var a1 = snappedAngleTo(prevP, rawX, rawY);
        var a2 = snappedAngleTo(nextP, rawX, rawY);
        var pt = rayIntersection(prevP, a1, nextP, a2);
        if(pt){
          // NICHT auf ganze cm runden - das würde den gerade errechneten
          // sauberen 15°-Winkel wieder minimal verschieben (z.B. 60° ->
          // 59,9°, genau der gemeldete Fall). Die Länge wird für die
          // Anzeige ohnehin auf cm gerundet (toFixed(2) m) - hier zählt nur
          // der Winkel, der bleibt exakt.
          p.x = pt.x;
          p.y = pt.y;
        } else {
          // Grenzfall: beide Nachbarn ergeben (gerade zu Beginn eines Zugs,
          // wenn der Punkt noch nah an seiner ursprünglichen geraden Kante
          // liegt) dieselbe gerasterte Richtung - kein eindeutiger
          // Schnittpunkt. Trotzdem NIE auf den ungerasterten freien Winkel
          // zurückfallen (das war der gemeldete 2°/5°/7°-Fehler) - stattdessen
          // wenigstens die Wand zum vorherigen Nachbarn sauber halten, mit
          // der Distanz entlang dieses Winkels aufs 10cm-Raster gerundet.
          var vx = rawX - prevP.x, vy = rawY - prevP.y;
          var dist = Math.hypot(vx, vy);
          var rad = (a1 * Math.PI) / 180;
          var snappedDist = Math.round(dist / ROOM_SNAP_CM) * ROOM_SNAP_CM;
          p.x = prevP.x + Math.cos(rad) * snappedDist;
          p.y = prevP.y + Math.sin(rad) * snappedDist;
        }
        // Nie über eine "gegenüberliegende" Wand hinausziehen (z.B. die
        // Spitze einer Nische durch die Rückwand hindurch) - auf die
        // Bounding Box aller ÜBRIGEN Eckpunkte geklemmt.
        var others = shapeRef.filter(function(_, i){ return i !== idx; });
        var obb = polygonBBox(others);
        p.x = Math.max(obb.minX, Math.min(p.x, obb.maxX));
        p.y = Math.max(obb.minY, Math.min(p.y, obb.maxY));
        // Ecke nie über andere Wände hinaus in eine verschachtelte/umge-
        // klappte Form ziehen - dann bleibt sie an der letzten gültigen
        // Stelle.
        if(!shapeStaysValid(shapeRef, origShapeSnap)){
          p.x = lastGoodX; p.y = lastGoodY;
        } else {
          lastGoodX = p.x; lastGoodY = p.y;
        }
        renderRoom();
      }
      function onUp(){
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        var shape = state.room.shape;
        // Reines Antippen (kein nennenswertes Ziehen) entfernt die Ecke
        // direkt - einfacher als sie exakt auf einen Nachbarn ziehen zu
        // müssen. Rückgängig-Button fängt ein Versehen ab.
        if(!moved){
          if(shape.length > 3) shape.splice(idx, 1);
        } else if(shape.length > 3){
          var prevI = (idx - 1 + shape.length) % shape.length;
          var nextI = (idx + 1) % shape.length;
          var thisP = shape[idx];
          var mergeTarget = null;
          [prevI, nextI].forEach(function(ni){
            if(ni === idx) return;
            var np = shape[ni];
            if(Math.hypot(np.x - thisP.x, np.y - thisP.y) * scale < 18) mergeTarget = ni;
          });
          if(mergeTarget !== null){
            // Türen-Kantenindizes an das Entfernen des Eckpunkts anpassen
            // (Kante idx-1 und idx verschmelzen zu idx-1, alles danach -1).
            state.room.doors.forEach(function(dd){
              if(dd.edge > idx) dd.edge -= 1;
              else if(dd.edge === idx) dd.edge = (idx - 1 + shape.length) % shape.length;
            });
            shape.splice(idx, 1);
          }
        }
        removeCollinearVertices();
        normalizeRoom();
        updateRoomLB();
        state.items.forEach(function(it){ clampItem(it); });
        ensureDoors();
        save(); renderRoom(); renderCostPanel();
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  /* ---------- render: placed floor items ---------- */
  // Ersetzt die frühere Beschriftung mitten im (auf dem Handy viel zu
  // kleinen) Geräte-Symbol: der Name steht jetzt unter dem Grundriss und
  // erscheint nur, solange ein Gerät ausgewählt ist (Tippen = auswählen,
  // ins Leere tippen = abwählen - siehe canvas-Klick-Handler unten).
  function updateSelectedInfo(){
    if(!activeItemUid){ selectedInfo.hidden = true; selectedInfo.innerHTML = ""; return; }
    var it = state.items.filter(function(x){ return x.uid === activeItemUid; })[0];
    if(!it){ activeItemUid = null; selectedInfo.hidden = true; selectedInfo.innerHTML = ""; return; }
    var cat = byId[it.catId];
    var t = tierData(it.catId, it.tier);
    var tierLabel = it.tier === "premium" ? "Premium" : "Einstieg";
    selectedInfo.hidden = false;
    selectedInfo.innerHTML = "Ausgewählt: <b>" + cat.name + "</b> — " + tierLabel + " (" + t.brand + " · " + t.model + ")";
  }

  function renderItems(){
    Array.prototype.slice.call(canvas.querySelectorAll(".planner-item, .planner-zones-layer")).forEach(function(n){ n.remove(); });

    var rects = state.items.map(rectFor);
    var obbs = state.items.map(obbFor);
    var overlapFlags = state.items.map(function(){ return false; });
    for(var i = 0; i < obbs.length; i++){
      for(var j = i + 1; j < obbs.length; j++){
        if(obbOverlap(obbs[i], obbs[j])){ overlapFlags[i] = true; overlapFlags[j] = true; }
      }
    }

    // Freiraum-Zonen stecken in einer eigenen Ebene mit overflow:hidden, die
    // exakt auf den Raum-Innenmaßen sitzt - eine Zone, die über die Wand
    // hinausragt, wird dort einfach abgeschnitten statt in den Rand des
    // Grundrisses hineinzuragen. Items selbst bleiben ein Geschwister davon
    // (nicht darin verschachtelt), damit ihre Lösch-/Dreh-Buttons nie
    // mitbeschnitten werden, falls ein Gerät ganz am Rand steht.
    var zonesLayer = document.createElement("div");
    zonesLayer.className = "planner-zones-layer";
    var roomBB = polygonBBox(state.room.shape);
    zonesLayer.style.clipPath = polygonClipPath(state.room.shape, roomBB); // an Nischen/Erker genauso exakt abschneiden wie an der geraden Wand
    var anyAccessBlocked = false;
    if(state.showClearance){
      var clearRects = state.items.map(clearanceRectFor);
      var accessRects = state.items.map(accessRectFor);
      var Lcm = roomBB.w, Bcm = roomBB.h;
      state.items.forEach(function(it, idx){
        var cr = clearRects[idx];
        if(!cr) return;
        var cat = byId[it.catId];
        // Rein informativ: wird nur optisch (amber statt neutral) markiert,
        // wenn die Zone die Raumgrenze überschneidet - blockiert nichts.
        // Dass sich zwei Freiraum-Zonen (oder eine Zone mit einem anderen
        // Gerät) überlappen, ist ausdrücklich erlaubt und bleibt neutral.
        var crAabb = zoneAabb(cr);
        var tight = crAabb.x < 0 || crAabb.y < 0 || crAabb.x + crAabb.w > Lcm || crAabb.y + crAabb.d > Bcm;
        var zone = document.createElement("div");
        zone.className = "planner-clearance-zone" + (tight ? " is-tight" : "");
        zone.dataset.uid = it.uid;
        zone.style.width = Math.round(cr.w * scale) + "px";
        zone.style.height = Math.round(cr.h * scale) + "px";
        zone.style.left = Math.round(cr.cx * scale - (cr.w * scale) / 2) + "px";
        zone.style.top = Math.round(cr.cy * scale - (cr.h * scale) / 2) + "px";
        zone.style.transform = "rotate(" + cr.rot + "deg)";
        zone.title = cat.name + " — empfohlener Freiraum: " + cat.clearance.sourceLabel + " Zum Verschieben auch hier ziehen.";
        zonesLayer.appendChild(zone);

        // Zugangsbereich (z.B. hinter dem Laufband): hier darf - anders als
        // im übrigen Freiraum - kein ANDERES Gerät mit seinem echten
        // Footprint hineinstehen. Das ist die einzige "harte" Regel hier,
        // alles andere bleibt reine Empfehlung.
        var ar = accessRects[idx];
        if(!ar) return;
        var arObb = obbForZone(ar);
        var blocked = false;
        for(var k = 0; k < obbs.length; k++){
          if(k !== idx && obbOverlap(arObb, obbs[k])){ blocked = true; break; }
        }
        if(blocked) anyAccessBlocked = true;
        var access = document.createElement("div");
        access.className = "planner-access-zone" + (blocked ? " is-blocked" : "");
        access.dataset.uid = it.uid;
        access.style.width = Math.round(ar.w * scale) + "px";
        access.style.height = Math.round(ar.h * scale) + "px";
        access.style.left = Math.round(ar.cx * scale - (ar.w * scale) / 2) + "px";
        access.style.top = Math.round(ar.cy * scale - (ar.h * scale) / 2) + "px";
        access.style.transform = "rotate(" + ar.rot + "deg)";
        access.title = cat.name + " — Zugangsbereich (zum Ein-/Aussteigen und Bedienen freihalten, kein anderes Gerät hineinstellen). Zum Verschieben auch hier ziehen.";
        zonesLayer.appendChild(access);
      });
    }
    canvas.appendChild(zonesLayer);

    state.items.forEach(function(it, idx){
      var cat = byId[it.catId];
      var r = rects[idx]; // Bounding Box (AABB) - nur für Kollision/Raumgrenzen
      var fp = footprintFor(it.catId, it.tier); // native, ungedrehte Maße - das ist jetzt die sichtbare Box selbst
      var rot = it.rot || 0;
      // Die sichtbare Box (Rahmen/Hintergrund) ist jetzt die native, nie
      // getauschte Größe und dreht sich als Ganzes über CSS transform - bei
      // 45°/135°/... stand hier vorher eine quadratische "Karte" (die
      // Bounding Box) mit sichtbaren leeren Ecken um ein diagonal gedrehtes
      // Icon herum. Position wird über die Mitte der AABB bestimmt, damit
      // sich das Gerät beim Drehen nicht verschiebt.
      var el = document.createElement("div");
      el.className = "planner-item" + (overlapFlags[idx] ? " is-overlapping" : "") + (it.uid === activeItemUid ? " is-active" : "");
      el.dataset.tier = it.tier;
      el.dataset.uid = it.uid;
      el.style.width = Math.round(fp.w * scale) + "px";
      el.style.height = Math.round(fp.d * scale) + "px";
      el.style.transform = "rotate(" + rot + "deg)";
      positionItemEl(el, it, r, fp);
      // Lösch-/Dreh-Button bekommen die Gegendrehung, damit ihr Symbol
      // lesbar aufrecht bleibt, auch wenn das Gerät selbst schräg steht -
      // nur ihre Position (der Dreh-Button sitzt an der Ecke) wandert mit.
      el.innerHTML =
        '<div class="planner-item-inner">' + vitaroIconSvg(it.catId, it.tier, fp) + '</div>' +
        '<button type="button" class="planner-item-remove" style="transform:translate(-50%,-50%) rotate(' + (-rot) + 'deg);" aria-label="' + cat.name + ' entfernen" data-action="remove">×</button>' +
        '<button type="button" class="planner-item-rotate-left" style="transform:rotate(' + (-rot) + 'deg);" aria-label="' + cat.name + ' nach links drehen" data-action="rotate-left">⟲</button>' +
        '<button type="button" class="planner-item-rotate" style="transform:rotate(' + (-rot) + 'deg);" aria-label="' + cat.name + ' nach rechts drehen" data-action="rotate">⟳</button>';
      canvas.appendChild(el);
      wireItemDrag(el, it);

      // Auch über die zugehörige Freiraum-/Zugangszone soll sich das Gerät
      // verschieben lassen, nicht nur über sein eigenes kleines Symbol.
      var zoneEl = zonesLayer.querySelector('.planner-clearance-zone[data-uid="' + it.uid + '"]');
      if(zoneEl) wireDragHandlers(zoneEl, el, it, function(){ selectItem(it, el); });
      var accessEl = zonesLayer.querySelector('.planner-access-zone[data-uid="' + it.uid + '"]');
      if(accessEl) wireDragHandlers(accessEl, el, it, function(){ selectItem(it, el); });
    });

    updateSelectedInfo();

    // fit feedback
    var anyOverlap = overlapFlags.some(function(f){ return f; });
    var placedArea = rects.reduce(function(s, r){ return s + r.w * r.d; }, 0);
    var roomArea = polygonAreaCm2(state.room.shape);
    if(state.items.length === 0){
      fitMsg.hidden = true;
    } else if(anyOverlap){
      fitMsg.hidden = false; fitMsg.dataset.state = "overlap";
      fitMsg.textContent = "Zwei oder mehr Geräte überlappen sich — Positionen anpassen, damit die Fläche realistisch bleibt.";
    } else if(anyAccessBlocked){
      fitMsg.hidden = false; fitMsg.dataset.state = "overlap";
      fitMsg.textContent = "Ein Gerät steht im rot markierten Zugangsbereich eines anderen — dort muss frei bleiben, um sicher ein-/auszusteigen.";
    } else if(placedArea > roomArea * 0.65){
      fitMsg.hidden = false; fitMsg.dataset.state = "tight";
      fitMsg.textContent = "Der Raum wird eng — mit dieser Auswahl bleibt wenig freie Bewegungsfläche.";
    } else {
      fitMsg.hidden = false; fitMsg.dataset.state = "ok";
      fitMsg.textContent = "Passt gut — ausreichend freie Fläche für Bewegung zwischen den Geräten.";
    }
  }

  /* ---------- drag + rotate + remove on a placed item ---------- */
  // Zeigt ein Gerät als ausgewählt (dicker Rahmen, Info-Zeile, Buttons) -
  // eigene Funktion, weil das jetzt sowohl vom Klick auf das Gerät selbst
  // als auch von einem bloßen Antippen (ohne Ziehen) seiner Freiraum-/
  // Zugangszone ausgelöst werden kann.
  function selectItem(it, el){
    activeItemUid = it.uid;
    el.classList.add("is-active");
    Array.prototype.slice.call(canvas.querySelectorAll(".planner-item.is-active")).forEach(function(n){
      if(n !== el) n.classList.remove("is-active");
    });
    updateSelectedInfo();
  }

  // Setzt das sichtbare <div> (immer die native, ggf. rotierte Geräte-Box -
  // siehe renderItems) an die aktuelle Position von it.x/it.y. Eigene
  // Funktion, damit Render-Pfad und Drag-Update exakt dieselbe Mitte-der-
  // Bounding-Box-Rechnung verwenden und nie auseinanderlaufen.
  function positionItemEl(el, it, r, fp){
    var centerX = r.x + r.w / 2, centerY = r.y + r.d / 2;
    var outerW = fp.w * scale, outerH = fp.d * scale;
    el.style.left = Math.round(centerX * scale - outerW / 2) + "px";
    el.style.top = Math.round(centerY * scale - outerH / 2) + "px";
  }

  // Drag-Logik einmal zentral: sourceEl ist das Element, auf dem der Zeige-
  // finger/die Maus tatsächlich aufsetzt (das Gerät selbst ODER - neu -
  // seine Freiraum-/Zugangszone), el ist immer das zu bewegende Geräte-Div
  // und it der zugehörige State-Eintrag. onTap feuert nur, wenn NICHT
  // gezogen wurde (reines Antippen) - für die Zonen genutzt, um sie auch
  // ohne Drag als "Gerät auswählen" nutzbar zu machen.
  function wireDragHandlers(sourceEl, el, it, onTap){
    sourceEl.addEventListener("pointerdown", function(e){
      if(e.target.getAttribute && e.target.getAttribute("data-action")) return;
      e.preventDefault();
      try { sourceEl.setPointerCapture(e.pointerId); } catch(err) { /* z.B. bereits losgelassener Pointer - Drag funktioniert auch ohne Capture */ }
      var startX = e.clientX, startY = e.clientY;
      var origX = it.x, origY = it.y;
      var moved = false;
      function onMove(ev){
        var dx = (ev.clientX - startX) / scale;
        var dy = (ev.clientY - startY) / scale;
        if(Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
        var prevX = it.x, prevY = it.y;
        it.x = origX + dx; it.y = origY + dy;
        if(state.snapEnabled){
          it.x = Math.round(it.x / SNAP_STEP_CM) * SNAP_STEP_CM;
          it.y = Math.round(it.y / SNAP_STEP_CM) * SNAP_STEP_CM;
        }
        clampItem(it);
        // Geräte dürfen sich nie überlappen (harte Regel) - würde die neue
        // Position das verursachen, bleibt das Gerät an der letzten gültigen
        // Stelle stehen, statt durch das andere Gerät hindurchzuziehen. Die
        // Sicherheitszonen sind davon ausdrücklich nicht betroffen - die
        // dürfen sich weiterhin frei überlappen. Der Schwenkbereich einer Tür
        // ist dagegen genauso hart - dort hinein lässt sich ein Gerät gar
        // nicht erst ziehen.
        var newRect = rectFor(it);
        var hitsDoor = doorSwingCircles().some(function(c){ return circleOverlapsRect(c, newRect); });
        if(footprintCollides(it) || hitsDoor){ it.x = prevX; it.y = prevY; }
        positionItemEl(el, it, rectFor(it), footprintFor(it.catId, it.tier));
      }
      function onUp(){
        sourceEl.removeEventListener("pointermove", onMove);
        sourceEl.removeEventListener("pointerup", onUp);
        if(moved){
          // Landet der Zugangsbereich beim Ablegen in einer Wand ODER auf
          // einem anderen Gerät, dreht sich das Gerät automatisch in eine
          // passende Himmelsrichtung, statt den Nutzer die Kollision erst
          // über die rote Zone entdecken zu lassen.
          tryAutoRotateForFit(it);
          save(); renderItems();
        } else if(onTap){
          onTap();
        }
      }
      sourceEl.addEventListener("pointermove", onMove);
      sourceEl.addEventListener("pointerup", onUp);
    });
  }

  function wireItemDrag(el, it){
    el.addEventListener("click", function(e){
      var action = e.target.getAttribute && e.target.getAttribute("data-action");
      if(action === "remove"){
        state.items = state.items.filter(function(x){ return x.uid !== it.uid; });
        save(); renderItems(); renderCostPanel();
        return;
      }
      if(action === "rotate" || action === "rotate-left"){
        // Drehung in 45°-Schritten, in beide Richtungen (0->45->90->... bzw.
        // rückwärts 0->315->270->...) - erlaubt auch schräge/diagonale
        // Aufstellung. Die Sicherheitszonen drehen sich dabei exakt mit
        // (siehe clearanceRectFor/accessRectFor).
        var step = action === "rotate" ? 45 : -45;
        it.rot = ((it.rot || 0) + step + 360) % 360;
        clampItem(it);
        save(); renderItems();
        return;
      }
      // Plain click on the item itself (not a button): select it - thick
      // border, Info-Zeile unter dem Grundriss, Lösch-/Dreh-Button
      // erscheinen. Klick ins Leere hebt die Auswahl wieder auf (unten).
      selectItem(it, el);
    });

    wireDragHandlers(el, el, it);
  }

  /* ---------- palette: floor equipment ---------- */
  function priceHtml(cat, tier, registered){
    var label = priceLabel(cat, tier);
    return registered ? label : '<span class="price-locked" aria-label="Preis nach Anmeldung sichtbar">' + label + '</span>';
  }

  // Free, anonymous use of the planner is time-boxed; once it's up, adding
  // anything new (or opening the calculator, gated separately) prompts
  // registration instead. Existing placed items are never taken away.
  function canAddMore(){
    if(!window.VitaroAuth) return true;
    if(VitaroAuth.isRegistered()) return true;
    if(!VitaroAuth.trialExpired()) return true;
    VitaroAuth.openModal("Die kostenlose Testzeit von 10 Minuten ist abgelaufen — kostenlos registrieren, um weiter zu planen.");
    return false;
  }

  function renderPalette(){
    var registered = window.VitaroAuth && VitaroAuth.isRegistered();
    palette.innerHTML = "";
    FLOOR_CATS.forEach(function(cat){
      var tier = state.paletteTier[cat.id] || "budget";
      var wrap = document.createElement("div");
      wrap.className = "planner-palette-item";
      wrap.innerHTML =
        '<h4>' + cat.name + '</h4>' +
        '<div class="planner-tier-switch" data-cat="' + cat.id + '">' +
          '<button type="button" data-tier="budget" class="' + (tier === "budget" ? "active" : "") + '">Einstieg</button>' +
          '<button type="button" data-tier="premium" class="' + (tier === "premium" ? "active" : "") + '">Premium</button>' +
        '</div>' +
        '<div class="planner-palette-price">' + priceHtml(cat, tier, registered) + '</div>' +
        '<button type="button" class="planner-palette-add" data-add="' + cat.id + '">+ Hinzufügen</button>';
      palette.appendChild(wrap);
    });

    palette.querySelectorAll(".planner-tier-switch button").forEach(function(btn){
      btn.addEventListener("click", function(){
        var catId = btn.closest(".planner-tier-switch").dataset.cat;
        state.paletteTier[catId] = btn.dataset.tier;
        renderPalette();
      });
    });
    palette.querySelectorAll("[data-add]").forEach(function(btn){
      btn.addEventListener("click", function(){
        if(!canAddMore()) return;
        addFloorItem(btn.getAttribute("data-add"));
      });
    });
  }

  function addFloorItem(catId){
    var tier = state.paletteTier[catId] || "budget";
    var fp = footprintFor(catId, tier);
    var roomBB = polygonBBox(state.room.shape);
    var Lcm = roomBB.w, Bcm = roomBB.h;
    var it = {
      uid: nextUid(), catId: catId, tier: tier, rot: 0,
      x: Math.max(0, (Lcm - fp.w) / 2),
      y: Math.max(0, (Bcm - fp.d) / 2)
    };
    clampItem(it);
    // Neues Gerät darf kein bereits platziertes überlappen (harte Regel,
    // siehe footprintCollides) - probiert dafür von der Raummitte ausgehend
    // zunehmend größere Versätze in alle vier Richtungen, bis eine freie
    // Stelle gefunden ist.
    var baseX = it.x, baseY = it.y, step = 20, tries = 0;
    while(footprintCollides(it) && tries < 40){
      var ring = Math.floor(tries / 4) + 1;
      var dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      var d = dirs[tries % 4];
      it.x = baseX + d[0] * step * ring;
      it.y = baseY + d[1] * step * ring;
      clampItem(it);
      tries++;
    }
    state.items.push(it);
    save(); renderItems(); renderCostPanel();
  }

  /* ---------- palette: accessories (no canvas placement) ---------- */
  function renderAccessoryPalette(){
    var registered = window.VitaroAuth && VitaroAuth.isRegistered();
    accessoryPalette.innerHTML = "";
    ACCESSORY_CATS.forEach(function(cat){
      var tier = state.paletteTier[cat.id] || "budget";
      var wrap = document.createElement("div");
      wrap.className = "planner-palette-item";
      wrap.innerHTML =
        '<h4>' + cat.name + '</h4>' +
        '<div class="planner-tier-switch" data-cat="' + cat.id + '">' +
          '<button type="button" data-tier="budget" class="' + (tier === "budget" ? "active" : "") + '">Einstieg</button>' +
          '<button type="button" data-tier="premium" class="' + (tier === "premium" ? "active" : "") + '">Premium</button>' +
        '</div>' +
        '<div class="planner-palette-price">' + priceHtml(cat, tier, registered) + '</div>' +
        '<button type="button" class="planner-palette-add" data-add="' + cat.id + '">+ Hinzufügen</button>';
      accessoryPalette.appendChild(wrap);
    });
    accessoryPalette.querySelectorAll(".planner-tier-switch button").forEach(function(btn){
      btn.addEventListener("click", function(){
        var catId = btn.closest(".planner-tier-switch").dataset.cat;
        state.paletteTier[catId] = btn.dataset.tier;
        renderAccessoryPalette();
      });
    });
    accessoryPalette.querySelectorAll("[data-add]").forEach(function(btn){
      btn.addEventListener("click", function(){
        if(!canAddMore()) return;
        var catId = btn.getAttribute("data-add");
        var cat = byId[catId];
        var tier = state.paletteTier[catId] || "budget";
        state.accessories.push({ uid: nextUid(), catId: catId, tier: tier, qty: cat.defaultQty || 1 });
        save(); renderCostPanel();
      });
    });
  }

  /* ---------- cost panel ---------- */
  function qtyStep(unit){ return unit === "kg" ? 10 : 1; }
  function detailHref(catId, tier){ return "geraet.html?id=" + encodeURIComponent(catId) + "&tier=" + tier; }

  // Equipment prices are the real, legally-required-gross consumer prices we
  // researched (Gorilla Sports, ATX etc. must show B2C prices inkl. MwSt) -
  // VITARO passes those through unmarked-up, so they need no further VAT
  // math. Our own margin is the service fee alone, which we DO charge net
  // of VAT like any other service invoice - see pricing-config.js.
  function computeTotals(){
    var equipmentGross = 0;
    state.items.forEach(function(it){ equipmentGross += tierData(it.catId, it.tier).price; });
    state.accessories.forEach(function(a){ equipmentGross += tierData(a.catId, a.tier).price * a.qty; });
    if(state.flooring.included){
      var t = tierData(FLOORING.id, state.flooring.tier);
      var autoArea = roomAreaM2();
      var qty = state.flooring.auto ? autoArea : state.flooring.qty;
      equipmentGross += t.price * qty;
    }
    // No equipment selected yet = nothing to install = no service fee either;
    // otherwise an empty plan would show the package minimum (e.g. 490 €) as
    // if there were already something to charge for.
    var serviceNet = equipmentGross === 0 ? 0 : vitaroServiceFee(state.pkg, equipmentGross);
    var serviceVat = serviceNet === null ? null : Math.round(serviceNet * VITARO_VAT_RATE * 100) / 100;
    var serviceGross = serviceNet === null ? null : Math.round((serviceNet + serviceVat) * 100) / 100;
    var grandTotal = serviceGross === null ? null : Math.round((equipmentGross + serviceGross) * 100) / 100;
    return { equipmentGross: equipmentGross, serviceNet: serviceNet, serviceVat: serviceVat, serviceGross: serviceGross, grandTotal: grandTotal };
  }

  function renderPackageSwitch(totals){
    var suggested = vitaroSuggestPackage(totals.equipmentGross);
    if(!state.pkgManual) state.pkg = suggested;
    packageSwitch.querySelectorAll("button").forEach(function(b){
      b.classList.toggle("active", b.dataset.pkg === state.pkg);
    });
    var pkgInfo = VITARO_PACKAGES.filter(function(p){ return p.id === state.pkg; })[0];
    packageSuggestNote.innerHTML = (!state.pkgManual
      ? "Anhand Ihrer Auswahl vorgeschlagen. "
      : "") + pkgInfo.tagline + ".";
  }

  function renderCostPanel(){
    costList.innerHTML = "";
    var hasAny = state.items.length || state.accessories.length || state.flooring.included;
    var registered = window.VitaroAuth && VitaroAuth.isRegistered();

    if(!hasAny){
      costList.innerHTML = '<p class="planner-cost-empty">Noch nichts ausgewählt — links Geräte in den Raum ziehen oder unten Zubehör hinzufügen. Die Summe erscheint hier live.</p>';
    }

    if(state.items.length){
      var lbl1 = document.createElement("div");
      lbl1.className = "planner-cost-group-label";
      lbl1.textContent = "Geräte im Raum";
      costList.appendChild(lbl1);
      state.items.forEach(function(it){
        var cat = byId[it.catId];
        var t = tierData(it.catId, it.tier);
        costList.appendChild(costRow({
          title: cat.name,
          href: detailHref(it.catId, it.tier),
          sub: t.brand + " · " + t.model,
          tier: it.tier,
          price: (t.priceNote ? t.priceNote + " " : "") + eur.format(t.price),
          onRemove: function(){
            state.items = state.items.filter(function(x){ return x.uid !== it.uid; });
            save(); renderItems(); renderCostPanel();
          }
        }));
      });
    }

    if(state.accessories.length){
      var lbl2 = document.createElement("div");
      lbl2.className = "planner-cost-group-label";
      lbl2.textContent = "Zubehör";
      costList.appendChild(lbl2);
      state.accessories.forEach(function(a){
        var cat = byId[a.catId];
        var t = tierData(a.catId, a.tier);
        var lineTotal = t.price * a.qty;
        costList.appendChild(costRow({
          title: cat.name,
          href: detailHref(a.catId, a.tier),
          sub: t.brand + " · " + t.model,
          tier: a.tier,
          price: eur.format(lineTotal),
          qty: a.qty,
          qtyUnit: cat.unit,
          onQtyChange: function(newQty){
            a.qty = Math.max(0, newQty);
            save(); renderCostPanel();
          },
          onRemove: function(){
            state.accessories = state.accessories.filter(function(x){ return x.uid !== a.uid; });
            save(); renderCostPanel();
          }
        }));
      });
    }

    if(state.flooring.included){
      var lbl3 = document.createElement("div");
      lbl3.className = "planner-cost-group-label";
      lbl3.textContent = "Bodenbelag";
      costList.appendChild(lbl3);
      var t3 = tierData(FLOORING.id, state.flooring.tier);
      var autoArea = roomAreaM2();
      var qty = state.flooring.auto ? autoArea : state.flooring.qty;
      var lineTotal3 = t3.price * qty;
      costList.appendChild(costRow({
        title: FLOORING.name,
        href: detailHref(FLOORING.id, state.flooring.tier),
        sub: t3.brand + " · " + t3.model,
        tier: state.flooring.tier,
        price: eur.format(lineTotal3),
        qty: qty,
        qtyUnit: "m²",
        onQtyChange: function(newQty){
          state.flooring.qty = Math.max(0, newQty);
          state.flooring.auto = false;
          save(); renderCostPanel();
        },
        onRemove: function(){
          state.flooring.included = false;
          flooringToggle.checked = false;
          save(); renderRoom(); renderCostPanel();
        }
      }));
    }

    var totals = computeTotals();
    renderPackageSwitch(totals);

    var pkgInfo = VITARO_PACKAGES.filter(function(p){ return p.id === state.pkg; })[0];
    var rows = [];
    rows.push({ label: "Gerätesumme (inkl. MwSt., Händlerpreise)", value: eur.format(totals.equipmentGross) });
    if(totals.equipmentGross > 0){
      if(totals.serviceNet === null){
        rows.push({ label: "Servicepauschale „" + pkgInfo.name + "“", value: "im Erstgespräch" });
      } else {
        rows.push({ label: "Servicepauschale „" + pkgInfo.name + "“ (netto)", value: eur.format(totals.serviceNet) });
        rows.push({ label: "zzgl. 19&nbsp;% MwSt. auf Servicepauschale", value: eur.format(totals.serviceVat) });
      }
    }
    breakdownEl.innerHTML = rows.map(function(r){
      return '<div class="planner-cost-breakdown-row"><span>' + r.label + '</span><b>' + r.value + '</b></div>';
    }).join("");

    totalEl.textContent = totals.grandTotal === null ? "auf Anfrage" : eur.format(totals.grandTotal);
    if(mobileTotalEl){
      mobileTotalEl.textContent = totals.grandTotal === null ? "auf Anfrage" : eur.format(totals.grandTotal);
    }

    updateGate(registered);
  }

  function costRow(opts){
    var row = document.createElement("div");
    row.className = "planner-cost-row";
    var qtyHtml = "";
    if(opts.qtyUnit){
      qtyHtml = '<div class="planner-cost-qty">' +
        '<button type="button" data-q="dec">−</button>' +
        '<input type="number" value="' + opts.qty + '" step="' + qtyStep(opts.qtyUnit) + '" min="0">' +
        '<button type="button" data-q="inc">+</button>' +
        '</div>';
    }
    var titleHtml = opts.href
      ? '<a class="planner-cost-row-title" href="' + opts.href + '">' + opts.title + '</a>'
      : '<div class="planner-cost-row-title">' + opts.title + '</div>';
    row.innerHTML =
      '<div class="planner-cost-row-main">' +
        titleHtml +
        '<div class="planner-cost-row-sub"><span class="planner-tier-pill" data-tier="' + opts.tier + '">' + (opts.tier === "premium" ? "Premium" : "Einstieg") + '</span>' + opts.sub + '</div>' +
      '</div>' +
      qtyHtml +
      '<div class="planner-cost-row-price">' + opts.price + '</div>' +
      '<button type="button" class="planner-cost-row-remove" aria-label="entfernen">×</button>';

    row.querySelector(".planner-cost-row-remove").addEventListener("click", opts.onRemove);
    if(opts.qtyUnit){
      var input = row.querySelector("input");
      var step = qtyStep(opts.qtyUnit);
      row.querySelector('[data-q="dec"]').addEventListener("click", function(){
        opts.onQtyChange(Math.max(0, (parseFloat(input.value) || 0) - step));
      });
      row.querySelector('[data-q="inc"]').addEventListener("click", function(){
        opts.onQtyChange((parseFloat(input.value) || 0) + step);
      });
      input.addEventListener("change", function(){
        opts.onQtyChange(parseFloat(input.value) || 0);
      });
    }
    return row;
  }

  /* ---------- room controls ---------- */
  // Ein reines Rechteck ohne eingezogene Ecken - nur dann bauen die L/B-
  // Felder die Form stillschweigend neu auf, sonst erst nach Rückfrage
  // (sonst würde eine mühsam angepasste Kontur ohne Vorwarnung verworfen).
  function isPlainRectangle(shape){
    if(shape.length !== 4) return false;
    var bb = polygonBBox(shape);
    return shape.every(function(p){
      return (Math.abs(p.x - bb.minX) < 0.5 || Math.abs(p.x - bb.maxX) < 0.5) &&
             (Math.abs(p.y - bb.minY) < 0.5 || Math.abs(p.y - bb.maxY) < 0.5);
    });
  }
  function onRoomChange(){
    var L = parseFloat(lengthInput.value) || 4.5;
    var B = parseFloat(widthInput.value) || 3.5;
    L = Math.max(2, Math.min(12, L));
    B = Math.max(2, Math.min(12, B));
    if(!isPlainRectangle(state.room.shape)){
      if(!window.confirm("Das setzt Ihre angepasste Raumform auf ein einfaches Rechteck zurück. Fortfahren?")){
        lengthInput.value = state.room.L; widthInput.value = state.room.B;
        return;
      }
    }
    state.room.L = L; state.room.B = B;
    state.room.shape = rectShape(L * 100, B * 100);
    ensureDoors();
    state.items.forEach(function(it){ clampItem(it); tryAutoRotateForFit(it); });
    resolveDoorConflicts();
    save(); renderRoom(); renderCostPanel();
  }
  lengthInput.addEventListener("change", onRoomChange);
  widthInput.addEventListener("change", onRoomChange);

  // Raumkontur-Werkzeuge: individuell anpassen, zurücksetzen, Türen
  // platzieren/verschieben. Das Breite-Feld bezieht sich immer auf die
  // gerade ausgewählte Tür (activeDoorIdx) - ohne Auswahl bleibt es versteckt.
  function renderDoorControls(){
    if(!doorWidthField) return;
    if(activeDoorIdx === null || !state.room.doors[activeDoorIdx]){
      doorWidthField.hidden = true;
      return;
    }
    doorWidthField.hidden = false;
    doorWidthInput.value = Math.round(state.room.doors[activeDoorIdx].width);
  }
  if(addDoorBtn) addDoorBtn.addEventListener("click", function(){
    // Neue Tür auf der längsten Wand ohne bereits vorhandene Tür platzieren
    // (sonst auf der längsten Wand insgesamt) - mittig, damit sie sofort
    // sichtbar und frei verschiebbar ist.
    var shape = state.room.shape;
    var occupied = {};
    state.room.doors.forEach(function(d){ occupied[d.edge] = true; });
    var bestEdge = 0, bestLen = -1, fallbackEdge = 0, fallbackLen = -1;
    for(var i = 0; i < shape.length; i++){
      var e = edgeInfo(shape, i);
      if(e.len > fallbackLen){ fallbackLen = e.len; fallbackEdge = i; }
      if(!occupied[i] && e.len > bestLen){ bestLen = e.len; bestEdge = i; }
    }
    var edge = bestLen >= DOOR_MIN_CM ? bestEdge : fallbackEdge;
    var e2 = edgeInfo(shape, edge);
    var width = Math.min(90, e2.len);
    var newDoor = { edge: edge, pos: Math.max(0, (e2.len - width) / 2), width: width };
    state.room.doors.push(newDoor);
    activeDoorIdx = state.room.doors.length - 1;
    ensureDoors();
    resolveDoorSpacing();
    resolveDoorConflicts();
    save(); renderRoom(); renderCostPanel();
  });
  if(doorWidthInput) doorWidthInput.addEventListener("change", function(){
    if(activeDoorIdx === null || !state.room.doors[activeDoorIdx]) return;
    var w = parseFloat(doorWidthInput.value) || 90;
    state.room.doors[activeDoorIdx].width = Math.max(DOOR_MIN_CM, Math.min(w, DOOR_MAX_CM));
    ensureDoors();
    resolveDoorConflicts();
    save(); renderRoom();
  });
  if(shapeEditToggle) shapeEditToggle.addEventListener("click", function(){
    state.roomEditMode = !state.roomEditMode;
    shapeEditToggle.classList.toggle("active", state.roomEditMode);
    shapeEditToggle.textContent = state.roomEditMode ? "Fertig" : "Grundriss anpassen";
    if(shapePanelBody) shapePanelBody.hidden = !state.roomEditMode;
    renderRoom();
  });
  if(shapeResetBtn) shapeResetBtn.addEventListener("click", function(){
    if(!window.confirm("Raumform wirklich auf ein einfaches Rechteck zurücksetzen?")) return;
    state.room.shape = rectShape(state.room.L * 100, state.room.B * 100);
    ensureDoors();
    state.items.forEach(function(it){ clampItem(it); });
    save(); renderRoom(); renderCostPanel();
  });
  if(undoBtn) undoBtn.addEventListener("click", undo);
  if(redoBtn) redoBtn.addEventListener("click", redo);

  flooringToggle.addEventListener("change", function(){
    state.flooring.included = flooringToggle.checked;
    if(state.flooring.included) state.flooring.auto = true;
    save(); renderRoom(); renderCostPanel();
  });
  clearanceToggle.addEventListener("change", function(){
    state.showClearance = clearanceToggle.checked;
    save(); renderItems();
  });
  snapToggle.addEventListener("change", function(){
    state.snapEnabled = snapToggle.checked;
    save();
  });
  flooringTierSwitch.querySelectorAll("button").forEach(function(btn){
    btn.addEventListener("click", function(){
      state.flooring.tier = btn.dataset.tier;
      flooringTierSwitch.querySelectorAll("button").forEach(function(b){ b.classList.toggle("active", b === btn); });
      save(); renderRoom(); renderCostPanel();
    });
  });

  resetBtn.addEventListener("click", function(){
    if(!confirm("Planung wirklich zurücksetzen?")) return;
    state.items = []; state.accessories = [];
    state.flooring = { included: false, tier: "budget", qty: null, auto: true };
    flooringToggle.checked = false;
    save(); renderRoom(); renderCostPanel();
  });

  handoverBtn.addEventListener("click", function(){
    var totals = computeTotals();
    var pkgInfo = VITARO_PACKAGES.filter(function(p){ return p.id === state.pkg; })[0];
    var lines = ["Meine VITARO-Planung (Planer & Kostenrechner):", "Raum: " + num.format(state.room.L) + " × " + num.format(state.room.B) + " m", "Paket: " + pkgInfo.name];
    state.items.forEach(function(it){
      var cat = byId[it.catId]; var t = tierData(it.catId, it.tier);
      lines.push("– " + cat.name + " (" + (it.tier === "premium" ? "Premium" : "Einstieg") + "): " + t.brand + " " + t.model + ", " + eur.format(t.price));
    });
    state.accessories.forEach(function(a){
      var cat = byId[a.catId]; var t = tierData(a.catId, a.tier);
      lines.push("– " + cat.name + " (" + (a.tier === "premium" ? "Premium" : "Einstieg") + "): " + a.qty + " " + cat.unit + " × " + t.brand + " " + t.model);
    });
    if(state.flooring.included){
      var t3 = tierData(FLOORING.id, state.flooring.tier);
      var autoArea = roomAreaM2();
      var qty = state.flooring.auto ? autoArea : state.flooring.qty;
      lines.push("– Bodenbelag (" + (state.flooring.tier === "premium" ? "Premium" : "Einstieg") + "): " + num.format(qty) + " m² " + t3.brand + " " + t3.model);
    }
    lines.push("", "Gerätesumme (inkl. MwSt.): " + eur.format(totals.equipmentGross));
    lines.push(totals.serviceNet === null ? "Servicepauschale: im Erstgespräch" : "Servicepauschale (netto + MwSt.): " + eur.format(totals.serviceGross));
    lines.push("Geschätzte Gesamtsumme: " + totalEl.textContent, "(Indikative Werte aus dem VITARO-Planer, keine Pauschalpreise — verbindlich erst im schriftlichen Angebot nach dem Vor-Ort-Termin.)");

    try{
      sessionStorage.setItem("vitaroPlanSummary", lines.join("\n"));
      sessionStorage.setItem("vitaroPlanRoomSize", String(Math.round(roomAreaM2())));
      var totalNum = totals.grandTotal === null ? totals.equipmentGross : totals.grandTotal;
      var bracket = totalNum < 15000 ? "bis_15k" : totalNum < 40000 ? "15_40k" : totalNum < 100000 ? "40_100k" : "ueber_100k";
      sessionStorage.setItem("vitaroPlanBudget", bracket);
      localStorage.setItem("vitaroRequestSentAt", String(Date.now()));
    }catch(e){}
    window.location.href = "kontakt.html#contactForm";
  });

  pdfBtn.addEventListener("click", function(){
    if(!(window.VitaroAuth && VitaroAuth.isRegistered())){
      VitaroAuth.openModal("Kostenlos registrieren, um das Planangebot als PDF herunterzuladen.");
      return;
    }
    window.location.href = "angebot.html";
  });

  packageSwitch.querySelectorAll("button").forEach(function(btn){
    btn.addEventListener("click", function(){
      state.pkg = btn.dataset.pkg;
      state.pkgManual = true;
      save(); renderCostPanel();
    });
  });

  /* ---------- Zugriffs-Gate: Kostenrechner erst nach Registrierung sichtbar ---------- */
  function updateGate(registered){
    gateOverlay.hidden = !!registered;
    gateInner.classList.toggle("vitaro-gate-blur", !registered);
    if(!registered){
      costGateText.textContent = "Kostenlos anmelden, um den Kostenrechner sichtbar zu machen.";
    }
    // Dieselbe Sperre gilt für die mobile Preisleiste - sonst würde sie den
    // Preis zeigen, obwohl er im Kostenrechner-Tab noch unscharf/gesperrt ist.
    if(mobilePricebar){
      mobilePricebar.classList.toggle("is-gated", !registered);
      mobilePricebarBtn.textContent = registered ? "Kostenaufstellung ansehen" : "Jetzt anmelden";
    }
  }

  function updateTimerBadge(){
    if(!window.VitaroAuth || VitaroAuth.isRegistered()){
      timerBadge.hidden = true;
      return;
    }
    var msLeft = VitaroAuth.timeLeftMs();
    timerBadge.hidden = false;
    if(msLeft <= 0){
      timerBadge.dataset.state = "expired";
      timerBadge.textContent = "Testzeit abgelaufen — jetzt kostenlos registrieren, um weiterzuplanen";
    } else {
      var mins = Math.floor(msLeft / 60000);
      var secs = Math.floor((msLeft % 60000) / 1000);
      timerBadge.dataset.state = msLeft < 120000 ? "warn" : "ok";
      timerBadge.textContent = "Kostenlos testen: noch " + mins + ":" + (secs < 10 ? "0" : "") + secs + " Min.";
    }
  }

  window.addEventListener("vitaro:registered", function(){
    renderPalette(); renderAccessoryPalette(); renderCostPanel(); updateTimerBadge();
  });

  window.addEventListener("resize", function(){ renderRoom(); });

  /* ---------- Mobile: Tab-Umschalter Planer/Kostenrechner + Preisleiste ----------
     Auf Desktop stehen beide Spalten nebeneinander (siehe .planner-app-Grid) -
     auf dem Handy sonst eine sehr lange Seite zum Durchscrollen. Die kompakte
     Preisleiste bleibt bewusst in BEIDEN Tabs sichtbar (fixiert am unteren
     Bildschirmrand), damit man die Summe auch beim Geräte-Platzieren im
     Blick behält, ohne extra umzuschalten - nur die ausführliche
     Kostenaufstellung selbst steckt weiterhin nur im Kostenrechner-Tab. */
  if(mobileTabs){
    mobileTabs.querySelectorAll("button").forEach(function(btn){
      btn.addEventListener("click", function(){
        mobileTabs.querySelectorAll("button").forEach(function(b){ b.classList.toggle("active", b === btn); });
        app.dataset.mobileView = btn.dataset.view;
      });
    });
  }
  if(mobilePricebarBtn){
    mobilePricebarBtn.addEventListener("click", function(){
      if(window.VitaroAuth && !VitaroAuth.isRegistered()){
        VitaroAuth.openModal();
        return;
      }
      mobileTabs.querySelector('[data-view="kosten"]').click();
      mobilePricebar.scrollIntoView({ block: "nearest" });
      app.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Clicking empty canvas (the room background, grid lines, flooring fill -
  // anything that isn't a .planner-item) clears any pinned label.
  canvas.addEventListener("click", function(e){
    if(suppressNextCanvasDeselect){ suppressNextCanvasDeselect = false; return; }
    if(e.target.closest(".planner-item")) return;
    activeItemUid = null;
    canvas.querySelectorAll(".planner-item.is-active").forEach(function(n){ n.classList.remove("is-active"); });
    updateSelectedInfo();
    if(activeDoorIdx !== null){
      activeDoorIdx = null;
      renderDoorControls();
      renderRoom();
    }
  });

  gateOverlay.querySelector("[data-open-auth]").addEventListener("click", function(){
    VitaroAuth.openModal();
  });

  /* ---------- init ---------- */
  lengthInput.value = state.room.L;
  widthInput.value = state.room.B;
  flooringToggle.checked = state.flooring.included;
  clearanceToggle.checked = state.showClearance;
  snapToggle.checked = state.snapEnabled;
  flooringTierSwitch.querySelectorAll("button").forEach(function(b){ b.classList.toggle("active", b.dataset.tier === state.flooring.tier); });
  if(window.VitaroAuth) VitaroAuth.ensureTimerStarted();
  renderPalette();
  renderAccessoryPalette();
  renderRoom();
  renderCostPanel();
  updateTimerBadge();
  setInterval(updateTimerBadge, 1000);
})();
