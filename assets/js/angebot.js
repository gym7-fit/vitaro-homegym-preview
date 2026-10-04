/* ---------- PLANANGEBOT (PDF via window.print()) ----------
   Liest denselben localStorage-State wie der Planer, baut daraus ein
   zweiseitiges Dokument und lässt den Browser selbst "als PDF speichern"
   (nativ in jedem modernen Browser, keine Client-Bibliothek nötig - das
   ist exakt derselbe Mechanismus, mit dem auch das interne
   Einkaufsdossier als PDF exportiert wurde). Gerätefelder sind hier
   bewusst beschriftete Rechtecke statt der verspielten Grundriss-Icons
   aus dem Planer selbst: für ein Angebotsdokument zählt Lesbarkeit
   (auch in Schwarz-Weiß-Ausdrucken) mehr als Wiedererkennbarkeit. */
(function(){
  var root = document.getElementById("offerRoot");
  var empty = document.getElementById("offerEmpty");
  if(!root) return;

  if(!(window.VitaroAuth && VitaroAuth.isRegistered())){
    empty.hidden = false;
    empty.querySelector("p").textContent = "Bitte zuerst kostenlos registrieren, um Ihr Planangebot herunterzuladen.";
    return;
  }

  var byId = {};
  VITARO_EQUIPMENT.forEach(function(c){ byId[c.id] = c; });
  var eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  var num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

  var state = null;
  try{ state = JSON.parse(localStorage.getItem("vitaroPlannerState") || "null"); }catch(e){}
  var hasAny = state && ((state.items && state.items.length) || (state.accessories && state.accessories.length) || (state.flooring && state.flooring.included));

  if(!hasAny){
    empty.hidden = false;
    empty.querySelector("p").textContent = "Noch keine Planung vorhanden — bitte zuerst im Planer etwas zusammenstellen.";
    return;
  }

  var user = VitaroAuth.getUser();
  root.hidden = false;

  var todayStr = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  document.getElementById("offerDate").textContent = todayStr;
  document.getElementById("offerDate2").textContent = todayStr;
  document.getElementById("offerNumber").textContent = "Angebot-Nr. " + new Date().toISOString().slice(0,10).replace(/-/g,"") + "-" + (Math.abs(hashCode(user.email)) % 1000);
  document.getElementById("offerCustomerName").textContent = user.name;
  document.getElementById("offerRoomSize").textContent = num.format(state.room.L) + " × " + num.format(state.room.B) + " m";

  function hashCode(s){ var h = 0; for(var i=0;i<s.length;i++){ h = ((h<<5)-h) + s.charCodeAt(i); h |= 0; } return h; }

  /* ---------- Seite 1: Grundriss mit Beschriftung + Maßen ---------- */
  function renderPlan(){
    var Lcm = state.room.L * 100, Bcm = state.room.B * 100;
    var svg = document.getElementById("offerPlanSvg");
    svg.setAttribute("viewBox", "0 0 " + Lcm + " " + Bcm);
    var parts = [];
    parts.push('<rect x="0" y="0" width="' + Lcm + '" height="' + Bcm + '" fill="#fbfaf6" stroke="#211c15" stroke-width="6"/>');

    for(var x = 0; x <= Lcm; x += 50){
      parts.push('<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + Bcm + '" stroke="#e4dcc9" stroke-width="' + (x % 100 === 0 ? 3 : 1.4) + '"/>');
    }
    for(var y = 0; y <= Bcm; y += 50){
      parts.push('<line x1="0" y1="' + y + '" x2="' + Lcm + '" y2="' + y + '" stroke="#e4dcc9" stroke-width="' + (y % 100 === 0 ? 3 : 1.4) + '"/>');
    }
    // meter scale along the bottom
    for(var m = 1; m * 100 < Lcm; m++){
      parts.push('<text x="' + (m * 100) + '" y="' + (Bcm - 10) + '" font-size="20" fill="#6e6353" text-anchor="middle">' + m + 'm</text>');
    }

    (state.items || []).forEach(function(it){
      var cat = byId[it.catId]; if(!cat) return;
      var fp = cat.footprint[it.tier];
      var w = it.rot === 90 ? fp.d : fp.w;
      var d = it.rot === 90 ? fp.w : fp.d;
      var color = it.tier === "premium" ? "#a1512f" : "#4f7a52";
      var fill = it.tier === "premium" ? "rgba(161,81,47,.14)" : "rgba(79,122,82,.14)";
      parts.push('<rect x="' + it.x + '" y="' + it.y + '" width="' + w + '" height="' + d + '" fill="' + fill + '" stroke="' + color + '" stroke-width="4"/>');
      var cx = it.x + w / 2, cy = it.y + d / 2;
      var fontSize = Math.max(11, Math.min(17, Math.min(w, d) * 0.16));
      parts.push('<text x="' + cx + '" y="' + (cy - fontSize * 0.3) + '" font-size="' + fontSize + '" font-weight="700" fill="#211c15" text-anchor="middle">' + escapeXml(cat.name) + '</text>');
      parts.push('<text x="' + cx + '" y="' + (cy + fontSize * 1.1) + '" font-size="' + (fontSize * 0.8) + '" fill="#6e6353" text-anchor="middle">' + Math.round(w) + '×' + Math.round(d) + ' cm</text>');
    });

    svg.innerHTML = parts.join("");
  }
  function escapeXml(s){ return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  /* ---------- Seite 2: Kostentabelle ---------- */
  function detailHref(catId, tier){ return "geraet.html?id=" + encodeURIComponent(catId) + "&tier=" + tier; }
  function tbodyRowGroup(label){ return '<tr class="row-group"><td colspan="5">' + label + '</td></tr>'; }
  function tbodyRow(name, href, brandModel, tier, qty, price){
    return '<tr><td><a href="' + href + '" target="_blank" style="color:inherit;">' + name + '</a></td><td>' + brandModel + '</td>' +
      '<td><span class="row-tier" data-tier="' + tier + '">' + (tier === "premium" ? "Premium" : "Einstieg") + '</span></td>' +
      '<td>' + qty + '</td><td>' + price + '</td></tr>';
  }

  function renderTable(){
    var body = document.getElementById("offerTableBody");
    var html = "";
    var equipmentGross = 0;

    if((state.items || []).length){
      html += tbodyRowGroup("Geräte im Raum");
      state.items.forEach(function(it){
        var cat = byId[it.catId]; var t = cat.tiers[it.tier];
        equipmentGross += t.price;
        html += tbodyRow(cat.name, detailHref(it.catId, it.tier), t.brand + " " + t.model, it.tier, "1", eur.format(t.price));
      });
    }
    if((state.accessories || []).length){
      html += tbodyRowGroup("Zubehör");
      state.accessories.forEach(function(a){
        var cat = byId[a.catId]; var t = cat.tiers[a.tier];
        var lineTotal = t.price * a.qty;
        equipmentGross += lineTotal;
        html += tbodyRow(cat.name, detailHref(a.catId, a.tier), t.brand + " " + t.model, a.tier, a.qty + " " + cat.unit, eur.format(lineTotal));
      });
    }
    if(state.flooring && state.flooring.included){
      html += tbodyRowGroup("Bodenbelag");
      var flooring = byId.flooring;
      var t3 = flooring.tiers[state.flooring.tier];
      var area = state.flooring.auto ? Math.round((state.room.L * state.room.B) * 10) / 10 : state.flooring.qty;
      var lineTotal3 = t3.price * area;
      equipmentGross += lineTotal3;
      html += tbodyRow(flooring.name, detailHref("flooring", state.flooring.tier), t3.brand + " " + t3.model, state.flooring.tier, num.format(area) + " m²", eur.format(lineTotal3));
    }
    body.innerHTML = html;
    return equipmentGross;
  }

  var equipmentGross = renderTable();
  renderPlan();

  var pkgId = state.pkg || vitaroSuggestPackage(equipmentGross);
  var pkgInfo = VITARO_PACKAGES.filter(function(p){ return p.id === pkgId; })[0];
  document.getElementById("offerPackage").textContent = pkgInfo.name;

  var serviceNet = vitaroServiceFee(pkgId, equipmentGross);
  document.getElementById("sumEquipment").textContent = eur.format(equipmentGross);
  if(serviceNet === null){
    document.getElementById("serviceNetLabel").textContent = "Servicepauschale „" + pkgInfo.name + "“";
    document.getElementById("sumServiceNet").textContent = "im Erstgespräch";
    document.getElementById("rowServiceVat").hidden = true;
    document.getElementById("sumTotal").textContent = "auf Anfrage";
  } else {
    var serviceVat = Math.round(serviceNet * VITARO_VAT_RATE * 100) / 100;
    var serviceGross = Math.round((serviceNet + serviceVat) * 100) / 100;
    var grandTotal = Math.round((equipmentGross + serviceGross) * 100) / 100;
    document.getElementById("serviceNetLabel").textContent = "Servicepauschale „" + pkgInfo.name + "“ (netto)";
    document.getElementById("sumServiceNet").textContent = eur.format(serviceNet);
    document.getElementById("sumServiceVat").textContent = eur.format(serviceVat);
    document.getElementById("sumTotal").textContent = eur.format(grandTotal);
  }

  document.getElementById("offerPackageTitle").textContent = pkgInfo.name;
  document.getElementById("offerPackageTagline").textContent = pkgInfo.tagline + ".";
  document.getElementById("offerPackageIncludes").innerHTML = pkgInfo.includes.map(function(i){ return "<li>" + i + "</li>"; }).join("");

  document.getElementById("printBtn").addEventListener("click", function(){ window.print(); });
  document.getElementById("toolbarStatus").textContent = "Erstellt für " + user.email;
})();
