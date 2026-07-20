/**
 * ATO standards for Australian employee truck / line-haul drivers.
 * Sources: TD 2025/4, ATO truck driver occupation guide, work-related deductions.
 * Income year 2025–26 unless noted.
 */

const INCOME_YEAR = "2025-26";

const FINANCIAL_YEAR = {
  label: INCOME_YEAR,
  start: "2025-07-01",
  end: "2026-06-30",
};

/** Australian marginal tax rates 2025–26 (resident, excludes Medicare levy). */
const TAX_BRACKETS = [
  { upTo: 18200, rate: 0 },
  { upTo: 45000, rate: 0.16 },
  { upTo: 135000, rate: 0.3 },
  { upTo: 190000, rate: 0.37 },
  { upTo: Infinity, rate: 0.45 },
];

const MEDICARE_LEVY_RATE = 0.02;

/** TD 2025/4 Table 5 – employee truck driver meal reasonable amounts (domestic). */
const TRUCK_DRIVER_MEALS = {
  breakfast: { cap: 31.15, label: "Breakfast (truck driver)", substantiation: "reasonable_amount" },
  lunch: { cap: 35.55, label: "Lunch (truck driver)", substantiation: "reasonable_amount" },
  dinner: { cap: 61.3, label: "Dinner (truck driver)", substantiation: "reasonable_amount" },
};

/** Overtime meal reasonable amount 2025–26 (TD 2025/4). */
const OVERTIME_MEAL_CAP = 38.65;

/** Cents per km – cars only, max 5,000 km (2024–25 and 2025–26). */
const CENTS_PER_KM = {
  rate: 0.88,
  maxKm: 5000,
  maxDeduction: 4400,
};

/** Laundry reasonable basis (ATO truck driver guide). */
const LAUNDRY_RATES = {
  workOnlyLoad: 1.0,
  mixedLoad: 0.5,
  noReceiptThreshold: 150,
};

/** Work-related expenses substantiation threshold. */
const SUBSTANTIATION = {
  totalWorkExpensesReceiptThreshold: 300,
  laundryNoReceiptThreshold: 150,
};

/** Salary bands for domestic travel allowance tables (TD 2025/4). */
const SALARY_BANDS = [
  { id: "band1", label: "Up to $148,250", maxSalary: 148250 },
  { id: "band2", label: "$148,251 – $263,850", maxSalary: 263850 },
  { id: "band3", label: "$263,851 or more", maxSalary: Infinity },
];

/** Domestic travel daily caps by salary band (accommodation + meals + incidentals). */
const DOMESTIC_TRAVEL_DAILY = {
  band1: { accommodation: 138.0, breakfast: 31.15, lunch: 35.55, dinner: 61.3, incidentals: 24.25 },
  band2: { accommodation: 175.0, breakfast: 36.8, lunch: 42.15, dinner: 72.6, incidentals: 27.65 },
  band3: { accommodation: 210.0, breakfast: 42.15, lunch: 59.6, dinner: 83.4, incidentals: 32.05 },
};

/**
 * ATO-aligned expense categories for line-haul / truck drivers.
 * `group` controls dropdown optgroup labels in the UI.
 */
const EXPENSE_CATEGORIES = {
  // ── Travel & living on the road ──────────────────────────────────────────
  accommodation: {
    label: "Accommodation (motel, hotel, caravan park)",
    group: "Travel & living on the road",
    atoSchedule: "D5 – Other work-related expenses / travel",
    method: "actual",
    substantiation: "written_evidence",
    notes: "Long-haul drivers sleeping away from home. Written evidence required. Not sleeping in cab.",
    driverType: ["long_haul"],
  },
  groceries_travel: {
    label: "Groceries & travel food supplies",
    group: "Travel & living on the road",
    atoSchedule: "D5 – Travel",
    method: "actual",
    substantiation: "receipt",
    notes: "Food/groceries bought while away from home on a line haul trip — not usual home groceries.",
    driverType: ["long_haul", "short_haul"],
  },
  snacks_drinks: {
    label: "Snacks & drinks (work travel)",
    group: "Travel & living on the road",
    atoSchedule: "D5 – Travel",
    method: "actual",
    substantiation: "receipt",
    notes: "Snacks and non-alcoholic drinks consumed while traveling for work away from home.",
    driverType: ["long_haul", "short_haul"],
  },
  incidentals: {
    label: "Travel incidentals (shower, toiletries)",
    group: "Travel & living on the road",
    atoSchedule: "D5 – Travel",
    method: "actual",
    substantiation: "written_evidence",
    notes: "Written evidence required for incidentals while away on work travel.",
  },
  rest_facilities: {
    label: "Rest stop / shower / laundry (on road)",
    group: "Travel & living on the road",
    atoSchedule: "D5 – Travel",
    method: "actual",
    substantiation: "receipt",
    notes: "Truck-stop showers, laundry while away from home on a line haul run.",
    driverType: ["long_haul", "short_haul"],
  },
  travel_general: {
    label: "General work travel expense",
    group: "Travel & living on the road",
    atoSchedule: "D5 – Travel",
    method: "actual",
    substantiation: "receipt",
    notes: "Other deductible costs while traveling away from home for line haul work.",
    driverType: ["long_haul", "short_haul"],
  },

  // ── Meals (ATO reasonable amounts) ───────────────────────────────────────
  meals_breakfast: {
    label: "Meals – breakfast",
    group: "Meals (ATO reasonable amounts)",
    atoSchedule: "D5 – Travel",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    cap: TRUCK_DRIVER_MEALS.breakfast.cap,
    notes: "Separate amount; cannot aggregate or transfer between meals (TD 2025/4).",
  },
  meals_lunch: {
    label: "Meals – lunch",
    group: "Meals (ATO reasonable amounts)",
    atoSchedule: "D5 – Travel",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    cap: TRUCK_DRIVER_MEALS.lunch.cap,
  },
  meals_dinner: {
    label: "Meals – dinner",
    group: "Meals (ATO reasonable amounts)",
    atoSchedule: "D5 – Travel",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    cap: TRUCK_DRIVER_MEALS.dinner.cap,
  },
  overtime_meals: {
    label: "Overtime meal",
    group: "Meals (ATO reasonable amounts)",
    atoSchedule: "D5 – Other work-related",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    cap: OVERTIME_MEAL_CAP,
    notes: "Claim actual spend up to reasonable amount when working overtime.",
  },

  // ── Vehicle & fuel ───────────────────────────────────────────────────────
  vehicle_truck: {
    label: "Truck / heavy vehicle (actual expenses)",
    group: "Vehicle & fuel",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipts_and_work_use",
    notes: "Vehicles ≥1 tonne – actual fuel, repairs, insurance, decline in value. No cents/km.",
    workUseRequired: true,
  },
  vehicle_car: {
    label: "Car expenses (own/lease car)",
    group: "Vehicle & fuel",
    atoSchedule: "D1 – Work-related car expenses",
    method: "cents_per_km_or_logbook",
    substantiation: "km_record_or_logbook",
    centsPerKm: CENTS_PER_KM,
    notes: "Logbook or 88c/km (max 5,000 km). Not for trucks ≥1 tonne.",
  },
  fuel: {
    label: "Fuel (truck / non-car vehicle)",
    group: "Vehicle & fuel",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipt",
    parentCategory: "vehicle_truck",
    workUseRequired: true,
  },
  adblue_fluids: {
    label: "AdBlue, oil & vehicle fluids",
    group: "Vehicle & fuel",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipt",
    workUseRequired: true,
  },
  repairs_maintenance: {
    label: "Repairs & maintenance (vehicle)",
    group: "Vehicle & fuel",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipt",
    workUseRequired: true,
  },
  tyres: {
    label: "Tyres & wheel services",
    group: "Vehicle & fuel",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipt",
    workUseRequired: true,
  },
  registration_insurance: {
    label: "Registration & insurance (work portion)",
    group: "Vehicle & fuel",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipt_and_work_use",
    workUseRequired: true,
  },
  parking_tolls: {
    label: "Parking, tolls & road charges",
    group: "Vehicle & fuel",
    atoSchedule: "D1 or D2",
    method: "actual",
    substantiation: "receipt",
    notes: "Work-related only; includes salary-sacrifice car extras.",
  },
  weighbridge: {
    label: "Weighbridge & compliance fees",
    group: "Vehicle & fuel",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipt",
    notes: "Work-related weighbridge, NHVAS or compliance costs you pay.",
  },

  // ── Clothing & safety ────────────────────────────────────────────────────
  clothing_uniform: {
    label: "Compulsory / registered uniform",
    group: "Clothing & safety",
    atoSchedule: "D3 – Work-related clothing",
    method: "actual",
    substantiation: "receipt",
  },
  clothing_protective: {
    label: "Protective clothing & footwear",
    group: "Clothing & safety",
    atoSchedule: "D3 – Work-related clothing",
    method: "actual",
    substantiation: "receipt",
    notes: "Steel-capped boots, hi-vis, etc.",
  },
  laundry: {
    label: "Laundry (eligible work clothing)",
    group: "Clothing & safety",
    atoSchedule: "D3 – Work-related clothing",
    method: "reasonable_basis",
    substantiation: "diary_if_over_threshold",
    rates: LAUNDRY_RATES,
  },
  first_aid: {
    label: "First aid & medical supplies (work)",
    group: "Clothing & safety",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    notes: "Work-related first aid kits and supplies kept in the truck.",
  },

  // ── Business & on-road equipment ─────────────────────────────────────────
  tools_equipment: {
    label: "Tools & hand equipment",
    group: "Business & on-road equipment",
    atoSchedule: "D5 – Other work-related",
    method: "actual_or_depreciation",
    substantiation: "receipt",
    depreciationThreshold: 300,
  },
  load_restraint: {
    label: "Load restraint & freight gear",
    group: "Business & on-road equipment",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    notes: "Straps, chains, tarps, dunnage and load-security equipment.",
  },
  truck_cabin_equipment: {
    label: "Truck cabin / sleeper equipment",
    group: "Business & on-road equipment",
    atoSchedule: "D5 – Other work-related",
    method: "actual_or_depreciation",
    substantiation: "receipt",
    notes: "Fridge, bedding, Esky and similar items for mandatory rest — work portion only.",
    depreciationThreshold: 300,
  },
  navigation_comms: {
    label: "GPS, UHF & communications gear",
    group: "Business & on-road equipment",
    atoSchedule: "D5 – Other work-related",
    method: "actual_or_depreciation",
    substantiation: "receipt",
    depreciationThreshold: 300,
  },
  cleaning_supplies: {
    label: "Cleaning & wash supplies (truck/trailer)",
    group: "Business & on-road equipment",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
  },
  office_admin: {
    label: "Logbooks, forms & admin supplies",
    group: "Business & on-road equipment",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    notes: "Work diaries, logbooks, delivery dockets and similar records.",
  },
  business_supplies: {
    label: "General business supplies",
    group: "Business & on-road equipment",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    notes: "Other work-related consumables for line haul operations.",
  },

  // ── Professional & fees ──────────────────────────────────────────────────
  training_education: {
    label: "Self-education & training",
    group: "Professional & fees",
    atoSchedule: "D4 – Work-related self-education",
    method: "actual",
    substantiation: "receipt",
    notes: "Must relate to current role as truck driver. No HELP/HECS repayments.",
  },
  trade_subscriptions: {
    label: "Trade magazines & subscriptions",
    group: "Professional & fees",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    notes: "Industry journals and subscriptions related to your driving role.",
  },
  phone_internet: {
    label: "Phone & internet (work portion)",
    group: "Professional & fees",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt_and_work_use",
    workUseRequired: true,
  },
  union_fees: {
    label: "Union & association fees",
    group: "Professional & fees",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
  },
  licence_permit: {
    label: "Special licence / heavy vehicle permit",
    group: "Professional & fees",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    notes: "Not standard driver licence renewal.",
  },
  compulsory_assessment: {
    label: "Compulsory medical / vision assessment",
    group: "Professional & fees",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    notes: "Employer-required ongoing assessments only.",
  },

  // ── Other ────────────────────────────────────────────────────────────────
  other_work: {
    label: "Other work-related expense",
    group: "Other",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
  },
};

/** Income / allowance types for truck drivers. */
const INCOME_TYPES = {
  salary_wages: {
    label: "Salary & wages",
    assessable: true,
    notes: "Include all salary, wages, bonuses on income statement.",
  },
  remittance_owner: {
    label: "Owner-driver remittance / contract income",
    assessable: true,
    notes: "Gross payments before expenses (contractor/ABN).",
  },
  allowance_taxable: {
    label: "Taxable allowance (on income statement)",
    assessable: true,
    notes: "Include on return; claim related expenses separately if eligible.",
  },
  allowance_travel: {
    label: "Travel allowance (not on income statement)",
    assessable: "if_claiming",
    notes: "Not declared unless claiming a deduction for related expenses.",
  },
  allowance_overtime_meal: {
    label: "Overtime meal allowance (not on income statement)",
    assessable: "if_claiming",
    notes: "Include as income if claiming overtime meal deduction.",
  },
  allowance_car: {
    label: "Car / km allowance",
    assessable: true,
    notes: "Include allowance; calculate deduction via logbook or cents/km.",
  },
  compensation: {
    label: "Compensation (non-deductible aspect)",
    assessable: true,
    notes: "e.g. unpleasant conditions allowance with no related expense.",
  },
  reimbursement: {
    label: "Reimbursement",
    assessable: false,
    notes: "Not income; cannot claim expense.",
  },
  training_allowance: {
    label: "Training allowance",
    assessable: true,
    notes: "Assessable if paid; offset by eligible training expenses.",
  },
};

const DRIVER_TYPES = {
  local: { label: "Local driver", description: "Usually within city/town, sleeps at home." },
  short_haul: { label: "Short-haul driver", description: "Between cities/towns, returns home to sleep." },
  long_haul: { label: "Long-haul driver", description: "Mandatory rest breaks away from home." },
  owner_driver: { label: "Owner-driver / contractor", description: "ABN contract remittances." },
};

function getFinancialYearForDate(dateStr) {
  // Parse YYYY-MM-DD as a calendar date (avoid UTC timezone shifting the day).
  const raw = String(dateStr || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let year;
  let month; // 0-based
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]) - 1;
  } else {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth();
    } else {
      year = d.getFullYear();
      month = d.getMonth();
    }
  }
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function getCurrentFinancialYear() {
  const now = new Date();
  return getFinancialYearForDate(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  );
}

function getSalaryBand(annualSalary) {
  if (annualSalary <= SALARY_BANDS[0].maxSalary) return "band1";
  if (annualSalary <= SALARY_BANDS[1].maxSalary) return "band2";
  return "band3";
}

function getCategoryMeta(categoryId) {
  return EXPENSE_CATEGORIES[categoryId] || null;
}

function listCategories() {
  return Object.entries(EXPENSE_CATEGORIES).map(([id, meta]) => ({
    id,
    group: meta.group || "Other",
    ...meta,
  }));
}

/** Ordered group labels for category dropdowns. */
const CATEGORY_GROUPS = [
  "Travel & living on the road",
  "Meals (ATO reasonable amounts)",
  "Vehicle & fuel",
  "Clothing & safety",
  "Business & on-road equipment",
  "Professional & fees",
  "Other",
];

function listIncomeTypes() {
  return Object.entries(INCOME_TYPES).map(([id, meta]) => ({ id, ...meta }));
}

module.exports = {
  INCOME_YEAR,
  FINANCIAL_YEAR,
  TAX_BRACKETS,
  MEDICARE_LEVY_RATE,
  TRUCK_DRIVER_MEALS,
  OVERTIME_MEAL_CAP,
  CENTS_PER_KM,
  LAUNDRY_RATES,
  SUBSTANTIATION,
  SALARY_BANDS,
  DOMESTIC_TRAVEL_DAILY,
  EXPENSE_CATEGORIES,
  CATEGORY_GROUPS,
  INCOME_TYPES,
  DRIVER_TYPES,
  getFinancialYearForDate,
  getCurrentFinancialYear,
  getSalaryBand,
  getCategoryMeta,
  listCategories,
  listIncomeTypes,
};
