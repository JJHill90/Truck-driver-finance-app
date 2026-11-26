/**
 * Expense / income keyword rules that stay product-specific.
 *
 * Suite fuel brands (BP, Ampol, Shell, 7-Eleven, Caltex, …) map to the Suite
 * car-fuel category id `fuel` ("Fuel (work car)").
 * Hub maps the same servo brands, when the docket is diesel / fuel, to `fuel`
 * as well — the Hub menu labels that id "Truck fuel & AdBlue", not the Suite
 * car label. Tolls, tyres and repairs stay on Hub truck categories.
 *
 * Category ids are shared where the ledger already uses them. Labels and which
 * menu shows them are not.
 */

const FUEL_BRAND_RE =
  /\b(bp\b|ampol|caltex|shell\b|mobil\b|7[\s-]*(?:eleven|11)|seven[\s-]*eleven|liberty|united\s*petroleum|puma(?:\s*energy)?)\b/i;

const FUEL_ITEM_RE =
  /\b(diesel|distillate|ad[\s-]*blue|adblue|unleaded|petrol|ulp|e10|fuel|pump\s*#?\d*|bowser|\d+(?:\.\d+)?\s*l\b|litres?|ltrs?)\b/i;

const FOOD_ITEM_RE =
  /\b(coffee|flat\s*white|cappuccino|latte|meal|burger|sandwich|steak|chips|snack|pie\b|breakfast|lunch|dinner)\b/i;

const TOLL_RE = /\b(tolls?|linkt|eastlink|citylink|e[\s-]*way|go\s*via|road\s*user\s*charge)\b/i;
const TYRE_RE = /\b(tyres?|tires?|retread)\b/i;
const REPAIR_RE =
  /\b(repairs?|maintenance|servicing|workshop|mechanic|truck\s*repair|parts?\b|filters?|brakes?|bearings?|gaskets?)\b/i;
const OVERNIGHT_MEAL_RE =
  /\b(roadhouse|overnight(?:\s+meal)?|nights?\s+away|travel\s+meals?|meal\s+away)\b/i;
const PHONE_RE = /\b(telstra|optus|vodafone|amaysim|boost\s*mobile)\b/i;
const CLIENT_INVOICE_RE = /\b(clients?|invoice|\binv\b|inv[\s-]*\d+)\b/i;
const MEAL_ALLOW_RE = /\b(meal\s+allowance|travel\s+allowance|lafha|living\s+away)\b/i;
const SALARY_RE = /\b(salary|wages?|payg|payslip|payroll)\b/i;

function blobOf(vendor, text) {
  return `${vendor || ""}\n${text || ""}`;
}

/**
 * @returns {{ category: string, source: string } | null}
 */
function categorizeExpense({ product = "haulage", vendor = "", text = "", suggested = "" } = {}) {
  const src = blobOf(vendor, text);
  const suite = product === "suite";
  const fuelish = FUEL_ITEM_RE.test(src);
  const food = FOOD_ITEM_RE.test(src);
  const brand = FUEL_BRAND_RE.test(src);

  if (!suite && REPAIR_RE.test(src) && !/\b(diesel|unleaded|petrol|ad[\s-]*blue)\b/i.test(src)) {
    return { category: "repairs_maintenance", source: "hub_parts" };
  }

  if (brand && fuelish && !(food && !/\b(diesel|unleaded|petrol|ad[\s-]*blue|fuel)\b/i.test(src))) {
    return {
      category: "fuel",
      source: suite ? "suite_fuel_vendor" : "hub_truck_fuel",
    };
  }

  // Use the docket text, not a remembered legal name ("Roadhouse Cafe Pty Ltd").
  if (OVERNIGHT_MEAL_RE.test(String(text || "")) && !fuelish) {
    return { category: "meals", source: suite ? "suite_travel_meal" : "hub_overnight_meal" };
  }

  if (!suite && TOLL_RE.test(src)) {
    return { category: "parking_tolls", source: "hub_tolls" };
  }
  if (!suite && TYRE_RE.test(src)) {
    return { category: "tyres", source: "hub_tyres" };
  }
  if (!suite && REPAIR_RE.test(src) && !/\b(diesel|unleaded|petrol)\b/i.test(src)) {
    return { category: "repairs_maintenance", source: "hub_repairs" };
  }

  if (suite && PHONE_RE.test(src)) {
    return { category: "phone_internet", source: "suite_phone" };
  }

  if (TOLL_RE.test(src)) return { category: "parking_tolls", source: "keyword_toll" };
  if (TYRE_RE.test(src)) return { category: "tyres", source: "keyword_tyre" };

  if (suggested) return { category: suggested, source: "passthrough" };
  return null;
}

/**
 * @returns {{ type: string, source: string } | null}
 */
function categorizeIncome({ product = "haulage", text = "", suggested = "" } = {}) {
  const src = String(text || "");
  if (MEAL_ALLOW_RE.test(src) && !SALARY_RE.test(src)) {
    return { type: "allowance_travel", source: "meal_allowance" };
  }
  if (product === "suite" && CLIENT_INVOICE_RE.test(src) && !SALARY_RE.test(src)) {
    return { type: "business_income", source: "suite_client_invoice" };
  }
  if (suggested) return { type: suggested, source: "passthrough" };
  return null;
}

module.exports = {
  categorizeExpense,
  categorizeIncome,
  FUEL_BRAND_RE,
  FUEL_ITEM_RE,
  OVERNIGHT_MEAL_RE,
  PHONE_RE,
  CLIENT_INVOICE_RE,
  MEAL_ALLOW_RE,
};
