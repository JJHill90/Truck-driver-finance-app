/**
 * NHVR-oriented heavy-vehicle access for Fuel Hub.
 *
 * Apple/Google car routing is not the source of truth for trucks. Combinations,
 * mass schemes and approved freight corridors follow public NHVR concepts:
 * General Mass Limits (GML), Concessional Mass Limits (CML), Higher Mass Limits
 * (HML), Performance Based Standards (PBS), and published B-double / road-train
 * networks. Drivers must still check the NHVR Route Planner / Journey Planner
 * for permits, gazettals and last-mile access.
 */

const COMBINATIONS = [
  {
    id: "rigid",
    label: "Heavy rigid",
    licence: "hr",
    defaultTrailers: 0,
    typicalLengthM: 12.5,
    typicalGcmT: 28,
    typicalTankL: 400,
    baseLPer100: 28,
    networks: ["general"],
    notes: "General access on most gazetted roads within mass/dimension limits.",
  },
  {
    id: "semi",
    label: "Prime mover + semi (single trailer)",
    licence: "hc",
    defaultTrailers: 1,
    typicalLengthM: 19,
    typicalGcmT: 42.5,
    typicalTankL: 800,
    baseLPer100: 36,
    networks: ["general", "b_double"],
    notes: "General access 19 m / 42.5 t GML typical. Confirm bridge and last-mile limits.",
  },
  {
    id: "b_double",
    label: "B-double",
    licence: "hc",
    defaultTrailers: 2,
    typicalLengthM: 26,
    typicalGcmT: 62.5,
    typicalTankL: 1200,
    baseLPer100: 52,
    networks: ["b_double"],
    notes: "Approved B-double routes only — not a car-nav shortcut through towns.",
  },
  {
    id: "b_triple",
    label: "B-triple",
    licence: "mc",
    defaultTrailers: 3,
    typicalLengthM: 36.5,
    typicalGcmT: 82.5,
    typicalTankL: 1400,
    baseLPer100: 62,
    networks: ["b_double", "road_train_t1"],
    notes: "Specified networks (mainly SA/WA/NT/QLD). Not Hume/Pacific as a default.",
  },
  {
    id: "road_train_t1",
    label: "Type 1 road train",
    licence: "mc",
    defaultTrailers: 2,
    typicalLengthM: 36.5,
    typicalGcmT: 79,
    typicalTankL: 1600,
    baseLPer100: 70,
    networks: ["road_train_t1"],
    notes: "Gazetted Type 1 road-train routes (outback / north / west). Avoid eastern seaboard car routes.",
  },
  {
    id: "road_train_t2",
    label: "Type 2 road train",
    licence: "mc",
    defaultTrailers: 3,
    typicalLengthM: 53.5,
    typicalGcmT: 135,
    typicalTankL: 2000,
    baseLPer100: 82,
    networks: ["road_train_t2"],
    notes: "Limited WA/NT/QLD gazetted networks. Car maps will cheerfully send you the wrong way.",
  },
];

const MASS_SCHEMES = [
  {
    id: "gml",
    label: "GML — General Mass Limits",
    massFactor: 1,
    notes: "Default national mass limits under the HVNL.",
  },
  {
    id: "cml",
    label: "CML — Concessional Mass Limits",
    massFactor: 1.05,
    notes: "Accredited operators. Confirm NHVR notice conditions.",
  },
  {
    id: "hml",
    label: "HML — Higher Mass Limits",
    massFactor: 1.1,
    notes: "Approved routes + often Intelligent Access / PBS. Check the map, not Google.",
  },
  {
    id: "pbs",
    label: "PBS — Performance Based Standards",
    massFactor: 1.12,
    notes: "Vehicle-specific PBS approval and network. Access is not implied by length alone.",
  },
];

const NETWORKS = [
  {
    id: "general",
    label: "General access",
    description: "Within general mass and dimension limits on the gazetted road network.",
  },
  {
    id: "b_double",
    label: "B-double network",
    description: "Approved B-double routes (NHVR / state gazettals). Urban shortcuts are often illegal.",
  },
  {
    id: "road_train_t1",
    label: "Type 1 road train",
    description: "Gazetted Type 1 road-train network — typically inland, north and west.",
  },
  {
    id: "road_train_t2",
    label: "Type 2 road train",
    description: "Gazetted Type 2 road-train network — limited corridors, mainly WA/NT/QLD.",
  },
];

/**
 * Freight corridors that trucks actually use. These are industry routes, not
 * the fastest car ETA from a consumer map.
 */
const CORRIDORS = [
  {
    id: "hume",
    name: "Hume Highway (M31 / A31)",
    aliases: ["sydney", "melbourne", "albury", "goulburn", "yass", "gundagai", "wangaratta", "wodonga"],
    distanceKm: 840,
    nhvrNetworks: ["general", "b_double"],
    blockedNetworks: ["road_train_t1", "road_train_t2"],
    westPremium: false,
    heading: "south",
    regions: [
      { fromKm: 0, toKm: 90, band: "metro" },
      { fromKm: 90, toKm: 760, band: "regional" },
      { fromKm: 760, toKm: 840, band: "metro" },
    ],
  },
  {
    id: "pacific",
    name: "Pacific Highway (M1 / A1)",
    aliases: ["sydney", "newcastle", "coffs harbour", "coffs", "grafton", "ballina", "brisbane", "gold coast"],
    distanceKm: 920,
    nhvrNetworks: ["general", "b_double"],
    blockedNetworks: ["road_train_t1", "road_train_t2"],
    westPremium: false,
    heading: "north",
    regions: [
      { fromKm: 0, toKm: 120, band: "metro" },
      { fromKm: 120, toKm: 820, band: "regional" },
      { fromKm: 820, toKm: 920, band: "metro" },
    ],
  },
  {
    id: "newell",
    name: "Newell Highway (A39)",
    aliases: ["melbourne", "shepparton", "dubbo", "parkes", "narrabri", "goondiwindi", "brisbane", "toowoomba"],
    distanceKm: 1060,
    nhvrNetworks: ["general", "b_double"],
    blockedNetworks: ["road_train_t2"],
    westPremium: false,
    heading: "north",
    regions: [
      { fromKm: 0, toKm: 80, band: "metro" },
      { fromKm: 80, toKm: 980, band: "regional" },
      { fromKm: 980, toKm: 1060, band: "metro" },
    ],
  },
  {
    id: "warrego",
    name: "Warrego / Mitchell (A2)",
    aliases: ["brisbane", "toowoomba", "roma", "charleville", "barcaldine", "longreach", "winton", "cloncurry", "mount isa"],
    distanceKm: 1820,
    nhvrNetworks: ["general", "b_double", "road_train_t1"],
    blockedNetworks: [],
    westPremium: true,
    heading: "west",
    regions: [
      { fromKm: 0, toKm: 130, band: "metro" },
      { fromKm: 130, toKm: 480, band: "regional" },
      { fromKm: 480, toKm: 1100, band: "remote" },
      { fromKm: 1100, toKm: 1820, band: "outback_west" },
    ],
  },
  {
    id: "stuart",
    name: "Stuart Highway (A87 / A1)",
    aliases: ["adelaide", "port augusta", "coober pedy", "alice springs", "tennant creek", "katherine", "darwin"],
    distanceKm: 2700,
    nhvrNetworks: ["general", "b_double", "road_train_t1", "road_train_t2"],
    blockedNetworks: [],
    westPremium: true,
    heading: "north",
    regions: [
      { fromKm: 0, toKm: 80, band: "metro" },
      { fromKm: 80, toKm: 320, band: "regional" },
      { fromKm: 320, toKm: 1200, band: "remote" },
      { fromKm: 1200, toKm: 2700, band: "outback_west" },
    ],
  },
  {
    id: "eyre",
    name: "Eyre Highway (A1 / National 1)",
    aliases: ["adelaide", "port augusta", "ceduna", "eucla", "norseman", "kalgoorlie", "perth", "nullarbor"],
    distanceKm: 1670,
    nhvrNetworks: ["general", "b_double", "road_train_t1"],
    blockedNetworks: [],
    westPremium: true,
    heading: "west",
    regions: [
      { fromKm: 0, toKm: 80, band: "metro" },
      { fromKm: 80, toKm: 280, band: "regional" },
      { fromKm: 280, toKm: 1670, band: "outback_west" },
    ],
  },
  {
    id: "great_western",
    name: "Great Western / Barrier (A32)",
    aliases: ["sydney", "lithgow", "bathurst", "orange", "dubbo", "broken hill", "mildura", "adelaide"],
    distanceKm: 1160,
    nhvrNetworks: ["general", "b_double", "road_train_t1"],
    blockedNetworks: ["road_train_t2"],
    westPremium: true,
    heading: "west",
    regions: [
      { fromKm: 0, toKm: 90, band: "metro" },
      { fromKm: 90, toKm: 420, band: "regional" },
      { fromKm: 420, toKm: 1160, band: "remote" },
    ],
  },
  {
    id: "bruce",
    name: "Bruce Highway (M1 / A1 QLD)",
    aliases: ["brisbane", "sunshine coast", "gympie", "bundaberg", "rockhampton", "mackay", "townsville", "cairns"],
    distanceKm: 1700,
    nhvrNetworks: ["general", "b_double"],
    blockedNetworks: ["road_train_t2"],
    westPremium: false,
    heading: "north",
    regions: [
      { fromKm: 0, toKm: 100, band: "metro" },
      { fromKm: 100, toKm: 1600, band: "regional" },
      { fromKm: 1600, toKm: 1700, band: "metro" },
    ],
  },
];

const COMBINATION_IDS = new Set(COMBINATIONS.map((c) => c.id));
const MASS_IDS = new Set(MASS_SCHEMES.map((m) => m.id));

function listCombinations() {
  return COMBINATIONS.map((c) => ({ ...c }));
}

function listMassSchemes() {
  return MASS_SCHEMES.map((m) => ({ ...m }));
}

function listNetworks() {
  return NETWORKS.map((n) => ({ ...n }));
}

function listCorridors() {
  return CORRIDORS.map((c) => ({ ...c, aliases: [...c.aliases], regions: c.regions.map((r) => ({ ...r })) }));
}

function getCombination(id) {
  return COMBINATIONS.find((c) => c.id === id) || COMBINATIONS.find((c) => c.id === "semi");
}

function getMassScheme(id) {
  return MASS_SCHEMES.find((m) => m.id === id) || MASS_SCHEMES[0];
}

function normalizePlace(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function corridorAliasesMatch(corridor, place) {
  const p = normalizePlace(place);
  if (!p) return false;
  return corridor.aliases.some((alias) => p === alias || p.includes(alias) || alias.includes(p));
}

/**
 * Pick the best freight corridor for an origin/destination pair.
 * Offline typed towns beat consumer-map polylines.
 */
function matchCorridor(origin, destination, via = []) {
  const places = [origin, destination, ...via].map((p) =>
    typeof p === "string" ? p : (p && (p.name || p.label)) || ""
  );
  let best = null;
  let bestScore = 0;
  for (const corridor of CORRIDORS) {
    let score = 0;
    for (const place of places) {
      if (corridorAliasesMatch(corridor, place)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = corridor;
    }
  }
  if (best && bestScore >= 2) return { ...best, matched: true, matchScore: bestScore };
  return {
    id: "custom",
    name: "Driver-entered / GPS route",
    aliases: [],
    distanceKm: null,
    nhvrNetworks: ["general"],
    blockedNetworks: [],
    westPremium: /west|outback|nullarbor|isa|alice|kalgoorlie|broken/i.test(places.join(" ")),
    heading: "unknown",
    regions: [{ fromKm: 0, toKm: 99999, band: "regional" }],
    matched: false,
    matchScore: bestScore,
  };
}

function regionBandAtKm(corridor, km) {
  const regions = (corridor && corridor.regions) || [];
  const x = Number(km) || 0;
  for (const region of regions) {
    if (x >= region.fromKm && x <= region.toKm) return region.band;
  }
  return regions.length ? regions[regions.length - 1].band : "regional";
}

function combinationAllowedOnCorridor(combinationId, corridor) {
  const combo = getCombination(combinationId);
  const networks = combo.networks || ["general"];
  const blocked = new Set((corridor && corridor.blockedNetworks) || []);
  const allowed = new Set((corridor && corridor.nhvrNetworks) || ["general"]);
  if (networks.some((n) => blocked.has(n) && !allowed.has(n))) {
    return { ok: false, reason: `${combo.label} is not a default fit for ${corridor.name}.` };
  }
  const overlap = networks.filter((n) => allowed.has(n));
  if (!overlap.length) {
    return {
      ok: false,
      reason: `${combo.label} needs a gazetted ${(combo.networks || []).join(" / ")} network. ${corridor.name} is not one by default — check the NHVR Route Planner, not Apple/Google Maps.`,
    };
  }
  return { ok: true, networks: overlap };
}

function accessWarnings({ combinationId, corridor, lengthM, heightM }) {
  const warnings = [];
  const access = combinationAllowedOnCorridor(combinationId, corridor);
  if (!access.ok) warnings.push(access.reason);
  const combo = getCombination(combinationId);
  if (Number(lengthM) > combo.typicalLengthM + 0.4) {
    warnings.push(
      `Length ${Number(lengthM).toFixed(1)} m is over the typical ${combo.typicalLengthM} m ${combo.label} envelope — confirm gazetted dimension limits.`
    );
  }
  if (Number(heightM) > 4.3) {
    warnings.push(
      `Height ${Number(heightM).toFixed(2)} m exceeds the common 4.3 m general-access height. Low bridges and car-nav tunnels are a real risk — use NHVR height data.`
    );
  }
  if (corridor && corridor.westPremium) {
    warnings.push(
      "This corridor heads remote / west: diesel usually steps up. Fill before the price band, and do not trust a car ETA that skips truck stops."
    );
  }
  if (corridor && !corridor.matched) {
    warnings.push(
      "No NHVR freight corridor matched this origin/destination. Stations are estimated along the entered path — verify heavy-vehicle access in the NHVR Journey Planner."
    );
  }
  return warnings;
}

function normalizeCombinationId(id) {
  const key = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (COMBINATION_IDS.has(key)) return key;
  if (key === "prime_mover" || key === "semitrailer" || key === "single_trailer") return "semi";
  if (key === "bdouble" || key === "b-double") return "b_double";
  if (key === "road_train" || key === "roadtrain") return "road_train_t1";
  return "semi";
}

function normalizeMassSchemeId(id) {
  const key = String(id || "")
    .trim()
    .toLowerCase();
  return MASS_IDS.has(key) ? key : "gml";
}

module.exports = {
  COMBINATIONS,
  MASS_SCHEMES,
  NETWORKS,
  CORRIDORS,
  listCombinations,
  listMassSchemes,
  listNetworks,
  listCorridors,
  getCombination,
  getMassScheme,
  matchCorridor,
  regionBandAtKm,
  combinationAllowedOnCorridor,
  accessWarnings,
  normalizeCombinationId,
  normalizeMassSchemeId,
  normalizePlace,
};
