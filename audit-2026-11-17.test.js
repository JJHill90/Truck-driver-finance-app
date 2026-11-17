/**
 * 17 Nov 2026 live-audit fixtures.
 * Invoice text and CSV rows are the samples used in that pass.
 */
const { parseTaxInvoice, gstAmountFromText, isTaxInvoiceText } = require("./lib/income-invoice");
const { extractBestDocumentDate } = require("./lib/aus-date");
const { categorizeExpense } = require("./lib/product-category-rules");
const { descriptionFromDocument } = require("./lib/scan-description");
const { previewCsv } = require("./lib/csv-import");
const { listMenuCategories } = require("./lib/expense-menu");
const suiteAto = require("./lib/suite/ato");
const { assessDocumentFy, outsideFySaveAllowed } = require("./lib/fy-date-guard");
const { estimateFuelTaxCredit, extractDieselLitres } = require("./lib/fuel-tax-credit");
const { incomeTypeForInvoice } = require("./lib/income-invoice");
const { listMenuIncomeTypes: listSuiteIncomeTypes } = require("./lib/suite/menus");
const { listMenuIncomeTypes: listHubIncomeTypes } = require("./lib/income-menu");
const fs = require("fs");
const path = require("path");
const { preserveDriverType } = require("./lib/hub-profile");
const { truckDriverMealsForYear, travelRatesForYear } = require("./lib/historical-rates");
const { summariseOvernightDays } = require("./lib/overnight-days");
const { summariseYear } = require("./lib/suite/tax");

const SUITE_INVOICE = `TAX INVOICE  INV-1047
From: Joshua Test Trading
ABN 11 222 333 444
To: Logan Freight Pty Ltd
Date: 01/11/2026  Due: 15/11/2026

Courier services Oct 2026
40 hrs @ $55.00          $2,200.00
GST 10%                    $220.00
TOTAL DUE                  $2,420.00

Pay to BSB 064-000 Acc 12345678
`;

const HUB_INVOICE = `TAX INVOICE  HAUL-0312
From: Test Haulage (owner driver)
ABN 99 888 777 666
To: Toll Transport Pty Ltd
Date: 12/11/2026  Due: 26/11/2026

Linehaul BNE-SYD 2 trips     $6,000.00
GST 10%                        $600.00
TOTAL DUE                      $6,600.00
`;

const BP_FUEL = `BP Crestmead
ABN 53 004 085 616
Date: 05/11/2026 07:41
TAX INVOICE

Unleaded 91  42.10L @ 1.899
FUEL                         $79.95

TOTAL                        $79.95
GST INCLUDED                  $7.27
PAID CARD ****4821
`;

const HUB_DIESEL = `AMPOL Truckstop Gatton
ABN 40 004 201 307
Date: 06/11/2026 03:12
TAX INVOICE

Diesel  412.00L @ 2.049
FUEL                         $844.19
AdBlue 20L                    $35.81

TOTAL                        $880.00
GST INCLUDED                  $80.00
FLEETCARD ****7730
`;

const HUB_MEAL = `Caltex Roadhouse Goondiwindi
Date: 10/11/2026 19:40
TAX INVOICE

Steak & chips                $28.50
Flat white                    $5.50

TOTAL                         $34.00
GST INCLUDED                   $3.09
`;

const SUITE_CSV = `date,description,amount,type
2026-10-02,Telstra mobile plan,-89.00,expense
2026-10-10,Salary PAYG Acme Pty Ltd,3200.00,income
2026-10-15,Uber Eats,-34.50,expense
2026-10-20,Client payment Logan Freight,2420.00,income
2026-10-28,Officeworks stationery,-45.20,expense
`;

const HUB_CSV = `date,description,amount,type
2026-10-03,Linkt tolls,-142.60,expense
2026-10-08,Payslip Linfox PAYG,2950.00,income
2026-10-12,Fuel BP Truckstop,-910.40,expense
2026-10-19,Meal allowance received,180.00,income
2026-10-25,Tyre replacement,-1480.00,expense
`;

const AUDIT_NOW = new Date("2026-11-17T12:00:00");

describe("tax invoices are not payslips", () => {
  it("reads the Suite INV-1047 bill-to, issue date and GST amount", () => {
    expect(isTaxInvoiceText(SUITE_INVOICE)).toBe(true);
    expect(isTaxInvoiceText(BP_FUEL)).toBe(false);
    const parsed = parseTaxInvoice(SUITE_INVOICE, {
      product: "suite",
      entityType: "sole_trader",
      selectedFy: "2026-27",
    });
    expect(parsed.payer).toBe("Logan Freight Pty Ltd");
    expect(parsed.issuer).toMatch(/Joshua Test Trading/);
    expect(parsed.date).toBe("2026-11-01");
    expect(parsed.dueDate).toBe("2026-11-15");
    expect(parsed.gstAmount).toBe(220);
    expect(parsed.grossTotal).toBe(2420);
    expect(parsed.suggestedIncomeType).toBe("business_income");
    expect(incomeTypeForInvoice("suite", "employee")).toBe("business_income");
    expect(incomeTypeForInvoice("suite", "partnership")).toBe("services_income");
    expect(incomeTypeForInvoice("haulage", "employee")).toBe("remittance_owner");
    expect(parsed.suggestedIncomeType).not.toBe("salary_wages");
    expect(parsed.description).toMatch(/Courier services/i);
    expect(parsed.dateOutsideSelectedFy).toBe(false);
    expect(gstAmountFromText(SUITE_INVOICE)).toBe(220);
  });

  it("reads the Hub HAUL-0312 issue date in 2026, not the due date in 2025", () => {
    const parsed = parseTaxInvoice(HUB_INVOICE, { product: "haulage", selectedFy: "2026-27" });
    expect(parsed.payer).toBe("Toll Transport Pty Ltd");
    expect(parsed.date).toBe("2026-11-12");
    expect(parsed.date).not.toBe("2025-11-26");
    expect(parsed.dueDate).toBe("2026-11-26");
    expect(parsed.gstAmount).toBe(600);
    expect(parsed.grossTotal).toBe(6600);
    expect(parsed.suggestedIncomeType).toBe("remittance_owner");
    const picked = extractBestDocumentDate(HUB_INVOICE, "income", AUDIT_NOW);
    expect(picked.date).toBe("2026-11-12");
  });

  it("flags an issue date outside the selected financial year", () => {
    const parsed = parseTaxInvoice(SUITE_INVOICE, {
      product: "suite",
      entityType: "sole_trader",
      selectedFy: "2025-26",
    });
    expect(parsed.documentFinancialYear).toBe("2026-27");
    expect(parsed.dateOutsideSelectedFy).toBe(true);
    expect(assessDocumentFy("2026-11-01", "2025-26").outside).toBe(true);
    expect(assessDocumentFy("2026-11-01", "2026-27").outside).toBe(false);
    expect(outsideFySaveAllowed({ outside: true, acknowledged: false })).toBe(false);
    expect(outsideFySaveAllowed({ outside: true, acknowledged: true })).toBe(true);
    expect(outsideFySaveAllowed({ outside: false, acknowledged: false })).toBe(true);
    const client = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(client).toMatch(/data-fy-ack/);
    expect(client).toMatch(/acknowledgeOutsideFy = outsideFyChecked\(\)/);
    expect(client).not.toMatch(/fyWarning\) payload\.acknowledgeOutsideFy = true/);
  });
});

describe("Suite and Hub categories stay separate", () => {
  it("labels Hub fuel as truck fuel and Suite fuel as work-car fuel", () => {
    const hub = listMenuCategories().find((c) => c.id === "fuel");
    expect(hub.label).toBe("Truck fuel & AdBlue");
    expect(hub.label).not.toMatch(/work car/i);
    expect(suiteAto.EXPENSE_CATEGORIES.fuel.label).toMatch(/work car/i);
    expect(listMenuCategories().some((c) => c.id === "compulsory_assessment")).toBe(false);
    expect(listMenuCategories().some((c) => c.id === "vehicle_car")).toBe(false);
    expect(listMenuCategories().map((c) => c.id)).toEqual(
      expect.arrayContaining(["repairs_maintenance", "tyres", "parking_tolls", "registration_insurance", "meals"])
    );
  });

  it("maps BP unleaded to fuel for Suite and Ampol diesel to truck fuel for Hub", () => {
    const suiteHit = categorizeExpense({ product: "suite", vendor: "BP Crestmead", text: BP_FUEL });
    const hubHit = categorizeExpense({ product: "haulage", vendor: "AMPOL Truckstop Gatton", text: HUB_DIESEL });
    expect(suiteHit).toMatchObject({ category: "fuel", source: "suite_fuel_vendor" });
    expect(hubHit).toMatchObject({ category: "fuel", source: "hub_truck_fuel" });
  });

  it("sends a roadhouse meal to overnight meals, not groceries", () => {
    const hit = categorizeExpense({
      product: "haulage",
      vendor: "Caltex Roadhouse Goondiwindi",
      text: HUB_MEAL,
      suggested: "groceries_travel",
    });
    expect(hit.category).toBe("meals");
    expect(hit.category).not.toBe("groceries_travel");
  });
});

describe("descriptions and diesel fuel tax credit", () => {
  it("fills a description from the line item", () => {
    expect(descriptionFromDocument({ text: BP_FUEL, vendor: "BP Crestmead" })).toMatch(/Unleaded 91/i);
    expect(descriptionFromDocument({ text: HUB_MEAL, vendor: "Caltex Roadhouse Goondiwindi" })).toMatch(/Steak/i);
    expect(descriptionFromDocument({ text: SUITE_INVOICE })).toMatch(/Courier services/i);
  });

  it("estimates BAS 7D from diesel litres at the ATO heavy-vehicle rate", () => {
    expect(extractDieselLitres(HUB_DIESEL)).toBe(412);
    const credit = estimateFuelTaxCredit({ text: HUB_DIESEL, date: "2026-11-06" });
    expect(credit.litres).toBe(412);
    expect(credit.use).toBe("on_road");
    expect(credit.centsPerLitre).toBe(21.3);
    expect(credit.amount).toBeCloseTo(87.76, 2);
    expect(credit.basLabel).toBe("7D");
    const offRoad = credit.options.find((row) => row.id === "off_road");
    const onRoad = credit.options.find((row) => row.id === "on_road");
    expect(onRoad.centsPerLitre).toBe(21.3);
    expect(offRoad.centsPerLitre).toBe(53.7);
    expect(offRoad.amount).toBeCloseTo(221.24, 2);
    const chosen = estimateFuelTaxCredit({ text: HUB_DIESEL, date: "2026-11-06", use: "off_road" });
    expect(chosen.use).toBe("off_road");
    expect(chosen.amount).toBeCloseTo(221.24, 2);
    expect(estimateFuelTaxCredit({ text: HUB_MEAL, date: "2026-11-10" })).toBeNull();
  });
});

describe("CSV keyword review", () => {
  it("categorises the Suite statement before import", () => {
    const preview = previewCsv(SUITE_CSV, { product: "suite" });
    expect(preview.reviewRequired).toBe(true);
    const telstra = preview.rows.find((r) => /telstra/i.test(r.description));
    const client = preview.rows.find((r) => /logan freight/i.test(r.description));
    const salary = preview.rows.find((r) => /salary/i.test(r.description));
    expect(telstra.category).toBe("phone_internet");
    expect(client.purpose).toBe("income");
    expect(client.type).toBe("business_income");
    expect(salary.type).toBe("salary_wages");
  });

  it("keeps Hub tolls, fuel and tyres off Other, and meal allowance off salary", () => {
    const preview = previewCsv(HUB_CSV, { product: "haulage" });
    expect(preview.reviewRequired).toBe(true);
    const byDesc = (re) => preview.rows.find((r) => re.test(r.description));
    expect(byDesc(/tolls/i).category).toBe("parking_tolls");
    expect(byDesc(/fuel/i).category).toBe("fuel");
    expect(byDesc(/tyre/i).category).toBe("tyres");
    expect(byDesc(/meal allowance/i).type).toBe("allowance_travel");
    expect(byDesc(/meal allowance/i).type).not.toBe("salary_wages");
    expect(byDesc(/payslip/i).type).toBe("salary_wages");
  });
});

describe("TD 2026/4 meal caps come from config", () => {
  it("sums Table 5 breakfast, lunch and dinner to $132.50 without inventing a separate figure", () => {
    const meals = truckDriverMealsForYear("2026-27");
    const rates = travelRatesForYear("2026-27");
    expect(rates.determination).toBe("TD 2026/4");
    expect(meals.breakfast.cap).toBe(32.25);
    expect(meals.lunch.cap).toBe(36.8);
    expect(meals.dinner.cap).toBe(63.45);
    expect(rates.truckDriverMealsDailyTotal).toBeCloseTo(32.25 + 36.8 + 63.45, 2);
    expect(rates.truckDriverMealsDailyTotal).toBeCloseTo(132.5, 2);
  });

  it("counts an overnight meal receipt toward travel days", () => {
    const summary = summariseOvernightDays(
      {
        income: [],
        expenses: [
          {
            id: "m1",
            date: "2026-11-10",
            category: "meals",
            vendor: "Caltex Roadhouse Goondiwindi",
            description: "Steak & chips",
            amount: 34,
          },
        ],
      },
      { financialYear: "2026-27" },
      "2026-27"
    );
    expect(summary.daysClaimed).toBe(1);
    expect(summary.entries[0].source).toBe("overnight_meal_receipt");
    expect(summary.note).toMatch(/TD 2026\/4/);
    expect(summary.note).toMatch(/32\.25/);
    expect(summary.mealCaps.dinner.cap).toBe(63.45);
  });
});

describe("Suite employees can select business income; Hub cannot", () => {
  it("puts business sales on the Suite employee menu and leaves it off Hub", () => {
    const employee = listSuiteIncomeTypes("employee").map((row) => row.id);
    const trader = listSuiteIncomeTypes("sole_trader").map((row) => row.id);
    const partnership = listSuiteIncomeTypes("partnership").map((row) => row.id);
    expect(employee).toContain("business_income");
    expect(trader).toContain("business_income");
    expect(partnership).not.toContain("business_income");
    expect(partnership).toContain("services_income");
    expect(listHubIncomeTypes().map((row) => row.id)).not.toContain("business_income");
    const label = listSuiteIncomeTypes("employee").find((row) => row.id === "business_income").label;
    expect(label).toMatch(/Business sales/i);
  });
});

describe("profile driver type is not rewritten to linehaul", () => {
  it("keeps Local driver when the saved value is local or the label is posted back", () => {
    expect(preserveDriverType("local", "local")).toBe("local");
    expect(preserveDriverType("Local driver", "local")).toBe("local");
    expect(preserveDriverType("", "local")).toBe("local");
    expect(preserveDriverType("linehaul", "local")).toBe("long_haul");
  });
});

describe("Suite EOFY indicators", () => {
  it("adds the GST threshold, marginal bracket and instant asset write-off flag", () => {
    const summary = summariseYear(
      {
        income: [{ id: "i1", type: "business_income", date: "2026-10-20", amount: 2420, grossTotal: 2420 }],
        expenses: [
          { id: "e1", category: "tools_equipment", date: "2026-11-12", amount: 200, deletedAt: null },
          { id: "e2", category: "phone_internet", date: "2026-10-02", amount: 89 },
        ],
      },
      { entityType: "sole_trader", financialYear: "2026-27", gstRegistered: false }
    );
    expect(summary.substantiation.threshold).toBe(300);
    expect(summary.gstTurnover.threshold).toBe(75000);
    expect(summary.gstTurnover.overThreshold).toBe(false);
    expect(summary.taxEstimate.brackets.length).toBeGreaterThan(1);
    expect(summary.taxEstimate.marginalRateLabel).toBeTruthy();
    expect(summary.instantAssetWriteOffFlag.threshold).toBeGreaterThan(300);
    expect(summary.instantAssetWriteOffFlag.note).toMatch(/instant asset write-off/i);
  });
});
