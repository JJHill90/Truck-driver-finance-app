/**
 * ATO standards for Go Taxation Suite — general PAYG employees, sole traders
 * and partnerships (not the truck-driver / line-haul occupation guide).
 *
 * Individual rates, work-related deductions (ITAA 1997 / ATO D1–D5), home
 * office PCG 2023/1, donations, tax-agent fees, small-business instant asset
 * write-off, GST 10%, Super Guarantee. Travel meal/overtime amounts come from
 * the published Taxation Determination tables (other than the employee truck
 * driver occupation table).
 *
 * This is an assistance tool, not tax advice.
 */

const {
  getFinancialYearForDate,
  getCurrentFinancialYear,
} = require("../ato-standards");
const {
  incomeTaxForYear,
  medicareLevyForYear,
  budgetRepairLevy,
  centsPerKmForYear,
  sgRateForYear,
  travelRatesForYear,
  getSalaryBandForYear,
} = require("../historical-rates");
const { mealCapsForYear: suiteMealCapsForYear } = require("./travel");

const GST_RATE = 0.1;
const SUBSTANTIATION = {
  totalWorkExpensesReceiptThreshold: 300,
  laundryNoReceiptThreshold: 150,
  toolsImmediateWriteOff: 300,
};

const LAUNDRY_RATES = {
  workOnlyLoad: 1.0,
  mixedLoad: 0.5,
  noReceiptThreshold: 150,
};

/** Revised fixed-rate working-from-home method (PCG 2023/1). */
function homeOfficeRateForYear(fy) {
  const y = Number(String(fy || "").split("-")[0]) || 0;
  if (y >= 2024) return 0.7;
  if (y >= 2022) return 0.67;
  if (y >= 2020) return 0.52;
  return 0.7;
}

/** Small business instant asset write-off (eligible SBE, aggregated turnover rules apply). */
function instantAssetWriteOffForYear(fy) {
  const y = Number(String(fy || "").split("-")[0]) || 0;
  if (y >= 2023 && y <= 2025) return 20000;
  if (y >= 2020 && y <= 2022) return 150000;
  return 20000;
}

/** Low income tax offset (resident). Cannot reduce tax below $0. */
function calcLito(taxableIncome) {
  const t = Math.max(0, Number(taxableIncome) || 0);
  if (t <= 37500) return 700;
  if (t <= 45000) return Math.max(0, Math.round((700 - (t - 37500) * 0.05) * 100) / 100);
  if (t <= 66667) return Math.max(0, Math.round((325 - (t - 45000) * 0.015) * 100) / 100);
  return 0;
}

/**
 * Medicare levy with the single-taxpayer low-income shade-in (2025–26:
 * $28,011 / $35,013). Full 2% above the upper threshold. Family/SAPTO
 * tables are not modelled.
 */
const MEDICARE_SINGLE = {
  "2025-26": { lower: 28011, upper: 35013 },
  "2024-25": { lower: 26000, upper: 32500 },
};

function medicareThresholds(fy) {
  const y = Number(String(fy || "").split("-")[0]) || 0;
  if (y >= 2025) return MEDICARE_SINGLE["2025-26"];
  return MEDICARE_SINGLE["2024-25"];
}

function calcMedicareLevyShaded(taxableIncome, fy) {
  const t = Math.max(0, Number(taxableIncome) || 0);
  if (t <= 0) return 0;
  const { lower, upper } = medicareThresholds(fy);
  if (t <= lower) return 0;
  if (t <= upper) {
    // ATO shade-in is 10% of the excess over the lower threshold.
    return Math.round((t - lower) * 0.1 * 100) / 100;
  }
  return Math.round(t * 0.02 * 100) / 100;
}

const ALL_ENTITIES = ["employee", "sole_trader", "partnership"];
const BUSINESS = ["sole_trader", "partnership"];

/**
 * General ATO-aligned expense categories.
 * `entities` lists which registration types see the category in menus.
 */
const EXPENSE_CATEGORIES = {
  // ── D1 Car ─────────────────────────────────────────────────────────────
  vehicle_car: {
    label: "Car expenses (cents per km or logbook)",
    group: "Car (ATO D1)",
    atoSchedule: "D1 – Work-related car expenses",
    method: "cents_per_km_or_logbook",
    substantiation: "km_record_or_logbook",
    entities: ALL_ENTITIES,
    notes: "Cars only. 88c/km (2025–26) up to 5,000 km, or logbook / actual running costs. Not for vehicles ≥1 tonne.",
  },
  fuel: {
    label: "Fuel (work car — logbook / actual)",
    group: "Car (ATO D1)",
    atoSchedule: "D1 – Work-related car expenses",
    method: "actual",
    substantiation: "receipt",
    workUseRequired: true,
    entities: ALL_ENTITIES,
    notes: "Work-use portion only. Prefer the Car Expenses tab for cents/km vs logbook.",
  },
  repairs_maintenance: {
    label: "Repairs & servicing (work car)",
    group: "Car (ATO D1)",
    atoSchedule: "D1 – Work-related car expenses",
    method: "actual",
    substantiation: "receipt",
    workUseRequired: true,
    entities: ALL_ENTITIES,
  },
  tyres: {
    label: "Tyres & wheel services (work car)",
    group: "Car (ATO D1)",
    atoSchedule: "D1 – Work-related car expenses",
    method: "actual",
    substantiation: "receipt",
    workUseRequired: true,
    entities: ALL_ENTITIES,
  },
  registration_insurance: {
    label: "Registration & insurance (work portion)",
    group: "Car (ATO D1)",
    atoSchedule: "D1 – Work-related car expenses",
    method: "actual",
    substantiation: "receipt_and_work_use",
    workUseRequired: true,
    entities: ALL_ENTITIES,
  },
  parking_tolls: {
    label: "Parking, tolls & road charges (work)",
    group: "Car (ATO D1)",
    atoSchedule: "D1 or D2",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Work-related parking and tolls. Everyday home-to-work travel is generally private.",
  },

  // ── D2 Travel ──────────────────────────────────────────────────────────
  travel_general: {
    label: "Work travel (flights, fares, taxis)",
    group: "Travel (ATO D2)",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Travel for work away from your usual workplace. Ordinary commuting is not deductible.",
  },
  accommodation: {
    label: "Work accommodation (hotel, motel)",
    group: "Travel (ATO D2)",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "written_evidence",
    entities: ALL_ENTITIES,
    notes: "Overnight work travel. Reasonable amounts in the annual Taxation Determination may apply when an allowance is paid.",
  },
  meals: {
    label: "Meals while travelling for work",
    group: "Travel (ATO D2)",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    entities: ALL_ENTITIES,
    notes: "Everyday lunches at your usual workplace are private. Overnight work travel / overtime meal allowance rules apply.",
  },
  meals_breakfast: {
    label: "Travel meals – breakfast",
    group: "Travel (ATO D2)",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    entities: ALL_ENTITIES,
  },
  meals_lunch: {
    label: "Travel meals – lunch",
    group: "Travel (ATO D2)",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    entities: ALL_ENTITIES,
  },
  meals_dinner: {
    label: "Travel meals – dinner",
    group: "Travel (ATO D2)",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    entities: ALL_ENTITIES,
  },
  overtime_meals: {
    label: "Overtime meal",
    group: "Travel (ATO D2)",
    atoSchedule: "D5 – Other work-related",
    method: "reasonable_or_actual",
    substantiation: "reasonable_amount",
    entities: ALL_ENTITIES,
    notes: "Claim actual spend up to the TD overtime meal reasonable amount when an overtime meal allowance is paid.",
  },
  groceries_travel: {
    label: "Groceries while travelling for work",
    group: "Travel (ATO D2)",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Only while away overnight for work. Home groceries are private and not deductible.",
  },
  incidentals: {
    label: "Travel incidentals",
    group: "Travel (ATO D2)",
    atoSchedule: "D2 – Work-related travel expenses",
    method: "actual",
    substantiation: "written_evidence",
    entities: ALL_ENTITIES,
  },

  // ── D3 Clothing ────────────────────────────────────────────────────────
  clothing_uniform: {
    label: "Compulsory / registered uniform",
    group: "Clothing (ATO D3)",
    atoSchedule: "D3 – Work-related clothing",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Compulsory unique uniforms or registered designs. Conventional clothing is not deductible.",
  },
  clothing_protective: {
    label: "Protective clothing & occupation-specific dress",
    group: "Clothing (ATO D3)",
    atoSchedule: "D3 – Work-related clothing",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Hi-vis, steel-cap boots, chef whites, and similar occupation-specific or protective items.",
  },
  laundry: {
    label: "Laundry (eligible work clothing)",
    group: "Clothing (ATO D3)",
    atoSchedule: "D3 – Work-related clothing",
    method: "reasonable_basis",
    substantiation: "diary_if_over_threshold",
    rates: LAUNDRY_RATES,
    entities: ALL_ENTITIES,
  },

  // ── D4 Self-education ──────────────────────────────────────────────────
  training_education: {
    label: "Self-education & training",
    group: "Self-education (ATO D4)",
    atoSchedule: "D4 – Work-related self-education",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Must have a sufficient connection to your current employment or business. HELP/HECS repayments are not deductible here.",
  },
  trade_subscriptions: {
    label: "Professional journals & subscriptions",
    group: "Self-education (ATO D4)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
  },

  // ── D5 Other work-related ──────────────────────────────────────────────
  tools_equipment: {
    label: "Tools, equipment & computers",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual_or_depreciation",
    substantiation: "receipt",
    depreciationThreshold: 300,
    entities: ALL_ENTITIES,
    notes: "Employees: items $300 or less may be immediate. Over $300 generally decline in value. Businesses may use instant asset write-off.",
  },
  phone_internet: {
    label: "Phone & internet (work portion)",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt_and_work_use",
    workUseRequired: true,
    entities: ALL_ENTITIES,
    notes: "Apportion private vs work. Do not double-count if using the home-office fixed rate (which already covers phone/internet running costs).",
  },
  union_fees: {
    label: "Union, professional & association fees",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
  },
  licence_permit: {
    label: "Occupation licence / registration (not a standard driver licence)",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Work licences, practising certificates, police checks required by the job. Standard car licence renewal is private.",
  },
  compulsory_assessment: {
    label: "Compulsory work medicals / police checks",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
  },
  office_admin: {
    label: "Stationery, printing & office supplies",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
  },
  business_supplies: {
    label: "Work consumables & supplies",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
  },
  first_aid: {
    label: "First aid & workplace medical supplies",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
  },
  income_protection: {
    label: "Income protection insurance",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Premiums for income protection covering lost earnings can be deductible. Life/trauma cover generally is not.",
  },
  other_work: {
    label: "Other work-related expense",
    group: "Other work-related (ATO D5)",
    atoSchedule: "D5 – Other work-related",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
  },

  // ── Home office ────────────────────────────────────────────────────────
  home_office_hours: {
    label: "Home office – revised fixed rate (hours)",
    group: "Home office",
    atoSchedule: "D5 – Working from home (PCG 2023/1)",
    method: "fixed_rate_hours",
    substantiation: "diary_and_bills",
    entities: ALL_ENTITIES,
    notes: "70c per work-from-home hour (2024–25 and 2025–26). Covers energy, internet, phone, stationery and computer consumables. Keep a record of hours. Do not also claim those running costs separately.",
  },
  home_office_actual: {
    label: "Home office – actual running costs",
    group: "Home office",
    atoSchedule: "D5 – Working from home (actual)",
    method: "actual",
    substantiation: "receipt_and_work_use",
    workUseRequired: true,
    entities: ALL_ENTITIES,
    notes: "Only if you do not use the fixed-rate method for the year. Occupancy (rent/mortgage) is generally not deductible for employees.",
  },

  // ── Donations & tax affairs ────────────────────────────────────────────
  donations_dgr: {
    label: "Gifts & donations (DGR)",
    group: "Gifts, donations & tax affairs",
    atoSchedule: "D9 – Gifts or donations",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Must be to a deductible gift recipient. No material benefit in return. Receipts required for $2 or more.",
  },
  tax_affairs: {
    label: "Cost of managing tax affairs",
    group: "Gifts, donations & tax affairs",
    atoSchedule: "D10 – Cost of managing tax affairs",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
    notes: "Registered tax agent fees, ATO interest on overpayments is not claimed here as a deduction in the same way.",
  },

  // ── Business operating (sole trader / partnership) ─────────────────────
  advertising: {
    label: "Advertising & marketing",
    group: "Business operating costs",
    atoSchedule: "Business deduction – advertising",
    method: "actual",
    substantiation: "receipt",
    entities: BUSINESS,
  },
  contractor_payments: {
    label: "Contractors & subcontractors",
    group: "Business operating costs",
    atoSchedule: "Business deduction – contractors",
    method: "actual",
    substantiation: "receipt",
    entities: BUSINESS,
    notes: "Keep ABN invoices. PAYG withholding may apply if no ABN is quoted.",
  },
  stock_cogs: {
    label: "Purchases / cost of sales",
    group: "Business operating costs",
    atoSchedule: "Business deduction – trading stock",
    method: "actual",
    substantiation: "receipt",
    entities: BUSINESS,
  },
  insurance_business: {
    label: "Business insurance",
    group: "Business operating costs",
    atoSchedule: "Business deduction – insurance",
    method: "actual",
    substantiation: "receipt",
    entities: BUSINESS,
  },
  bank_fees: {
    label: "Bank fees & merchant charges",
    group: "Business operating costs",
    atoSchedule: "Business deduction – bank fees",
    method: "actual",
    substantiation: "receipt",
    entities: BUSINESS,
  },
  professional_fees: {
    label: "Accounting, legal & professional fees",
    group: "Business operating costs",
    atoSchedule: "Business deduction – professional",
    method: "actual",
    substantiation: "receipt",
    entities: BUSINESS,
  },
  rent_occupancy: {
    label: "Business rent / exclusive occupancy",
    group: "Business premises",
    atoSchedule: "Business deduction – occupancy",
    method: "actual",
    substantiation: "receipt_and_work_use",
    workUseRequired: true,
    entities: BUSINESS,
    notes: "Rent for business premises, or the exclusive-use portion of a home-based business area. Employees generally cannot claim occupancy.",
  },
  utilities_business: {
    label: "Business utilities (power, water, internet)",
    group: "Business premises",
    atoSchedule: "Business deduction – utilities",
    method: "actual",
    substantiation: "receipt_and_work_use",
    workUseRequired: true,
    entities: BUSINESS,
  },
  super_personal: {
    label: "Personal super contributions (deductible)",
    group: "Business operating costs",
    atoSchedule: "Personal superannuation contribution",
    method: "actual",
    substantiation: "notice_of_intent",
    entities: BUSINESS,
    notes: "Requires a valid notice of intent to claim and acknowledgement from the fund. Subject to concessional cap. Employees claiming this need to meet additional conditions.",
  },
  cleaning_supplies: {
    label: "Cleaning & workplace supplies",
    group: "Business operating costs",
    atoSchedule: "D5 / business deduction",
    method: "actual",
    substantiation: "receipt",
    entities: ALL_ENTITIES,
  },
};

const CATEGORY_GROUPS = [
  "Car (ATO D1)",
  "Travel (ATO D2)",
  "Clothing (ATO D3)",
  "Self-education (ATO D4)",
  "Other work-related (ATO D5)",
  "Home office",
  "Gifts, donations & tax affairs",
  "Business operating costs",
  "Business premises",
];

const INCOME_TYPES = {
  salary_wages: {
    label: "Salary & wages (PAYG)",
    assessable: true,
    entities: ALL_ENTITIES,
    notes: "Include gross salary, wages, bonuses and commissions from your income statement (PAYG withholding).",
  },
  allowance_taxable: {
    label: "Taxable allowance (on income statement)",
    assessable: true,
    entities: ALL_ENTITIES,
    notes: "Most allowances shown on the income statement are assessable. Claim related deductions separately if eligible.",
  },
  allowance_travel: {
    label: "Travel allowance (not on income statement)",
    assessable: "if_claiming",
    entities: ALL_ENTITIES,
    notes: "If the allowance is not on your income statement, include it only if you claim a deduction for the related travel.",
  },
  allowance_overtime_meal: {
    label: "Overtime meal allowance (not on income statement)",
    assessable: "if_claiming",
    entities: ALL_ENTITIES,
  },
  allowance_car: {
    label: "Car / kilometre allowance",
    assessable: true,
    entities: ALL_ENTITIES,
    notes: "Include the allowance; work out the deduction via cents per km or logbook.",
  },
  bonus: {
    label: "Bonus / commission",
    assessable: true,
    entities: ALL_ENTITIES,
  },
  interest: {
    label: "Interest (bank / investments)",
    assessable: true,
    entities: ALL_ENTITIES,
  },
  dividends: {
    label: "Dividends (including franking)",
    assessable: true,
    entities: ALL_ENTITIES,
    notes: "Include franked and unfranked dividends. Franking credits are not auto-applied in this version — confirm with your tax agent.",
  },
  government_payments: {
    label: "Taxable government payments",
    assessable: true,
    entities: ALL_ENTITIES,
  },
  reimbursement: {
    label: "Reimbursement (not income)",
    assessable: false,
    entities: ALL_ENTITIES,
    notes: "A genuine reimbursement of a work expense is not assessable and you cannot claim the expense.",
  },
  business_income: {
    label: "Business sales / fees (sole trader)",
    assessable: true,
    entities: ["sole_trader"],
    notes: "Gross business takings before expenses. Include GST-exclusive amounts if you account for GST on a cash/accruals basis — record GST separately.",
  },
  services_income: {
    label: "Professional / contractor fees",
    assessable: true,
    entities: BUSINESS,
  },
  partnership_distribution: {
    label: "Partnership distribution (your share)",
    assessable: true,
    entities: ["partnership"],
    notes: "Your share of partnership net income from the partnership return (including any GST adjustments at partner level as advised).",
  },
  partner_salary: {
    label: "Partner salary / guaranteed payment",
    assessable: true,
    entities: ["partnership"],
  },
  other_income: {
    label: "Other assessable income",
    assessable: true,
    entities: ALL_ENTITIES,
  },
};

function getCategoryMeta(categoryId) {
  return EXPENSE_CATEGORIES[categoryId] || null;
}

function listCategories(entityType) {
  const entity = entityType || null;
  return Object.entries(EXPENSE_CATEGORIES)
    .filter(([, meta]) => !entity || (meta.entities || ALL_ENTITIES).includes(entity))
    .map(([id, meta]) => ({
      id,
      group: meta.group || "Other",
      ...meta,
    }));
}

function listIncomeTypes(entityType) {
  const entity = entityType || null;
  return Object.entries(INCOME_TYPES)
    .filter(([, meta]) => !entity || (meta.entities || ALL_ENTITIES).includes(entity))
    .map(([id, meta]) => ({ id, ...meta }));
}

function mealCapsForYear(fy, annualSalary, profile) {
  return suiteMealCapsForYear(fy, annualSalary, profile);
}

module.exports = {
  GST_RATE,
  SUBSTANTIATION,
  LAUNDRY_RATES,
  EXPENSE_CATEGORIES,
  CATEGORY_GROUPS,
  INCOME_TYPES,
  ALL_ENTITIES,
  BUSINESS,
  getFinancialYearForDate,
  getCurrentFinancialYear,
  incomeTaxForYear,
  medicareLevyForYear,
  budgetRepairLevy,
  centsPerKmForYear,
  sgRateForYear,
  travelRatesForYear,
  getSalaryBandForYear,
  homeOfficeRateForYear,
  instantAssetWriteOffForYear,
  calcLito,
  calcMedicareLevyShaded,
  medicareThresholds,
  getCategoryMeta,
  listCategories,
  listIncomeTypes,
  mealCapsForYear,
};
