/**
 * Taxation companion answers grounded in the ATO tables this app already ships.
 *
 * Retrieval only — no free-form model. If nothing in the published rates /
 * category notes matches, the caller gets a support-email handoff instead of
 * invented advice.
 */
const {
  getCurrentFinancialYear,
  SUBSTANTIATION,
  LAUNDRY_RATES,
  MEDICARE_LEVY_RATE,
  listCategories,
} = require("./ato-standards");
const {
  travelRatesForYear,
  centsPerKmForYear,
  sgRateForYear,
  bracketsForYear,
} = require("./historical-rates");
const { listMenuIncomeTypes } = require("./income-menu");
const { listSpecialClaimCategories } = require("./expense-menu");
const { supportInbox } = require("./support");
const suiteTravel = require("./suite/travel");

const MAX_MESSAGE = 500;
const MIN_SCORE = 3;
const DISCLAIMER =
  "This is not tax, financial or legal advice. Figures are the ATO-table amounts loaded in this app for the selected financial year — check your own circumstances with an accredited adviser.";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "what",
  "whats",
  "which",
  "how",
  "can",
  "could",
  "should",
  "would",
  "i",
  "im",
  "my",
  "me",
  "we",
  "you",
  "your",
  "do",
  "does",
  "did",
  "for",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "at",
  "with",
  "about",
  "please",
  "tell",
  "need",
  "want",
  "know",
  "help",
]);

const OUT_OF_SCOPE =
  /\b(crypto|bitcoin|nft|shares?\b|asx|capital gains?|\bcgt\b|rental property|investment property|smsf|self[- ]managed super|divorce|visa|citizenship|child support|centrelink|jobseeker|hecs[- ]?help debt repayment formula)\b/i;

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "$0.00";
  return `$${x.toFixed(2)}`;
}

function pct(n) {
  return `${(Number(n) * 100).toFixed(Number.isInteger(Number(n) * 100) ? 0 : 1)}%`;
}

function article(id, title, tags, body, extra = {}) {
  return { id, title, tags, body: String(body).trim(), ...extra };
}

function haulageMealArticle(fy, rates) {
  const m = rates.truckDriverMeals;
  const daily = rates.truckDriverMealsDailyTotal;
  return article(
    "meals-lafha",
    "Truck driver meals / Living Away from Home (LAFHA)",
    [
      "meal",
      "meals",
      "food",
      "breakfast",
      "lunch",
      "dinner",
      "lafha",
      "living away",
      "away from home",
      "travel allowance",
      "reasonable amount",
      "table 5",
      "truck driver",
    ],
    [
      `For employee truck drivers in ${rates.incomeYear}, ${rates.determination} Table 5 sets reasonable meal amounts when you are living away from home for work:`,
      `Breakfast ${money(m.breakfast.cap)}, lunch ${money(m.lunch.cap)}, dinner ${money(m.dinner.cap)} — ${money(daily)} a day in total.`,
      `This app uses that daily meal stack as the LAFHA / travel-allowance reference rate. It is not a private home grocery claim. Keep written evidence (receipts) when you claim actual costs, and stay within the published reasonable amounts if you are using the exception.`,
      `Overtime meal (separate from overnight travel) is ${money(rates.overtimeMealCap)} under the same determination.`,
    ].join("\n\n"),
    { determination: rates.determination, financialYear: fy }
  );
}

function suiteTravelArticle(fy) {
  const set = suiteTravel.workTravelSetForYear(fy);
  const band1 = set.bands.band1;
  const lafha = suiteTravel.lafhaWeeklyForYear(fy);
  return article(
    "work-travel-tables",
    "Ordinary-employee work travel (Tables 1–3)",
    [
      "meal",
      "meals",
      "food",
      "travel",
      "allowance",
      "overnight",
      "hotel",
      "accommodation",
      "incidentals",
      "tables 1",
      "lafha",
      "living away",
    ],
    [
      `Go Taxation Suite uses ${set.determination} Tables 1–3 for ordinary employees (Melbourne as the representative capital). These tables do not apply to employee truck drivers (Table 5) — that product is Driver Hub / Taxation Hub.`,
      `Band 1 (salary ${set.salaryBands[0].label}) daily stack: accommodation ${money(band1.accommodation)}, breakfast ${money(band1.breakfast)}, lunch ${money(band1.lunch)}, dinner ${money(band1.dinner)}, incidentals ${money(band1.incidentals)} — ${money(band1.dailyTotal)} total. Higher salary bands raise those amounts.`,
      `Living-away-from-home for sales, marketing and similar occupations uses the FBT weekly food component (${lafha.determination}: ${money(lafha.oneAdult)} per week for one adult), not the truck-driver daily meal stack.`,
      `Overtime meal is a separate exception: ${money(set.overtimeMealCap)}.`,
    ].join("\n\n"),
    { determination: set.determination, financialYear: fy }
  );
}

function travelCapsArticle(fy, rates) {
  const b1 = rates.domesticTravelDaily.band1;
  const stack = b1.accommodation + b1.breakfast + b1.lunch + b1.dinner + b1.incidentals;
  return article(
    "travel-allowance-caps",
    "Travel allowance daily caps (salary bands)",
    [
      "travel",
      "allowance",
      "accommodation",
      "incidentals",
      "motel",
      "hotel",
      "cap",
      "caps",
      "band",
      "salary band",
      "overnight",
    ],
    [
      `${rates.determination} also publishes domestic travel reasonable amounts by salary band (this app uses a single representative country-centre stack, not city tables).`,
      `Band 1 (${rates.salaryBands[0].label}) daily: accommodation ${money(b1.accommodation)} + meals (breakfast ${money(b1.breakfast)}, lunch ${money(b1.lunch)}, dinner ${money(b1.dinner)}) + incidentals ${money(b1.incidentals)} = ${money(stack)}.`,
      `Band 2 and band 3 raise accommodation, meals and incidentals. The Dashboard Allowance caps card tracks your claimed meals / overtime meal / accommodation / incidentals against these published rates for the day, week or month (AEST).`,
    ].join("\n\n"),
    { determination: rates.determination, financialYear: fy }
  );
}

function carArticle(fy) {
  const rate = centsPerKmForYear(fy);
  const max = 5000;
  const claims = listSpecialClaimCategories()
    .map((c) => c.label)
    .join("; ");
  return article(
    "car-expenses",
    "Car expenses (ATO D1 — cents per km or logbook)",
    [
      "car",
      "vehicle",
      "cents",
      "kilometre",
      "kilometres",
      "km",
      "logbook",
      "d1",
      "fuel",
      "rego",
      "tyres",
      "parking",
      "tolls",
    ],
    [
      `Work-related car claims (ATO D1) are either cents per kilometre or the logbook method — not both for the same car in the same year.`,
      `Cents per km for ${fy}: ${money(rate)} per work kilometre, capped at ${max.toLocaleString("en-AU")} km (maximum ${money(rate * max)}). You need a record of work trips (start, end, purpose). This method is for cars, not the heavy truck.`,
      `Logbook: keep a 12-week diary of destinations, then claim actual running costs × business-use %. Car Expenses in this app covers: ${claims}. Parking and tolls can be claimed with written evidence even when you use cents per km.`,
    ].join("\n\n"),
    { financialYear: fy }
  );
}

function substantiationArticle() {
  return article(
    "receipts-substantiation",
    "Receipts and substantiation",
    [
      "receipt",
      "receipts",
      "substantiation",
      "written evidence",
      "proof",
      "threshold",
      "300",
      "no receipt",
      "laundry",
    ],
    [
      `ATO written-evidence rules this app follows: keep receipts (or other written evidence) for work expenses once total work-related expenses go over ${money(SUBSTANTIATION.totalWorkExpensesReceiptThreshold)}.`,
      `Laundry claimed on a reasonable basis without receipts is limited to ${money(LAUNDRY_RATES.noReceiptThreshold)} (${money(LAUNDRY_RATES.workOnlyLoad)} per work-only load, ${money(LAUNDRY_RATES.mixedLoad)} per mixed load).`,
      `Scan or photograph receipts in Expenses (or Car Expenses for vehicle claims). Approve the overall total before the ledger row is created. If a scan cannot read a total, enter it from the docket — the photo still sits in your gallery.`,
    ].join("\n\n")
  );
}

function incomeArticle() {
  const types = listMenuIncomeTypes()
    .map((t) => `${t.label}${t.notes ? ` — ${t.notes}` : ""}`)
    .join("\n");
  return article(
    "income-payslips",
    "Income, payslips and allowances",
    [
      "income",
      "payslip",
      "pay slip",
      "wage",
      "wages",
      "salary",
      "remittance",
      "gross",
      "net",
      "payg",
      "allowance",
      "reimbursement",
    ],
    [
      `Record assessable earnings on Income: salary and wages, owner-driver remittances (gross before expenses), and allowances that belong on the income statement.`,
      `Travel / LAFHA paid on a payslip is recorded as Living Away from Home / Travel allowance. A reimbursement of an expense you already incurred is usually not income and you cannot claim that expense again.`,
      `Income types in this app:\n${types}`,
    ].join("\n\n")
  );
}

function expenseCategoriesArticle() {
  const groups = {};
  for (const cat of listCategories()) {
    const g = cat.group || "Other";
    if (!groups[g]) groups[g] = [];
    groups[g].push(`${cat.label}${cat.notes ? ` (${cat.notes})` : ""}`);
  }
  const body = Object.entries(groups)
    .map(([g, rows]) => `${g}:\n- ${rows.slice(0, 8).join("\n- ")}`)
    .join("\n\n");
  return article(
    "work-expenses",
    "Work expense categories",
    [
      "expense",
      "expenses",
      "claim",
      "deduct",
      "deduction",
      "tools",
      "clothing",
      "uniform",
      "laundry",
      "training",
      "phone",
      "accommodation",
      "groceries",
    ],
    [
      `Work expenses must be work-related, you must have spent the money yourself, and you must have a record. Home-to-work travel is usually private. Vehicle and fuel for the work car belong under Car Expenses, not general Expenses.`,
      `Categories this app maps to ATO-style schedules:\n\n${body}`,
    ].join("\n\n")
  );
}

function taxBracketsArticle(fy) {
  const brackets = bracketsForYear(fy);
  const lines = brackets.map((b, i) => {
    const prev = i === 0 ? 0 : brackets[i - 1].upTo;
    const top = Number.isFinite(b.upTo) ? `$${b.upTo.toLocaleString("en-AU")}` : "and over";
    const from = prev === 0 ? "$0" : `$${(prev + 1).toLocaleString("en-AU")}`;
    return `${from} – ${top}: ${pct(b.rate)}`;
  });
  return article(
    "tax-brackets",
    "Resident tax rates and Medicare levy",
    [
      "tax",
      "bracket",
      "brackets",
      "rate",
      "rates",
      "medicare",
      "levy",
      "income tax",
      "threshold",
      "18200",
    ],
    [
      `Australian resident marginal rates for ${fy} (excluding Medicare), as loaded in this app:`,
      lines.join("\n"),
      `Medicare levy is ${pct(MEDICARE_LEVY_RATE)} of taxable income (this app does not model every Medicare exemption). Super guarantee for ${fy} is ${pct(sgRateForYear(fy))} of ordinary time earnings.`,
      `The Dashboard and EOFY report estimate tax from your saved ledgers. They are a working paper, not a lodged return.`,
    ].join("\n\n"),
    { financialYear: fy }
  );
}

function gstArticle() {
  return article(
    "gst-bas",
    "GST and BAS (1/11)",
    ["gst", "bas", "activity statement", "1/11", "eleven", "tax invoice"],
    [
      `If you are registered for GST, the GST in a GST-inclusive amount is generally 1/11 of that amount (for example $110 includes $10 GST).`,
      `Pro EOFY tools in this app can build a BAS/GST worksheet (G1, 1A, G11, 1B, 9) from your ledgers to use when lodging — it does not lodge at the ATO for you.`,
      `Keep tax invoices that show the supplier ABN and GST. Occupations that are not GST-registered should not treat GST as a separate claim.`,
    ].join("\n\n")
  );
}

function buildArticles({ product, financialYear }) {
  const fy = financialYear || getCurrentFinancialYear();
  const rates = travelRatesForYear(fy);
  const haulage = product !== "suite";
  const meals = haulage ? haulageMealArticle(fy, rates) : suiteTravelArticle(fy);
  const list = [
    meals,
    haulage ? travelCapsArticle(fy, rates) : null,
    carArticle(fy),
    substantiationArticle(),
    incomeArticle(),
    expenseCategoriesArticle(),
    taxBracketsArticle(fy),
    gstArticle(),
  ].filter(Boolean);
  if (haulage) {
    list.push(
      article(
        "overtime-meal",
        "Overtime meal allowance",
        ["overtime", "ot meal", "overtime meal"],
        `The overtime meal reasonable amount in ${rates.incomeYear} (${rates.determination}) is ${money(rates.overtimeMealCap)}. Include the allowance as income if you claim the deduction. This is separate from overnight travel / LAFHA meals.`
      )
    );
  }
  return list;
}

function normalizeQuery(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9$%/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(query) {
  return normalizeQuery(query)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function scoreArticle(item, tokenList, raw) {
  let score = 0;
  const hay = `${item.title} ${item.tags.join(" ")} ${item.body}`.toLowerCase();
  for (const t of tokenList) {
    if (hay.includes(t)) score += 1;
  }
  for (const tag of item.tags) {
    if (raw.includes(String(tag).toLowerCase())) score += 2;
  }
  if (raw.includes(item.title.toLowerCase())) score += 3;
  return score;
}

function handoffPayload(message, supportEmail) {
  const topic = String(message || "").trim().slice(0, 180) || "(no topic given)";
  const inbox = supportEmail || supportInbox();
  const prompt = `I need help with: ${topic}`;
  const answer = [
    "I don’t have an ATO-table answer for that in this app.",
    `Email ${inbox} and mention this topic so someone can look at it with you.`,
    `Quick prompt you can paste: “${prompt}”`,
    "This companion only covers published expense, income and allowance rates loaded here. It is not personal tax advice.",
  ].join("\n\n");
  return {
    ok: true,
    handoff: true,
    title: "Contact support",
    answer,
    sources: [],
    supportEmail: inbox,
    prompt,
    disclaimer: DISCLAIMER,
  };
}

function formatAnswer(hits, fy) {
  const primary = hits[0];
  const extra =
    hits[1] && hits[1].score >= MIN_SCORE && hits[1].id !== primary.id
      ? `\n\nRelated — ${hits[1].title}:\n${hits[1].body}`
      : "";
  const sourceLine = primary.determination
    ? `\n\nSource in this app: ${primary.determination} (${primary.financialYear || fy}).`
    : primary.financialYear
      ? `\n\nFigures are for financial year ${primary.financialYear}.`
      : "";
  return `${primary.body}${extra}${sourceLine}\n\n${DISCLAIMER}`;
}

function answerQuestion(message, opts = {}) {
  const supportEmail = opts.supportEmail || supportInbox();
  const text = String(message || "").trim();
  if (!text) {
    return { ok: false, error: "Type a short tax or allowance question." };
  }
  if (text.length > MAX_MESSAGE) {
    return { ok: false, error: `Keep questions under ${MAX_MESSAGE} characters.` };
  }
  if (OUT_OF_SCOPE.test(text)) {
    return handoffPayload(text, supportEmail);
  }

  const fy = opts.financialYear || getCurrentFinancialYear();
  const product = opts.product === "suite" ? "suite" : "haulage";
  const raw = normalizeQuery(text);
  const tokenList = tokens(text);
  if (!tokenList.length) {
    return handoffPayload(text, supportEmail);
  }

  const ranked = buildArticles({ product, financialYear: fy })
    .map((item) => ({ ...item, score: scoreArticle(item, tokenList, raw) }))
    .sort((a, b) => b.score - a.score);

  if (!ranked.length || ranked[0].score < MIN_SCORE) {
    return handoffPayload(text, supportEmail);
  }

  const hits = ranked.filter((h) => h.score >= MIN_SCORE).slice(0, 2);
  return {
    ok: true,
    handoff: false,
    title: hits[0].title,
    answer: formatAnswer(hits, fy),
    sources: hits.map((h) => ({
      id: h.id,
      title: h.title,
      determination: h.determination || null,
    })),
    supportEmail,
    prompt: null,
    disclaimer: DISCLAIMER,
    financialYear: fy,
  };
}

module.exports = {
  MAX_MESSAGE,
  MIN_SCORE,
  DISCLAIMER,
  money,
  buildArticles,
  answerQuestion,
  handoffPayload,
};
