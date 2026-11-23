/**
 * 24 Nov 2026 audit. Suite and Hub stay on separate rules.
 */
const fs = require("fs");
const path = require("path");
const { applyAbnEntityPairing } = require("./lib/abn-entity");
const { gstAmountFromText } = require("./lib/income-invoice");
const { extractDieselLitres, creditFromStoredInputs } = require("./lib/fuel-tax-credit");
const { buildHubGstTracker } = require("./lib/hub-gst-tracker");
const { resolveRegistration, buildAccountantPack } = require("./lib/accountant-pack");
const { mapExpenseSchedule } = require("./lib/ato-return-labels");
const { previewCsv } = require("./lib/csv-import");
const { summariseYear, applySuiteBusinessIncomeGst } = require("./lib/suite/tax");
const { profilePace } = require("./lib/profile-pace");
const { eofyPdfBasename } = require("./lib/report-pdf");

const root = __dirname;

describe("24 Nov — ABN formats and GST dollars", () => {
  it("reads spaced, dotted, unspaced and next-line ABNs", () => {
    const samples = [
      ["AMPOL\nA.B.N. 40 004 201 307\nDIESEL", "40004201307"],
      ["BUNNINGS\nABN\n26 008 672 179", "26008672179"],
      ["OFFICEWORKS ABN: 36.004.763.526", "36004763526"],
      ["BP 53004085616", "53004085616"],
      ["TAX INVOICE\nFrom: Client\nABN 11 222 333 444\nTo: Studio", "11222333444"],
    ];
    for (const [text, digits] of samples) {
      const ocr = applyAbnEntityPairing({ rawText: text, vendor: "" });
      expect(String(ocr.vendorAbn || "").replace(/\s/g, "")).toBe(digits);
    }
  });

  it("reads GST $80 and ignores a bare 10% rate", () => {
    expect(gstAmountFromText("DIESEL\nGST 10%\nGST $80.00\nTOTAL $880.00")).toBe(80);
    expect(gstAmountFromText("GST 10%")).toBeNull();
  });

  it("prefills 412 litres from a diesel line", () => {
    expect(extractDieselLitres("AMPOL DIESEL 412.00 L @ 1.95")).toBe(412);
  });
});

describe("24 Nov — Hub fuel tax credit, GST tracker and registration", () => {
  it("computes 7D only after litres are stored", () => {
    expect(creditFromStoredInputs({ category: "fuel", date: "2026-11-05", dieselLitres: 412, use: "on_road" }).amount).toBeCloseTo(
      87.76,
      2
    );
    const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
    expect(app).toMatch(/id="enh-ftc-litres"/);
    expect(app).toMatch(/Fuel tax credit \(BAS 7D\)/);
  });

  it("does not shrink ex-GST business income by an assumed 1/11", () => {
    const tracker = buildHubGstTracker(
      {
        income: [
          { date: "2026-08-01", type: "business_income", amount: 15000, grossTotal: 15000 },
          { date: "2026-08-02", type: "remittance_owner", amount: 5363.64, grossTotal: 5363.64 },
          { date: "2026-08-03", type: "services_income", amount: 5000, grossTotal: 5000 },
        ],
      },
      "2026-27"
    );
    expect(tracker.recorded).toBe(25363.64);
  });

  it("uses owner-driver wording when business income exists", () => {
    const records = {
      income: [{ id: "i1", date: "2026-08-01", type: "remittance_owner", amount: 6600, payer: "Toll", vendorAbn: "99888777666" }],
      expenses: [{ id: "e1", date: "2026-08-02", category: "fuel", amount: 880 }],
      profile: { driverType: "local", financialYear: "2026-27", name: "Alex" },
    };
    const reg = resolveRegistration(records.profile, "haulage", records);
    expect(reg.label).toMatch(/Owner-driver/);
    expect(reg.id).toBe("sole_trader");
    expect(mapExpenseSchedule("fuel", "D2 – Work-related travel expenses", { product: "haulage", entity: "sole_trader" }).label).toMatch(
      /Business schedule/
    );
    expect(mapExpenseSchedule("repairs_maintenance", "D2 – Work-related travel expenses", { product: "haulage", entity: "sole_trader" }).label).toMatch(
      /Business schedule/
    );
    const pack = buildAccountantPack(records, records.profile, { product: "haulage", financialYear: "2026-27" });
    expect(pack.registration.label).toMatch(/Owner-driver/);
  });

  it("leaves payslip and allowance rows unticked for an owner-driver", () => {
    const csv = "Date,Description,Amount\n01/08/2026,Payslip Linfox PAYG,3200\n02/08/2026,Meal allowance received,180\n03/08/2026,Toll invoice,6600\n";
    const preview = previewCsv(csv, {
      product: "haulage",
      records: { profile: { driverType: "owner_driver" }, expenses: [], income: [], receipts: [] },
    });
    const payslip = preview.rows.find((row) => /linfox/i.test(row.description));
    const allowance = preview.rows.find((row) => /allowance/i.test(row.description));
    expect(payslip.include).toBe(false);
    expect(allowance.include).toBe(false);
    expect(payslip.warning).toMatch(/owner-driver/i);
  });

  it("labels the profile total as an income target for an owner-driver", () => {
    expect(profilePace({ driverType: "owner_driver", annualSalary: 120000 }, 0).targetLabel).toBe("Income target");
  });

  it("strips a TAX; bank prefix and the income page leads with the income file input when that view is active", () => {
    const csv = "Date,Description,Amount\n01/08/2026,TAX; BUNNINGS WAREHOUSE,-42.00\n";
    const preview = previewCsv(csv, { product: "suite" });
    expect(preview.rows[0].vendor).not.toMatch(/^TAX\b/i);
    expect(preview.rows[0].description).not.toMatch(/^TAX;/i);
    const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
    expect(app).toMatch(/input\.disabled = !on/);
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    expect(html).toMatch(/id="income-abn"/);
    expect(html).toMatch(/Scan an invoice or payslip/);
  });
});

describe("24 Nov — Suite taxable GST, branding and ABN", () => {
  it("stores taxable income excluding the invoice GST", () => {
    const payload = applySuiteBusinessIncomeGst({
      type: "business_income",
      amount: 2420,
      grossTotal: 2420,
      gstAmount: 220,
    });
    expect(payload.taxableIncome).toBe(2200);
    const summary = summariseYear(
      {
        income: [{ date: "2026-08-01", type: "business_income", amount: 2420, grossTotal: 2420, gstAmount: 220 }],
        expenses: [],
      },
      { financialYear: "2026-27", entityType: "sole_trader" }
    );
    expect(summary.income.assessableTotal).toBe(2200);
  });

  it("names the Suite PDF footer and keeps the Suite download name", () => {
    const pdf = fs.readFileSync(path.join(root, "lib/report-pdf.js"), "utf8");
    expect(pdf).toMatch(/Go Taxation Suite/);
    expect(eofyPdfBasename("suite", "2026-27")).toBe("suite-eofy-2026-27.pdf");
    const js = fs.readFileSync(path.join(root, "public/enhancements.js"), "utf8");
    expect(js).toMatch(/general ATO individual and small-business standards/);
    expect(js).toMatch(/haulageRefreshAlerts/);
    expect(js).not.toMatch(/\/api\/haulage\/\(report\|forecast\)/);
  });
});
