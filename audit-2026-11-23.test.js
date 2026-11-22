/**
 * 23 Nov 2026 live audit. Suite and Hub stay on separate rules.
 */
const fs = require("fs");
const path = require("path");
const { bracketsForYear, incomeTaxForYear } = require("./lib/historical-rates");
const { summariseYear } = require("./lib/tax-calculator");
const suiteTax = require("./lib/suite/tax");
const { summariseExpensesByCategory } = require("./lib/report-ledgers");
const { eofyPdfBasename } = require("./lib/report-pdf");
const { buildHubGstTracker } = require("./lib/hub-gst-tracker");
const { buildLodgementBrief } = require("./lib/accountant-brief");
const { previewCsv } = require("./lib/csv-import");
const { applyAbnEntityPairing } = require("./lib/abn-entity");
const { parseTaxInvoice } = require("./lib/income-invoice");
const { creditFromStoredInputs } = require("./lib/fuel-tax-credit");
const { summariseOvernightDays } = require("./lib/overnight-days");
const { buildForecast } = require("./lib/forecast");

const root = __dirname;

describe("23 Nov — FY2026-27 tax brackets are 15% to $45,000", () => {
  it("keeps 16% for 2025-26 and uses 15% from 2026-27", () => {
    const prior = bracketsForYear("2025-26").find((b) => b.upTo === 45000);
    const next = bracketsForYear("2026-27").find((b) => b.upTo === 45000);
    expect(prior.rate).toBe(0.16);
    expect(next.rate).toBe(0.15);
    // 50,200: 26,800 * 0.15 + 5,200 * 0.30 = 4,020 + 1,560
    expect(incomeTaxForYear(50200, "2026-27")).toBeCloseTo(5580, 2);
    expect(incomeTaxForYear(50200, "2025-26")).toBeCloseTo(5848, 2);
  });

  it("shows 15% on the Suite bracket table for FY2026-27", () => {
    const summary = suiteTax.summariseYear(
      { income: [{ date: "2026-08-01", type: "salary_wages", amount: 50000 }], expenses: [] },
      { financialYear: "2026-27", entityType: "employee" }
    );
    const band = summary.taxEstimate.brackets.find((b) => b.upTo === 45000);
    expect(band.rate).toBe(0.15);
  });
});

describe("23 Nov — EOFY PDF names and category maps stay with the app", () => {
  const rows = [
    { date: "2026-08-02", category: "fuel", amount: 80 },
    { date: "2026-08-03", category: "office_admin", amount: 40 },
  ];

  it("uses Suite labels and D1 for work-car fuel", () => {
    const summary = summariseExpensesByCategory(rows, "2026-27", "suite");
    const fuel = summary.find((r) => r.category === "fuel");
    const office = summary.find((r) => r.category === "office_admin");
    expect(fuel.label).toMatch(/Fuel \(work car/);
    expect(fuel.atoSchedule).toBe("D1");
    expect(office.label).toMatch(/Stationery/);
    expect(office.label).not.toMatch(/Logbook/);
    expect(eofyPdfBasename("suite", "2026-27")).toBe("suite-eofy-2026-27.pdf");
  });

  it("keeps Hub truck fuel and the logbook label", () => {
    const summary = summariseExpensesByCategory(rows, "2026-27", "haulage");
    const fuel = summary.find((r) => r.category === "fuel");
    const office = summary.find((r) => r.category === "office_admin");
    expect(fuel.label).toMatch(/Truck fuel/);
    expect(fuel.atoSchedule).toBe("D2");
    expect(office.label).toMatch(/Logbook/);
    expect(eofyPdfBasename("haulage", "2026-27")).toBe("haulage-eofy-2026-27.pdf");
  });

  it("names the Suite download from the Suite page", () => {
    const js = fs.readFileSync(path.join(root, "public/enhancements.js"), "utf8");
    expect(js).toMatch(/suite" : "haulage"\}-eofy/);
    expect(js).toMatch(/\/api\/suite/);
  });
});

describe("23 Nov — GST $75k trackers", () => {
  it("counts Suite business income excluding GST and salary", () => {
    const summary = suiteTax.summariseYear(
      {
        income: [
          { date: "2026-08-01", type: "salary_wages", amount: 3200 },
          { date: "2026-08-02", type: "business_income", amount: 4840, grossTotal: 4840, gstAmount: 440 },
        ],
        expenses: [],
      },
      { financialYear: "2026-27", entityType: "sole_trader", gstRegistered: true }
    );
    expect(summary.gstTurnover.recorded).toBe(4400);
    expect(summary.income.salaryAssessable).toBe(3200);
  });

  it("counts Hub business income excluding GST and formats thousands", () => {
    const gst = buildHubGstTracker(
      {
        income: [
          { date: "2026-08-01", type: "salary_wages", amount: 2000 },
          {
            date: "2026-08-02",
            type: "remittance_owner",
            amount: 6600,
            grossTotal: 6600,
            gstAmount: 600,
          },
        ],
      },
      "2026-27"
    );
    expect(gst.recorded).toBe(6000);
    expect(gst.remaining).toBe(69000);
    expect(gst.note).toMatch(/\$6,000\.00/);
    expect(gst.note).toMatch(/\$75,000\.00/);
  });
});

describe("23 Nov — salary target ignores business income", () => {
  const income = [
    { date: "2026-08-01", type: "salary_wages", amount: 120000, taxableIncome: 120000 },
    { date: "2026-08-02", type: "business_income", amount: 2422.5, taxableIncome: 2422.5 },
  ];

  it("splits Hub salary and business", () => {
    const summary = summariseYear(
      { income, expenses: [] },
      { financialYear: "2026-27", driverType: "local", annualSalary: 120000 }
    );
    expect(summary.income.salaryAssessable).toBe(120000);
    expect(summary.income.businessAssessable).toBe(2422.5);
    expect(summary.income.salaryAssessable).not.toBe(summary.income.assessableTotal);
  });

  it("splits Suite salary and business", () => {
    const summary = suiteTax.summariseYear(
      { income, expenses: [] },
      { financialYear: "2026-27", entityType: "employee", annualSalary: 85000 }
    );
    expect(summary.income.salaryAssessable).toBe(120000);
    expect(summary.income.businessAssessable).toBeGreaterThan(0);
    expect(summary.income.salaryAssessable).toBeLessThan(summary.income.assessableTotal);
  });

  it("puts salary and business on the Hub forecast year to date", () => {
    const forecast = buildForecast(
      { income, expenses: [] },
      { financialYear: "2026-27", driverType: "local", annualSalary: 120000 }
    );
    expect(forecast.yearToDate.salaryIncome).toBe(120000);
    expect(forecast.yearToDate.businessIncome).toBe(2422.5);
  });
});

describe("23 Nov — scanner ABN, invoice date and document kind", () => {
  it("reads Bunnings, Officeworks, Ampol and invoice ABNs", () => {
    const samples = [
      ["BUNNINGS WAREHOUSE\nABN 26 008 672 179\nTOTAL 45.00", "26008672179"],
      ["OFFICEWORKS\nABN: 36 004 763 526\nTOTAL 22.00", "36004763526"],
      ["AMPOL\nABN 40 004 201 307\nDIESEL 412 L", "40004201307"],
      ["TAX INVOICE\nFrom: Hill Haulage\nABN 99 888 777 666\nTo: Acme\nDate: 01/11/2026", "99888777666"],
    ];
    for (const [text, digits] of samples) {
      const ocr = applyAbnEntityPairing({ rawText: text, vendor: "" });
      expect(String(ocr.vendorAbn || "").replace(/\s/g, "")).toBe(digits);
    }
  });

  it("shows the issue date that will be saved, not the due date", () => {
    const parsed = parseTaxInvoice(
      "TAX INVOICE\nFrom: Hill Haulage\nTo: Acme Pty Ltd\nInvoice date 01/11/2026\nDue date 03/11/2026\nABN 99 888 777 666\nTotal $2,420.00\nGST $220.00"
    );
    expect(parsed.date).toBe("2026-11-01");
    expect(parsed.issueDate).toBe("2026-11-01");
    expect(parsed.dueDate).toBe("2026-11-03");
    expect(parsed.documentKind).toBe("tax_invoice");
  });
});

describe("23 Nov — CSV personal rows start unticked", () => {
  it("flags Uber Eats as likely personal", () => {
    const csv = "Date,Description,Amount\n01/11/2026,Uber Eats Sydney,-42.50\n02/11/2026,Ampol diesel,-180.00\n";
    const preview = previewCsv(csv, { product: "suite" });
    expect(preview.ok).toBe(true);
    const eats = preview.rows.find((row) => /uber/i.test(row.description));
    const fuel = preview.rows.find((row) => /ampol/i.test(row.description));
    expect(eats.include).toBe(false);
    expect(eats.warning).toMatch(/likely personal/i);
    expect(fuel.include).toBe(true);
  });
});

describe("23 Nov — Hub fuel tax credit only from stored inputs", () => {
  it("does not invent 7D from receipt text alone", () => {
    expect(
      creditFromStoredInputs({
        category: "fuel",
        date: "2026-11-05",
        text: "AMPOL DIESEL 412 L",
      })
    ).toBeNull();
  });

  it("computes 7D when litres and use were stored", () => {
    const credit = creditFromStoredInputs({
      category: "fuel",
      dieselLitres: 412,
      date: "2026-11-05",
      use: "on_road",
    });
    expect(credit.litres).toBe(412);
    expect(credit.basLabel).toBe("7D");
    expect(credit.amount).toBeCloseTo(87.76, 2);
  });
});

describe("23 Nov — lodgement wording follows income types", () => {
  it("does not stay on the salary-only title when business income exists", () => {
    const brief = buildLodgementBrief(
      {
        income: [
          { date: "2026-08-01", type: "salary_wages", amount: 8000 },
          { date: "2026-08-02", type: "remittance_owner", amount: 6600, description: "Item 15" },
        ],
        expenses: [],
      },
      { driverType: "local", financialYear: "2026-27", name: "Alex" },
      { financialYear: "2026-27" },
      { product: "haulage" }
    );
    expect(brief.returnTitle).not.toMatch(/salary and wages/);
    expect(brief.returnTitle).toMatch(/sole trader/i);
  });
});

describe("23 Nov — LAFHA sources are not all called payslips", () => {
  it("labels a meal receipt and a CSV allowance row", () => {
    const snap = summariseOvernightDays(
      {
        income: [
          {
            id: "csv1",
            date: "2026-08-04",
            type: "allowance_travel",
            amount: 265,
            source: "csv_import",
            description: "Travel allowance",
          },
        ],
        expenses: [
          {
            id: "meal1",
            date: "2026-08-05",
            category: "meals_dinner",
            amount: 28,
            vendor: "Roadhouse overnight",
            overnightMeal: true,
          },
        ],
      },
      { financialYear: "2026-27" },
      "2026-27"
    );
    const kinds = snap.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(["csv_allowance", "meal_receipt"]);
    expect(snap.entries.find((e) => e.kind === "meal_receipt").label).not.toMatch(/payslip/i);
    const js = fs.readFileSync(path.join(root, "public/enhancements.js"), "utf8");
    expect(js).toMatch(/meal receipt/);
    expect(js).toMatch(/CSV allowance row/);
    expect(js).not.toMatch(/Payslips counted/);
  });
});

describe("23 Nov — expense delete labels and scan compliance text", () => {
  it("labels photo delete separately from the ledger row delete", () => {
    const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
    expect(app).toMatch(/Delete photo only/);
    expect(app).toMatch(/data-del-expense/);
    expect(app).toMatch(/>Delete<\/button>/);
  });

  it("does not print the raw within_policy token on the scan card", () => {
    const js = fs.readFileSync(path.join(root, "public/enhancements.js"), "utf8");
    expect(js).toMatch(/Within ATO policy/);
    expect(js).toMatch(/statusLabel/);
    expect(js).toMatch(/reasonable amount/);
    expect(js).toMatch(/the allowance/);
  });

  it("refreshes the dashboard and EOFY after income changes", () => {
    const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
    expect(app).toMatch(/name === "report" \|\| name === "dashboard"/);
    expect(app).toMatch(/Income deleted/);
    expect(app).toMatch(/refreshEofyLive/);
  });
});
