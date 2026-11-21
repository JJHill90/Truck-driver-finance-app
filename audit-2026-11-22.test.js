/**
 * 22 Nov 2026 live audit.
 * Other users' details stay off a normal page. Suite BAS, CSV, and Hub
 * owner-driver invoices keep their own rules.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const auth = require("./lib/auth");
const { buildBasPack } = require("./lib/suite/bas-pack");
const { analyzeScan } = require("./lib/document-breakdown");
const { applyHubBusinessIncomeGst } = require("./lib/hub-income-gst");
const { calcIncomeAssessability } = require("./lib/tax-calculator");

const enhancements = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const strongPass = "RoadSafe!99x";
const uniq = () => `t22_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

function cookiePair(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const line = raw[0] || res.headers.get("set-cookie") || "";
  return String(line).split(";")[0];
}

describe("22 Nov — other users are not loaded until the admin panel is opened", () => {
  it("does not fetch the user list while opening the app", () => {
    const marker = 'if (selectedApp === "taxationhub" || me.user.needsFirstRunTour)';
    const slice = enhancements.slice(enhancements.indexOf(marker), enhancements.indexOf(marker) + 700);
    expect(slice).not.toMatch(/loadAdminUsers/);
    expect(enhancements).toMatch(/if \(!adminListRequested\) return/);
    expect(enhancements).toMatch(/id = "admin-open"/);
  });

  it("refuses the user list to a signed-in non-admin on Suite and Hub", async () => {
    const { app } = require("./server");
    const server = await new Promise((resolve) => {
      const s = http.createServer(app);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = server.address().port;
    const other = uniq();
    const self = uniq();
    auth.registerUser(other, strongPass, {}, `${other}@example.test`);
    auth.registerUser(self, strongPass, {}, `${self}@example.test`);
    try {
      for (const base of ["/api/suite", "/api/haulage"]) {
        const login = await fetch(`http://127.0.0.1:${port}${base}/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: self, password: strongPass }),
        });
        expect(login.status).toBe(200);
        const cookie = cookiePair(login);
        const users = await fetch(`http://127.0.0.1:${port}${base}/admin/users`, {
          headers: { cookie },
        });
        expect(users.status).toBe(403);
        const records = await fetch(`http://127.0.0.1:${port}${base}/records`, {
          headers: { cookie },
        });
        const text = await records.text();
        expect(text).not.toContain(`${other}@example.test`);
        expect(text).not.toContain(other);
        const me = await fetch(`http://127.0.0.1:${port}${base}/auth/me`, {
          headers: { cookie },
        });
        const meBody = await me.json();
        expect(meBody.user.username).toBe(self);
        expect(JSON.stringify(meBody)).not.toContain(`${other}@example.test`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("22 Nov — Suite BAS leaves salary out of G1 and 1A", () => {
  const records = {
    income: [
      { date: "2026-11-12", amount: 3200, type: "salary_wages" },
      { date: "2026-11-12", amount: 4840, type: "business_income" },
    ],
    expenses: [],
  };
  const profile = { financialYear: "2026-27", gstRegistered: true, entityType: "sole_trader" };

  function box(pack, id) {
    return pack.boxes.find((row) => row.atoBox === id).amount;
  }

  it("counts only business income for the year and the quarter", () => {
    const pack = buildBasPack(records, profile, { financialYear: "2026-27", product: "suite" });
    expect(box(pack, "G1")).toBe(4840);
    expect(box(pack, "1A")).toBe(440);
    expect(pack.quarterly[1].sales).toBe(4840);
    expect(pack.quarterly[1].gstOnSales).toBe(440);
  });

  it("keeps the Hub exclusion and leaves an unscoped pack counting every income row", () => {
    const hub = buildBasPack(records, profile, { financialYear: "2026-27", product: "haulage" });
    expect(box(hub, "G1")).toBe(4840);
    const open = buildBasPack(records, profile, { financialYear: "2026-27" });
    expect(box(open, "G1")).toBe(8040);
  });
});

describe("22 Nov — Suite CSV import stays on the current page", () => {
  it("restores the view that was open after the ledger refresh", () => {
    const slice = enhancements.slice(enhancements.indexOf("async function importSelected"));
    expect(slice.indexOf("const stayOn")).toBeLessThan(slice.indexOf("window.refreshAll"));
    expect(slice).toMatch(/setView\(stayOn\)/);
    expect(slice.slice(0, 1800)).not.toMatch(/location\.reload/);
  });
});

describe("22 Nov — Hub owner-driver invoice", () => {
  const invoice = {
    documentType: "income",
    documentKind: "invoice",
    suggestedIncomeType: "remittance_owner",
    vendor: "Toll",
    grossTotal: 6600,
    gstAmount: 600,
    amount: 6600,
    date: "2026-11-12",
    rawText: "TAX INVOICE\nToll Transport\nHAUL-0312\nTOTAL $6,600.00\nGST $600.00",
  };

  it("does not add expected super or a LAFHA daily allowance", () => {
    const result = analyzeScan(invoice, "income", {
      financialYear: "2026-27",
      driverType: "owner_driver",
    });
    const labels = result.componentBreakdown.map((row) => row.label).join("\n");
    expect(labels).not.toMatch(/Superannuation \(expected/);
    expect(result.componentBreakdown.find((row) => row.type === "overnight_allowance")).toBeUndefined();
  });

  it("keeps expected super on a PAYG payslip", () => {
    const result = analyzeScan(
      { documentType: "income", suggestedIncomeType: "salary_wages", grossTotal: 2000, netPay: 1600 },
      "income",
      { financialYear: "2026-27", driverType: "long_haul" }
    );
    expect(result.componentBreakdown.some((row) => /Superannuation \(expected/.test(row.label))).toBe(true);
  });

  it("excludes invoice GST from taxable income and keeps the gross", () => {
    const saved = applyHubBusinessIncomeGst(
      {
        type: "remittance_owner",
        amount: 6600,
        grossTotal: 6600,
        gstAmount: 600,
        taxableIncome: 6600,
      },
      {}
    );
    expect(saved.grossTotal).toBe(6600);
    expect(saved.taxableIncome).toBe(6000);
    const assessable = calcIncomeAssessability({
      type: "remittance_owner",
      amount: 6600,
      grossTotal: 6600,
      taxableIncome: saved.taxableIncome,
      gstAmount: 600,
    });
    expect(assessable.assessable).toBe(6000);
  });

  it("uses GST registration when the invoice does not print a GST figure", () => {
    const saved = applyHubBusinessIncomeGst(
      { type: "remittance_owner", amount: 1100, grossTotal: 1100, taxableIncome: 1100 },
      { gstRegistered: true }
    );
    expect(saved.grossTotal).toBe(1100);
    expect(saved.taxableIncome).toBe(1000);
  });
});
