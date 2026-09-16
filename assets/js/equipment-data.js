/* ---------- VITARO GERÄTE-DATENSATZ ----------
   Quelle: VITARO Einkaufsdossier (14 Kategorien, je eine Einstiegs- und eine
   Premium-Empfehlung, ausschließlich deutsche Neuware-Händler/Hersteller,
   Stand 8. Sept. 2026). Preise sind Verkaufspreise (VK) beim jeweiligen
   Händler zum Recherchezeitpunkt — keine Pauschalpreise, echte Zahlen
   ändern sich je nach Verfügbarkeit und stehen verbindlich erst im
   schriftlichen Angebot nach dem Vor-Ort-Termin.

   footprint (w × d, in cm) ist ein gerundeter Planungsrichtwert je
   Kategorie, kein zertifiziertes Maßblatt einer einzelnen SKU — für Racks
   und Hantelbänke durch Herstellerangaben gestützt, für die übrigen
   Kategorien eine branchenübliche Größenordnung. Das exakte Maß wird beim
   Vor-Ort-Termin genommen; deshalb überall als "ca." beschriftet. */

var VITARO_EQUIPMENT = [

  {
    id: "rack",
    name: "Power Rack / Kraftstation",
    icon: "rack",
    placement: "floor",
    tiers: {
      budget:  { brand: "Taurus",      model: "Power Rack",                 price: 399,  url: "https://www.fitshop.de/taurus-power-rack-tf-powerrack", blurb: "Deutsche Traditionsmarke aus Rastatt. Nach unserer Nachprüfung mit 4,96★ bei 55 Bewertungen aktuell die beste Einstiegsoption in dieser Kategorie — schlägt sowohl die vorherige Empfehlung als auch die Premium-Konkurrenz bei Preis und Bewertungslage." },
      premium: { brand: "ATX Fitness", model: "Power Rack PRX-780 2.0",     price: 899,  url: "https://www.megafitness.shop/atx-power-rack-780.html", blurb: "Aus deutlich stärkerem Stahl gefertigt, DIN-EN-20957-1-zertifiziert und belastbar bis 1.000 kg. Das Rack, das ein ernsthafter Kraftsportler ein Jahrzehnt behält, nicht das, das er ersetzt." }
    },
    footprint: { budget: { w: 120, d: 120 }, premium: { w: 130, d: 170 } },
    clearance: { top: 75, bottom: 60, left: 60, right: 60, access: "top", sourceLabel: "Unterer Bereich der Faustregel-Spanne (60–90 cm) aus Fitness-Planungsratgebern, für Privatgebrauch angesetzt — keine DIN-/DGUV-Vorschrift." }
  },
  {
    id: "bench",
    name: "Verstellbare Hantelbank",
    icon: "bench",
    placement: "floor",
    tiers: {
      budget:  { brand: "Gorilla Sports", model: "Verstellbare Hantelbank",     price: 129.99, url: "https://www.gorillasports.de/products/verstellbare-hantelbank", blurb: "Robuste Mehrpositionsbank für Flach-, Schräg- und Negativtraining — solide Standardausführung für den Hausgebrauch." },
      premium: { brand: "ATX Fitness",    model: "Verstellbare Hantelbank MBX-520", price: 359, url: "https://www.megafitness.shop/atx-multi-bench-mbx-520-modell-2023.html", blurb: "Massiver Rahmen mit modularem Anbau-System (u. a. Beinbeuger, Bizepscurl); 32 verifizierte Vor-Ort-Bewertungen bestätigen die Verarbeitungsqualität." }
    },
    footprint: { budget: { w: 140, d: 65 }, premium: { w: 140, d: 65 } },
    clearance: { top: 45, bottom: 45, left: 60, right: 60, access: "right", sourceLabel: "Faustregel aus Fitness-Planungsratgebern (mind. 60 cm), für Privatgebrauch angesetzt — der teils genannte Wert von 150–180 cm bezog sich aufs Verschieben der Bank selbst, nicht auf reinen Trainingsbetrieb. Keine DIN-/DGUV-Vorschrift." }
  },
  {
    id: "cable",
    name: "Kabelturm / Cable Crossover",
    icon: "cable",
    placement: "floor",
    tiers: {
      budget:  { brand: "Gorilla Sports", model: "Kraftstation SmartGym H8",     price: 1199.99, url: "https://www.gorillasports.de/products/kabelzugstation-smartgym-h8", blurb: "Echter freistehender Doppelturm-Funktionstrainer mit doppeltem Gewichtsblock, kein einzelner Kabelzug-Aufsatz. Nach Prüfung bestätigt: 4,80★ bei 30 Bewertungen vor Ort." },
      premium: { brand: "NOHRD",          model: "SlimBeam Kabelzugstation",     price: 1899, priceNote: "ab", url: "https://www.fitshop.de/nohrd-kabelzugstation-slimbeam-no-15.112", blurb: "Wandmontierte Kabelzugstation aus deutscher Fertigung (Enger, NRW) mit echter Holzverkleidung — gebaut für den Wohnraum, nicht den Keller, deshalb der deutlich kleinere Platzbedarf." }
    },
    footprint: { budget: { w: 150, d: 120 }, premium: { w: 40, d: 25 } },
    note: "Premium ist wandmontiert (NOHRD SlimBeam, 40 cm breit, laut Hersteller 10 cm Wandabstand + 20 cm Auszug) — deshalb der deutlich kleinere Platzbedarf gegenüber dem freistehenden Einstiegsmodell.",
    clearance: { top: 60, bottom: 90, left: 60, right: 60, access: "bottom", sourceLabel: "Untere Faustregel-Spanne (60–91 cm) aus Fitness-Ratgebern für Privatgebrauch. Ein Hersteller-Handbuch (TRUE Fitness, kommerzieller Doppelturm) nennt bis zu 254 cm — für ein einzelnes Heimgerät nicht übertragbar." }
  },
  {
    id: "chestpress",
    name: "Brustpresse",
    icon: "chestpress",
    placement: "floor",
    tiers: {
      budget:  { brand: "Taurus",                          model: "Brustpresse IFP",                price: 799,  url: "https://www.fitshop.de/taurus-brustpresse-ifp-seated-chest-press-tf-ifp1201", blurb: "In Deutschland entwickelte Studio-Line-Maschine für den leichten gewerblichen Einsatz — isolaterale Arme, 100 kg pro Seite mit Standardscheiben." },
      premium: { brand: "Hammer Strength by Life Fitness",  model: "Select Chest Press",              price: 6932, url: "https://www.fitshop.de/hammer-strength-by-life-fitness-kraftstation-select-chest-press-lf-hs-cp", blurb: "Waschechte Gewerbe-Kraftstation von Life Fitness/Hammer Strength — die Referenzklasse, wie sie in echten Fitnessstudios steht." }
    },
    footprint: { budget: { w: 128, d: 98 }, premium: { w: 145, d: 110 } },
    note: "Keine echte Einstiegsmarke bietet eine eigenständige Brustpresse — Taurus' leicht-gewerbliche Studio-Line springt hier als günstigste dedizierte Maschine ein. Platzbedarf nach Herstellermaß korrigiert (breiter als tief: Taurus IFP1201 B128×L98, Hammer Strength Select L105×B145).",
    clearance: { top: 50, bottom: 50, left: 50, right: 50, access: "bottom", sourceLabel: "Faustregel aus Fitness-Planungsratgebern (50–60 cm rundum) — keine gerichtete Angabe gefunden, keine DIN-/DGUV-Vorschrift." }
  },
  {
    id: "legpress",
    name: "Beinpresse",
    icon: "legpress",
    placement: "floor",
    tiers: {
      budget:  { brand: "Taurus",                         model: "Vertikale Beinpresse IFP",   price: 1299,  url: "https://www.fitshop.de/taurus-vertikale-beinpresse-ifp-iso-vertical-leg-press-tf-ifp1613", blurb: "Platzsparende vertikale Bauweise aus derselben leicht-gewerblichen Taurus-Studio-Line wie die Brustpresse oben." },
      premium: { brand: "Hammer Strength by Life Fitness", model: "SE Seated Leg Press",         price: 10591, url: "https://www.fitshop.de/hammer-strength-by-life-fitness-kraftstation-se-seated-leg-press-lf-hs-slp", blurb: "Klassische liegende Gewerbe-Beinpresse — deutlich größerer Platzbedarf, dafür Referenzqualität für ernsthaftes Beintraining." }
    },
    footprint: { budget: { w: 110, d: 160 }, premium: { w: 220, d: 190 } },
    note: "Budget = vertikale Bauweise (platzsparender Schlitten). Premium = klassische liegende Gewerbe-Beinpresse, dafür deutlich größerer Platzbedarf.",
    clearance: { top: 75, bottom: 60, left: 60, right: 60, access: "top", sourceLabel: "Unterer Bereich der Faustregel-Spanne (Schlittenrichtung, Plattenbeladung seitlich 60–90 cm), für Privatgebrauch angesetzt — keine DIN-/DGUV-Vorschrift." }
  },
  {
    id: "smith",
    name: "Multipresse / Smith Machine",
    icon: "smith",
    placement: "floor",
    tiers: {
      budget:  { brand: "Gorilla Sports", model: "Smith Machine (Klimmzug, Dip, Kabelzug)", price: 1699.99, url: "https://www.gorillasports.de/products/multifunction-smith-machine", blurb: "Kombigerät mit Smith-Funktion, Klimmzugstange, Dipgriffen und Kabelzug in einem Rahmen — viel Funktion auf wenig Grundfläche." },
      premium: { brand: "ATX Fitness",    model: "Power Smith Rack PSR-780",                price: 2990,    url: "https://www.megafitness.shop/atx-power-smith-rack.html", blurb: "Fahrbare Multipresse aus dem ATX-Studioqualität-Katalog, von deutschen Händlern durchgängig als solide Gewerbequalität beschrieben." }
    },
    footprint: { budget: { w: 150, d: 130 }, premium: { w: 140, d: 140 } },
    clearance: { top: 75, bottom: 75, left: 50, right: 50, access: "top", sourceLabel: "Unterer Bereich der Faustregel-Spanne (Gesamttiefe inkl. Bewegung, seitlich 50–75 cm), für Privatgebrauch angesetzt — keine DIN-/DGUV-Vorschrift." }
  },
  {
    id: "treadmill",
    name: "Laufband",
    icon: "treadmill",
    placement: "floor",
    tiers: {
      budget:  { brand: "cardiostrong", model: "Laufband TX50",      price: 1799, url: "https://www.fitshop.de/cardiostrong-laufband-tx50-cst-tx50-4", blurb: "Solides Einstiegs-Laufband für den regelmäßigen Hausgebrauch." },
      premium: { brand: "NOHRD",        model: "Sprintbok V.2",       price: 6699, priceNote: "ab", url: "https://www.fitshop.de/nohrd-laufband-sprintbok-v.2-no-23121", blurb: "Motorloses, gebogenes Lauf-Curve — trainiert natürlicher als ein Motor-Laufband und ist dabei etwas kompakter." }
    },
    footprint: { budget: { w: 190, d: 90 }, premium: { w: 170, d: 80 } },
    note: "Premium (Sprintbok) ist ein motorloses, gebogenes Lauf-Curve — etwas kompakter als ein klassisches Motor-Laufband.",
    clearance: { left: 100, right: 60, top: 40, bottom: 40, access: "left", sourceLabel: "Rückseite (100 cm): Kettler-Handbuch (echtes Heimlaufband, „mind. 1 m rundum größer als Trainingsfläche“) — die vorher genannten 200 cm stammen aus der US-Norm ASTM F2115 und Herstellerquellen für den kommerziellen/US-Kontext, nicht in DE/EU verbindlich und für ein einzelnes Heimgerät zu großzügig. Rückseite bleibt trotzdem die großzügigste Richtung (Sturzrisiko bei laufendem Band)." }
  },
  {
    id: "bike",
    name: "Indoor-Bike / Ergometer",
    icon: "bike",
    placement: "floor",
    tiers: {
      budget:  { brand: "cardiostrong", model: "IB50 Incline Bike Ergometer", price: 599,  url: "https://www.fitshop.de/cardiostrong-ib50-incline-bike-ergometer-cst-ib50", blurb: "Incline Bike Ergometer für den Hausgebrauch, mit verstellbarer Neigung für mehr Trainingsvarianz." },
      premium: { brand: "Concept2",     model: "BikeErg",                    price: 1410, url: "https://www.concept2.de/ergs/bikeerg", blurb: "Referenzgerät von Concept2 — Luftwiderstand statt Magnetbremse, präzise Wattmessung wie im Wettkampf-Rudersport." }
    },
    footprint: { budget: { w: 120, d: 60 }, premium: { w: 120, d: 55 } },
    clearance: { top: 50, bottom: 50, left: 50, right: 50, access: "left", sourceLabel: "Faustregel aus Fitness-Planungsratgebern (ca. 60 cm rundum), leicht reduziert für Privatgebrauch — keine DIN-/DGUV-Vorschrift." }
  },
  {
    id: "rower",
    name: "Rudergerät",
    icon: "rower",
    placement: "floor",
    tiers: {
      budget:  { brand: "Kettler",  model: "Regatta 200",           price: 699,  url: "https://www.fitshop.de/kettler-rudergeraet-regatta-200-k-ro1041-100", blurb: "Bewährtes Einstiegsrudergerät des deutschen Traditionsherstellers Kettler." },
      premium: { brand: "Concept2", model: "RowErg (Standardbeine)", price: 1195, url: "https://www.concept2.de/ergs/rowerg", blurb: "Der weltweite Referenzstandard fürs Rudertraining — dasselbe Modell, das in Wettkämpfen eingesetzt wird." }
    },
    footprint: { budget: { w: 180, d: 45 }, premium: { w: 245, d: 60 } },
    clearance: { left: 20, right: 50, top: 40, bottom: 40, access: "right", sourceLabel: "Faustregel, geringe Quellenlage (kein Herstellerwert öffentlich gefunden): Schwungrad-/Monitorseite ~20 cm, Sitzschienen-/Beinstreckseite ~50 cm." }
  },

  /* ---- Zubehör: kein eigener Grundriss-Platzbedarf, nur Menge × Preis ---- */
  {
    id: "barbell",
    name: "Olympia-Langhantel",
    icon: null,
    placement: "accessory",
    unit: "Stk",
    defaultQty: 1,
    tiers: {
      budget:  { brand: "PhysKcal",    model: "Langhantelstange 220 cm, IWF-Standard", price: 135.15, url: "https://www.amazon.de/PhysKcal-Gewichtheben-Powerlifting-Langhantelstange-Sto%C3%9Fstangenplatten/dp/B0CTLZNJ9L", blurb: "IWF-Standard-Langhantelstange mit echten Nadellagern (nicht nur Gleitlagern), 15/20 kg. Ersetzt nach unserer Nachprüfung die vorherige Empfehlung — besser bewertet (4,8★/166) und günstiger." },
      premium: { brand: "ATX Fitness", model: "Training Bar 20 kg, Chrome",             price: 209,    url: "https://www.megafitness.shop/atx-training-bar-20-kg-chrome-tx.html", blurb: "Mehrzweck-Wettkampfhantel für Kniebeuge, Bankdrücken und leichtes Olympisches Gewichtheben in einer Stange." }
    }
  },
  {
    id: "plates",
    name: "Hantelscheiben",
    icon: null,
    placement: "accessory",
    unit: "kg",
    defaultQty: 100,
    tiers: {
      budget:  { brand: "Gorilla Sports", model: "Gusseisen, Olympia 50/51 mm", price: 3.00, url: "https://www.gorillasports.de/products/hantelscheibe-olympia-gusseisen-50-51-mm", blurb: "Gusseisen, olympische Bohrung — Marktstandard, Material und Preis nach Nachprüfung bestätigt." },
      premium: { brand: "ATX Fitness",    model: "Gym Bumper Plate, 50 mm",     price: 3.35, url: "https://www.megafitness.shop/atx-gym-bumper-plate-hantelscheiben-5-25-kg.html", blurb: "Vollgummi-Bumper-Konstruktion — sturzsicher, bodenschonend und nahezu geräuschlos im Vergleich zu Gusseisen." }
    }
  },
  {
    id: "dumbbells",
    name: "Kurzhanteln",
    icon: null,
    placement: "accessory",
    unit: "Stk",
    defaultQty: 2,
    tiers: {
      budget:  { brand: "Gorilla Sports", model: "Kurzhantel Gummi, 20 kg",           price: 65.99, url: "https://www.gorillasports.de/products/kurzhantel-gummi-2-5-40-kg", blurb: "Gummierte Kurzhantel für den Hausgebrauch, angenehm griffig und bodenschonend." },
      premium: { brand: "ATX Fitness",    model: "PRO-Style Rubber Dumbbell, 20 kg",  price: 88.00, url: "https://www.megafitness.shop/pro-style-rubber-dumbbells-mit-atx-logo-2-5-60-kg-2-5-kg-steigerung.html", blurb: "Hochwertige gummierte Kurzhantel aus dem ATX-Katalog, feine 2,5-kg-Abstufung." }
    }
  },
  {
    id: "kettlebells",
    name: "Kettlebells",
    icon: null,
    placement: "accessory",
    unit: "Stk",
    defaultQty: 1,
    tiers: {
      budget:  { brand: "Gorilla Sports", model: "Kettlebell Gusseisen, 16 kg",              price: 54.99, url: "https://www.gorillasports.de/products/kettlebell-gusseisen-2-32-kg", blurb: "Gusseisen-Kettlebell in Einstiegsqualität für Schwung- und Ganzkörperübungen." },
      premium: { brand: "ATX Fitness",    model: "Original Russian Kettlebell, 32 kg",        price: 119.00, url: "https://www.megafitness.shop/original-russian-kettlebell-competition-8-48-kg.html", blurb: "Wettkampf-Kettlebell nach russischem Competition-Standard — einheitliche Griffmaße unabhängig vom Gewicht." }
    }
  },

  /* ---- Bodenbelag: keine Box, sondern die Fläche des Raums selbst ---- */
  {
    id: "flooring",
    name: "Gummi-Bodenbelag",
    icon: null,
    placement: "covering",
    unit: "m²",
    tiers: {
      budget:  { brand: "MSPORTS", model: "Bodenschutzmatten Set Premium, 12 mm", price: 12.50, priceNote: "ca.", url: "https://www.amazon.de/MSPORTS-Bodenschutzmatten-Premium-verschiedenen-Gymnastikmatte/dp/B076ZV7MWD", blurb: "Bestätigt echtes NBR-Gummi, mit 1.628 Bewertungen die breiteste Beleglage im gesamten Dossier. Ersetzt nach Nachprüfung die vorherige Empfehlung." },
      premium: { brand: "Gymfloor", model: "Fallschutzplatte 30 mm",              price: 67.60, url: "https://www.megafitness.shop/fallschutzplatte-30mm-staerke-fuer-fitness-und-hantelbereiche-mit-erhoehter-anforderung.html", blurb: "Echtes 30-mm-Verlege-Fliesensystem in Gewerbequalität, wie es in echten deutschen Fitnessstudio-Ausbauten verwendet wird." }
    }
  }
];
