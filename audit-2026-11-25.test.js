/**
 * 25 Nov 2026 live audit (v4.27). Scanner fields, HEIC, tax invoices,
 * Suite income saves, employee tools, and the Hub GST tracker.
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const auth = require("./lib/auth");
const suite = require("./lib/suite");
const { extractIncomeFromPdf } = require("./lib/income-document-ocr");
const { extractReceiptData } = require("./lib/receipt-ocr");
const { jpegFromHeic } = require("./lib/heic-image");
const { buildHubGstTracker } = require("./lib/hub-gst-tracker");
const { calcExpenseDeduction } = require("./lib/suite/tax");

const strongPass = "RoadSafe!99x";
const fixtures = path.join(__dirname, "test", "fixtures");

function cookiePair(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const line = raw[0] || res.headers.get("set-cookie") || "";
  return String(line).split(";")[0];
}

describe("25 Nov — Suite income saves", () => {
  it("exports the business GST helper the income route calls", () => {
    expect(typeof suite.applySuiteBusinessIncomeGst).toBe("function");
  });

  it("saves salary, business sales and other assessable income", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "suite-income-"));
    auth.setDataDirForTests(tmp);
    suite.setDataDirForTests(tmp);
    const { app } = require("./server");
    const server = await new Promise((resolve) => {
      const s = http.createServer(app);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = server.address().port;
    const name = `inc_${Date.now().toString(36)}`;
    auth.registerUser(name, strongPass, {}, `${name}@example.test`);
    try {
      const login = await fetch(`http://127.0.0.1:${port}/api/suite/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: name, password: strongPass }),
      });
      expect(login.status).toBe(200);
      const cookie = cookiePair(login);
      const types = [
        ["salary_wages", 1200],
        ["business_income", 100],
        ["other_income", 90],
      ];
      for (const [type, amount] of types) {
        const res = await fetch(`http://127.0.0.1:${port}/api/suite/income`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            type,
            amount,
            grossTotal: amount,
            date: "2026-11-01",
            entity: "Harbour Consulting",
            description: type,
          }),
        });
        const body = await res.json();
        expect(res.status, JSON.stringify(body)).toBe(200);
        expect(body.entry.type).toBe(type);
        expect(body.entry.amount).toBe(amount);
      }
      const records = await fetch(`http://127.0.0.1:${port}/api/suite/records`, {
        headers: { cookie },
      });
      const ledger = await records.json();
      const saved = (ledger.income || ledger.records?.income || []).map((row) => row.type);
      expect(saved).toEqual(expect.arrayContaining(["salary_wages", "business_income", "other_income"]));

      const pdf = fs.readFileSync(path.join(fixtures, "tax-invoice-2page.pdf"));
      const scan = await fetch(`http://127.0.0.1:${port}/api/suite/receipts/scan`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          imageBase64: `data:application/pdf;base64,${pdf.toString("base64")}`,
          mimeType: "application/pdf",
          filename: "tax-invoice.pdf",
          purpose: "income",
          forceDuplicate: true,
        }),
      });
      const scanned = await scan.json();
      expect(scan.status, JSON.stringify(scanned).slice(0, 800)).toBe(200);
      expect(scanned.receipt && scanned.receipt.id, JSON.stringify(Object.keys(scanned))).toBeTruthy();
      expect(scanned.ocrResult.date).toBe("2026-11-01");
      expect(scanned.ocrResult.suggestedIncomeType).toBe("business_income");
      expect(scanned.ocrResult.notes || "").not.toMatch(/no ATO compliance flags/i);
      const confirm = await fetch(
        `http://127.0.0.1:${port}/api/suite/receipts/${scanned.receipt.id}/confirm`,
        {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          confirmed: true,
          purpose: "income",
          type: scanned.ocrResult.suggestedIncomeType,
          amount: scanned.ocrResult.grossTotal,
          grossTotal: scanned.ocrResult.grossTotal,
          gstAmount: scanned.ocrResult.gstAmount,
          taxableIncome: scanned.ocrResult.taxableIncome,
          date: scanned.ocrResult.date,
          entity: scanned.ocrResult.issuer || scanned.ocrResult.entity,
          documentKind: "tax_invoice",
        }),
      });
      const confirmedBody = await confirm.json();
      expect(confirm.status, JSON.stringify(confirmedBody)).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      auth.setDataDirForTests(null);
      suite.setDataDirForTests(null);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("25 Nov — employee tools and GST tracker", () => {
  it("does not deduct an employee tool over $300 in full", () => {
    const row = calcExpenseDeduction(
      { category: "tools_equipment", amount: 467.5, date: "2026-11-01", workUsePercent: 100 },
      { entityType: "employee" }
    );
    expect(row.deductibleAmount).toBeLessThan(467.5);
    expect(row.deductibleAmount).toBeCloseTo(467.5 / 4, 2);
    expect(row.warnings.join(" ")).toMatch(/decline in value/i);
  });

  it("lets a sole trader deduct a tool under the instant asset write-off", () => {
    const row = calcExpenseDeduction(
      { category: "tools_equipment", amount: 467.5, date: "2026-11-01", workUsePercent: 100 },
      { entityType: "sole_trader" }
    );
    expect(row.deductibleAmount).toBeCloseTo(467.5, 2);
  });

  it("counts an owner-driver tax invoice on the GST tracker, ex-GST", () => {
    const tracker = buildHubGstTracker(
      {
        income: [
          {
            type: "salary_wages",
            documentKind: "tax_invoice",
            date: "2026-11-01",
            grossTotal: 825,
            gstAmount: 75,
          },
        ],
      },
      "2026-27"
    );
    expect(tracker.recorded).toBe(750);
  });
});

describe("25 Nov — tax invoice PDF", () => {
  it("uses the invoice date, ABN, GST and ex-GST amount, not the page marker", async () => {
    const buf = fs.readFileSync(path.join(fixtures, "tax-invoice-2page.pdf"));
    const dataUrl = `data:application/pdf;base64,${buf.toString("base64")}`;
    const hub = await extractIncomeFromPdf(dataUrl, { product: "haulage" });
    expect(hub.entity).not.toMatch(/of 2/);
    expect(hub.documentKind).toBe("tax_invoice");
    expect(hub.suggestedIncomeType).toBe("remittance_owner");
    expect(hub.date).toBe("2026-11-01");
    expect(hub.dueDate).toBe("2026-11-15");
    expect(hub.vendorAbn).toMatch(/53\s*004\s*085\s*616/);
    expect(hub.gstAmount).toBe(75);
    expect(hub.invoiceNumber).toMatch(/1842/);
    expect(hub.issuer).toMatch(/Harbour Consulting/);
    expect(hub.billTo || hub.payer).toMatch(/Alex Driver/);
    expect(hub.taxableIncome).toBe(750);
    const suitePdf = await extractIncomeFromPdf(dataUrl, { product: "suite", entityType: "sole_trader" });
    expect(suitePdf.suggestedIncomeType).toBe("business_income");
  });
});

describe("25 Nov — HEIC and local OCR", () => {
  it("converts a real HEIC photo to JPEG", async () => {
    const buf = fs.readFileSync(path.join(fixtures, "sample.heic"));
    const jpeg = await jpegFromHeic(buf);
    expect(jpeg.slice(0, 3).toString("hex")).toBe("ffd8ff");
    expect(jpeg.length).toBeGreaterThan(1000);
  });

  it("reads vendor, date, total, ABN and litres from a receipt image without a vision key", async () => {
    const png = fs.readFileSync(path.join(fixtures, "receipt-clean.png"));
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    const result = await extractReceiptData(null, dataUrl, "image/png", "receipt-clean.png", {
      purpose: "expense",
    });
    expect(result.ocrSource).not.toBe("unreadable");
    expect(result.vendor).toMatch(/OUTBACK/i);
    expect(result.date).toBe("2026-11-01");
    expect(result.amount).toBeCloseTo(86.4, 2);
    expect(result.vendorAbn).toMatch(/53/);
    expect(result.dieselLitres).toBeCloseTo(64.2, 1);
    const jpg = fs.readFileSync(path.join(fixtures, "receipt-faded-exif6.jpg"));
    const faded = await extractReceiptData(
      null,
      `data:image/jpeg;base64,${jpg.toString("base64")}`,
      "image/jpeg",
      "receipt-faded-exif6.jpg",
      { purpose: "expense" }
    );
    expect(faded.vendor).toMatch(/OUTBACK/i);
    expect(faded.amount).toBeCloseTo(86.4, 2);
    expect(faded.date).toBe("2026-11-01");
  }, 180000);
});
