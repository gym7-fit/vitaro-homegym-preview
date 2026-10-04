/* ---------- VITARO PREISMODELL ----------
   Ergänzt equipment-data.js um das, was der reine Gerätepreis nicht abdeckt:
   unsere eigene Leistung (Planung, Koordination, Einrichtung) plus die
   gesetzliche MwSt. Ohne das wäre der Kostenrechner nur ein Preisvergleich
   für Fremdware, kein Planangebot von VITARO.

   Die drei Stufen spiegeln die Pakete aus pakete.html (Essential/Signature/
   Maßgeschneidert) — Namen und Beschreibungen bewusst identisch, damit
   Kostenrechner und Pakete-Seite dieselbe Sprache sprechen.

   feePercent/feeMin sind Richtwerte für die automatische Schätzung im
   Kostenrechner, keine Vertragsbedingungen — das steht (wie überall auf
   der Seite) so auch im Planangebot: verbindlich wird es erst nach dem
   Vor-Ort-Termin. */

var VITARO_VAT_RATE = 0.19; // gesetzliche MwSt Deutschland

var VITARO_PACKAGES = [
  {
    id: "essential",
    name: "Essential",
    tagline: "Kuratierte Ausstattung, keine baulichen Eingriffe",
    feePercent: 0.12,
    feeMin: 490,
    // Ab dieser Gerätesumme (netto) wird dieses Paket automatisch vorgeschlagen.
    suggestFrom: 0,
    includes: [
      "Auswahl &amp; Beschaffung der Geräte",
      "Lieferkoordination zum Wunschtermin",
      "Aufbau &amp; Einrichtung vor Ort",
      "Kurze Einweisung in die Geräte"
    ]
  },
  {
    id: "signature",
    name: "Signature",
    tagline: "Individuelles Konzept, hochwertige Ausstattung, abgestimmter Boden",
    feePercent: 0.18,
    feeMin: 990,
    suggestFrom: 6000,
    includes: [
      "Alles aus Essential",
      "Individuelles Raumkonzept &amp; Beratung zur Geräteauswahl",
      "Koordination von Bodenbelag &amp; kleineren Anpassungen",
      "Direkte Gründer-Betreuung während des gesamten Projekts"
    ]
  },
  {
    id: "custom",
    name: "Maßgeschneidert",
    tagline: "Kompletter Umbau — Elektrik, Boden, Klimatisierung, Sonderwünsche",
    feePercent: null, // zu individuell für eine automatische Schätzung
    feeMin: null,
    suggestFrom: 15000,
    includes: [
      "Alles aus Signature",
      "Koordination von Elektrik, Bodenaufbau &amp; Klimatisierung",
      "Vollständige Umbauplanung nach Ihren Vorstellungen",
      "Preis ausschließlich im persönlichen Erstgespräch"
    ]
  }
];

function vitaroSuggestPackage(equipmentNet){
  var pick = VITARO_PACKAGES[0];
  for(var i = 0; i < VITARO_PACKAGES.length; i++){
    if(equipmentNet >= VITARO_PACKAGES[i].suggestFrom) pick = VITARO_PACKAGES[i];
  }
  return pick.id;
}

function vitaroServiceFee(pkgId, equipmentNet){
  var pkg = VITARO_PACKAGES.filter(function(p){ return p.id === pkgId; })[0];
  if(!pkg || pkg.feePercent === null) return null; // "im Erstgespräch"
  return Math.max(pkg.feeMin, Math.round(equipmentNet * pkg.feePercent));
}
