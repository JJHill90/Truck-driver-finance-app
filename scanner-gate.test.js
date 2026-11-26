/**
 * End-to-end scanner gate. Starts the real server and POSTs the fixture
 * files as multipart, the same way the browser uploads a scan.
 * Tesseract, abort handling and image conversion are not mocked.
 *
 * With no OPENAI_API_KEY this must pass on local Tesseract.
 * When a vision key is set, the same assertions run with cloud OCR enabled.
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

process.env.NODE_ENV = "test";
delete process.env.ABR_GUID;

const auth = require("./lib/auth");
const suite = require("./lib/suite");
const { repairOcrKeywords, cleanPartyName, isWeakVendor } = require("./lib/ocr-keywords");
const { categorizeExpense } = require("./lib/product-category-rules");
const suiteMenus = require("./lib/suite/menus");
const { buildExpenseSummaryFromText } = require("./lib/local-receipt-ocr");
const { parseTaxInvoice } = require("./lib/income-invoice");

const strongPass = "RoadSafe!99x";
const fixtures = path.join(__dirname, "test", "fixtures");
const FUEL = {
  vendor: /OUTBACK/i,
  date: "2026-11-01",
  amount: 86.4,
  gst: 7.85,
  abn: /53\s*004\s*085\s*616/,
  litres: 64.2,
};

function cookiePair(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const line = raw[0] || res.headers.get("set-cookie") || "";
  return String(line).split(";")[0];
}

function multipart(file, mime, purpose) {
  const buf = fs.readFileSync(path.join(fixtures, file));
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), file);
  form.append("mimeType", mime);
  form.append("filename", file);
  form.append("purpose", purpose);
  form.append("forceDuplicate", "true");
  return form;
}

describe("scanner gate — real HTTP upload", () => {
  let server;
  let port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-gate-"));

  beforeAll(async () => {
    auth.setDataDirForTests(tmp);
    suite.setDataDirForTests(tmp);
    const { app } = require("./server");
    server = await new Promise((resolve) => {
      const s = http.createServer(app);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    port = server.address().port;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    auth.setDataDirForTests(null);
    suite.setDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function session(base) {
    const name = `gate_${base.replace(/\W/g, "")}_${Date.now().toString(36)}`;
    auth.registerUser(name, strongPass, {}, `${name}@example.test`);
    const login = await fetch(`http://127.0.0.1:${port}${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: name, password: strongPass }),
    });
    expect(login.status).toBe(200);
    return cookiePair(login);
  }

  async function scan(base, cookie, file, mime, purpose) {
    const res = await fetch(`http://127.0.0.1:${port}${base}/receipts/scan`, {
      method: "POST",
      headers: { cookie, accept: "application/json" },
      body: multipart(file, mime, purpose),
    });
    const body = await res.json();
    expect(res.status, JSON.stringify(body).slice(0, 500)).toBe(200);
    return body;
  }

  function expectFuel(body) {
    const o = body.ocrResult || {};
    const notes = String(o.notes || "");
    expect(o.ocrError || "").not.toMatch(/timeout|abort/i);
    expect(notes).not.toMatch(/Couldn't read this receipt/);
    expect(o.ocrSource).not.toBe("unreadable");
    expect(o.vendor || "").toMatch(FUEL.vendor);
    expect(o.date).toBe(FUEL.date);
    expect(Number(o.amount)).toBeCloseTo(FUEL.amount, 2);
    expect(Number(o.gstAmount ?? o.gst)).toBeCloseTo(FUEL.gst, 2);
    expect(String(o.vendorAbn || "")).toMatch(FUEL.abn);
    expect(Number(o.dieselLitres)).toBeCloseTo(FUEL.litres, 1);
  }

  it("reads the fuel fixtures and the tax invoice on Hub and Suite", async () => {
    for (const base of ["/api/haulage", "/api/suite"]) {
      const cookie = await session(base);
      expectFuel(await scan(base, cookie, "receipt-clean.png", "image/png", "expense"));
      expectFuel(await scan(base, cookie, "receipt-faded-exif6.jpg", "image/jpeg", "expense"));
      expectFuel(await scan(base, cookie, "receipt.heic", "image/heic", "expense"));
      const faded = await scan(base, cookie, "receipt-faded-thermal.jpg", "image/jpeg", "expense");
      const fadedOcr = faded.ocrResult || {};
      expect(fadedOcr.vendor || "").toMatch(/CEDAR RIDGE/i);
      expect(fadedOcr.date).toBe("2026-11-08");
      expect(Number(fadedOcr.amount)).toBeCloseTo(96.8, 2);
      expect(Number(fadedOcr.gstAmount ?? fadedOcr.gst)).toBeCloseTo(8.8, 2);
      expect(Number(fadedOcr.dieselLitres)).toBeCloseTo(48.5, 1);
      expect(String(fadedOcr.paymentMethod || "")).toMatch(/visa/i);
      expect(String(fadedOcr.notes || "")).not.toMatch(/Couldn't read/);

      const pdf = await scan(base, cookie, "tax-invoice-2page.pdf", "application/pdf", "income");
      const o = pdf.ocrResult || {};
      const notes = String(o.notes || "");
      expect(o.ocrError || "").not.toMatch(/timeout|abort/i);
      expect(notes).not.toMatch(/Couldn't read this receipt/);
      expect(o.documentKind).toBe("tax_invoice");
      expect(o.documentKind).not.toBe("payslip");
      expect(o.suggestedIncomeType).not.toBe("salary_wages");
      expect(o.suggestedIncomeType).toBe(base.includes("suite") ? "business_income" : "remittance_owner");
      expect(o.date).toBe("2026-11-01");
      expect(o.dueDate).toBe("2026-11-15");
      expect(Number(o.gstAmount)).toBe(75);
      expect(Number(o.taxableIncome)).toBe(750);
      expect(Number(o.grossTotal)).toBe(825);
      expect(Number(o.netPay || o.amount)).toBe(750);
      expect(String(o.vendorAbn || "")).toMatch(/53\s*004\s*085\s*616/);
      expect(o.invoiceNumber || "").toMatch(/1842/);
      expect(notes).not.toMatch(/payslip/i);
    }
  }, 180000);

  it("returns an explicit error for a blank image, never a no-flags result", async () => {
    for (const base of ["/api/haulage", "/api/suite"]) {
      const cookie = await session(base);
      const body = await scan(base, cookie, "blank.png", "image/png", "expense");
      const o = body.ocrResult || {};
      const notes = `${o.notes || ""} ${body.compliance && body.compliance.summary ? body.compliance.summary : ""}`;
      expect(o.ocrSource).toBe("unreadable");
      expect(notes).toMatch(/Couldn't read this receipt/);
      expect(notes).not.toMatch(/no ATO compliance flags/i);
      expect(notes).not.toMatch(/within ATO policy/i);
      expect(body.compliance && body.compliance.status).not.toBe("within_policy");
    }
  }, 60000);

  it("reads invoice GST, the invoice date and the income type, and does not treat a shop docket as income", async () => {
    for (const base of ["/api/haulage", "/api/suite"]) {
      const cookie = await session(base);
      const file = base.includes("suite") ? "invoice-suite-2420.pdf" : "invoice-hub-7260.pdf";
      const body = await scan(base, cookie, file, "application/pdf", "income");
      const o = body.ocrResult || {};
      expect(o.suggestedIncomeType).not.toBe("salary_wages");
      expect(o.suggestedIncomeType).toBe(base.includes("suite") ? "business_income" : "remittance_owner");
      expect(o.date).toBe("2026-11-01");
      expect(o.dueDate).toBe("2026-11-15");
      expect(String(o.vendorAbn || "")).toMatch(/53\s*004\s*085\s*616/);
      if (base.includes("suite")) {
        expect(Number(o.gstAmount)).toBe(220);
        expect(Number(o.grossTotal || o.amount)).toBe(2420);
        expect(Number(o.netPay || o.taxableIncome)).toBe(2200);
      } else {
        expect(Number(o.gstAmount)).toBe(660);
        expect(Number(o.grossTotal || o.amount)).toBe(7260);
        expect(Number(o.netPay || o.taxableIncome)).toBe(6600);
        expect(o.payer || o.entity || "").toBe("Harbour Street Consulting");
        expect(o.issuer || "").toBe("Western Rim Transport");
        expect(o.description || "").not.toMatch(/\bel$/);
      }
      const shop = await scan(base, cookie, "officeworks-receipt.pdf", "application/pdf", "expense");
      expect(shop.ocrResult && shop.ocrResult.offerAsIncome).not.toBe(true);
      const customer = await scan(base, cookie, "invoice-hub-7260.pdf", "application/pdf", "expense");
      expect(customer.ocrResult && customer.ocrResult.offerAsIncome).toBe(true);
    }
  }, 120000);
});

describe("scanner gate — printed text", () => {
  it("repairs TOTAL and GST keywords and trims stray name fragments", () => {
    const text = repairOcrKeywords("1oTAL $86.40\n53 INCLUDED $7.85\nVISA ****6104\nReceipt No 18421");
    expect(text).toMatch(/TOTAL/);
    expect(text).toMatch(/GST INCLUDED/);
    const summary = buildExpenseSummaryFromText(text + "\nDIESEL 12.5 L\nPacific Tyre Co Pty Ltd");
    expect(summary.amount).toBeCloseTo(86.4, 2);
    expect(summary.gstAmount).toBeCloseTo(7.85, 2);
    expect(summary.vendor).toMatch(/Pacific Tyre/);
    expect(summary.paymentMethod).toBe("visa");
    expect(summary.receiptNumber).toMatch(/18421/);
    expect(summary.dieselLitres).toBeCloseTo(12.5, 1);
    expect(cleanPartyName("Harbour Street Consulting a")).toBe("Harbour Street Consulting");
    expect(cleanPartyName("Western Rim Transport el")).toBe("Western Rim Transport");
    expect(cleanPartyName("Pacific Tyre Co")).toBe("Pacific Tyre Co");
  });

  it("does not keep a $1 GST figure when the GST line also prints the real amount", () => {
    const parsed = parseTaxInvoice(
      `TAX INVOICE
Invoice number: INV-9
Invoice date: 01/11/2026
Due date: 15/11/2026
Bill to: Logan Freight
ABN 53 004 085 616
GST $1.00
Total GST 10% $220.00
Total 2420.00`,
      { product: "suite", entityType: "sole_trader" }
    );
    expect(parsed.gstAmount).toBe(220);
    expect(parsed.netPay).toBe(2200);
    expect(parsed.date).toBe("2026-11-01");
    expect(parsed.suggestedIncomeType).toBe("business_income");
    expect(parsed.gstUnsure).toBe(false);
  });

  it("reads a misread GST label and prefers total/11 when that amount is also printed", () => {
    const fuel = buildExpenseSummaryFromText("LAKEVIEW FUEL\n5ST INCLUDED $7.00\nDIESEL 40 L\nTOTAL $77.00");
    expect(fuel.gstAmount).toBeCloseTo(7, 2);
    const parts = parseTaxInvoice(
      `TAX INVOICE
From: Roadhouse Parts
ABN 53 004 085 616
Invoice number: INV-26
Invoice date: 01/11/2026
Due date: 15/11/2026
Bill to: Western Rim
Brake parts 260.00
GST 21.00
GST component 26.00
Total 286.00`,
      { product: "haulage" }
    );
    expect(parts.gstAmount).toBe(26);
    expect(parts.vendor || parts.payer).toBeTruthy();
    expect(parts.suggestedIncomeType).toBe("remittance_owner");
    expect(parts.vendorAbn).toMatch(/53/);
    const accountant = parseTaxInvoice(
      `TAX INVOICE
Tax Invoice from Harbour Accounting
ABN: 53 004 085 616
Invoice number: INV-50
Invoice date: 01/11/2026
Due date: 15/11/2026
Bill to: Alex Driver
GST 20.00
Total 550.00
50.00 GST component`,
      { product: "suite", entityType: "sole_trader" }
    );
    expect(accountant.gstAmount).toBe(50);
    expect(accountant.suggestedIncomeType).toBe("business_income");
    expect(accountant.issuer).toMatch(/Harbour Accounting/);
  });

  it("rejects junk vendors and does not file parts as fuel", () => {
    expect(isWeakVendor("banana")).toBe(true);
    expect(isWeakVendor("Indl")).toBe(true);
    expect(isWeakVendor("Roadhouse Parts")).toBe(false);
    const summary = buildExpenseSummaryFromText(
      "Tax Invoice from Roadhouse Parts\nABN 53 004 085 616\nBrake parts\nTOTAL 180.00"
    );
    expect(summary.vendor).toMatch(/Roadhouse Parts/);
    expect(summary.vendorAbn).toMatch(/53/);
    expect(summary.suggestedCategory).toBe("repairs_maintenance");
    expect(
      categorizeExpense({
        product: "haulage",
        vendor: "Roadhouse Parts",
        text: "Brake parts and filters",
        suggested: "fuel",
      }).category
    ).toBe("repairs_maintenance");
    expect(suiteMenus.listMenuCategories("employee").map((row) => row.id)).toContain("parking_tolls");
  });
});
