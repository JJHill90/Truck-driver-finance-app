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
      expect(Number(o.amount)).toBe(825);
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
});
