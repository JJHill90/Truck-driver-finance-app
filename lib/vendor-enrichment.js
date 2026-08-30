/**
 * ABN + business-name enrichment for expense/income scans.
 * Remembers vendors (ABN ↔ name ↔ default category) and uses them as the key
 * reference on later scans, then categorises receipts (meals, training, …).
 *
 * When ABN / business name establish a known business type (e.g. Woolworths →
 * groceries), that type always wins over weak OCR guesses like other_work.
 *
 * Also canonicalises chain names from OCR junk (e.g. "7 EIEVEN" / random first
 * line → "7-Eleven") by matching tolerant patterns against the vendor field and
 * receipt raw text — without editing the verbatim OCR modules.
 */
const storage = require("./storage");
const { vendorsMatch, normalizeVendor } = require("./duplicate-receipt");
const { normalizeExpenseCategoryId, HIDDEN_FROM_MENU } = require("./expense-menu");

const WEAK_CATEGORIES = new Set(["", "other_work", "other", null, undefined]);

/**
 * Receipt header/boilerplate lines that OCR often returns as the "vendor"
 * when the real brand logo is misread.
 */
const VENDOR_BOILERPLATE_RE =
  /^(tax\s*invoice|taxinvoice|invoice|receipt|abn\b|gst\b|total\b|change\b|eftpos|visa|mastercard|debit|credit|thank\s*you|store\s*#?\d+|terminal|merchant\s*copy|customer\s*copy|docket)\b/i;

/**
 * Well-known AU chains → clean display name (+ optional category / ABN).
 * Patterns intentionally tolerate common Tesseract misreads (l/1/I, e/c, …).
 * Order: more specific brands first.
 */
const CANONICAL_VENDORS = [
  {
    name: "7-Eleven",
    // Dual-purpose (fuel + food) — category comes from receipt line items
    patterns: [
      /\b7[\s-]*e+l+[aeiou]*v+[aeiou]*n\b/i,
      /\b7[\s-]*eie[vw]en\b/i,
      /\b7[\s-]*el[e]?v[ae]?n\b/i,
      /\b7eleven\b/i,
      /\bseven[\s-]*e+l+[aeiou]*v+[aeiou]*n\b/i,
      // Leading "7" often OCR'd as l, I, |, or 1
      /\b[lI|1][\s-]*e+l+[aeiou]*v+[aeiou]*n\b/i,
      /\b7[\s-]*11\b/,
    ],
    abns: [],
  },
  {
    name: "NightOwl",
    patterns: [/\bnight[\s-]*owl\b/i],
    abns: [],
  },
  {
    name: "Woolworths Metro",
    category: "groceries_travel",
    patterns: [/\bwoolworths?\s*metro\b/i],
    abns: [],
  },
  {
    name: "Woolworths",
    category: "groceries_travel",
    patterns: [
      /\bwoolworths?\b/i,
      /\bwoolies\b/i,
      /\bwoolworth\b/i,
      // OCR misreads: WOOIWOIHS, Wo0lworths, W00lworths
      /\bw+[o0]{1,3}[il1]{1,3}w+[o0]?r+t+h+s?\b/i,
      /\bfresh\s*foo[a-z]{0,12}(?:people|peopl|apesple)?\b/i,
      /\beveryday\s*rewards?\b/i,
      /\bw+[o0]{1,3}[il1]{1,3}w+[o0il1]*[rhs]+\b/i,
    ],
    abns: ["88000014675"],
  },
  {
    name: "Coles Express",
    // Dual-purpose servo + convenience — content decides fuel vs food
    patterns: [/\bcoles\s*express\b/i],
    abns: [],
  },
  {
    name: "Coles",
    category: "groceries_travel",
    patterns: [/\bcoles(?:\s+group|\s+supermarket)?\b/i],
    abns: ["45004189708"],
  },
  {
    name: "ALDI",
    category: "groceries_travel",
    patterns: [/\baldi\b/i],
    abns: [],
  },
  {
    name: "IGA",
    category: "groceries_travel",
    patterns: [/\biga\b/i],
    abns: [],
  },
  {
    name: "Costco",
    category: "groceries_travel",
    patterns: [/\bcostco\b/i],
    abns: [],
  },
  {
    name: "Harris Farm",
    category: "groceries_travel",
    patterns: [/\bharris\s*farm\b/i],
    abns: [],
  },
  {
    name: "Bakers Delight",
    category: "meals",
    patterns: [/\bbakers?\s*delight\b/i],
    abns: [],
  },
  {
    name: "Brumby's",
    category: "meals",
    patterns: [/\bbrumby'?s?\b/i],
    abns: [],
  },
  {
    name: "Chemist Warehouse",
    category: "first_aid",
    patterns: [/\bchemist\s*warehouse\b/i],
    abns: [],
  },
  {
    name: "Priceline",
    category: "first_aid",
    patterns: [/\bpriceline\b/i],
    abns: [],
  },
  {
    name: "TerryWhite Chemmart",
    category: "first_aid",
    patterns: [/\bterry\s*white(?:\s*chemmart)?\b/i, /\bchemmart\b/i],
    abns: [],
  },
  {
    name: "Amcal",
    category: "first_aid",
    patterns: [/\bamcal\b/i],
    abns: [],
  },
  {
    name: "Blooms The Chemist",
    category: "first_aid",
    patterns: [/\bblooms(?:\s+the\s+chemist)?\b/i],
    abns: [],
  },
  {
    name: "Myer",
    category: "business_supplies",
    patterns: [/\bmyer\b/i],
    abns: [],
  },
  {
    name: "David Jones",
    category: "business_supplies",
    patterns: [/\bdavid\s*jones\b/i],
    abns: [],
  },
  {
    name: "Kmart",
    category: "business_supplies",
    patterns: [/\bkmart\b/i],
    abns: [],
  },
  {
    name: "Target",
    category: "business_supplies",
    // Avoid bare "target" in unrelated OCR lines — prefer store branding.
    patterns: [/\btarget\s+australia\b/i, /\btarget\s+store\b/i, /^target$/i],
    abns: [],
  },
  {
    name: "Big W",
    category: "business_supplies",
    patterns: [/\bbig\s*w\b/i],
    abns: [],
  },
  {
    name: "The Reject Shop",
    category: "business_supplies",
    patterns: [/\b(?:the\s*)?reject\s*shop\b/i],
    abns: [],
  },
  {
    name: "JB Hi-Fi",
    category: "tools_equipment",
    patterns: [/\bjb\s*hi[\s-]*fi\b/i, /\bjbhifi\b/i],
    abns: [],
  },
  {
    name: "Harvey Norman",
    category: "tools_equipment",
    patterns: [/\bharvey\s*norman\b/i],
    abns: [],
  },
  {
    name: "The Good Guys",
    category: "tools_equipment",
    patterns: [/\b(?:the\s*)?good\s*guys\b/i],
    abns: [],
  },
  {
    name: "Officeworks",
    category: "office_admin",
    patterns: [/\bofficeworks\b/i],
    abns: [],
  },
  {
    name: "Dymocks",
    category: "trade_subscriptions",
    patterns: [/\bdymocks\b/i],
    abns: [],
  },
  {
    name: "QBD Books",
    category: "trade_subscriptions",
    patterns: [/\bqbd(?:\s*books?)?\b/i],
    abns: [],
  },
  {
    name: "Savers",
    category: "business_supplies",
    patterns: [/\bsavers\b/i],
    abns: [],
  },
  {
    name: "Vinnies",
    category: "business_supplies",
    patterns: [/\bvinnies\b/i, /\bst\.?\s*vincent\b/i],
    abns: [],
  },
  {
    name: "BP",
    // Dual-purpose truck stop / servo — content decides
    patterns: [
      /\bbp\b(?:\s+(?:truck\s*stop|servo|connect|outlet|service|express|[A-Za-z][A-Za-z'&-]{2,}))?/i,
      /\bbp\s*rewards?\b/i,
      /\bbprewards?\b/i,
      /\brampage\s*reta(?:il)?\b/i,
    ],
    // Common BP retail ABNs (site-level Pty Ltd entities still map to BP)
    abns: ["66600817178"],
  },
  {
    name: "Shell",
    patterns: [/\bshell\b(?:\s+(?:truck\s*stop|servo|select|colestop))?/i],
    abns: [],
  },
  {
    name: "Ampol",
    patterns: [
      /\bampol\b/i,
      /\bamp[o0][l1]\b/i,
      /\bfoodary\b/i,
      /\bampolfeedback\b/i,
      /\bampol\s*retail\b/i,
      /\bt\/?\s*as\s*ampol\b/i,
    ],
    abns: ["64000175342"],
  },
  {
    name: "Caltex",
    patterns: [/\bcaltex\b/i],
    abns: [],
  },
  {
    name: "United Petroleum",
    // Bare "United Crestmead" (no Petroleum) is common on thermal dockets.
    patterns: [
      /\bunited\s*petroleum\b/i,
      /\bunited\s*servo\b/i,
      /\bunited\s+(?!petroleum\b|servo\b|states\b|kingdom\b|airlines?\b)[A-Za-z][A-Za-z'&-]{2,}\b/i,
    ],
    abns: [],
  },
  {
    name: "Puma Energy",
    patterns: [/\bpuma(?:\s*energy)?\b/i],
    abns: [],
  },
  {
    name: "Mobil",
    patterns: [/\bmobil\b/i],
    abns: [],
  },
  {
    name: "Pearl Energy",
    patterns: [/\bpearl(?:\s*energy)?\b/i],
    abns: [],
  },
  {
    name: "Liberty",
    patterns: [/\bliberty(?:\s*(?:oil|fuel|petroleum))?\b/i],
    abns: [],
  },
  {
    name: "Metro Petroleum",
    patterns: [/\bmetro\s*petroleum\b/i],
    abns: [],
  },
  {
    name: "Budget Petrol",
    patterns: [/\bbudget\s*(?:petrol|fuel)\b/i],
    abns: [],
  },
  {
    name: "EG Ampol",
    patterns: [/\beg\s*ampol\b/i],
    abns: [],
  },
  {
    name: "OTR",
    patterns: [/\botr\b/i, /\bon\s*the\s*run\b/i],
    abns: [],
  },
  {
    name: "Foodworks",
    category: "groceries_travel",
    patterns: [/\bfoodworks\b/i],
    abns: [],
  },
  {
    name: "Drakes",
    category: "groceries_travel",
    patterns: [/\bdrakes?\b/i],
    abns: [],
  },
  {
    name: "SPARC",
    category: "groceries_travel",
    patterns: [/\bsparc\b/i],
    abns: [],
  },
  {
    name: "Bunnings",
    category: "tools_equipment",
    patterns: [/\bbunnings\b/i],
    abns: ["26008672179"],
  },
  {
    name: "McDonald's",
    category: "meals",
    patterns: [/\bmcdona[l1]d'?s?\b/i, /\bmaccas\b/i],
    abns: [],
  },
  {
    name: "Hungry Jack's",
    category: "meals",
    patterns: [/\bhungry\s*jack'?s?\b/i],
    abns: [],
  },
  {
    name: "KFC",
    category: "meals",
    patterns: [/\bkfc\b/i, /\bkentucky\s*fried\b/i],
    abns: [],
  },
  {
    name: "Subway",
    category: "meals",
    patterns: [/\bsubway\b/i],
    abns: [],
  },
  {
    name: "Guzman y Gomez",
    category: "meals",
    patterns: [/\bguzman\b/i, /\bgyg\b/i],
    abns: [],
  },
  {
    name: "Red Rooster",
    category: "meals",
    patterns: [/\bred\s*rooster\b/i],
    abns: [],
  },
  {
    name: "Nando's",
    category: "meals",
    patterns: [/\bnando'?s?\b/i],
    abns: [],
  },
  {
    name: "Dominos",
    category: "meals",
    patterns: [/\bdomino'?s?\b/i],
    abns: [],
  },
  {
    name: "Pizza Hut",
    category: "meals",
    patterns: [/\bpizza\s*hut\b/i],
    abns: [],
  },
  {
    name: "Boost Juice",
    category: "meals",
    patterns: [/\bboost\s*juice\b/i],
    abns: [],
  },
  {
    name: "Gloria Jean's",
    category: "meals",
    patterns: [/\bgloria\s*jean'?s?\b/i],
    abns: [],
  },
  {
    name: "Starbucks",
    category: "meals",
    patterns: [/\bstarbucks\b/i],
    abns: [],
  },
  {
    name: "Telstra",
    category: "navigation_comms",
    patterns: [/\btelstra\b/i],
    abns: ["33051775556"],
  },
  {
    name: "Optus",
    category: "navigation_comms",
    patterns: [/\boptus\b/i],
    abns: [],
  },
];

/**
 * Known Australian retailers / chains → expense category by business type.
 * Matched by ABN (preferred) or business-name wording. Always overrides weak
 * OCR (other_work) and any conflicting remembered default.
 * Dual-purpose servos / convenience (7-Eleven, BP, …) are handled separately
 * via suggestCategoryFromVendorContent so line items can pick fuel vs food.
 *
 * Covers common retail types outside fuel stops: supermarket, bakery, butcher,
 * greengrocer, pharmacy, department/discount/hypermarket, specialty shops.
 */
const KNOWN_BUSINESS_TYPES = [
  {
    category: "groceries_travel",
    // Supermarket / greengrocer / butcher / hypermarket grocery
    nameRe:
      /\b(woolworths|woolies|coles(?:\s+group|\s+supermarket)?|aldi|iga|foodworks|foodland|drakes|harris\s*farm|costco|supermarket|hypermarket|grocery|groceries|greengrocer|green\s*grocer|fruit(?:\s*(?:&|and)\s*veg(?:etable)?s?)?|butcher(?:y)?|meat\s*(?:market|shop)|general\s*store)\b/i,
    abns: [
      "88000014675", // Woolworths Group Limited
      "45004189708", // Coles Group Limited
    ],
  },
  {
    category: "meals",
    // Bakery + quick-service food (convenience store brands use content rules)
    nameRe:
      /\b(bakers?\s*delight|brumby'?s?|michel'?s?\s*patisserie|bakery|bakehouse|pastry\s*shop|patisserie|pie\s*shop|mcdonald'?s?|hungry\s*jack'?s?|kfc|subway|domino'?s|pizza\s*hut|red\s*rooster|guzman|grill'?d|nando'?s|oporto|hungry\s*jacks)\b/i,
    abns: [],
  },
  {
    category: "first_aid",
    // Pharmacy / chemist — medicines and health products
    nameRe:
      /\b(chemist\s*warehouse|priceline|terry\s*white|chemmart|amcal|blooms(?:\s+the\s+chemist)?|soul\s*pattinson|pharmacy|chemist|drugstore|drug\s*store)\b/i,
    abns: [],
  },
  {
    category: "tools_equipment",
    // Hardware + electronics / appliance retailers
    nameRe:
      /\b(bunnings|total\s*tools|sydney\s*tools|repco|supercheap\s*auto|autobarn|blackwoods|tool\s*kit\s*depot|jb\s*hi[\s-]*fi|jbhifi|harvey\s*norman|good\s*guys|bing\s*lee|electronics\s*store|appliance\s*store)\b/i,
    abns: [
      "26008672179", // Bunnings Group Limited
    ],
  },
  {
    category: "office_admin",
    nameRe: /\b(officeworks|office\s*supplies|stationery\s*store)\b/i,
    abns: [],
  },
  {
    category: "trade_subscriptions",
    // Bookstore — books and magazines
    nameRe: /\b(dymocks|qbd(?:\s*books?)?|booktopia|kinokuniya|bookstore|book\s*shop|bookshop|newsagency|newsagent)\b/i,
    abns: [],
  },
  {
    category: "business_supplies",
    // Department / discount / big-box general retail, thrift, boutique, florist
    nameRe:
      /\b(myer|david\s*jones|harris\s*scarfe|kmart|target(?:\s+australia|\s+store)|big\s*w|reject\s*shop|best\s*(?:and|&)\s*less|department\s*store|discount\s*store|big[\s-]*box|warehouse\s*club|thrift(?:\s*shop)?|opportunity\s*shop|op[\s-]*shop|savers|vinnies|salv(?:ation)?\s*army|salvos|boutique|florist|floristry|flower\s*shop)\b/i,
    abns: [],
  },
  {
    category: "accommodation",
    nameRe:
      /\b(ibis|quest\s+apartment|quest\s+serviced|mercure|novotel|hilton|holiday\s*inn|motel\s+\w+|caravan\s*park)\b/i,
    abns: [],
  },
  {
    category: "navigation_comms",
    nameRe: /\b(telstra|optus|vodafone|boost\s*mobile|amaysim)\b/i,
    abns: [
      "33051775556", // Telstra Corporation Limited
    ],
  },
  {
    category: "cleaning_supplies",
    nameRe: /\b(truck\s*wash|ultra\s*tune\s*wash|pro[\s-]?wash)\b/i,
    abns: [],
  },
];

/**
 * Vendors that sell both fuel and food/convenience — category must follow
 * receipt line items (diesel vs coffee/snacks), not a single fixed default.
 * Includes generic “convenience store” / corner store wording.
 */
const DUAL_PURPOSE_VENDOR_RE =
  /\b(7[\s-]*(?:eleven|11)|seven[\s-]*eleven|night[\s-]*owl|friendly\s*grocer|bp\b|shell\b|ampol|caltex|united\s*(?:petroleum|servo)|puma(?:\s*energy)?|mobil|coles\s*express|metro\s*petroleum|truck\s*stop|servo|convenience\s*store|corner\s*store|milk\s*bar)\b/i;

/** Fuel / pump line signals on AU dockets. */
const FUEL_CONTENT_RE =
  /\b(diesel|distillate|petrol|unleaded(?:\s*91|\s*95|\s*98)?|ulp|e10|e85|pulp|fuel|litre|ltrs?|pump\s*#?\d*|bowser|ad[\s-]*blue|adblue|l\s*@|\$\/l|per\s*l(?:itre)?)\b/i;

/** Food / drink / snack signals (coffee & snacks at 7-Eleven, etc.). */
const FOOD_CONTENT_RE =
  /\b(coffee|caf{1,2}e|cappuccino|latte|flat\s*white|espresso|long\s*black|mocha|tea\b|hot\s*choc|slurpee|slurpy|soft\s*drink|soda|coke|pepsi|fanta|sprite|water\b|juice|energy\s*drink|red\s*bull|monster|snack|chips|crisps|chocolate|loll(?:y|ies)|confection|candy|biscuit|cookie|muffin|donut|doughnut|pastry|pie\b|sausage\s*roll|sandwich|wrap\b|salad|yoghurt|yogurt|milk\b|bread|banana|fruit|hot\s*food|hot\s*dog|burger|nugget|fries|meal\b|breakfast|lunch|dinner|food\b|grocery|groceries|ice\s*cream)\b/i;

/** Heuristic keyword → menu-facing expense category (after meal consolidation). */
const CATEGORY_HEURISTICS = [
  {
    id: "meals",
    re: /\b(breakfast|lunch|dinner|meal|cafe|caf[eé]|restaurant|bistro|mcdonald|hungry\s*jack|kfc|subway|domino|pizza|food\s*court|canteen|roadhouse\s*meal|takeaway|take[\s-]*away|coffee|cappuccino|latte|flat\s*white|espresso|slurpee|snack|sandwich|sausage\s*roll|hot\s*food|pie\b|muffin|pastry|bakery|bakehouse|patisserie)\b/i,
  },
  {
    id: "overtime_meals",
    re: /\b(overtime\s*meal|ot\s*meal)\b/i,
  },
  {
    id: "training_education",
    re: /\b(training|course|seminar|workshop|tafe|rto|certificate|competency|induction|first\s*aid\s*course|driver\s*training|education)\b/i,
  },
  {
    id: "accommodation",
    re: /\b(motel|hotel|accommodation|ibis|quest|room\s*rate|caravan\s*park|lodge|inn\b)\b/i,
  },
  {
    id: "groceries_travel",
    re: /\b(woolworths|coles|aldi|iga|supermarket|hypermarket|grocery|groceries|greengrocer|butcher|fruit(?:\s*(?:&|and)\s*veg)?|general\s*store)\b/i,
  },
  {
    id: "first_aid",
    re: /\b(pharmacy|chemist|prescription|medicine|first\s*aid\s*kit|bandage|antiseptic)\b/i,
  },
  {
    id: "rest_facilities",
    re: /\b(shower|laundry|laundromat|rest\s*stop|truck\s*wash\s*bay)\b/i,
  },
  {
    id: "laundry",
    re: /\b(dry[\s-]*clean|clothing\s*laundry|uniform\s*laundry)\b/i,
  },
  {
    id: "clothing_protective",
    re: /\b(hi[\s-]*vis|steel[\s-]*cap|safety\s*boot|protective\s*clothing|ppe|work\s*boot)\b/i,
  },
  {
    id: "clothing_uniform",
    re: /\b(uniform|embroidered\s*shirt|company\s*shirt)\b/i,
  },
  {
    id: "cleaning_supplies",
    re: /\b(truck\s*wash|truck\s*cleaning|vehicle\s*wash|wash\s*bay|detailing)\b/i,
  },
  {
    id: "office_admin",
    re: /\b(logbook|work\s*diary|ewd|electronic\s*work\s*diary|nhvr|officeworks|stationery)\b/i,
  },
  {
    id: "compulsory_assessment",
    re: /\b(medical|vision\s*test|eyesight|health\s*assessment|drug\s*(?:and|&)\s*alcohol)\b/i,
  },
  {
    id: "navigation_comms",
    re: /\b(uhf|gps|navman|two[\s-]*way|phone\s*plan|telstra|optus|vodafone)\b/i,
  },
  {
    id: "tools_equipment",
    re: /\b(bunnings|jb\s*hi[\s-]*fi|harvey\s*norman|tool|socket|spanner|torch|flashlight|electronics)\b/i,
  },
  {
    id: "trade_subscriptions",
    re: /\b(bookstore|book\s*shop|bookshop|newsagency|magazine\s*subscription|trade\s*magazine)\b/i,
  },
  {
    id: "business_supplies",
    re: /\b(department\s*store|discount\s*store|kmart|target\s+(?:australia|store)|big\s*w|thrift|op[\s-]*shop|boutique|florist)\b/i,
  },
  {
    id: "incidentals",
    re: /\b(toiletr|incidentals|personal\s*care)\b/i,
  },
  {
    id: "travel_general",
    re: /\b(travel|ferry|flight|airline|bus\s*ticket)\b/i,
  },
];

function normaliseAbn(abn) {
  return String(abn || "")
    .replace(/\s/g, "")
    .replace(/[^\d]/g, "");
}

function formatAbn(digits) {
  const d = normaliseAbn(digits);
  if (d.length !== 11) return d;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}`;
}

/** ABN modulus-89 check (Australian Business Register). */
function isValidAbn(abn) {
  const d = normaliseAbn(abn);
  if (d.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = d.split("").map(Number);
  nums[0] -= 1;
  const sum = nums.reduce((s, n, i) => s + n * weights[i], 0);
  return sum % 89 === 0;
}

/** Pull an ABN from OCR text / fields (labeled first, then spaced 11 digits). */
function extractAbnFromText(text) {
  const src = String(text || "");
  // Prefer the ABN+entity resolver (checksum + proximity). Fall back to the
  // first valid labeled / spaced / compact hit when pairing finds nothing.
  try {
    const { pickBestAbnCandidate } = require("./abn-entity");
    const picked = pickBestAbnCandidate(src);
    if (picked && picked.best) return picked.best.formatted;
  } catch {
    /* circular-load safe fallback below */
  }
  const labeled = src.match(/\bABN[:\s#]*([0-9][0-9\s]{9,16}[0-9])/i);
  if (labeled) {
    const d = normaliseAbn(labeled[1]);
    if (d.length === 11 && isValidAbn(d)) return formatAbn(d);
  }
  const spaced = src.match(/\b(\d{2}\s\d{3}\s\d{3}\s\d{3})\b/);
  if (spaced) {
    const d = normaliseAbn(spaced[1]);
    if (d.length === 11 && isValidAbn(d)) return formatAbn(d);
  }
  const compact = src.match(/\b(\d{11})\b/);
  if (compact && isValidAbn(compact[1])) return formatAbn(compact[1]);
  return "";
}

function isWeakCategory(id) {
  if (id == null || id === "") return true;
  const norm = normalizeExpenseCategoryId(id);
  return WEAK_CATEGORIES.has(norm) || WEAK_CATEGORIES.has(id);
}

function menuSafeCategory(id) {
  if (!id) return null;
  const norm = normalizeExpenseCategoryId(id);
  if (HIDDEN_FROM_MENU.has(norm)) return null;
  if (WEAK_CATEGORIES.has(norm)) return null;
  return norm;
}

/**
 * Infer expense category from established business identity (ABN and/or name).
 * Returns a menu-safe category id, or null when the business type is unknown.
 */
function inferBusinessTypeCategory({ name, abn, text } = {}) {
  const abnDigits = normaliseAbn(abn);
  if (abnDigits.length === 11) {
    for (const rule of KNOWN_BUSINESS_TYPES) {
      if ((rule.abns || []).some((a) => normaliseAbn(a) === abnDigits)) {
        return menuSafeCategory(rule.category);
      }
    }
  }
  const blob = `${name || ""}\n${text || ""}`;
  if (!String(blob).trim()) return null;
  for (const rule of KNOWN_BUSINESS_TYPES) {
    if (rule.nameRe && rule.nameRe.test(blob)) {
      return menuSafeCategory(rule.category);
    }
  }
  return null;
}

/**
 * True when OCR "vendor" looks like noise / boilerplate rather than a brand.
 * Examples: "XqR7", "TAX INVOICE", "P E WHEY TAA", "4% Lae", empty.
 */
function looksLikeJunkVendor(name) {
  const s = String(name || "").trim();
  if (!s) return true;
  if (VENDOR_BOILERPLATE_RE.test(s)) return true;
  if (s.length <= 2) return true;
  // Tiny OCR shreds that are not known short brands ("Aen", "Es", "RE")
  if (s.length <= 3 && !/^(bp|iga|otr|kfc|gyg|eg)$/i.test(s)) return true;
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 2) return true;
  const norm = normalizeVendor(s);
  if (!norm || norm.length <= 2) return true;

  const KNOWN_SHORT_BRANDS = /^(bp|iga|otr|kfc|gyg|eg|aldi)$/i;
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const letterLens = tokens.map((t) => t.replace(/[^a-zA-Z]/g, "").length);
    const shortTokens = tokens.filter((t, i) => {
      const n = letterLens[i];
      return n > 0 && n <= 2 && !KNOWN_SHORT_BRANDS.test(t);
    }).length;
    const avgLen = letterLens.reduce((a, b) => a + b, 0) / letterLens.length;
    // Spaced single-letter salad: "P E WHEY TAA", "a BE a oe", "NRA RA"
    if (shortTokens / tokens.length >= 0.5) return true;
    if (tokens.length >= 3 && avgLen <= 3.2) return true;
    if (tokens.length === 2 && avgLen <= 3 && letters.length <= 6 && !KNOWN_SHORT_BRANDS.test(tokens[0])) {
      return true;
    }
  }

  // Mostly punctuation / digits with a couple of letters ("4% Lae")
  const nonLetterRatio = (s.length - letters.length) / s.length;
  if (s.length >= 4 && nonLetterRatio >= 0.45) return true;

  // Long consonant salad with no / few vowels (typical Tesseract garbage).
  if (letters.length >= 4) {
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    if (vowels === 0) return true;
    if (letters.length >= 6 && vowels / letters.length < 0.18) return true;
  }

  // Random mixed case OCR shreds without a dictionary word shape.
  if (/^[A-Za-z]{1,3}(\s+[A-Za-z]{1,3}){1,}$/.test(s) && letters.length <= 10) {
    return true;
  }

  if (s.length >= 4 && nonLetterRatio >= 0.6) return true;
  return false;
}

/** Pty Ltd / Ltd legal entity names — prefer trading/site names on the docket. */
function looksLikeLegalEntityName(name) {
  const s = String(name || "").trim();
  if (!s) return false;
  return /\b(pty\.?\s*ltd\.?|proprietary\s+limited|limited|ltd\.?)\b/i.test(s);
}

function titleCaseWords(s) {
  return String(s || "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      if (/^(bp|iga|aldi|abn|gst|nab)$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function formatSiteToken(site) {
  const s = String(site || "").trim();
  if (!s) return s;
  if (/^[A-Z0-9\s'&#.-]+$/.test(s) && !/[a-z]/.test(s)) return titleCaseWords(s);
  return s;
}

/**
 * Trading / site name printed near the top of a receipt (before TAX INVOICE / ABN).
 * Used for all scans so we keep "BP Archerfield", "United Crestmead", etc.
 */
function extractReceiptBusinessName(text, { maxLines = 14 } = {}) {
  const stopRe =
    /^(tax\s*invoice|taxinvoice|invoice|receipt|abn\b|gst\b|total\b|subtotal|amount\s*due|change\b|eftpos|visa|mastercard|debit|credit|thank\s*you|terminal|merchant\s*copy|customer\s*copy|docket|approved|phone|tel|fax|www\.|http)/i;
  const addressRe =
    /^\d+[A-Za-z]?\s+\S+.*\b(rd|road|st|street|ave|avenue|hwy|highway|dr|drive|cres|crescent|parade|pde|blvd|boulevard|qld|nsw|vic|sa|wa|tas|nt|act)\b/i;

  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  let firstLegal = null;
  for (const line of lines) {
    if (stopRe.test(line)) continue;
    if (addressRe.test(line)) continue;
    if (/^[\d\s$.*-]+$/.test(line)) continue;
    if (looksLikeJunkVendor(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    if (looksLikeLegalEntityName(line)) {
      if (!firstLegal) firstLegal = formatSiteToken(line);
      continue;
    }
    return formatSiteToken(line);
  }
  return firstLegal;
}

/** Words that must not be treated as a site/suburb after a chain name. */
const SITE_NAME_REJECT_RE =
  /\b(rewards?|fleet|card|truck\s*stop|servo|connect|outlet|service|express|pty|ltd|limited|australia|group|retail|holdings?|tax|invoice|receipt|abn|tel|phone|gst|total|debit|credit|eftpos|approved|nab|visa|master|petroleum|select|fresh|food|people|the|foodary|feedback|www|http|duplicate|pos|trn|trans)\b/i;

/**
 * Alternate spellings used on thermal dockets for multi-word chain brands
 * (e.g. "United Crestmead" for United Petroleum).
 */
function brandMatchVariants(canonicalName) {
  const brand = String(canonicalName || "").trim();
  if (!brand) return [];
  const variants = [brand];
  const parts = brand.split(/\s+/).filter(Boolean);
  if (
    parts.length >= 2 &&
    /^(petroleum|energy|oil|australia|group|holdings?|limited|ltd)$/i.test(parts[parts.length - 1])
  ) {
    variants.push(parts.slice(0, -1).join(" "));
  }
  if (/^7-Eleven$/i.test(brand)) {
    variants.push("7 Eleven", "7Eleven", "7-ELEVEN");
  }
  if (/^BP$/i.test(brand)) variants.push("BP");
  return [...new Set(variants.filter(Boolean))];
}

function formatBrandOut(matched, canonicalName) {
  const m = String(matched || "").trim();
  const canon = String(canonicalName || "").trim();
  if (/^bp$/i.test(m) || /^bp$/i.test(canon)) return "BP";
  if (/^7[\s-]*eleven$/i.test(m) || /^7-Eleven$/i.test(canon)) return "7-Eleven";
  // Prefer short trading brand when site line used "United" not "United Petroleum".
  if (canon && m.length < canon.length && vendorsMatch(m, canon.split(/\s+/)[0])) {
    return formatSiteToken(m);
  }
  if (/^[A-Z0-9\s'&-]+$/.test(m) && !/[a-z]/.test(m)) return formatSiteToken(m);
  return m || canon;
}

/**
 * Prefer "BP Archerfield" / "United Crestmead" / "7-Eleven Store 2145" over a
 * bare chain name when the site appears in the vendor field or receipt header.
 */
function preferCanonicalSiteName(canonicalName, vendor, text) {
  const brand = String(canonicalName || "").trim();
  if (!brand) return null;
  const variants = brandMatchVariants(brand);
  const entry =
    CANONICAL_VENDORS.find((e) => e.name === brand) || matchCanonicalVendorInText(brand);
  const candidates = [String(vendor || ""), String(text || "")]
    .join("\n")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 24);

  for (const variant of variants) {
    const brandRe = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]*");
    const storeRe = new RegExp(
      `\\b(${brandRe})\\s+(?:store|stn|station)\\s*[#:]?\\s*(\\d{2,5})\\b`,
      "i"
    );
    const siteRe = new RegExp(
      `\\b(${brandRe})\\s+([A-Za-z][A-Za-z'&-]*(?:\\s+[A-Za-z][A-Za-z'&-]*){0,2})\\b`,
      "i"
    );

    for (const line of candidates) {
      const storeHit = line.match(storeRe);
      if (storeHit) {
        const brandOut = formatBrandOut(storeHit[1], brand);
        return `${brandOut} Store ${storeHit[2]}`.replace(/\s+/g, " ").trim();
      }
      const m = line.match(siteRe);
      if (!m) continue;
      const site = String(m[2] || "").trim();
      if (!site || SITE_NAME_REJECT_RE.test(site)) continue;
      if (/^\d+$/.test(site)) continue;
      if (site.length < 3 || site.length > 40) continue;
      if (looksLikeJunkVendor(site) || looksLikeOcrShredVendor(site)) continue;
      // Skip "United Petroleum" matching itself as brand+site.
      if (vendorsMatch(`${m[1]} ${site}`, brand)) continue;
      const brandOut = formatBrandOut(m[1], brand);
      return `${brandOut} ${formatSiteToken(site)}`.replace(/\s+/g, " ").trim();
    }
  }

  // OCR brand spellings (7 EIEVEN STORE 2145): use chain patterns, then site/store.
  if (entry && entry.patterns && entry.patterns.length) {
    for (const line of candidates) {
      const hitsPattern = entry.patterns.some((re) => {
        try {
          return re.test(line);
        } catch {
          return false;
        }
      });
      if (!hitsPattern) continue;
      const storeM = line.match(/\b(?:store|stn|station)\s*[#:]?\s*(\d{2,5})\b/i);
      if (storeM) {
        return `${brand} Store ${storeM[1]}`.replace(/\s+/g, " ").trim();
      }
      // Strip a matched brand-ish prefix and take following suburb words.
      const brandEsc = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const stripped = line
        .replace(/^[lI|1]?[\s-]*e+l+[aeiou]*v+[aeiou]*n\b/i, "")
        .replace(/^7[\s-]*(?:eie[vw]en|eleven|11)\b/i, "")
        .replace(/^seven[\s-]*e+l+[aeiou]*v+[aeiou]*n\b/i, "")
        .replace(new RegExp(`^${brandEsc}\\b`, "i"), "")
        .trim();
      const siteM = stripped.match(
        /^([A-Za-z][A-Za-z'&-]*(?:\s+[A-Za-z][A-Za-z'&-]*){0,2})\b/
      );
      if (siteM) {
        const site = siteM[1].trim();
        if (
          site &&
          !SITE_NAME_REJECT_RE.test(site) &&
          site.length >= 3 &&
          site.length <= 40 &&
          !/^\d+$/.test(site) &&
          !looksLikeJunkVendor(site) &&
          !looksLikeOcrShredVendor(`${brand} ${site}`)
        ) {
          return `${brand} ${formatSiteToken(site)}`.replace(/\s+/g, " ").trim();
        }
      }
    }
  }
  return null;
}

/**
 * True when remembered ABN name (often a Pty Ltd legal entity) should not
 * overwrite a chain/site or trading name resolved from this receipt.
 */
function memoryConflictsWithCanonical(memoryName, canonicalDisplayName) {
  const mem = String(memoryName || "").trim();
  const display = String(canonicalDisplayName || "").trim();
  if (!mem || !display) return false;
  // Exact normalised match only — vendorsMatch is too loose across sites
  // (e.g. "Shell Australia Pty Ltd" ≈ "Shell Springfield Lakes").
  if (normalizeVendor(mem) === normalizeVendor(display)) return false;

  // Legal-entity memory vs trading/site name on the docket.
  if (looksLikeLegalEntityName(mem) && !looksLikeLegalEntityName(display)) {
    return true;
  }

  if (vendorsMatch(mem, display)) return false;

  const chainEntry =
    matchCanonicalVendorInText(display) ||
    matchCanonicalVendorInText(display.split(/\s+/)[0] || "");
  const chainName = chainEntry ? chainEntry.name : display.split(/\s+/)[0];
  if (!chainName) return false;
  if (normalizeVendor(mem) === normalizeVendor(chainName)) return false;
  const chainRe = new RegExp(
    `\\b${String(chainName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i"
  );
  // Memory already includes this chain as a trading/site name — OK.
  if (chainRe.test(mem) && !looksLikeLegalEntityName(mem)) return false;
  if (chainRe.test(mem) && looksLikeLegalEntityName(mem)) return true;
  return true;
}

/** Match a known chain against a single string (vendor field or raw OCR text). */
function matchCanonicalVendorInText(text) {
  const src = String(text || "");
  if (!src.trim()) return null;
  for (const entry of CANONICAL_VENDORS) {
    for (const re of entry.patterns || []) {
      if (re.test(src)) return entry;
    }
  }
  return null;
}

function matchCanonicalVendorByAbn(abn) {
  const digits = normaliseAbn(abn);
  if (digits.length !== 11) return null;
  return (
    CANONICAL_VENDORS.find((entry) =>
      (entry.abns || []).some((a) => normaliseAbn(a) === digits)
    ) || null
  );
}

/**
 * Resolve a clean chain name from OCR vendor + receipt text.
 * Prefers ABN, then a brand already in the vendor field, then a brand found
 * in the receipt header/body when the vendor field is junk or mismatched.
 */
function matchCanonicalVendorByCompactText(text) {
  const compact = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!compact || compact.length < 4) return null;
  const needles = [
    { name: "Woolworths", keys: ["woolworth", "woolies", "freshfoodpeople", "everydayrewards"] },
    { name: "Ampol", keys: ["ampol", "foodary", "ampolfeedback", "ampolretail"] },
    { name: "BP", keys: ["bprewards", "rampageretail", "bparcherfield", "bpconnect"] },
    { name: "Shell", keys: ["shellselect", "shelltruck", "colesexpress"] },
    { name: "Coles", keys: ["colessupermarket", "colesgroup"] },
    { name: "7-Eleven", keys: ["7eleven", "seveneleven"] },
    { name: "United Petroleum", keys: ["unitedpetroleum", "unitedservo"] },
    { name: "ALDI", keys: ["aldi"] },
    { name: "Bunnings", keys: ["bunnings"] },
    { name: "McDonald's", keys: ["mcdonald", "maccas"] },
  ];
  for (const row of needles) {
    if (row.keys.some((k) => compact.includes(k))) {
      return CANONICAL_VENDORS.find((e) => e.name === row.name) || null;
    }
  }
  return null;
}

function resolveCanonicalVendor({ vendor, text, abn } = {}) {
  const byAbn = matchCanonicalVendorByAbn(abn);
  if (byAbn) {
    const site =
      preferCanonicalSiteName(byAbn.name, vendor, text) ||
      preferCanonicalSiteName(byAbn.name, "", text);
    return { ...byAbn, name: site || byAbn.name, source: site ? "abn_site" : "abn" };
  }

  const vendorStr = String(vendor || "").trim();
  const fromVendor = matchCanonicalVendorInText(vendorStr);
  if (fromVendor) {
    const site =
      preferCanonicalSiteName(fromVendor.name, vendorStr, text) ||
      preferCanonicalSiteName(fromVendor.name, vendorStr, "");
    return {
      ...fromVendor,
      name: site || fromVendor.name,
      source: site ? "vendor_field_site" : "vendor_field",
    };
  }

  // Only override from receipt text when the vendor field is empty/junk/legal —
  // never replace a plausible independent trading name with a brand mentioned
  // later on the docket (e.g. a BP card line on another servo's receipt).
  // Pty Ltd legal names are weak: prefer the trading/site line in the header.
  if (!looksLikeJunkVendor(vendorStr) && !looksLikeLegalEntityName(vendorStr)) return null;

  const raw = String(text || "");
  const header = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 24)
    .join("\n");
  const fromHeader =
    matchCanonicalVendorInText(header) ||
    matchCanonicalVendorInText(raw) ||
    matchCanonicalVendorByCompactText(header) ||
    matchCanonicalVendorByCompactText(raw);
  if (!fromHeader) return null;
  const site = preferCanonicalSiteName(fromHeader.name, vendorStr, header || raw);
  return {
    ...fromHeader,
    name: site || fromHeader.name,
    source: site ? "raw_text_site" : "raw_text",
  };
}

/**
 * Find a remembered vendor by ABN (preferred) or fuzzy business name.
 */
function findKnownVendor(vendors, { vendorAbn, vendor, entity } = {}) {
  const list = vendors || [];
  const abn = normaliseAbn(vendorAbn);
  if (abn && abn.length === 11) {
    const byAbn = list.find((v) => normaliseAbn(v.abn) === abn);
    if (byAbn) return { vendor: byAbn, source: "abn" };
  }
  const name = String(vendor || entity || "").trim();
  if (!name || !normalizeVendor(name)) return null;
  const byName = list.find((v) => vendorsMatch(v.name, name));
  if (byName) return { vendor: byName, source: "name" };
  return null;
}

/** Keyword heuristics on receipt/vendor text → category id. */
function suggestCategoryFromText(text, vendorName = "") {
  const blob = `${vendorName || ""}\n${text || ""}`;
  for (const rule of CATEGORY_HEURISTICS) {
    if (rule.re.test(blob)) {
      const safe = menuSafeCategory(rule.id);
      if (safe) return safe;
    }
  }
  return null;
}

/** Count regex hits in text (global flag required for iterative match). */
function countMatches(re, text) {
  const src = String(text || "");
  if (!src) return 0;
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const globalRe = new RegExp(re.source, flags);
  const hits = src.match(globalRe);
  return hits ? hits.length : 0;
}

function isDualPurposeVendor(name, text = "") {
  const blob = `${name || ""}\n${text || ""}`;
  return DUAL_PURPOSE_VENDOR_RE.test(blob);
}

/**
 * Score fuel vs food line items. Used for convenience / servo chains where
 * the same brand sells diesel and coffee.
 * @returns {{ fuel: number, food: number }}
 */
function scoreFuelVsFoodContent(text) {
  const src = String(text || "");
  return {
    fuel: countMatches(FUEL_CONTENT_RE, src),
    food: countMatches(FOOD_CONTENT_RE, src),
  };
}

/**
 * Category for dual-purpose vendors (7-Eleven, BP, Shell, …) from receipt
 * content. Prefer fuel when pump/diesel lines dominate; meals/food when coffee
 * and snacks dominate; default to meals for a bare convenience-store docket
 * (typical driver snack stop) instead of other_work.
 *
 * Fuel is returned even though it is hidden from the general expense menu —
 * Car Expenses/Claims and confirm payloads still use the id.
 */
function suggestCategoryFromVendorContent({ name, text } = {}) {
  const vendor = String(name || "").trim();
  const raw = String(text || "");
  if (!isDualPurposeVendor(vendor, raw)) return null;

  const scores = scoreFuelVsFoodContent(`${vendor}\n${raw}`);
  if (scores.fuel > 0 && scores.fuel >= scores.food) {
    return "fuel";
  }
  if (scores.food > 0) {
    // Packed snacks / milk / bread → groceries; coffee/hot food/meals → meals.
    if (
      /\b(milk\b|bread|banana|fruit|grocery|groceries|yoghurt|yogurt|chips|crisps|chocolate|loll(?:y|ies)|biscuit|cookie)\b/i.test(
        raw
      ) &&
      !/\b(coffee|cappuccino|latte|meal|burger|sandwich|hot\s*food|breakfast|lunch|dinner)\b/i.test(raw)
    ) {
      return menuSafeCategory("groceries_travel") || "groceries_travel";
    }
    return menuSafeCategory("meals") || "meals";
  }
  // Known convenience / servo brand but no clear lines — prefer food over other_work.
  if (
    /\b(7[\s-]*(?:eleven|11)|seven[\s-]*eleven|night[\s-]*owl|coles\s*express|friendly\s*grocer|convenience\s*store|corner\s*store|milk\s*bar)\b/i.test(
      `${vendor}\n${raw}`
    )
  ) {
    return menuSafeCategory("meals") || "meals";
  }
  // Pure servo brands with no line detail — leave null so fuel heuristics / memory can win.
  return null;
}

function looksLikeOcrShredVendor(name) {
  const s = String(name || "").trim();
  if (!s) return true;
  if (matchCanonicalVendorInText(s) || matchCanonicalVendorByCompactText(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  // ALL-CAPS or Title-Case multi-token thermal shreds ("SAREE GS ARAN", "Saree Gs Aran")
  if (words.length >= 2 && words.some((w) => w.replace(/[^A-Za-z]/g, "").length <= 2)) {
    if (!/^(bp|iga|otr|kfc|gyg|eg)\b/i.test(words[0])) return true;
  }
  if (/^[A-Z0-9\s'&.-]{5,}$/.test(s) && !/[a-z]/.test(s)) {
    if (words.length >= 3 && words.every((w) => w.length <= 6)) return true;
  }
  return false;
}

/**
 * Final gate: if we still do not have a human-readable vendor, clear OCR junk
 * and ask the driver to type the shop name on approve.
 */
function finalizeVendorGate(ocrResult) {
  if (!ocrResult || typeof ocrResult !== "object") return ocrResult;
  const finalVendor = String(ocrResult.vendor || ocrResult.entity || "").trim();
  const junk = !finalVendor || looksLikeJunkVendor(finalVendor) || looksLikeOcrShredVendor(finalVendor);
  if (junk) {
    if (finalVendor && (looksLikeJunkVendor(finalVendor) || looksLikeOcrShredVendor(finalVendor))) {
      ocrResult.vendor = "";
      if (ocrResult.entity && (looksLikeJunkVendor(ocrResult.entity) || looksLikeOcrShredVendor(ocrResult.entity))) {
        ocrResult.entity = "";
      }
    }
    ocrResult.vendorNeedsInput = true;
    ocrResult.vendorUnidentifiedMessage =
      "Vendor name cannot be identified — can you add the name of the vendor/shop this receipt is from?";
  } else {
    ocrResult.vendorNeedsInput = false;
  }
  return ocrResult;
}

/**
 * Enrich OCR with remembered ABN ↔ business name and a category suggestion.
 * Mutates and returns ocrResult.
 */
function enrichOcrFromVendors(ocrResult, vendors, purpose = "expense") {
  if (!ocrResult || typeof ocrResult !== "object") return ocrResult;
  if (purpose === "income") {
    // Still fill ABN/entity from memory when possible; skip expense categories.
    const raw = ocrResult.rawText || ocrResult.rawTextPreview || "";
    if (!ocrResult.vendorAbn) {
      const fromText = extractAbnFromText(raw);
      if (fromText) ocrResult.vendorAbn = fromText;
    }
    const known = findKnownVendor(vendors, {
      vendorAbn: ocrResult.vendorAbn,
      vendor: ocrResult.vendor || ocrResult.entity || ocrResult.payer,
      entity: ocrResult.entity || ocrResult.payer,
    });
    if (known) {
      if (known.source === "abn" && known.vendor.name) {
        ocrResult.vendor = known.vendor.name;
        ocrResult.entity = ocrResult.entity || known.vendor.name;
        ocrResult.payer = ocrResult.payer || known.vendor.name;
      }
      if (!ocrResult.vendorAbn && known.vendor.abn) {
        ocrResult.vendorAbn = formatAbn(known.vendor.abn);
      }
      ocrResult.vendorId = known.vendor.id;
      ocrResult.vendorMatch = { id: known.vendor.id, source: known.source, name: known.vendor.name };
    }
    return finalizeVendorGate(ocrResult);
  }

  const raw = ocrResult.rawText || ocrResult.rawTextPreview || "";
  if (!ocrResult.vendorAbn) {
    const fromText = extractAbnFromText(raw);
    if (fromText) ocrResult.vendorAbn = fromText;
  }

  // Prefer a clean chain/site name over OCR first-line junk ("XqR7", "TAX INVOICE").
  const canonical = resolveCanonicalVendor({
    vendor: ocrResult.vendor || ocrResult.entity,
    text: raw,
    abn: ocrResult.vendorAbn,
  });
  if (canonical) {
    if (String(ocrResult.vendor || "").trim() !== canonical.name) {
      ocrResult.vendor = canonical.name;
    }
    ocrResult.vendorCanonical = {
      name: canonical.name,
      source: canonical.source,
    };
    if (!ocrResult.vendorAbn && canonical.abns && canonical.abns[0]) {
      ocrResult.vendorAbn = formatAbn(canonical.abns[0]);
    }
  }

  // All receipts: utilise the printed business / site name from the header
  // when OCR or ABN pairing left a junk or Pty Ltd legal name.
  const receiptBiz = extractReceiptBusinessName(raw);
  if (receiptBiz) {
    ocrResult.receiptBusinessName = receiptBiz;
    const prev = String(ocrResult.vendor || "").trim();
    const canonicalName = (canonical && canonical.name) || "";
    if (
      !prev ||
      looksLikeJunkVendor(prev) ||
      looksLikeLegalEntityName(prev) ||
      (canonicalName &&
        looksLikeLegalEntityName(prev) &&
        !vendorsMatch(prev, canonicalName))
    ) {
      if (canonicalName && !looksLikeLegalEntityName(canonicalName)) {
        // Keep resolved chain+site when we have it.
        ocrResult.vendor = canonicalName;
      } else if (!canonicalName || looksLikeLegalEntityName(canonicalName)) {
        // Only accept header trading names that look like real shops — not
        // random OCR prose lines ("random thermal shreds").
        const headerLooksReal =
          receiptBiz &&
          !looksLikeJunkVendor(receiptBiz) &&
          (matchCanonicalVendorInText(receiptBiz) ||
            matchCanonicalVendorByCompactText(receiptBiz) ||
            /\b(pty\.?\s*ltd\.?|store|servo|cafe|roadhouse|truck|petroleum|foodary)\b/i.test(
              receiptBiz
            ) ||
            (/^[A-Z0-9][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){0,3}$/.test(receiptBiz) &&
              receiptBiz.split(/\s+/).length <= 4 &&
              !/^(random|welcome|customer|please|retain|thank|original|duplicate)\b/i.test(
                receiptBiz
              )));
        if (headerLooksReal) ocrResult.vendor = receiptBiz;
      }
    } else if (
      canonicalName &&
      memoryConflictsWithCanonical(prev, canonicalName) &&
      !looksLikeLegalEntityName(canonicalName)
    ) {
      ocrResult.vendor = canonicalName;
    }
  }

  const known = findKnownVendor(vendors, {
    vendorAbn: ocrResult.vendorAbn,
    vendor: ocrResult.vendor || ocrResult.entity || (canonical && canonical.name),
    entity: ocrResult.entity,
  });

  if (known) {
    // ABN is the key reference for category/memory — but never let a conflicting
    // remembered Pty Ltd / unrelated name overwrite the receipt trading/site name
    // (e.g. remembered "Rampage Retail Pty Ltd" vs OCR "BP Archerfield").
    if (known.vendor.name) {
      const prev = String(ocrResult.vendor || "").trim();
      const canonicalName =
        (ocrResult.vendorCanonical && ocrResult.vendorCanonical.name) ||
        (canonical && canonical.name) ||
        "";
      const displayName = canonicalName || receiptBiz || prev;
      const skipMemoryName =
        known.source === "abn" &&
        displayName &&
        memoryConflictsWithCanonical(known.vendor.name, displayName);
      if (
        !skipMemoryName &&
        (known.source === "abn" ||
          !prev ||
          looksLikeJunkVendor(prev) ||
          vendorsMatch(prev, known.vendor.name))
      ) {
        ocrResult.vendor = known.vendor.name;
        if (!ocrResult.entity) ocrResult.entity = known.vendor.name;
      }
    }
    if (!ocrResult.vendorAbn && known.vendor.abn) {
      ocrResult.vendorAbn = formatAbn(known.vendor.abn);
    } else if (known.vendor.abn && normaliseAbn(ocrResult.vendorAbn) !== normaliseAbn(known.vendor.abn)) {
      // Name matched a known vendor — prefer the stored ABN when OCR ABN missing/invalid.
      if (!isValidAbn(ocrResult.vendorAbn) && isValidAbn(known.vendor.abn)) {
        ocrResult.vendorAbn = formatAbn(known.vendor.abn);
      }
    }
    ocrResult.vendorId = known.vendor.id;
    ocrResult.vendorMatch = {
      id: known.vendor.id,
      source: known.source,
      name: known.vendor.name,
      defaultCategory: known.vendor.defaultCategory || null,
    };
  }

  const businessName = ocrResult.vendor || ocrResult.entity || (known && known.vendor.name) || "";
  const businessAbn = ocrResult.vendorAbn || (known && known.vendor.abn) || "";

  // Dual-purpose stores (7-Eleven, BP, …): pick fuel vs food from line items
  // before a fixed business-type or weak OCR other_work wins.
  const fromVendorContent = suggestCategoryFromVendorContent({
    name: businessName,
    text: raw,
  });
  if (fromVendorContent) {
    ocrResult.suggestedCategory = fromVendorContent;
    ocrResult.categorySource = "vendor_content";
    if (
      known &&
      known.vendor &&
      fromVendorContent !== "fuel" &&
      menuSafeCategory(known.vendor.defaultCategory) !== fromVendorContent
    ) {
      // Remember food default for this convenience store; leave fuel to content.
      known.vendor.defaultCategory = fromVendorContent;
    }
    return finalizeVendorGate(ocrResult);
  }

  const businessType = inferBusinessTypeCategory({
    name: businessName,
    abn: businessAbn,
    text: raw,
  });

  // Business type (Woolworths → groceries, etc.) always wins once ABN/name
  // establish the retailer — including over OCR other_work and bad memory.
  // Skip dual-purpose vendors here (they need line-item content, handled above).
  if (businessType && !isDualPurposeVendor(businessName, raw)) {
    ocrResult.suggestedCategory = businessType;
    ocrResult.categorySource = "business_type";
    // Heal remembered defaults that contradict the known business type.
    if (known && known.vendor && known.vendor.defaultCategory !== businessType) {
      known.vendor.defaultCategory = businessType;
    }
    return finalizeVendorGate(ocrResult);
  }

  // Category: remembered vendor default → text heuristics → keep OCR if already strong.
  const remembered = known && menuSafeCategory(known.vendor.defaultCategory);
  const fromText = suggestCategoryFromText(raw, ocrResult.vendor || ocrResult.entity || "");
  // Allow fuel from local OCR when the receipt clearly looks like a fuel docket.
  const rawOcrCat = normalizeExpenseCategoryId(ocrResult.suggestedCategory || "");
  const fromOcr =
    menuSafeCategory(ocrResult.suggestedCategory) ||
    (rawOcrCat === "fuel" && scoreFuelVsFoodContent(raw).fuel > 0 ? "fuel" : null);

  if (remembered && (isWeakCategory(ocrResult.suggestedCategory) || remembered === fromOcr)) {
    ocrResult.suggestedCategory = remembered;
    ocrResult.categorySource = "vendor_memory";
  } else if (fromText && isWeakCategory(ocrResult.suggestedCategory)) {
    ocrResult.suggestedCategory = fromText;
    ocrResult.categorySource = "text_heuristic";
  } else if (fromOcr) {
    ocrResult.suggestedCategory = fromOcr;
    ocrResult.categorySource = ocrResult.categorySource || "ocr";
  } else if (fromText) {
    ocrResult.suggestedCategory = fromText;
    ocrResult.categorySource = "text_heuristic";
  } else if (remembered) {
    ocrResult.suggestedCategory = remembered;
    ocrResult.categorySource = "vendor_memory";
  } else {
    ocrResult.suggestedCategory = normalizeExpenseCategoryId(ocrResult.suggestedCategory || "other_work");
  }

  ocrResult.suggestedCategory = normalizeExpenseCategoryId(ocrResult.suggestedCategory);

  return finalizeVendorGate(ocrResult);
}

/**
 * Persist ABN + business name + default category after the driver confirms a save.
 * Extends storage.upsertVendor objects with defaultCategory (no storage.js edit).
 * Known business types override weak categories so groceries stay groceries.
 */
function rememberVendor(records, { name, abn, category } = {}) {
  const vendorName = String(name || "").trim();
  if (!vendorName && !normaliseAbn(abn)) return null;

  const vendor = storage.upsertVendor(records, {
    name: vendorName || formatAbn(abn) || "Unknown vendor",
    abn,
  });
  if (!vendor) return null;

  const businessType = inferBusinessTypeCategory({
    name: vendor.name || vendorName,
    abn: vendor.abn || abn,
  });
  const fromContent = suggestCategoryFromVendorContent({
    name: vendor.name || vendorName,
    text: "",
  });
  const safe = menuSafeCategory(category);
  // Prefer content-aware food default for convenience stores; never lock fuel
  // as the only remembered default (next scan may be coffee).
  if (fromContent && fromContent !== "fuel") {
    vendor.defaultCategory = fromContent;
  } else if (businessType && !isDualPurposeVendor(vendor.name || vendorName)) {
    vendor.defaultCategory = businessType;
  } else if (safe && safe !== "fuel") {
    vendor.defaultCategory = safe;
  }
  vendor.lastUsed = new Date().toISOString();
  return vendor;
}

module.exports = {
  normaliseAbn,
  formatAbn,
  isValidAbn,
  extractAbnFromText,
  findKnownVendor,
  suggestCategoryFromText,
  suggestCategoryFromVendorContent,
  scoreFuelVsFoodContent,
  isDualPurposeVendor,
  inferBusinessTypeCategory,
  enrichOcrFromVendors,
  rememberVendor,
  isWeakCategory,
  menuSafeCategory,
  finalizeVendorGate,
  looksLikeJunkVendor,
  looksLikeLegalEntityName,
  extractReceiptBusinessName,
  resolveCanonicalVendor,
  matchCanonicalVendorInText,
  matchCanonicalVendorByCompactText,
  preferCanonicalSiteName,
  memoryConflictsWithCanonical,
  KNOWN_BUSINESS_TYPES,
  CANONICAL_VENDORS,
};
