/* ---------- GERÄTE-DETAILSEITE ----------
   Liest ?id=<catId>&tier=<budget|premium> und zeigt Bild, Preis und
   Beschreibung aus equipment-data.js. "Zurück zum Planer" verliert nichts -
   der Plan selbst liegt schon in localStorage (planer.js persistiert ihn
   bei jeder Änderung), diese Seite muss dafür nichts extra tun. */
(function(){
  var content = document.getElementById("geraetContent");
  if(!content || typeof VITARO_EQUIPMENT === "undefined") return;

  var params = new URLSearchParams(window.location.search);
  var id = params.get("id");
  var tier = params.get("tier") === "premium" ? "premium" : "budget";

  var byId = {};
  VITARO_EQUIPMENT.forEach(function(c){ byId[c.id] = c; });
  var cat = byId[id];

  if(!cat){
    document.getElementById("main").innerHTML =
      '<section class="section-tight"><div class="wrap"><a href="planer.html" class="geraet-back">← Zurück zum Planer</a>' +
      '<h1 style="margin-top:24px;">Gerät nicht gefunden</h1><p>Dieser Link scheint nicht mehr zu stimmen — bitte über den Planer erneut aufrufen.</p></div></section>';
    return;
  }

  var t = cat.tiers[tier];
  var eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  var imgPath = "assets/media/geraete/" + cat.id + "-" + tier + ".jpg";

  document.title = t.brand + " " + t.model + " — VITARO Home Gym";

  document.getElementById("geraetImg").src = imgPath;
  document.getElementById("geraetImg").alt = t.brand + " " + t.model;
  document.getElementById("geraetCategory").textContent = cat.name;
  document.getElementById("geraetModel").textContent = t.model;
  document.getElementById("geraetBrand").textContent = t.brand;
  var pill = document.getElementById("geraetTierPill");
  pill.dataset.tier = tier;
  pill.textContent = tier === "premium" ? "Premium" : "Einstieg";

  var priceLabel = (t.priceNote ? t.priceNote + " " : "") + eur.format(t.price) + (cat.unit ? "/" + cat.unit : "");
  document.getElementById("geraetPrice").textContent = priceLabel;
  document.getElementById("geraetBlurb").textContent = t.blurb || "";

  var specsHtml = "";
  if(cat.footprint){
    var fp = cat.footprint[tier];
    specsHtml += '<div class="geraet-spec"><span>Platzbedarf, ca.</span><b>' + fp.w + ' × ' + fp.d + ' cm</b></div>';
  }
  if(cat.note){
    specsHtml += '<div class="geraet-spec geraet-spec-note"><span>Hinweis</span><b>' + cat.note + '</b></div>';
  }
  document.getElementById("geraetSpecs").innerHTML = specsHtml;

  document.getElementById("geraetExternalLink").href = t.url;
  content.hidden = false;

  /* ---------- Preis-Gate (gleiche Logik wie im Planer) ---------- */
  function updatePriceGate(){
    var registered = window.VitaroAuth && VitaroAuth.isRegistered();
    var overlay = document.getElementById("geraetGateOverlay");
    var inner = document.getElementById("geraetPriceInner");
    overlay.hidden = !!registered;
    inner.classList.toggle("vitaro-gate-blur", !registered);
  }
  updatePriceGate();
  window.addEventListener("vitaro:registered", updatePriceGate);
  var gateBtn = document.querySelector("#geraetGateOverlay [data-open-auth]");
  if(gateBtn) gateBtn.addEventListener("click", function(){ VitaroAuth.openModal(); });

  /* ---------- die andere Stufe als Cross-Sell ---------- */
  var otherTier = tier === "budget" ? "premium" : "budget";
  var ot = cat.tiers[otherTier];
  if(ot){
    var altSection = document.getElementById("geraetAlternative");
    altSection.hidden = false;
    document.getElementById("geraetAltCard").href = "geraet.html?id=" + cat.id + "&tier=" + otherTier;
    document.getElementById("geraetAltImg").src = "assets/media/geraete/" + cat.id + "-" + otherTier + ".jpg";
    document.getElementById("geraetAltImg").alt = ot.brand + " " + ot.model;
    var altPill = document.getElementById("geraetAltPill");
    altPill.dataset.tier = otherTier;
    altPill.textContent = otherTier === "premium" ? "Premium" : "Einstieg";
    document.getElementById("geraetAltModel").textContent = ot.model;
    document.getElementById("geraetAltBrand").textContent = ot.brand;
  }

  /* ---------- "Im Planer verwenden": direkt zur Palette springen ---------- */
  document.getElementById("geraetUseBtn").addEventListener("click", function(){
    try{
      var raw = localStorage.getItem("vitaroPlannerState");
      var state = raw ? JSON.parse(raw) : { paletteTier: {} };
      state.paletteTier = state.paletteTier || {};
      state.paletteTier[cat.id] = tier;
      localStorage.setItem("vitaroPlannerState", JSON.stringify(state));
    }catch(e){}
    window.location.href = "planer.html#app";
  });
})();
