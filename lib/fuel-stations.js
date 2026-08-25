/**
 * Truck-accessible diesel sites on NHVR freight corridors.
 * Coordinates are public-road approximations for planning, not a permit.
 * Major barometers: BP, Mobil, Shell, Ampol, Liberty, 7-Eleven, Pearl.
 */

const { tableDieselCpl } = require("./fuel-prices");

const STATIONS = [
  // Hume
  { id: "bp-marulan", name: "BP Truckstop Marulan", retailerId: "bp", corridorId: "hume", km: 160, lat: -34.711, lng: 150.005, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking", "shower"], biasCpl: 1 },
  { id: "ampol-yass", name: "Ampol Yass", retailerId: "ampol", corridorId: "hume", km: 280, lat: -34.841, lng: 148.91, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "shell-gundagai", name: "Shell Gundagai", retailerId: "shell", corridorId: "hume", km: 390, lat: -35.065, lng: 148.105, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0.5 },
  { id: "bp-holbrook", name: "BP Holbrook", retailerId: "bp", corridorId: "hume", km: 490, lat: -35.69, lng: 147.315, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["parking"], biasCpl: 0 },
  { id: "liberty-albury", name: "Liberty Albury", retailerId: "liberty", corridorId: "hume", km: 555, lat: -36.075, lng: 146.915, band: "regional", capital: "melbourne", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: -1 },
  { id: "mobil-euroa", name: "Mobil Euroa", retailerId: "mobil", corridorId: "hume", km: 700, lat: -36.755, lng: 145.572, band: "regional", capital: "melbourne", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "seven-craigieburn", name: "7-Eleven Craigieburn", retailerId: "seven_eleven", corridorId: "hume", km: 810, lat: -37.599, lng: 144.941, band: "metro", capital: "melbourne", truckAccess: false, bDouble: false, roadTrain: false, amenities: ["food"], biasCpl: -2 },

  // Pacific
  { id: "bp-hexham", name: "BP Truckstop Hexham", retailerId: "bp", corridorId: "pacific", km: 160, lat: -32.831, lng: 151.684, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking", "shower"], biasCpl: 1 },
  { id: "ampol-tarcott", name: "Ampol Taree", retailerId: "ampol", corridorId: "pacific", km: 315, lat: -31.911, lng: 152.454, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "shell-coffs", name: "Shell Coffs Harbour", retailerId: "shell", corridorId: "pacific", km: 540, lat: -30.296, lng: 153.114, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0.5 },
  { id: "bp-ballina", name: "BP Ballina", retailerId: "bp", corridorId: "pacific", km: 740, lat: -28.868, lng: 153.563, band: "regional", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "ampol-yatala", name: "Ampol Yatala", retailerId: "ampol", corridorId: "pacific", km: 880, lat: -27.743, lng: 153.244, band: "metro", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking", "shower"], biasCpl: -0.5 },

  // Newell
  { id: "bp-shepparton", name: "BP Shepparton", retailerId: "bp", corridorId: "newell", km: 180, lat: -36.381, lng: 145.399, band: "regional", capital: "melbourne", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "ampol-parkes", name: "Ampol Parkes", retailerId: "ampol", corridorId: "newell", km: 520, lat: -33.137, lng: 148.176, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "shell-dubbo", name: "Shell Dubbo", retailerId: "shell", corridorId: "newell", km: 620, lat: -32.257, lng: 148.601, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking", "shower"], biasCpl: 0 },
  { id: "liberty-narrabri", name: "Liberty Narrabri", retailerId: "liberty", corridorId: "newell", km: 820, lat: -30.323, lng: 149.784, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["parking"], biasCpl: 1 },
  { id: "bp-goondiwindi", name: "BP Goondiwindi", retailerId: "bp", corridorId: "newell", km: 940, lat: -28.547, lng: 150.307, band: "regional", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking", "shower"], biasCpl: 2 },

  // Warrego / west QLD
  { id: "ampol-toowoomba", name: "Ampol Toowoomba", retailerId: "ampol", corridorId: "warrego", km: 125, lat: -27.56, lng: 151.954, band: "regional", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "bp-roma", name: "BP Roma", retailerId: "bp", corridorId: "warrego", km: 480, lat: -26.567, lng: 148.787, band: "remote", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking", "shower"], biasCpl: 2 },
  { id: "shell-charleville", name: "Shell Charleville", retailerId: "shell", corridorId: "warrego", km: 745, lat: -26.402, lng: 146.238, band: "remote", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking"], biasCpl: 3 },
  { id: "ampol-longreach", name: "Ampol Longreach", retailerId: "ampol", corridorId: "warrego", km: 1180, lat: -23.442, lng: 144.249, band: "outback_west", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking", "shower"], biasCpl: 4 },
  { id: "bp-cloncurry", name: "BP Cloncurry", retailerId: "bp", corridorId: "warrego", km: 1680, lat: -20.705, lng: 140.505, band: "outback_west", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking"], biasCpl: 5 },
  { id: "pearl-mtisa", name: "Pearl Mount Isa", retailerId: "pearl", corridorId: "warrego", km: 1820, lat: -20.725, lng: 139.497, band: "outback_west", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["parking"], biasCpl: 3 },

  // Stuart
  { id: "bp-portaugusta", name: "BP Port Augusta", retailerId: "bp", corridorId: "stuart", km: 310, lat: -32.49, lng: 137.763, band: "regional", capital: "adelaide", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking", "shower"], biasCpl: 1 },
  { id: "ampol-coober", name: "Ampol Coober Pedy", retailerId: "ampol", corridorId: "stuart", km: 850, lat: -29.013, lng: 134.753, band: "outback_west", capital: "adelaide", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking"], biasCpl: 6 },
  { id: "shell-alice", name: "Shell Alice Springs", retailerId: "shell", corridorId: "stuart", km: 1530, lat: -23.698, lng: 133.88, band: "outback_west", capital: "darwin", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking", "shower"], biasCpl: 2 },
  { id: "bp-katherine", name: "BP Katherine", retailerId: "bp", corridorId: "stuart", km: 2320, lat: -14.465, lng: 132.263, band: "outback_west", capital: "darwin", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking", "shower"], biasCpl: 3 },

  // Eyre / Nullarbor
  { id: "liberty-ceduna", name: "Liberty Ceduna", retailerId: "liberty", corridorId: "eyre", km: 780, lat: -32.126, lng: 133.674, band: "outback_west", capital: "adelaide", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking"], biasCpl: 5 },
  { id: "bp-eucla", name: "BP Eucla", retailerId: "bp", corridorId: "eyre", km: 1230, lat: -31.677, lng: 128.879, band: "outback_west", capital: "perth", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking", "shower"], biasCpl: 8 },
  { id: "ampol-norseman", name: "Ampol Norseman", retailerId: "ampol", corridorId: "eyre", km: 1510, lat: -32.196, lng: 121.778, band: "outback_west", capital: "perth", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking"], biasCpl: 4 },
  { id: "shell-kalgoorlie", name: "Shell Kalgoorlie", retailerId: "shell", corridorId: "eyre", km: 1670, lat: -30.748, lng: 121.466, band: "remote", capital: "perth", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["food", "parking", "shower"], biasCpl: 2 },

  // Great Western / Barrier
  { id: "bp-lithgow", name: "BP Lithgow", retailerId: "bp", corridorId: "great_western", km: 140, lat: -33.481, lng: 150.157, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "ampol-dubbo-gw", name: "Ampol Dubbo West", retailerId: "ampol", corridorId: "great_western", km: 400, lat: -32.247, lng: 148.601, band: "regional", capital: "sydney", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "pearl-brokenhill", name: "Pearl Broken Hill", retailerId: "pearl", corridorId: "great_western", km: 1160, lat: -31.954, lng: 141.465, band: "remote", capital: "adelaide", truckAccess: true, bDouble: true, roadTrain: true, amenities: ["parking"], biasCpl: 4 },

  // Bruce
  { id: "bp-gympie", name: "BP Gympie", retailerId: "bp", corridorId: "bruce", km: 160, lat: -26.183, lng: 152.666, band: "regional", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 0 },
  { id: "ampol-rocky", name: "Ampol Rockhampton", retailerId: "ampol", corridorId: "bruce", km: 640, lat: -23.378, lng: 150.51, band: "regional", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking", "shower"], biasCpl: 1 },
  { id: "shell-mackay", name: "Shell Mackay", retailerId: "shell", corridorId: "bruce", km: 970, lat: -21.143, lng: 149.182, band: "regional", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking"], biasCpl: 1 },
  { id: "bp-townsville", name: "BP Townsville", retailerId: "bp", corridorId: "bruce", km: 1360, lat: -19.259, lng: 146.818, band: "regional", capital: "brisbane", truckAccess: true, bDouble: true, roadTrain: false, amenities: ["food", "parking", "shower"], biasCpl: 2 },
];

function withTablePrice(station, observedMap = {}) {
  const tableCpl = tableDieselCpl({
    band: station.band,
    capital: station.capital,
    retailerBiasCpl: station.biasCpl,
  });
  const observed = observedMap[station.id];
  return {
    ...station,
    amenities: [...(station.amenities || [])],
    tableCpl,
    observedCpl: observed != null ? Number(observed) : null,
    pumpCpl: observed != null ? Number(observed) : tableCpl,
  };
}

function listStations({ corridorId, q, observedPrices = [] } = {}) {
  const observedMap = {};
  for (const row of observedPrices || []) {
    if (row && row.stationId && row.cpl != null) observedMap[row.stationId] = row.cpl;
  }
  const query = String(q || "")
    .trim()
    .toLowerCase();
  return STATIONS.filter((s) => {
    if (corridorId && s.corridorId !== corridorId) return false;
    if (!query) return true;
    return (
      s.name.toLowerCase().includes(query) ||
      s.retailerId.includes(query) ||
      s.id.includes(query)
    );
  }).map((s) => withTablePrice(s, observedMap));
}

function getStation(id, observedPrices = []) {
  const found = STATIONS.find((s) => s.id === id);
  if (!found) return null;
  return listStations({ observedPrices }).find((s) => s.id === id) || withTablePrice(found);
}

function stationsOnCorridor(corridorId, observedPrices = []) {
  return listStations({ corridorId, observedPrices }).sort((a, b) => a.km - b.km);
}

function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function trackDistanceKm(points = []) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) {
    const step = haversineKm(points[i - 1], points[i]);
    if (step != null && step < 80) km += step;
  }
  return Math.round(km * 10) / 10;
}

function nearestStations(point, { limit = 8, observedPrices = [], maxKm = 80 } = {}) {
  return listStations({ observedPrices })
    .map((s) => ({ ...s, distanceKm: haversineKm(point, s) }))
    .filter((s) => s.distanceKm != null && s.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

module.exports = {
  STATIONS,
  listStations,
  getStation,
  stationsOnCorridor,
  haversineKm,
  trackDistanceKm,
  nearestStations,
  withTablePrice,
};
