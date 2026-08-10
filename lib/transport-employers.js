/**
 * Curated directory of transport / logistics employers commonly used by
 * Australian truck drivers. Used for profile employer predictive text.
 *
 * Not a complete world register — names + aliases are searchable keywords.
 * Free-typed employers still work; suggestions only appear when q matches.
 */

const EMPLOYERS = [
  // Major AU fleets / linehaul
  { name: "Lindsay Brothers Transport", aliases: ["lindsay", "lindsay brothers", "lindsay transport", "lindsay australia"] },
  { name: "Toll Group", aliases: ["toll", "toll transport", "toll priority", "team global express"] },
  { name: "Team Global Express", aliases: ["tge", "team global", "former toll"] },
  { name: "Linfox", aliases: ["lin fox", "fox"] },
  { name: "Centurion Transport", aliases: ["centurion"] },
  { name: "SCT Logistics", aliases: ["sct"] },
  { name: "Qube Logistics", aliases: ["qube"] },
  { name: "K&S Freighters", aliases: ["k and s", "k&s", "ks freighters"] },
  { name: "Ron Finemore Transport", aliases: ["finemore", "rft"] },
  { name: "Scott's Refrigerated Logistics", aliases: ["scotts", "scott's", "scotts transport"] },
  { name: "Followmont Transport", aliases: ["followmont"] },
  { name: "Nolan's Interstate Transport", aliases: ["nolans", "nolan's"] },
  { name: "Border Express", aliases: ["border"] },
  { name: "Northline", aliases: ["north line"] },
  { name: "Mainfreight", aliases: ["main freight"] },
  { name: "Direct Freight Express", aliases: ["dfe", "direct freight"] },
  { name: "Simon National Carriers", aliases: ["simon national", "snc"] },
  { name: "FBT Transwest", aliases: ["fbt", "transwest"] },
  { name: "Rocky's Own Transport", aliases: ["rockys", "rocky's"] },
  { name: "Hap's Transport", aliases: ["haps", "hap's"] },
  { name: "Sadleirs Logistics", aliases: ["sadleirs", "sadliers"] },
  { name: "Kings Transport", aliases: ["kings"] },
  { name: "Hunter Express", aliases: ["hunter"] },
  { name: "Capital Transport", aliases: ["capital"] },
  { name: "Western Freight Management", aliases: ["wfm", "western freight"] },
  { name: "Symes Transport", aliases: ["symes"] },
  { name: "Polar Fresh", aliases: ["polar"] },
  { name: "Cold Logic", aliases: ["coldlogic"] },
  { name: "Lineage Logistics", aliases: ["lineage"] },
  { name: "Swire Cold Storage", aliases: ["swire"] },
  { name: "Rivet Mining Services", aliases: ["rivet"] },
  { name: "Booth Transport", aliases: ["booth"] },
  { name: "McColl's Transport", aliases: ["mccolls", "mc colls"] },
  { name: "Blenners Transport", aliases: ["blenners"] },
  { name: "Grants Freightlines", aliases: ["grants"] },
  { name: "Centurion Super Dock", aliases: ["super dock"] },
  { name: "Intermodal Group", aliases: ["intermodal"] },
  { name: "Pacific National", aliases: ["pn", "pacific national rail"] },
  { name: "Aurizon", aliases: ["aurizon freight"] },
  { name: "Genesee & Wyoming Australia", aliases: ["gwa", "genesee"] },

  // Parcel / express / retail supply chain
  { name: "Australia Post", aliases: ["auspost", "post"] },
  { name: "StarTrack", aliases: ["star track", "startrack express"] },
  { name: "Couriers Please", aliases: ["couriersplease"] },
  { name: "Aramex Australia", aliases: ["aramex", "fastway"] },
  { name: "Allied Express", aliases: ["allied"] },
  { name: "TNT Express", aliases: ["tnt"] },
  { name: "FedEx", aliases: ["federal express"] },
  { name: "DHL", aliases: ["dhl express", "dhl supply chain"] },
  { name: "Primary Connect", aliases: ["woolworths primary connect", "woolworths logistics"] },
  { name: "Coles Group Supply Chain", aliases: ["coles logistics", "coles supply"] },
  { name: "Metcash Logistics", aliases: ["metcash"] },
  { name: "ALDI Distribution", aliases: ["aldi logistics"] },

  // Global logistics with AU operations
  { name: "DB Schenker", aliases: ["schenker"] },
  { name: "Kuehne+Nagel", aliases: ["kuehne nagel", "kn", "k+n"] },
  { name: "CEVA Logistics", aliases: ["ceva"] },
  { name: "DSV", aliases: ["dsv logistics"] },
  { name: "Maersk Logistics", aliases: ["maersk", "damco"] },
  { name: "UPS", aliases: ["united parcel"] },
  { name: "XPO Logistics", aliases: ["xpo"] },
  { name: "Ryder Logistics", aliases: ["ryder"] },
  { name: "Werner Enterprises", aliases: ["werner"] },
  { name: "Schneider National", aliases: ["schneider"] },
  { name: "J.B. Hunt", aliases: ["jb hunt", "j b hunt"] },
  { name: "Swift Transportation", aliases: ["swift"] },
  { name: "Knight-Swift", aliases: ["knight swift"] },

  // NZ / cross-Tasman common names
  { name: "Toll Networks NZ", aliases: ["toll nz"] },
  { name: "Mainfreight NZ", aliases: ["mainfreight new zealand"] },
  { name: "Move Logistics", aliases: ["move"] },
];

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9+&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function employerRecord(row) {
  return {
    name: row.name,
    aliases: Array.isArray(row.aliases) ? [...row.aliases] : [],
  };
}

function listTransportEmployers() {
  return EMPLOYERS.map(employerRecord);
}

/**
 * Keyword search over employer names and aliases.
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 */
function searchTransportEmployers(query, opts = {}) {
  const q = normalize(query);
  const limit = Math.min(Math.max(Number(opts.limit) || 12, 1), 40);
  if (q.length < 2) return [];

  const scored = [];
  for (const row of EMPLOYERS) {
    const name = normalize(row.name);
    const aliases = (row.aliases || []).map(normalize);
    let score = 0;

    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 90;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 80;
    else if (name.includes(q)) score = 70;
    else {
      for (const a of aliases) {
        if (a === q) {
          score = 95;
          break;
        }
        if (a.startsWith(q) || a.split(" ").some((w) => w.startsWith(q))) {
          score = Math.max(score, 85);
        } else if (a.includes(q)) {
          score = Math.max(score, 65);
        }
      }
    }

    if (score > 0) {
      scored.push({ ...employerRecord(row), score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ score: _s, ...rest }) => rest);
}

module.exports = {
  EMPLOYERS,
  listTransportEmployers,
  searchTransportEmployers,
};
