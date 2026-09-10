/* ---------- VITARO KONTO / ANMELDUNG ----------
   Ehrliche Grenze vorab, damit niemand (auch nicht zukünftiges Ich) das für
   mehr hält, als es ist: Diese Seite ist rein statisch gehostet (GitHub
   Pages), es gibt keinen eigenen Server. "Registrieren" heißt hier konkret
   drei Dinge, alle real:
     1. Die Kontaktdaten gehen per Formspree (dieselbe Anbindung wie das
        Kontaktformular) tatsächlich als E-Mail an VITARO raus.
     2. Dieselben Kontaktdaten (Name, E-Mail, Telefon) landen zusätzlich als
        Zeile in einer echten Supabase-Datenbank (Tabelle "kunden") - das
        ist die eigentliche Kunden-Datenbank, siehe syncToSupabase() unten.
        Von der Webseite aus ist NUR Einfügen erlaubt (Row-Level-Security-
        Regel in Supabase), kein Lesen/Ändern/Löschen - ein Blick in den
        Seiten-Code kann also keine fremden Kundendaten offenlegen.
     3. Der "eingeloggt"-Zustand selbst (inkl. Passwort-Hash) lebt weiterhin
        nur in localStorage, gilt also nur für dieses Gerät/diesen Browser.
        Das ist bewusst getrennt von Punkt 2: die Kunden-DB ist ein reines
        Einbahnstraßen-Postfach für Leads, kein Auth-Speicher - dort landet
        deshalb auch nie ein Passwort oder dessen Hash.
   "Anmelden" prüft weiterhin nur gegen das lokale Konto auf diesem Gerät -
   für eine echte geräteübergreifende Anmeldung bräuchte es zusätzlich eine
   Supabase-Auth-Anbindung, die hier (noch) nicht gebaut ist. */
(function(){

  var STORAGE_KEY = "vitaroUser";     // das Konto selbst - überlebt ein Logout
  var SESSION_KEY = "vitaroSession";  // "1" = gerade angemeldet, sonst abgemeldet
  var TIMER_KEY = "vitaroPlannerStart";
  var FREE_MINUTES = 10;

  // Öffentliche Projekt-URL + "publishable" (anon) Key - beide sind bewusst
  // dafür gedacht, im Client-Code sichtbar zu sein (siehe Row-Level-Security-
  // Regel in Supabase: nur Einfügen erlaubt, kein Lesen). Kein Geheimnis hier.
  var SUPABASE_URL = "https://xgkujmwcumcpibfkvmnr.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_wVMpntBaoBl05u7-x5EySA_JJQg2A-m";

  // Fire-and-forget, wie schon beim Formspree-Versand: ein neuer Kunden-
  // Eintrag ist nice-to-have für die Datenbank, darf aber niemals die lokale
  // Registrierung blockieren oder verzögern, falls Supabase mal langsam ist
  // oder die Tabelle (noch) nicht existiert.
  function syncToSupabase(name, email, phone){
    try{
      fetch(SUPABASE_URL + "/rest/v1/kunden", {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ name: name, email: email, telefon: phone, quelle: "Planer-Registrierung" })
      }).catch(function(){});
    }catch(e){}
  }

  // Kontodaten unabhängig vom Anmeldestatus lesen - für den Passwort-Abgleich beim
  // Login, wo genau geprüft werden muss, obwohl man gerade "abgemeldet" ist.
  function getAccount(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  // Öffentlich sichtbarer Nutzer: nur wenn tatsächlich eine Sitzung aktiv ist.
  // Ein Logout löscht bewusst NICHT das Konto (sonst könnte "Anmelden" auf
  // demselben Gerät nie wieder funktionieren, siehe logout() unten) - es setzt
  // nur die Sitzung zurück, getUser() gibt dann trotzdem null zurück.
  function getUser(){
    try{
      if(localStorage.getItem(SESSION_KEY) !== "1") return null;
    }catch(e){ return null; }
    return getAccount();
  }
  function isRegistered(){ return !!getUser(); }

  function setUser(user){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      localStorage.setItem(SESSION_KEY, "1");
    }catch(e){}
  }
  // Nach erfolgreicher Login-Prüfung: Konto ist schon da, nur die Sitzung wird
  // wieder aktiv geschaltet - kein erneutes Schreiben der Kontodaten nötig.
  function startSession(){
    try{ localStorage.setItem(SESSION_KEY, "1"); }catch(e){}
  }
  function logout(){
    try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
    fireEvent("vitaro:loggedout");
  }

  function fireEvent(name, detail){
    try{ window.dispatchEvent(new CustomEvent(name, { detail: detail })); }catch(e){}
  }

  // SHA-256 über WebCrypto - das Passwort selbst wird nirgends gespeichert oder
  // geloggt, nur dieser Hash. Ehrlich gesagt: das schützt vor einem beiläufigen
  // Blick in localStorage, nicht vor jemandem mit Entwicklerkonsole auf
  // demselben Gerät - echte Sicherheit bräuchte einen Server, der den Hash
  // prüft, statt dass der Client sich selbst die Antwort gibt. Trotzdem besser
  // als der Klartext-Vergleich, den ein Konto-Formular sonst nahelegen würde.
  // Buchstabe + Zahl + Sonderzeichen, mind. 8 Zeichen - wie bei jeder
  // normalen Registrierungsmaske üblich (z.B. GitHub/Google-Signup-Muster).
  function isStrongPassword(pw){
    return /[A-Za-zÄÖÜäöüß]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9ÄÖÜäöüß]/.test(pw) && pw.length >= 8;
  }

  function hashPassword(pw){
    var data = new TextEncoder().encode(pw);
    return crypto.subtle.digest("SHA-256", data).then(function(buf){
      return Array.prototype.map.call(new Uint8Array(buf), function(b){
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  /* ---------- 10-Minuten-Testphase (nur relevant, solange nicht registriert) ---------- */
  function ensureTimerStarted(){
    try{
      if(!sessionStorage.getItem(TIMER_KEY)){
        sessionStorage.setItem(TIMER_KEY, String(Date.now()));
      }
    }catch(e){}
  }
  function timeLeftMs(){
    if(isRegistered()) return Infinity;
    var start;
    try{ start = parseInt(sessionStorage.getItem(TIMER_KEY), 10); }catch(e){ start = Date.now(); }
    if(!start){ ensureTimerStarted(); start = Date.now(); }
    var elapsed = Date.now() - start;
    return Math.max(0, FREE_MINUTES * 60000 - elapsed);
  }
  function trialExpired(){ return !isRegistered() && timeLeftMs() <= 0; }

  /* ---------- Modal (einmal ins DOM injiziert, von jeder Seite aus nutzbar) ---------- */
  var modalEl = null;
  function buildModal(){
    if(modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "vitaro-modal-backdrop";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.hidden = true;
    modalEl.innerHTML =
      '<div class="vitaro-modal">' +
        '<button type="button" class="vitaro-modal-close" aria-label="Schließen">&times;</button>' +
        '<div class="vitaro-modal-tabs">' +
          '<button type="button" class="vitaro-modal-tab active" data-tab="register">Registrieren</button>' +
          '<button type="button" class="vitaro-modal-tab" data-tab="login">Anmelden</button>' +
        '</div>' +
        '<p class="vitaro-modal-reason" id="vitaroModalReason"></p>' +
        '<form class="vitaro-modal-form" data-view="register">' +
          '<div class="form-field"><label for="vmName">Ihr Name</label><input type="text" id="vmName" required autocomplete="name"></div>' +
          '<div class="form-field" id="vmEmailField"><label for="vmEmail">E-Mail</label><input type="email" id="vmEmail" required autocomplete="email"><p class="field-error" id="vmEmailError" hidden>Diese E-Mail ist auf diesem Gerät bereits registriert. <a href="#" data-goto-login>Stattdessen anmelden</a>.</p></div>' +
          '<div class="form-field" id="vmPasswordField"><label for="vmPassword">Passwort</label><input type="password" id="vmPassword" required minlength="8" autocomplete="new-password"><p class="field-error" id="vmPasswordError" hidden>Passwort nicht stark genug — mind. 8 Zeichen mit Buchstaben, Zahlen und einem Sonderzeichen.</p></div>' +
          '<div class="form-field" id="vmPasswordConfirmField"><label for="vmPasswordConfirm">Passwort wiederholen</label><input type="password" id="vmPasswordConfirm" required autocomplete="new-password"><p class="field-error" id="vmPasswordConfirmError" hidden>Passwörter stimmen nicht überein.</p></div>' +
          '<p class="vitaro-modal-hint">Ihr Zugang gilt für dieses Gerät. Für einen geräteübergreifenden Login mit echter serverseitiger Prüfung braucht es ein eigenes Backend — sprechen Sie uns an, falls gewünscht.</p>' +
          '<div class="form-field"><label for="vmPhone">Telefon (optional)</label><input type="tel" id="vmPhone" autocomplete="tel"></div>' +
          '<label class="form-consent" style="margin-top:4px;">' +
            '<input type="checkbox" id="vmConsent" required>' +
            '<span><span>Ich bin einverstanden, dass VITARO Home Gym meine Angaben speichert und zur Kontaktaufnahme nutzt, gemäß der</span> <a href="datenschutz.html" target="_blank">Datenschutzerklärung</a>.</span>' +
          '</label>' +
          '<button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:14px;">Kostenlos registrieren &amp; freischalten</button>' +
          '<p class="vitaro-modal-note">Keine Zahlungsdaten nötig. Schaltet Preise, Kostenrechner und den PDF-Export frei.</p>' +
        '</form>' +
        '<form class="vitaro-modal-form" data-view="login" hidden>' +
          '<div class="form-field"><label for="vmLoginEmail">E-Mail, mit der Sie registriert sind</label><input type="email" id="vmLoginEmail" required autocomplete="email"></div>' +
          '<div class="form-field"><label for="vmLoginPassword">Passwort</label><input type="password" id="vmLoginPassword" required autocomplete="current-password"></div>' +
          '<button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:14px;">Anmelden</button>' +
          '<p class="vitaro-modal-note">Die Anmeldung gilt pro Gerät. Erkennt dieses Gerät Ihre E-Mail/Ihr Passwort nicht wieder, registrieren wir Sie neu — Ihre Daten bleiben dabei erhalten.</p>' +
        '</form>' +
      '</div>';
    document.body.appendChild(modalEl);

    modalEl.querySelector(".vitaro-modal-close").addEventListener("click", closeModal);
    modalEl.addEventListener("click", function(e){ if(e.target === modalEl) closeModal(); });
    document.addEventListener("keydown", function(e){ if(e.key === "Escape" && !modalEl.hidden) closeModal(); });

    var tabs = modalEl.querySelectorAll(".vitaro-modal-tab");
    tabs.forEach(function(tab){
      tab.addEventListener("click", function(){
        tabs.forEach(function(t){ t.classList.toggle("active", t === tab); });
        modalEl.querySelectorAll(".vitaro-modal-form").forEach(function(f){
          f.hidden = f.getAttribute("data-view") !== tab.dataset.tab;
        });
      });
    });

    // Live-Validierung, wie es eine Registriermaske erwarten lässt: Feld wird
    // rot + Fehlertext erscheint, sobald der Nutzer etwas eingegeben hat -
    // nicht schon beim leeren Formular, das wäre nur störend.
    var emailField = document.getElementById("vmEmailField");
    var emailInput = document.getElementById("vmEmail");
    var emailError = document.getElementById("vmEmailError");
    emailInput.addEventListener("input", function(){
      // Fehler verschwindet, sobald getippt wird - die harte Prüfung passiert
      // wieder beim Absenden, das hier ist nur, damit das rote Feld nicht
      // stur stehen bleibt, während man schon eine andere Adresse eintippt.
      emailField.classList.remove("invalid");
      emailError.hidden = true;
    });
    emailError.querySelector("[data-goto-login]").addEventListener("click", function(e){
      e.preventDefault();
      document.getElementById("vmLoginEmail").value = emailInput.value.trim();
      tabs[1].click();
      setTimeout(function(){ document.getElementById("vmLoginPassword").focus(); }, 50);
    });

    var pwField = document.getElementById("vmPasswordField");
    var pwInput = document.getElementById("vmPassword");
    var pwError = document.getElementById("vmPasswordError");
    var pwConfirmField = document.getElementById("vmPasswordConfirmField");
    var pwConfirmInput = document.getElementById("vmPasswordConfirm");
    var pwConfirmError = document.getElementById("vmPasswordConfirmError");

    function validatePasswordField(){
      if(pwInput.value === ""){ pwField.classList.remove("invalid"); pwError.hidden = true; return true; }
      var ok = isStrongPassword(pwInput.value);
      pwField.classList.toggle("invalid", !ok);
      pwError.hidden = ok;
      return ok;
    }
    function validateConfirmField(){
      if(pwConfirmInput.value === ""){ pwConfirmField.classList.remove("invalid"); pwConfirmError.hidden = true; return true; }
      var ok = pwConfirmInput.value === pwInput.value;
      pwConfirmField.classList.toggle("invalid", !ok);
      pwConfirmError.hidden = ok;
      return ok;
    }
    pwInput.addEventListener("input", function(){ validatePasswordField(); validateConfirmField(); });
    pwConfirmInput.addEventListener("input", validateConfirmField);

    modalEl.querySelector('[data-view="register"]').addEventListener("submit", function(e){
      e.preventDefault();

      // Beim Absenden nochmal hart prüfen (auch wenn leer gelassen wurde,
      // z.B. Copy-Paste ohne "input"-Event) - nie mit einem schwachen oder
      // nicht übereinstimmenden Passwort weiterschalten.
      var pwOk = isStrongPassword(pwInput.value);
      var confirmOk = pwConfirmInput.value === pwInput.value;
      pwField.classList.toggle("invalid", !pwOk);
      pwError.hidden = pwOk;
      pwConfirmField.classList.toggle("invalid", !confirmOk);
      pwConfirmError.hidden = confirmOk;
      var name = document.getElementById("vmName").value.trim();
      var email = document.getElementById("vmEmail").value.trim();
      var password = pwInput.value;
      var phone = document.getElementById("vmPhone").value.trim();

      // Diese eine Speicherstelle (STORAGE_KEY) hält immer nur ein Konto -
      // ohne diese Prüfung würde eine erneute Registrierung mit derselben
      // E-Mail das bestehende Konto (inkl. Passwort) klanglos überschreiben,
      // und man hätte anschließend kommentarlos ein neues Passwort, ohne dass
      // irgendwas darauf hingewiesen hätte. Stattdessen: Fehler + Angebot,
      // stattdessen anzumelden - wie bei jeder normalen Registriermaske.
      var existingAcc = getAccount();
      var emailTaken = existingAcc && existingAcc.email.toLowerCase() === email.toLowerCase();
      emailField.classList.toggle("invalid", !!emailTaken);
      emailError.hidden = !emailTaken;
      if(emailTaken){ emailInput.focus(); return; }

      if(!pwOk){ pwInput.focus(); return; }
      if(!confirmOk){ pwConfirmInput.focus(); return; }

      hashPassword(password).then(function(passwordHash){
        // Freischalten passiert sofort und lokal, bevor überhaupt ein Netzwerk-
        // Request losgeht. Vorher hing das Speichern am Ergebnis der Formspree-
        // Anfrage - wer ungeduldig war und vor deren Antwort schon weiterklickte
        // oder die Seite wechselte, war "registriert" ohne dass es je gespeichert
        // wurde, und stand beim nächsten Anmeldeversuch vor "E-Mail unbekannt".
        // Der Mail-Versand an VITARO läuft jetzt nur noch nebenher mit - und
        // enthält nie das Passwort oder seinen Hash.
        setUser({ name: name, email: email, phone: phone, passwordHash: passwordHash, registeredAt: Date.now() });
        closeModal();
        fireEvent("vitaro:registered", { name: name, email: email });

        syncToSupabase(name, email, phone);

        if(window.FORMSPREE_ENDPOINT){
          var fd = new FormData();
          fd.append("_subject", "VITARO Planer — Neue Registrierung");
          fd.append("name", name);
          fd.append("email", email);
          fd.append("phone", phone);
          fd.append("quelle", "Planer-Registrierung");
          fetch(window.FORMSPREE_ENDPOINT, { method: "POST", body: fd, headers: { "Accept": "application/json" } }).catch(function(){});
        }
      });
    });

    modalEl.querySelector('[data-view="login"]').addEventListener("submit", function(e){
      e.preventDefault();
      var email = document.getElementById("vmLoginEmail").value.trim().toLowerCase();
      var password = document.getElementById("vmLoginPassword").value;
      // Bewusst getAccount(), nicht getUser(): Nach einem Logout ist getUser()
      // schon null (keine aktive Sitzung), aber das Konto zum Abgleichen muss
      // trotzdem noch da sein - sonst könnte "Anmelden" nach "Abmelden" auf
      // demselben Gerät nie wieder klappen.
      var existing = getAccount();

      hashPassword(password).then(function(passwordHash){
        var emailMatches = existing && existing.email.toLowerCase() === email;
        // Konten von vor der Passwort-Umstellung haben noch kein passwordHash-Feld -
        // die lassen wir einmalig ohne Passwortprüfung durch (E-Mail reicht), statt
        // Bestandsnutzer auszusperren, deren Konto es schon vor diesem Feature gab.
        var passwordMatches = !existing || !existing.passwordHash || existing.passwordHash === passwordHash;
        if(emailMatches && passwordMatches){
          startSession();
          closeModal();
          fireEvent("vitaro:registered", { name: existing.name, email: existing.email });
        } else if(emailMatches){
          var reasonWrongPw = document.getElementById("vitaroModalReason");
          reasonWrongPw.textContent = "Falsche E-Mail oder falsches Passwort.";
          reasonWrongPw.hidden = false;
        } else {
          document.getElementById("vmEmail").value = document.getElementById("vmLoginEmail").value;
          tabs[0].click();
          var reason = document.getElementById("vitaroModalReason");
          reason.textContent = "Diese E-Mail ist auf diesem Gerät nicht bekannt — bitte einmal registrieren, dauert 10 Sekunden.";
          reason.hidden = false;
        }
      });
    });

    return modalEl;
  }

  function openModal(reason){
    var m = buildModal();
    var reasonEl = m.querySelector("#vitaroModalReason");
    if(reason){ reasonEl.textContent = reason; reasonEl.hidden = false; } else { reasonEl.hidden = true; }
    m.hidden = false;
    document.body.classList.add("vitaro-modal-open");
    setTimeout(function(){ var f = m.querySelector('[data-view="register"] input'); if(f) f.focus(); }, 50);
  }
  function closeModal(){
    if(!modalEl) return;
    modalEl.hidden = true;
    document.body.classList.remove("vitaro-modal-open");
  }

  window.VitaroAuth = {
    isRegistered: isRegistered,
    getUser: getUser,
    logout: logout,
    ensureTimerStarted: ensureTimerStarted,
    timeLeftMs: timeLeftMs,
    trialExpired: trialExpired,
    openModal: openModal,
    closeModal: closeModal
  };

  /* ---------- Header-Login-Status: "Mein Konto" vs. "Registrieren" ---------- */
  document.addEventListener("DOMContentLoaded", function(){
    var slot = document.querySelector("[data-auth-slot]");
    if(!slot) return;
    function render(){
      var user = getUser();
      if(user){
        slot.innerHTML =
          '<span class="auth-slot-loggedin">' +
            '<a href="konto.html" class="btn btn-ghost">' + user.name.split(" ")[0] + " · Mein Konto</a>" +
            '<button type="button" class="btn btn-ghost" data-logout>Abmelden</button>' +
          '</span>';
        slot.querySelector("[data-logout]").addEventListener("click", function(){ logout(); });
      } else {
        slot.innerHTML = '<button type="button" class="btn btn-ghost" data-open-auth>Registrieren / Anmelden</button>';
        slot.querySelector("[data-open-auth]").addEventListener("click", function(){ openModal(); });
      }
    }
    render();
    window.addEventListener("vitaro:registered", render);
    window.addEventListener("vitaro:loggedout", render);
  });
})();
