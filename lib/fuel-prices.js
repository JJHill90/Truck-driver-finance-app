/**
 * Diesel price bands and retailer discounts for Fuel Hub.
 *
 * Tables follow the shape of public Australian government / regulator charts:
 * ACCC petrol monitoring (capital-city averages and regional differentials),
 * WA FuelWatch, NSW FuelCheck, QLD fuel prices, NT MyFuel. Figures here are
 * structured reference bands (cents per litre, diesel) so the planner can
 * prefer metro fills before remote / out-west step-ups. Drivers overlay live
 * bowser prices and fuel-card cents-off. Connect a state feed later via env
 * without changing the formula.
 */

const DIESEL_KG_PER_L = 0.84;

const RETAILERS = [
  {
    id: "bp",
    name: "BP",
    truckBrand: "BP Truckstop / BP Plus",
    typicalCardCpl: 6,
    notes: "Major truckstop network; BP Plus / fleet cards common on linehaul.",
  },
  {
    id: "shell",
    name: "Shell",
    truckBrand: "Shell Coles Express / Shell Card",
    typicalCardCpl: 5,
    notes: "Wide metro/regional coverage; truck access varies by site.",
  },
  {
    id: "ampol",
    name: "Ampol",
    truckBrand: "Ampol Foodary / AmpolCard",
    typicalCardCpl: 6,
    notes: "Strong highway coverage; many sites take heavy vehicles.",
  },
  {
    id: "mobil",
    name: "Mobil",
    truckBrand: "Mobil / ExxonMobil fleet card",
    typicalCardCpl: 4,
    notes: "Industry spelling is Mobil (not Mobile). Fleet cards at many servos.",
  },
  {
    id: "liberty",
    name: "Liberty",
    truckBrand: "Liberty Card",
    typicalCardCpl: 4,
    notes: "Independent network with a number of truck-friendly highway sites.",
  },
  {
    id: "seven_eleven",
    name: "7-Eleven",
    truckBrand: "7-Eleven fuel / fuel lock",
    typicalCardCpl: 3,
    notes: "Dense metro; confirm truck clearance and turning circles before diverting.",
  },
  {
    id: "pearl",
    name: "Pearl",
    truckBrand: "Pearl Energy",
    typicalCardCpl: 3,
    notes: "Independent brand on selected corridors; check diesel and truck access.",
  },
];

/**
 * Indicative diesel cpl by capital — ACCC-style city average table.
 * Used as the metro floor before regional/remote loadings.
 */
const CAPITAL_DIESEL_CPL = {
  sydney: 184.5,
  melbourne: 183.0,
  brisbane: 185.5,
  adelaide: 186.0,
  perth: 188.5,
  hobart: 191.0,
  darwin: 204.0,
  canberra: 187.0,
};

/**
 * Public-chart style loadings on top of the nearest capital (cpl).
 * Remote and outback_west encode the “further west / outback is dearer” rule.
 */
const REGION_LOADING_CPL = {
  metro: 0,
  regional: 12,
  remote: 28,
  outback_west: 46,
};

const PRICE_SOURCES = [
  {
    id: "accc",
    name: "ACCC petrol monitoring / petroleum market reports",
    url: "https://www.accc.gov.au/by-industry/petrol-and-fuel",
    use: "Capital-city average structure and regional differential discussion.",
  },
  {
    id: "fuelwatch",
    name: "WA FuelWatch",
    url: "https://www.fuelwatch.wa.gov.au/",
    use: "Tomorrow’s prices and regional WA diesel — public tables.",
  },
  {
    id: "fuelcheck_nsw",
    name: "NSW FuelCheck",
    url: "https://www.fuelcheck.nsw.gov.au/",
    use: "Live NSW service-station prices (API key for a live overlay).",
  },
  {
    id: "qld_fuel",
    name: "Queensland fuel prices",
    url: "https://www.qld.gov.au/transport/projects/fuel-prices",
    use: "QLD published fuel-price scheme.",
  },
  {
    id: "myfuel_nt",
    name: "MyFuel NT",
    url: "https://myfuelnt.nt.gov.au/",
    use: "Northern Territory published prices — typically a remote premium.",
  },
];

function listRetailers() {
  return RETAILERS.map((r) => ({ ...r }));
}

function getRetailer(id) {
  const key = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "7eleven" || key === "7_eleven" || key === "seveneleven") {
    return RETAILERS.find((r) => r.id === "seven_eleven");
  }
  if (key === "mobile") return RETAILERS.find((r) => r.id === "mobil");
  return RETAILERS.find((r) => r.id === key) || null;
}

function capitalCpl(city) {
  const key = String(city || "")
    .trim()
    .toLowerCase();
  return CAPITAL_DIESEL_CPL[key] || CAPITAL_DIESEL_CPL.sydney;
}

function loadingForBand(band) {
  return REGION_LOADING_CPL[band] != null ? REGION_LOADING_CPL[band] : REGION_LOADING_CPL.regional;
}

function tableDieselCpl({ band = "regional", capital = "sydney", retailerBiasCpl = 0 } = {}) {
  const n = capitalCpl(capital) + loadingForBand(band) + Number(retailerBiasCpl || 0);
  return Math.round(n * 10) / 10;
}

function governmentTables() {
  const cities = Object.entries(CAPITAL_DIESEL_CPL).map(([city, dieselCpl]) => ({
    city,
    dieselCpl,
    band: "metro",
  }));
  const loadings = Object.entries(REGION_LOADING_CPL).map(([band, cpl]) => ({
    band,
    loadingCpl: cpl,
    exampleSydneyCpl: Math.round((CAPITAL_DIESEL_CPL.sydney + cpl) * 10) / 10,
  }));
  return {
    product: "diesel",
    unit: "cpl",
    asOfNote:
      "Reference bands shaped like ACCC / FuelWatch / FuelCheck public charts. Overlay bowser or state-feed prices when you have them — remote and out-west loadings are the planning signal.",
    cities,
    loadings,
    sources: PRICE_SOURCES.map((s) => ({ ...s })),
  };
}

function roundCpl(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Best cents-off (or %) from cards that match this retailer.
 * Company / industry agreements stack as extra cpl after the card.
 */
function bestDiscountForRetailer(retailerId, cards = []) {
  const retailer = getRetailer(retailerId);
  let bestCpl = 0;
  let bestPercent = 0;
  let cardName = "";
  for (const card of cards || []) {
    const brand = String(card.retailerId || card.brand || "")
      .trim()
      .toLowerCase();
    const cardRetailer = getRetailer(brand);
    const matches =
      !brand ||
      brand === "any" ||
      brand === "all" ||
      (cardRetailer && cardRetailer.id === (retailer && retailer.id));
    if (!matches) continue;
    const cpl = Number(card.cplOff) || 0;
    const pct = Number(card.percentOff) || 0;
    if (cpl > bestCpl) {
      bestCpl = cpl;
      cardName = card.name || cardName;
    }
    if (pct > bestPercent) {
      bestPercent = pct;
      cardName = card.name || cardName;
    }
  }
  const companyCpl = (cards || []).reduce((sum, card) => {
    if (!card || !card.companyWide) return sum;
    return sum + (Number(card.companyCplOff) || 0);
  }, 0);
  if (!bestCpl && retailer) bestCpl = 0;
  return {
    retailerId: retailer ? retailer.id : retailerId,
    cardCplOff: bestCpl,
    percentOff: bestPercent,
    companyCplOff: companyCpl,
    cardName,
  };
}

function effectiveCpl(pumpCpl, discount) {
  const pump = Number(pumpCpl);
  if (!Number.isFinite(pump)) return null;
  const pct = Math.max(0, Math.min(40, Number(discount && discount.percentOff) || 0));
  const afterPct = pump * (1 - pct / 100);
  const off =
    (Number(discount && discount.cardCplOff) || 0) + (Number(discount && discount.companyCplOff) || 0);
  return Math.max(0, roundCpl(afterPct - off));
}

function dieselKg(litres) {
  return Math.round(Number(litres || 0) * DIESEL_KG_PER_L * 10) / 10;
}

module.exports = {
  DIESEL_KG_PER_L,
  RETAILERS,
  CAPITAL_DIESEL_CPL,
  REGION_LOADING_CPL,
  PRICE_SOURCES,
  listRetailers,
  getRetailer,
  capitalCpl,
  loadingForBand,
  tableDieselCpl,
  governmentTables,
  bestDiscountForRetailer,
  effectiveCpl,
  dieselKg,
  roundCpl,
};
