/* ---------- SITE CONFIG (the single place to switch things live) ----------
   FORMSPREE_ENDPOINT  https://formspree.io/f/<id>. Empty = the form shows a
                       "not live yet" notice instead of silently posting.
   CONTACT_EMAIL       Real mailbox. Empty = email button stays hidden and the
                       pending note on kontakt.html stays visible.
   There is deliberately no BOOKING_URL constant on this site yet — unlike
   the hotel concept, there's no self-serve booking calendar for Home Gym
   consultations yet, so every CTA points straight at the contact form. ---------- */
var FORMSPREE_ENDPOINT = 'https://formspree.io/f/xwlkrkoy';
var CONTACT_EMAIL = 'vitaro.gymsolutions@gmail.com';

(function(){
  var mail = document.querySelector('[data-contact-email]');
  var pending = document.getElementById('contactEmailPending');
  if(mail && CONTACT_EMAIL){
    mail.setAttribute('href', 'mailto:' + CONTACT_EMAIL);
    mail.textContent = CONTACT_EMAIL;
    mail.hidden = false;
    if(pending){ pending.hidden = true; }
  }
})();

/* ---------- HERO SLIDESHOW (crossfade through .hero-bg-slide layers,
   5s per image, paused for prefers-reduced-motion). Homepage only. ---------- */
(function(){
  var slides = document.querySelectorAll('.hero-bg-slide');
  if(slides.length < 2) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var current = 0;
  setInterval(function(){
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }, 5000);
})();

/* ---------- GALLERY LIGHTBOX: click any .gallery-tile.has-image to open
   it large, with prev/next cycling through every photo on the page (in
   document order) and a caption pulled straight from the image's alt
   text - no separate captions to keep in sync. No-op on pages without
   a gallery (guarded on the #lightbox element existing). ---------- */
(function(){
  var lightbox = document.getElementById('lightbox');
  var tiles = Array.prototype.slice.call(document.querySelectorAll('.gallery-tile.has-image'));
  if(!lightbox || !tiles.length) return;
  var imgEl = document.getElementById('lightboxImg');
  var captionEl = document.getElementById('lightboxCaption');
  var closeBtn = document.getElementById('lightboxClose');
  var prevBtn = document.getElementById('lightboxPrev');
  var nextBtn = document.getElementById('lightboxNext');
  var current = 0;
  var lastFocused = null;

  function show(i){
    current = (i + tiles.length) % tiles.length;
    var img = tiles[current].querySelector('img');
    imgEl.src = img.currentSrc || img.src;
    imgEl.alt = img.alt;
    captionEl.textContent = img.alt;
  }
  function open(i){
    lastFocused = document.activeElement;
    show(i);
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }
  function close(){
    lightbox.hidden = true;
    document.body.style.overflow = '';
    if(lastFocused){ lastFocused.focus(); }
  }
  tiles.forEach(function(tile, i){
    tile.addEventListener('click', function(){ open(i); });
  });
  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', function(){ show(current - 1); });
  nextBtn.addEventListener('click', function(){ show(current + 1); });
  lightbox.addEventListener('click', function(e){ if(e.target === lightbox){ close(); } });
  document.addEventListener('keydown', function(e){
    if(lightbox.hidden) return;
    if(e.key === 'Escape'){ close(); }
    else if(e.key === 'ArrowLeft'){ show(current - 1); }
    else if(e.key === 'ArrowRight'){ show(current + 1); }
  });

  /* Swipe left/right on touch devices - arrows stay for mouse/desktop,
     this is additive. 40px threshold so a scroll-y tap doesn't misfire
     as a swipe; passive listeners since nothing here needs to block
     the browser's own touch handling.
     Two things had to be excluded, or pinch-zooming the photo would
     also fire a swipe: a second finger touching down at any point
     during the gesture (pinch-zoom is inherently two touches), and the
     page already being zoomed in (a one-finger pan to look around a
     zoomed photo is still one touch, but isn't a swipe request - caught
     via visualViewport.scale, not available everywhere so it fails open
     to "not zoomed" rather than breaking swipe on browsers without it). */
  var touchStartX = null;
  var multiTouch = false;
  function isZoomedIn(){
    return !!(window.visualViewport && window.visualViewport.scale > 1.05);
  }
  lightbox.addEventListener('touchstart', function(e){
    if(e.touches.length > 1 || isZoomedIn()){
      multiTouch = true;
      touchStartX = null;
      return;
    }
    multiTouch = false;
    touchStartX = e.changedTouches[0].clientX;
  }, { passive: true });
  lightbox.addEventListener('touchmove', function(e){
    if(e.touches.length > 1){ multiTouch = true; }
  }, { passive: true });
  lightbox.addEventListener('touchend', function(e){
    var wasMultiTouch = multiTouch;
    multiTouch = false;
    if(wasMultiTouch || touchStartX === null || e.touches.length > 0 || isZoomedIn()){
      touchStartX = null;
      return;
    }
    var dx = e.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if(Math.abs(dx) < 40) return;
    if(dx < 0){ show(current + 1); } else { show(current - 1); }
  }, { passive: true });
})();

/* ---------- HEADER SCROLL STATE ---------- */
(function(){
  var header = document.querySelector('header');
  if(!header) return;
  var syncScrolled = function(){
    header.classList.toggle('scrolled', window.scrollY > 40);
  };
  syncScrolled();
  window.addEventListener('scroll', syncScrolled, { passive: true });
})();

/* ---------- THEME ---------- */
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme(){
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  var next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('vitaro-theme', next);
  localStorage.setItem('vitaro-theme-manual', '1');
}
if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e){
    if(!localStorage.getItem('vitaro-theme-manual')){
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

/* ---------- MOBILE MENU ---------- */
var MOBILE_NAV_BREAKPOINT = 1220; // keep in sync with style.css nav breakpoint (max-width:1220px / min-width:1221px)
function toggleMobileMenu(){
  var panel = document.getElementById('navPanel');
  if(!panel) return;
  if(panel.classList.contains('open')){ closeMobileMenu(); }
  else{ openMobileMenu(); }
}
function openMobileMenu(){
  var panel = document.getElementById('navPanel');
  var btn = document.getElementById('menuToggle');
  var backdrop = document.getElementById('navBackdrop');
  if(!panel || !btn) return;
  panel.classList.add('open');
  btn.classList.add('active');
  btn.setAttribute('aria-expanded', 'true');
  if(backdrop) backdrop.classList.add('open');
  document.body.classList.add('nav-open');
}
function closeMobileMenu(){
  var panel = document.getElementById('navPanel');
  var btn = document.getElementById('menuToggle');
  var backdrop = document.getElementById('navBackdrop');
  if(!panel || !btn) return;
  panel.classList.remove('open');
  btn.classList.remove('active');
  btn.setAttribute('aria-expanded', 'false');
  if(backdrop) backdrop.classList.remove('open');
  document.body.classList.remove('nav-open');
}
document.querySelectorAll('.nav-links a').forEach(function(a){
  a.addEventListener('click', closeMobileMenu);
});
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape') closeMobileMenu();
});
window.addEventListener('resize', function(){
  if(window.innerWidth > MOBILE_NAV_BREAKPOINT) closeMobileMenu();
});

/* ---------- FAQ (only one open at a time, optional nicety) ---------- */
document.querySelectorAll('.faq-list').forEach(function(list){
  list.addEventListener('toggle', function(e){
    if(e.target.tagName !== 'DETAILS' || !e.target.open) return;
    list.querySelectorAll('details[open]').forEach(function(d){
      if(d !== e.target) d.removeAttribute('open');
    });
  }, true);
});

/* ---------- CONTACT FORM: Formspree via fetch (JSON), reusing #formSuccess.
   Native HTML5 validation runs first (no novalidate). AJAX keeps the visitor
   on the page and works on any host path (GitHub Pages subpath included),
   and Formspree's redirect feature is paid-tier only. ---------- */
(function(){
  var form = document.getElementById('contactForm');
  if(!form) return;
  var errorEl = document.getElementById('formError');
  var submitBtn = document.getElementById('formSubmit');
  var wrap = document.getElementById('contactFormWrap');
  var success = document.getElementById('formSuccess');

  if(FORMSPREE_ENDPOINT){ form.setAttribute('action', FORMSPREE_ENDPOINT); }

  form.addEventListener('submit', function(e){
    var consent = form.querySelector('#formConsent');
    if(consent && !consent.checked){
      e.preventDefault();
      consent.focus();
      return;
    }
    if(!form.checkValidity()){ return; }
    e.preventDefault();
    if(errorEl){ errorEl.hidden = true; }
    if(!FORMSPREE_ENDPOINT){
      if(errorEl){ errorEl.textContent = 'Das Formular ist noch nicht aktiv. Bitte schreiben Sie uns direkt eine E-Mail.'; errorEl.hidden = false; }
      return;
    }
    if(submitBtn){ submitBtn.disabled = true; }

    fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' }
    }).then(function(res){
      if(!res.ok){ throw new Error('HTTP ' + res.status); }
      return res.json().catch(function(){ return {}; });
    }).then(function(){
      if(wrap){ wrap.style.display = 'none'; }
      if(success){
        success.style.display = 'block';
        var h = success.querySelector('h2');
        if(h){ h.focus(); }
      }
      try{ history.replaceState(null, '', location.pathname + '?submitted=true'); }catch(err){}
    }).catch(function(){
      if(errorEl){ errorEl.textContent = 'Senden fehlgeschlagen. Bitte versuchen Sie es gleich noch einmal oder schreiben Sie uns direkt per E-Mail.'; errorEl.hidden = false; }
      if(submitBtn){ submitBtn.disabled = false; }
    });
  });
})();

/* ---------- PLANER-ÜBERGABE: kontakt.html only. Liest eine Zusammenfassung,
   die planer.js beim Klick auf "Im Erstgespräch besprechen" in sessionStorage
   abgelegt hat, füllt Nachricht/Raumgröße/Budget vor und räumt danach auf, damit
   ein späterer normaler Besuch der Seite nicht erneut vorbefüllt wird. No-op
   auf jeder anderen Seite und wenn niemand vom Planer kam. ---------- */
(function(){
  var message = document.getElementById('message');
  if(!message) return;
  var summary;
  try{ summary = sessionStorage.getItem('vitaroPlanSummary'); }catch(e){ return; }
  if(!summary) return;

  message.value = summary;
  try{
    var roomSize = sessionStorage.getItem('vitaroPlanRoomSize');
    var roomInput = document.getElementById('roomSize');
    if(roomSize && roomInput){ roomInput.value = roomSize; }
    var budget = sessionStorage.getItem('vitaroPlanBudget');
    var budgetSelect = document.getElementById('budget');
    if(budget && budgetSelect){ budgetSelect.value = budget; }
  }catch(e){}
  try{
    sessionStorage.removeItem('vitaroPlanSummary');
    sessionStorage.removeItem('vitaroPlanRoomSize');
    sessionStorage.removeItem('vitaroPlanBudget');
  }catch(e){}
})();
