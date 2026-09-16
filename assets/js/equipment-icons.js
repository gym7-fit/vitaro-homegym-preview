(function(){
/* ---------- VITARO GERÄTE-ICONS (top-down floor-plan symbols) ----------
   Shared between planer.js (draws them scaled into the room canvas) and
   angebot.js (draws them into the printed PDF-Planangebot) - one drawing
   per category, one place to fix or extend it. 
   Each function draws into a viewBox that already matches the category's
   real footprint aspect ratio (width fixed at 100, height = 100 * d/w) and
   is placed with preserveAspectRatio="xMidYMid meet" - so a 140x65 bench
   is drawn as an actually-wide shape, never a square icon squashed to fit.
   A 90° turn in the UI never touches this markup: it rotates the whole
   already-correct picture as one rigid piece (see renderItems). Shapes are
   solid fills with a couple of sharp interior lines - like a floor-plan
   furniture symbol - so they read at a glance instead of as a tinted box. */
var VITARO_ICONS = {
  rack: function(w, h){
    var p = Math.min(w, h) * 0.14; // corner-post size
    return '<rect x="' + p * 0.4 + '" y="' + p * 0.4 + '" width="' + (w - p * 0.8) + '" height="' + (h - p * 0.8) + '" fill="none" stroke="currentColor" stroke-width="' + (p * 0.3) + '"/>' +
      '<rect x="0" y="0" width="' + p + '" height="' + p + '" fill="currentColor"/>' +
      '<rect x="' + (w - p) + '" y="0" width="' + p + '" height="' + p + '" fill="currentColor"/>' +
      '<rect x="0" y="' + (h - p) + '" width="' + p + '" height="' + p + '" fill="currentColor"/>' +
      '<rect x="' + (w - p) + '" y="' + (h - p) + '" width="' + p + '" height="' + p + '" fill="currentColor"/>' +
      '<line x1="0" y1="' + (h * 0.5) + '" x2="' + (p * 0.5) + '" y2="' + (h * 0.5) + '" stroke="currentColor" stroke-width="' + (p * 0.5) + '"/>' +
      '<line x1="' + (w - p * 0.5) + '" y1="' + (h * 0.5) + '" x2="' + w + '" y2="' + (h * 0.5) + '" stroke="currentColor" stroke-width="' + (p * 0.5) + '"/>' +
      '<line x1="' + (p * 0.5) + '" y1="' + (h * 0.5) + '" x2="' + (w - p * 0.5) + '" y2="' + (h * 0.5) + '" stroke="currentColor" stroke-width="' + (p * 0.22) + '" opacity=".8"/>';
  },
  bench: function(w, h){
    // Always wider than tall: back pad on the left, seat on the right,
    // three visible segment seams, thin leg-frame lines top and bottom.
    var padH = h * 0.62, padY = (h - padH) / 2, legY1 = h * 0.14, legY2 = h * 0.86;
    var seg = w * 0.22;
    return '<rect x="' + (w * 0.06) + '" y="' + padY + '" width="' + (w * 0.88) + '" height="' + padH + '" rx="' + (padH * 0.18) + '" fill="currentColor"/>' +
      '<line x1="' + (w * 0.06 + seg) + '" y1="' + padY + '" x2="' + (w * 0.06 + seg) + '" y2="' + (padY + padH) + '" stroke="var(--planner-seam,rgba(0,0,0,.35))" stroke-width="' + (h * 0.03) + '" opacity=".4"/>' +
      '<line x1="' + (w * 0.06 + seg * 2.6) + '" y1="' + padY + '" x2="' + (w * 0.06 + seg * 2.6) + '" y2="' + (padY + padH) + '" stroke="var(--planner-seam,rgba(0,0,0,.35))" stroke-width="' + (h * 0.03) + '" opacity=".4"/>' +
      '<line x1="' + (w * 0.1) + '" y1="' + legY1 + '" x2="' + (w * 0.9) + '" y2="' + legY1 + '" stroke="currentColor" stroke-width="' + (h * 0.045) + '" opacity=".55"/>' +
      '<line x1="' + (w * 0.1) + '" y1="' + legY2 + '" x2="' + (w * 0.9) + '" y2="' + legY2 + '" stroke="currentColor" stroke-width="' + (h * 0.045) + '" opacity=".55"/>';
  },
  cable: function(w, h, tier){
    if(tier === "premium"){
      // Wall-mounted slim beam: a bold bar along the top edge (the wall side),
      // two roller cut-outs, thick solid cable lines fanning down into the room
      // so the "mounted to the wall, cables reach out" idea survives at icon size.
      var beamH = h * 0.36;
      return '<rect x="0" y="0" width="' + w + '" height="' + beamH + '" fill="currentColor"/>' +
        '<circle cx="' + (w * 0.27) + '" cy="' + (beamH * 0.5) + '" r="' + (beamH * 0.26) + '" fill="var(--card,#fff)"/>' +
        '<circle cx="' + (w * 0.73) + '" cy="' + (beamH * 0.5) + '" r="' + (beamH * 0.26) + '" fill="var(--card,#fff)"/>' +
        '<path d="M' + (w * 0.27) + ' ' + beamH + ' L' + (w * 0.06) + ' ' + h + '" fill="none" stroke="currentColor" stroke-width="' + (h * 0.08) + '" stroke-linecap="round"/>' +
        '<path d="M' + (w * 0.73) + ' ' + beamH + ' L' + (w * 0.94) + ' ' + h + '" fill="none" stroke="currentColor" stroke-width="' + (h * 0.08) + '" stroke-linecap="round"/>';
    }
    // Freestanding dual tower: two bold towers left/right (with a visible pulley
    // hole each), a clearly outlined bench between them - three separate, legible
    // blocks rather than thin strokes that blur together at small sizes.
    var tw = w * 0.2;
    return '<rect x="0" y="0" width="' + tw + '" height="' + h + '" fill="currentColor"/>' +
      '<rect x="' + (w - tw) + '" y="0" width="' + tw + '" height="' + h + '" fill="currentColor"/>' +
      '<circle cx="' + (tw * 0.5) + '" cy="' + (h * 0.32) + '" r="' + (tw * 0.28) + '" fill="var(--card,#fff)"/>' +
      '<circle cx="' + (w - tw * 0.5) + '" cy="' + (h * 0.32) + '" r="' + (tw * 0.28) + '" fill="var(--card,#fff)"/>' +
      '<rect x="' + (tw * 1.15) + '" y="' + (h * 0.62) + '" width="' + (w - tw * 2.3) + '" height="' + (h * 0.3) + '" rx="' + (h * 0.06) + '" fill="none" stroke="currentColor" stroke-width="' + (h * 0.07) + '"/>';
  },
  chestpress: function(w, h){
    // Assumes the real footprint (always taller than wide, both tiers): backrest
    // + seat toward the front edge, a hatched weight-stack block at the far end,
    // one connecting rail - stacked top-to-bottom, not squeezed into a narrow width.
    var seatR = w * 0.3;
    return '<rect x="' + (w * 0.14) + '" y="0" width="' + (w * 0.72) + '" height="' + (h * 0.2) + '" rx="' + (w * 0.05) + '" fill="currentColor"/>' +
      '<circle cx="' + (w * 0.5) + '" cy="' + (h * 0.34) + '" r="' + seatR + '" fill="currentColor"/>' +
      '<rect x="' + (w * 0.44) + '" y="' + (h * 0.42) + '" width="' + (w * 0.12) + '" height="' + (h * 0.28) + '" fill="currentColor" opacity=".65"/>' +
      '<rect x="' + (w * 0.2) + '" y="' + (h * 0.68) + '" width="' + (w * 0.6) + '" height="' + (h * 0.3) + '" rx="' + (w * 0.05) + '" fill="currentColor"/>' +
      '<line x1="' + (w * 0.28) + '" y1="' + (h * 0.76) + '" x2="' + (w * 0.72) + '" y2="' + (h * 0.76) + '" stroke="var(--card,#fff)" stroke-width="' + (w * 0.04) + '" opacity=".8"/>' +
      '<line x1="' + (w * 0.28) + '" y1="' + (h * 0.85) + '" x2="' + (w * 0.72) + '" y2="' + (h * 0.85) + '" stroke="var(--card,#fff)" stroke-width="' + (w * 0.04) + '" opacity=".8"/>' +
      '<line x1="' + (w * 0.28) + '" y1="' + (h * 0.94) + '" x2="' + (w * 0.72) + '" y2="' + (h * 0.94) + '" stroke="var(--card,#fff)" stroke-width="' + (w * 0.04) + '" opacity=".8"/>';
  },
  legpress: function(w, h){
    // Orient along whichever axis is actually longer, so a vertical (budget) and a
    // horizontal (premium) leg press each read correctly instead of forcing one layout.
    var seatR = Math.min(w, h) * 0.17;
    if(w >= h){
      return '<circle cx="' + (w * 0.14) + '" cy="' + (h * 0.5) + '" r="' + seatR + '" fill="currentColor"/>' +
        '<path d="M' + (w * 0.24) + ' ' + (h * 0.28) + ' L' + (w * 0.95) + ' ' + (h * 0.12) + ' L' + (w * 0.95) + ' ' + (h * 0.88) + ' L' + (w * 0.24) + ' ' + (h * 0.72) + ' Z" fill="currentColor" opacity=".7"/>' +
        '<rect x="' + (w * 0.85) + '" y="' + (h * 0.15) + '" width="' + (w * 0.08) + '" height="' + (h * 0.7) + '" fill="currentColor"/>';
    }
    return '<circle cx="' + (w * 0.5) + '" cy="' + (h * 0.14) + '" r="' + seatR + '" fill="currentColor"/>' +
      '<path d="M' + (w * 0.28) + ' ' + (h * 0.24) + ' L' + (h > 0 ? w * 0.12 : 0) + ' ' + (h * 0.95) + ' L' + (w * 0.88) + ' ' + (h * 0.95) + ' L' + (w * 0.72) + ' ' + (h * 0.24) + ' Z" fill="currentColor" opacity=".7"/>' +
      '<rect x="' + (w * 0.15) + '" y="' + (h * 0.85) + '" width="' + (w * 0.7) + '" height="' + (h * 0.08) + '" fill="currentColor"/>';
  },
  smith: function(w, h){
    // A rack-like frame at full contrast (not the faded outline this used to be,
    // which read as almost the same shape as the chest press icon) so the two
    // stay visually distinct: thick square frame + the two rail tracks are its
    // defining feature, drawn as a clearly separate double line down the middle.
    var p = Math.min(w, h) * 0.12;
    return '<rect x="' + (p * 0.3) + '" y="' + (p * 0.3) + '" width="' + (w - p * 0.6) + '" height="' + (h - p * 0.6) + '" fill="none" stroke="currentColor" stroke-width="' + (p * 0.45) + '"/>' +
      '<rect x="0" y="0" width="' + p + '" height="' + p + '" fill="currentColor"/>' +
      '<rect x="' + (w - p) + '" y="0" width="' + p + '" height="' + p + '" fill="currentColor"/>' +
      '<rect x="0" y="' + (h - p) + '" width="' + p + '" height="' + p + '" fill="currentColor"/>' +
      '<rect x="' + (w - p) + '" y="' + (h - p) + '" width="' + p + '" height="' + p + '" fill="currentColor"/>' +
      '<rect x="' + (w * 0.41) + '" y="' + (p * 0.5) + '" width="' + (w * 0.07) + '" height="' + (h - p) + '" fill="currentColor"/>' +
      '<rect x="' + (w * 0.52) + '" y="' + (p * 0.5) + '" width="' + (w * 0.07) + '" height="' + (h - p) + '" fill="currentColor"/>' +
      '<rect x="' + (w * 0.34) + '" y="' + (h * 0.44) + '" width="' + (w * 0.32) + '" height="' + (h * 0.09) + '" fill="currentColor"/>' +
      '<rect x="' + (w * 0.37) + '" y="' + (h * 0.66) + '" width="' + (w * 0.26) + '" height="' + (h * 0.26) + '" rx="' + (h * 0.05) + '" fill="currentColor"/>';
  },
  treadmill: function(w, h){
    var beltX = w * 0.1, beltW = w * 0.72;
    var lamellas = "", n = 9;
    for(var i = 1; i < n; i++){
      var x = beltX + (beltW * i / n);
      lamellas += '<line x1="' + x + '" y1="' + (h * 0.14) + '" x2="' + x + '" y2="' + (h * 0.86) + '" stroke="var(--card,#fff)" stroke-width="' + (h * 0.05) + '" opacity=".55"/>';
    }
    return '<rect x="' + beltX + '" y="0" width="' + beltW + '" height="' + h + '" rx="' + (h * 0.08) + '" fill="currentColor"/>' +
      lamellas +
      '<line x1="' + beltX + '" y1="0" x2="' + (beltX + beltW) + '" y2="0" stroke="currentColor" stroke-width="' + (h * 0.06) + '" opacity=".6"/>' +
      '<line x1="' + beltX + '" y1="' + h + '" x2="' + (beltX + beltW) + '" y2="' + h + '" stroke="currentColor" stroke-width="' + (h * 0.06) + '" opacity=".6"/>' +
      '<rect x="' + (w * 0.84) + '" y="' + (h * 0.2) + '" width="' + (w * 0.16) + '" height="' + (h * 0.6) + '" rx="' + (h * 0.06) + '" fill="currentColor" opacity=".85"/>';
  },
  bike: function(w, h){
    // Two wheels, a solid frame bar and a raised saddle read as "bicycle from
    // above" at a glance; the front wheel is a ring (open hub), the flywheel a
    // filled disc with a light centre, so the two ends stay tellable apart too.
    var wheelR = h * 0.44;
    return '<circle cx="' + (w * 0.15) + '" cy="' + (h * 0.5) + '" r="' + wheelR + '" fill="none" stroke="currentColor" stroke-width="' + (h * 0.16) + '"/>' +
      '<rect x="' + (w * 0.15) + '" y="' + (h * 0.4) + '" width="' + (w * 0.7) + '" height="' + (h * 0.2) + '" fill="currentColor"/>' +
      '<ellipse cx="' + (w * 0.36) + '" cy="' + (h * 0.5) + '" rx="' + (w * 0.045) + '" ry="' + (h * 0.3) + '" fill="currentColor"/>' +
      '<circle cx="' + (w * 0.85) + '" cy="' + (h * 0.5) + '" r="' + wheelR + '" fill="currentColor"/>' +
      '<circle cx="' + (w * 0.85) + '" cy="' + (h * 0.5) + '" r="' + (wheelR * 0.42) + '" fill="var(--card,#fff)"/>';
  },
  rower: function(w, h){
    var railH = h * 0.22, railY = (h - railH) / 2;
    return '<rect x="' + (w * 0.1) + '" y="' + railY + '" width="' + (w * 0.8) + '" height="' + railH + '" rx="' + (railH * 0.3) + '" fill="currentColor" opacity=".85"/>' +
      '<circle cx="' + (w * 0.09) + '" cy="' + (h * 0.5) + '" r="' + (h * 0.42) + '" fill="none" stroke="currentColor" stroke-width="' + (h * 0.08) + '"/>' +
      '<circle cx="' + (w * 0.09) + '" cy="' + (h * 0.5) + '" r="' + (h * 0.12) + '" fill="currentColor"/>' +
      '<rect x="' + (w * 0.44) + '" y="' + (h * 0.14) + '" width="' + (w * 0.12) + '" height="' + (h * 0.72) + '" rx="' + (h * 0.08) + '" fill="currentColor"/>' +
      '<path d="M' + (w * 0.86) + ' ' + (h * 0.1) + ' L' + (w * 0.97) + ' ' + (h * 0.5) + ' L' + (w * 0.86) + ' ' + (h * 0.9) + '" fill="none" stroke="currentColor" stroke-width="' + (h * 0.12) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  }
};
function vitaroIconSvg(catId, tier, fp){
  var fn = VITARO_ICONS[catId];
  if(!fn) return "";
  var w = 100, h = Math.max(20, Math.round((100 * fp.d / fp.w) * 10) / 10);
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + fn(w, h, tier) + '</svg>';
}

window.VITARO_ICONS = VITARO_ICONS;
window.vitaroIconSvg = vitaroIconSvg;
})();
