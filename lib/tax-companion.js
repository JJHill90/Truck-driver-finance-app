/**
 * In-app tax companion — answers only from ATO-aligned rates and notes
 * already used in this product (Taxation Determinations, PCG 2023/1, D1–D5).
 * Not tax advice and not an official ATO product.
 */
const suiteAto = require("./suite/ato");
const suiteTravel = require("./suite/travel");
const { travelRatesForYear } = require("./historical-rates");
const { getCurrentFinancialYear } = require("./ato-standards");

const SUPPORT_EMAIL = "support@godriverhub.com";
const DISCLAIMER =
  "This companion is an assistance tool, not tax advice, and not an official ATO product. You (or your registered agent) lodge with the ATO.";
const MAX_QUESTION = 500;

const STOP = new Set([
  "the",
  "and",
  "for",
  "can",
  "you",
  "what",
  "how",
  "does",
  "about",
  "with",
  "this",
  "that",
  "are",
  "is",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "my",
  "me",
  "i",
  "do",
  "if",
  "or",
  "be",
  "we",
  "it",
  "please",
  "tell",
  "give",
  "need",
  "want",
  "just",
]);

function money(n) {
  const x = Math.round((Number(n) || 0) * 100) / 100;
  return `$${x.toFixed(2)}`;
}

function currentFy(override) {
  return override || getCurrentFinancialYear();
}

function supportFallback(question, email = SUPPORT_EMAIL, product = "suite") {
  const q = String(question || "").trim() || "this topic";
  const brand = product === "haulage" ? "Taxation Hub" : "Go Taxation Suite";
  const subject = encodeURIComponent(`${brand} — question the companion could not answer`);
  const body = encodeURIComponent(
    `I asked the in-app companion:\n\n${q}\n\nIt did not have an ATO-backed answer. Please help with this topic.\n`
  );
  return {
    answered: false,
    topicId: null,
    title: null,
    answer:
      `I don’t have an ATO-backed answer for that in this companion. Email ${email} and mention this topic so they can help.`,
    disclaimer: DISCLAIMER,
    email,
    mailto: `mailto:${email}?subject=${subject}&body=${body}`,
    sources: [],
    suggestions: suggestedPrompts(product),
  };
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9$%./+\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w && !STOP.has(w) && (w.length > 2 || /^\d/.test(w) || w[0] === "$"));
}

function scoreTopic(topic, tokens, raw) {
  const hay = `${topic.title} ${(topic.keywords || []).join(" ")}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += t.length >= 6 ? 2 : 1;
  }
  for (const phrase of topic.phrases || []) {
    if (raw.includes(phrase)) score += 6;
  }
  return score;
}

function buildTopics(fy) {
  const year = currentFy(fy);
  const km = suiteAto.centsPerKmForYear(year);
  const kmCents = Math.round(km * 100);
  const homeOffice = suiteAto.homeOfficeRateForYear(year);
  const writeOff = suiteAto.instantAssetWriteOffForYear(year);
  const laundry = suiteAto.LAUNDRY_RATES;
  const subst = suiteAto.SUBSTANTIATION;
  const ordinary = suiteTravel.mealCapsForYear(year, 80000, { occupation: "sales" });
  const truckRates = travelRatesForYear(year);
  const truckMeals = truckRates.truckDriverMeals || {};
  const truckDaily = ["breakfast", "lunch", "dinner"].reduce((sum, k) => {
    const cap = truckMeals[k] && truckMeals[k].cap;
    return sum + (Number(cap) || 0);
  }, 0);
  const lafha = ordinary.lafhaWeekly;

  return [
    {
      id: "disclaimer",
      products: ["suite", "haulage"],
      title: "What this app can and cannot do",
      keywords: ["advice", "lodge", "official", "ato", "bas", "return", "disclaimer"],
      phrases: ["tax advice", "lodge my", "official ato"],
      sources: [],
      answer:
        "Go Taxation Suite / Taxation Hub records receipts and income and prepares working papers (including an ATO-box BAS worksheet you can copy when you lodge). It does not lodge a BAS or tax return and is not an official ATO product.",
    },
    {
      id: "work-travel-meals",
      products: ["suite"],
      title: "Overnight work travel — meals and incidentals",
      keywords: [
        "travel",
        "meal",
        "meals",
        "breakfast",
        "lunch",
        "dinner",
        "overnight",
        "allowance",
        "reasonable",
        "incidentals",
        "accommodation",
        "hotel",
      ],
      phrases: ["work travel", "travel allowance", "reasonable amount", "overnight"],
      sources: [ordinary.determination, "Tables 1–3"],
      answer:
        `For ordinary employees (not employee truck drivers), ${ordinary.determination} Tables 1–3 set reasonable amounts for overnight work travel. Using Melbourne as this app’s representative capital city, salary band “${ordinary.salaryBandLabel}”: breakfast ${money(ordinary.breakfast)}, lunch ${money(ordinary.lunch)}, dinner ${money(ordinary.dinner)} (meals ${money(ordinary.mealsDaily)}/day), incidentals ${money(ordinary.incidentals)}, accommodation ${money(ordinary.accommodation)} — about ${money(ordinary.dailyTravelTotal)}/day. Everyday lunches at your usual workplace are private. Ordinary commuting is not deductible.`,
    },
    {
      id: "overtime-meal",
      products: ["suite", "haulage"],
      title: "Overtime meal allowance",
      keywords: ["overtime", "meal", "ot", "allowance"],
      phrases: ["overtime meal"],
      sources: [ordinary.determination, "s 900-60"],
      answer:
        `An overtime meal is separate from overnight travel. Claim actual spend up to the Taxation Determination overtime meal reasonable amount (${ordinary.determination}: ${money(ordinary.overtimeMealCap)}) when an overtime meal allowance is paid. Keep the receipt where you can.`,
    },
    {
      id: "lafha-weekly",
      products: ["suite"],
      title: "Living away from home (LAFHA) — FBT food",
      keywords: ["lafha", "living", "away", "home", "fbt", "weekly", "food", "sales", "marketing"],
      phrases: ["living away", "lafha", "away from home"],
      sources: [lafha.determination],
      answer:
        `Living-away-from-home for occupations such as sales and marketing uses the FBT weekly food component (${lafha.determination}: ${money(lafha.oneAdult)}/week for one adult in Australia), not the employee truck-driver daily meal table. Overnight hotel-style work travel still uses ${ordinary.determination} Tables 1–3.`,
    },
    {
      id: "truck-meals",
      products: ["haulage"],
      title: "Employee truck driver meal amounts",
      keywords: ["truck", "driver", "meal", "meals", "lafha", "travel", "allowance", "breakfast", "lunch", "dinner"],
      phrases: ["truck driver", "table 5", "travel allowance"],
      sources: [truckRates.determination, "Table 5"],
      answer:
        `For employee truck drivers, ${truckRates.determination} Table 5 sets reasonable meal amounts (all domestic destinations): breakfast ${money(truckMeals.breakfast && truckMeals.breakfast.cap)}, lunch ${money(truckMeals.lunch && truckMeals.lunch.cap)}, dinner ${money(truckMeals.dinner && truckMeals.dinner.cap)} — ${money(truckDaily)}/day. Tables 1–3 (capital-city hotels) do not apply to that occupation. This is a working-paper cap, not a lodged claim.`,
    },
    {
      id: "car-cents-km",
      products: ["suite", "haulage"],
      title: "Car expenses — cents per kilometre (D1)",
      keywords: ["car", "vehicle", "km", "kilometre", "kilometer", "cents", "logbook", "d1", "fuel"],
      phrases: ["cents per", "per km", "logbook", "car expense"],
      sources: ["ATO D1", `${year}`],
      answer:
        `Work-related car expenses (ATO D1) are for cars. Cents per kilometre is ${kmCents}c/km for ${year} (up to 5,000 work kilometres). You may instead use a 12-week logbook and actual running costs × business-use %. Vehicles 1 tonne or more are not this cents/km method. Home-to-work commuting is generally private. Use the Car Expenses tab for trips and the work-use slider.`,
    },
    {
      id: "home-office",
      products: ["suite"],
      title: "Working from home (PCG 2023/1)",
      keywords: ["home", "office", "wfh", "working", "hours", "electricity", "internet"],
      phrases: ["work from home", "working from home", "home office"],
      sources: ["PCG 2023/1"],
      answer:
        `The revised fixed-rate working-from-home method (PCG 2023/1) is ${homeOffice.toFixed(2)}c per hour for ${year}, covering energy, internet, and phone for that method. Keep a record of hours. Occupancy (rent/mortgage) is a different claim and is not this rate.`,
    },
    {
      id: "clothing",
      products: ["suite", "haulage"],
      title: "Work clothing and uniforms (D3)",
      keywords: ["clothing", "uniform", "protective", "boots", "laundry", "washing"],
      phrases: ["work clothes", "conventional clothing", "protective"],
      sources: ["ATO D3"],
      answer:
        "Compulsory unique uniforms, registered designs, or occupation-specific protective clothing can be deductible. Conventional clothing (everyday jeans, shirts, sneakers) is not. Laundry of eligible work clothing can use ATO cents-per-load rates (occupation-specific load $1.00, mixed load $0.50) with a $150 no-receipt threshold for laundry claims.",
    },
    {
      id: "laundry-threshold",
      products: ["suite", "haulage"],
      title: "Receipts and substantiation",
      keywords: ["receipt", "substantiation", "threshold", "evidence", "written", "300", "laundry"],
      phrases: ["no receipt", "written evidence", "substantiation"],
      sources: ["ITAA 1997", "ATO substantiation"],
      answer:
        `Keep written evidence. A common total work-expense no-receipt threshold is $${subst.totalWorkExpensesReceiptThreshold}; laundry has a $${laundry.noReceiptThreshold} no-receipt threshold. Tools often need a receipt; immediate write-off for tools is commonly $${subst.toolsImmediateWriteOff} (separate from the small-business instant asset write-off). When in doubt, keep the receipt.`,
    },
    {
      id: "income",
      products: ["suite", "haulage"],
      title: "Income, PAYG and what is assessable",
      keywords: ["income", "payslip", "salary", "wages", "gross", "net", "payg", "withheld", "invoice"],
      phrases: ["payg", "net pay", "assessable income"],
      sources: ["ITAA 1997"],
      answer:
        "Salary and wages, allowances, and most business takings are assessable. Record payslips and invoices on the Income tab. The approve amount prefers net pay when that wording appears. PAYG withheld is not a deduction — it is tax already paid. GST collected by a GST-registered business is not kept as extra income in the net GST sense; use the BAS worksheet boxes when you lodge.",
    },
    {
      id: "gst-bas",
      products: ["suite"],
      title: "GST and the BAS worksheet",
      keywords: ["gst", "bas", "g1", "1a", "activity", "statement", "10%"],
      phrases: ["activity statement", "bas worksheet"],
      sources: ["GST 10%", "ATO BAS labels"],
      answer:
        "GST is 10% on taxable supplies. The in-app BAS/GST activity statement is an ATO-box worksheet (G1, 1A, G11, 1B, 9) you can download and copy when you lodge on the ATO Business Portal or with an agent. The app does not lodge a BAS.",
    },
    {
      id: "instant-asset",
      products: ["suite"],
      title: "Small business instant asset write-off",
      keywords: ["asset", "write", "off", "equipment", "depreciation", "sbe", "instant"],
      phrases: ["instant asset", "write-off", "write off"],
      sources: ["SBE instant asset write-off"],
      answer:
        `Eligible small-business entities may use instant asset write-off. For ${year} this app uses a $${writeOff.toLocaleString("en-AU")} limit (aggregated turnover rules apply — confirm eligibility). This is not the same as the $${subst.toolsImmediateWriteOff} tools threshold for employees.`,
    },
    {
      id: "commuting",
      products: ["suite", "haulage"],
      title: "Home to work travel",
      keywords: ["commute", "commuting", "depot", "home", "work", "private", "parking"],
      phrases: ["home to work", "ordinary commuting"],
      sources: ["ATO D1 / D2"],
      answer:
        "Ordinary travel between home and your regular workplace is generally private and not deductible. Work travel is travel away from that usual workplace for your job. Work parking and tolls can be deductible when they are for work, not everyday commuting.",
    },
    {
      id: "groceries",
      products: ["suite", "haulage"],
      title: "Groceries and meals at home",
      keywords: ["grocery", "groceries", "food", "woolworths", "coles", "aldi"],
      phrases: ["home groceries"],
      sources: ["ATO D2"],
      answer:
        "Groceries at home and everyday meals at your usual workplace are private. Groceries while you are away overnight for work can be a travel expense. Keep the receipt and use the travel/grocery category — not a private shop.",
    },
  ];
}

function suggestedPrompts(product) {
  if (product === "haulage") {
    return [
      "Truck driver meal amounts",
      "Cents per kilometre for my car",
      "Overtime meal allowance",
      "Work clothing and laundry",
      "Can I claim home to work travel?",
    ];
  }
  return [
    "Overnight work travel meals",
    "Cents per kilometre (D1)",
    "Working from home hourly rate",
    "GST and the BAS worksheet",
    "Overtime meal allowance",
  ];
}

function answerQuestion(question, opts = {}) {
  const product = opts.product === "haulage" ? "haulage" : "suite";
  const email = String(opts.email || SUPPORT_EMAIL).trim() || SUPPORT_EMAIL;
  const fy = currentFy(opts.financialYear);
  const raw = String(question || "").trim().slice(0, MAX_QUESTION);
  if (raw.length < 3) {
    return supportFallback(raw, email, product);
  }
  const tokens = tokenize(raw);
  const qlow = raw.toLowerCase();
  const topics = buildTopics(fy).filter((t) => (t.products || ["suite"]).includes(product));
  let best = null;
  let bestScore = 0;
  for (const topic of topics) {
    const s = scoreTopic(topic, tokens, qlow);
    if (s > bestScore) {
      bestScore = s;
      best = topic;
    }
  }
  const phraseHit = bestScore >= 6;
  const threshold = phraseHit ? 6 : Math.max(3, Math.min(4, tokens.length));
  if (!best || bestScore < threshold) {
    return supportFallback(raw, email, product);
  }
  return {
    answered: true,
    topicId: best.id,
    title: best.title,
    answer: `${best.answer} ${DISCLAIMER}`,
    disclaimer: DISCLAIMER,
    email,
    mailto: null,
    sources: best.sources || [],
    financialYear: fy,
    suggestions: suggestedPrompts(product),
  };
}

module.exports = {
  SUPPORT_EMAIL,
  DISCLAIMER,
  MAX_QUESTION,
  tokenize,
  buildTopics,
  suggestedPrompts,
  answerQuestion,
  supportFallback,
};
