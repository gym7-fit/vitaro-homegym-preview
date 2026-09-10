/* ---------- MEIN KONTO ----------
   Liest denselben localStorage, den planer.js schreibt - kein zweiter
   Datenspeicher, keine Möglichkeit, dass beide auseinanderlaufen. Gilt
   pro Gerät/Browser (siehe auth.js für die ehrliche Erklärung, warum). */
(function(){
  var loggedOutEl = document.getElementById("kontoLoggedOut");
  var loggedInEl = document.getElementById("kontoLoggedIn");
  if(!loggedOutEl || !window.VitaroAuth) return;

  var eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  var byId = {};
  if(typeof VITARO_EQUIPMENT !== "undefined") VITARO_EQUIPMENT.forEach(function(c){ byId[c.id] = c; });

  function render(){
    var user = VitaroAuth.getUser();
    if(!user){
      loggedOutEl.hidden = false;
      loggedInEl.hidden = true;
      document.getElementById("kontoGreeting").textContent = "Willkommen bei VITARO.";
      return;
    }
    loggedOutEl.hidden = true;
    loggedInEl.hidden = false;

    document.getElementById("kontoGreeting").textContent = "Willkommen zurück, " + user.name.split(" ")[0] + ".";
    document.getElementById("kontoName").textContent = user.name;
    document.getElementById("kontoEmail").textContent = user.email;
    document.getElementById("kontoPhone").textContent = user.phone || "Kein Telefon hinterlegt";

    var requestSentAt = null;
    try{ requestSentAt = localStorage.getItem("vitaroRequestSentAt"); }catch(e){}
    var statusEl = document.getElementById("kontoStatus");
    if(requestSentAt){
      var d = new Date(parseInt(requestSentAt, 10));
      statusEl.innerHTML = '<span class="planner-tier-pill" data-tier="budget">Angefragt</span><br><br>Anfrage gesendet am ' + d.toLocaleDateString("de-DE") + '. Wir melden uns für das kostenlose Erstgespräch.';
    } else {
      statusEl.innerHTML = '<span class="planner-tier-pill" data-tier="premium">Planung offen</span><br><br>Noch keine Anfrage gesendet — sobald Sie im Planer auf „Im Erstgespräch besprechen" klicken, erscheint der Status hier.';
    }

    renderPlan();
  }

  function renderPlan(){
    var raw;
    try{ raw = localStorage.getItem("vitaroPlannerState"); }catch(e){}
    var state = null;
    try{ state = raw ? JSON.parse(raw) : null; }catch(e){}

    var hasAny = state && ((state.items && state.items.length) || (state.accessories && state.accessories.length) || (state.flooring && state.flooring.included));
    document.getElementById("kontoPlanEmpty").hidden = !!hasAny;
    document.getElementById("kontoPlanContent").hidden = !hasAny;
    if(!hasAny) return;

    var list = document.getElementById("kontoPlanList");
    list.innerHTML = "";
    var equipmentGross = 0;

    function row(title, sub, tier, price){
      var el = document.createElement("div");
      el.className = "planner-cost-row";
      el.innerHTML = '<div class="planner-cost-row-main"><div class="planner-cost-row-title">' + title + '</div>' +
        '<div class="planner-cost-row-sub"><span class="planner-tier-pill" data-tier="' + tier + '">' + (tier === "premium" ? "Premium" : "Einstieg") + '</span>' + sub + '</div></div>' +
        '<div class="planner-cost-row-price">' + price + '</div>';
      list.appendChild(el);
    }

    (state.items || []).forEach(function(it){
      var cat = byId[it.catId]; if(!cat) return;
      var t = cat.tiers[it.tier];
      equipmentGross += t.price;
      row(cat.name, t.brand + " · " + t.model, it.tier, eur.format(t.price));
    });
    (state.accessories || []).forEach(function(a){
      var cat = byId[a.catId]; if(!cat) return;
      var t = cat.tiers[a.tier];
      var lineTotal = t.price * a.qty;
      equipmentGross += lineTotal;
      row(cat.name, t.brand + " · " + t.model, a.tier, eur.format(lineTotal));
    });
    if(state.flooring && state.flooring.included){
      var flooring = byId.flooring;
      var t3 = flooring.tiers[state.flooring.tier];
      var area = state.flooring.auto ? Math.round((state.room.L * state.room.B) * 10) / 10 : state.flooring.qty;
      var lineTotal3 = t3.price * area;
      equipmentGross += lineTotal3;
      row(flooring.name, t3.brand + " · " + t3.model, state.flooring.tier, eur.format(lineTotal3));
    }

    var pkg = state.pkg || vitaroSuggestPackage(equipmentGross);
    var serviceNet = vitaroServiceFee(pkg, equipmentGross);
    var grandTotal = serviceNet === null ? null : equipmentGross + Math.round(serviceNet * (1 + VITARO_VAT_RATE) * 100) / 100;
    document.getElementById("kontoPlanTotal").textContent = grandTotal === null ? "auf Anfrage" : eur.format(grandTotal);
  }

  document.getElementById("kontoLoginBtn").addEventListener("click", function(){ VitaroAuth.openModal(); });
  document.getElementById("kontoLogoutBtn").addEventListener("click", function(){
    VitaroAuth.logout();
    render();
  });
  window.addEventListener("vitaro:registered", render);
  window.addEventListener("vitaro:loggedout", render);

  render();
})();
