/**
 * 20 Nov 2026 live audit.
 * Invoice save must not freeze, saved expenses stay on the list, Hub BAS
 * leaves salary and allowances out of G1/1A, and Suite approve stays on Expenses.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildBasPack } = require("./lib/suite/bas-pack");
const { isSuiteRequest } = require("./lib/suite/product");
const { generalLedgerExpenses, deleteExpenseById } = require("./lib/ledger-visibility");

const appSrc = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");
const enhancementsSrc = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");

function extractFunction(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = src.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let j = i; j < src.length; j += 1) {
    const ch = src[j];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function runFunction(src, name, args, sandbox) {
  const code = `${extractFunction(src, name)}\nresult = ${name}(${args});`;
  const context = vm.createContext({ result: undefined, ...sandbox });
  vm.runInContext(code, context);
  return context.result;
}

describe("20 Nov audit — income save does not freeze the tab", () => {
  it("only writes a label when the text actually changes", () => {
    const assign = extractFunction(enhancementsSrc, "assignTextIfChanged");
    const node = {
      text: "Gross ($)",
      writes: 0,
      get textContent() {
        return this.text;
      },
      set textContent(value) {
        this.writes += 1;
        this.text = value;
      },
    };
    const context = vm.createContext({ node, changed: 0 });
    vm.runInContext(
      `${assign}
       changed = assignTextIfChanged(node, "Gross Pay ($)");
       changedAgain = assignTextIfChanged(node, "Gross Pay ($)");`,
      context
    );
    expect(context.changed).toBe(true);
    expect(context.changedAgain).toBe(false);
    expect(node.writes).toBe(1);
  });

  it("claims the scan card before relabelling so the observer cannot loop", () => {
    const start = enhancementsSrc.indexOf("function enhanceBox");
    const body = enhancementsSrc.slice(start, start + 700);
    expect(body.indexOf("box.__enhToken === latest.token")).toBeLessThan(body.indexOf("ensureIncomeAbnField"));
    expect(enhancementsSrc).toMatch(/window\.__haulageStopOcrProgress = stopOcrProgress/);
    expect(enhancementsSrc).toMatch(/pick\.textContent = "Upload file"/);
  });

  it("times out a stuck approve and clears the saving state", () => {
    expect(appSrc).toMatch(/const CONFIRM_SAVE_TIMEOUT_MS = 20000/);
    expect(appSrc).toMatch(/Saving took too long\. The document is still under Needs approval/);
    const finalize = appSrc.slice(appSrc.indexOf("async function finalizeScannedTotals"));
    expect(finalize.indexOf("apiWithTimeout")).toBeLessThan(finalize.indexOf("async function apiWithTimeout"));
    expect(finalize).toMatch(/__haulageStopOcrProgress/);
  });
});

describe("20 Nov audit — saved expenses stay on the list and can be deleted", () => {
  const fuelRows = () => ({
    expenses: [
      { id: "bp-1", category: "fuel", amount: 79.95, date: "2026-11-05", vendor: "BP", deletedAt: null },
      { id: "bp-2", category: "fuel", amount: 79.95, date: "2026-11-05", vendor: "BP" },
      { id: "gone", category: "fuel", amount: 10, date: "2026-11-05", deletedAt: "2026-11-20T00:00:00.000Z" },
    ],
  });

  it("includes fuel rows on the general ledger for Suite and Hub", () => {
    const visible = generalLedgerExpenses(fuelRows());
    expect(visible.map((row) => row.id)).toEqual(["bp-1", "bp-2"]);
    expect(enhancementsSrc).toMatch(/if \(scope === "general"\) return true;/);
    expect(enhancementsSrc).toMatch(/weekHasSavedEntries/);
  });

  it("soft-deletes a fuel row by id when it is not on screen", () => {
    const records = fuelRows();
    const result = deleteExpenseById(records, "bp-1", { username: "primary-mod" });
    expect(result.ok).toBe(true);
    expect(generalLedgerExpenses(records).map((row) => row.id)).toEqual(["bp-2"]);
    expect(records.expenses.find((row) => row.id === "bp-1").deletedAt).toBeTruthy();
  });
});

describe("20 Nov audit — Hub BAS leaves salary and allowances out of G1 and 1A", () => {
  const records = {
    income: [
      { date: "2026-11-12", amount: 2950, type: "salary_wages" },
      { date: "2026-11-12", amount: 180, type: "allowance_travel" },
      { date: "2026-11-12", amount: 6600, type: "remittance_owner" },
    ],
    expenses: [],
  };
  const profile = { financialYear: "2026-27", gstRegistered: true, entityType: "employee" };

  function box(pack, id) {
    return pack.boxes.find((row) => row.atoBox === id).amount;
  }

  it("leaves Suite salary and allowances out of G1 and 1A as well", () => {
    const pack = buildBasPack(records, profile, { financialYear: "2026-27", product: "suite" });
    expect(box(pack, "G1")).toBe(6600);
    expect(box(pack, "1A")).toBe(600);
    expect(pack.quarterly[1].sales).toBe(6600);
  });

  it("drops Hub salary and allowances from the full year and from Q2", () => {
    const pack = buildBasPack(records, profile, { financialYear: "2026-27", product: "haulage" });
    expect(box(pack, "G1")).toBe(6600);
    expect(box(pack, "1A")).toBe(600);
    expect(pack.quarterly[1].sales).toBe(6600);
    expect(pack.quarterly[1].gstOnSales).toBe(600);
    expect(pack.quarterly[0].sales).toBe(0);
    expect(serverSrc).toMatch(/product: productOf\(req\) === "suite" \? "suite" : "haulage"/);
  });
});

describe("20 Nov audit — Suite approve uses its own route and stays on Expenses", () => {
  it("treats /api/suite as Suite and /api/haulage as Hub", () => {
    expect(isSuiteRequest({ originalUrl: "/api/suite/receipts/abc/confirm", headers: {} })).toBe(true);
    expect(isSuiteRequest({ originalUrl: "/api/haulage/receipts/abc/confirm", headers: {} })).toBe(false);
    expect(serverSrc).toMatch(/app\.use\("\/api\/suite", api\)/);
  });

  it("points a Suite page at /api/suite and a Hub page at /api/haulage", () => {
    const suite = runFunction(appSrc, "pageApiRoot", "", {
      window: { location: { origin: "https://suite.example.test", pathname: "/suite/" } },
    });
    const hub = runFunction(appSrc, "pageApiRoot", "", {
      window: { location: { origin: "https://hub.example.test", pathname: "/haulage/" } },
    });
    expect(suite).toBe("https://suite.example.test/api/suite");
    expect(hub).toBe("https://hub.example.test/api/haulage");
  });

  it("rewrites a leftover Hub URL when the page is Suite", () => {
    const rewritten = runFunction(
      enhancementsSrc,
      "rewriteSuiteApiUrl",
      "url",
      { url: "https://suite.example.test/api/haulage/receipts/abc/confirm", isGotaxSuitePage: () => true, window: {} }
    );
    const hub = runFunction(
      enhancementsSrc,
      "rewriteSuiteApiUrl",
      "url",
      { url: "https://hub.example.test/api/haulage/receipts/abc/confirm", isGotaxSuitePage: () => false, window: {} }
    );
    expect(rewritten).toBe("https://suite.example.test/api/suite/receipts/abc/confirm");
    expect(hub).toBe("https://hub.example.test/api/haulage/receipts/abc/confirm");
  });

  it("sends the vendor shown on the card, including a short BP name", () => {
    const junk = runFunction(enhancementsSrc, "looksLikeJunkVendorClient", "name", { name: "BP" });
    const invoice = runFunction(enhancementsSrc, "looksLikeJunkVendorClient", "name", { name: "TAX INVOICE" });
    expect(junk).toBe(false);
    expect(invoice).toBe(true);

    const ids = {
      "scan-confirm-vendor": { value: "BP" },
      "scan-confirm-amount": { value: "79.95" },
      "scan-confirm-date": { value: "2026-11-05" },
      "scan-confirm-category": { value: "fuel" },
      "scan-confirm-abn": { value: "" },
      "scan-confirm-description": { value: "Unleaded" },
      "scan-confirm-work": { value: "100" },
      "scan-confirm-reimbursed": { checked: false },
    };
    const payload = runFunction(appSrc, "readScanConfirmPayload", "false", {
      document: { getElementById: (id) => ids[id] || null },
      readManualFormPayload: () => ({ vendor: "", category: "", amount: "" }),
      pendingReceiptConfirm: { ocrResult: { vendor: "", suggestedCategory: "other_work" } },
      localToday: () => "2026-11-20",
    });
    expect(payload.vendor).toBe("BP");
    expect(payload.category).toBe("fuel");
    expect(payload.amount).toBe(79.95);
  });

  it("does not leave Expenses for a Suite fuel approve", () => {
    const CAR_CLAIM_IDS = new Set([
      "vehicle_car",
      "fuel",
      "repairs_maintenance",
      "tyres",
      "registration_insurance",
      "parking_tolls",
    ]);
    const suite = runFunction(enhancementsSrc, "shouldReturnToCarExpenses", "ctx", {
      ctx: { suite: true, startedOnCar: false, category: "fuel" },
      CAR_CLAIM_IDS,
    });
    const hubExpenses = runFunction(enhancementsSrc, "shouldReturnToCarExpenses", "ctx", {
      ctx: { suite: false, startedOnCar: false, category: "fuel" },
      CAR_CLAIM_IDS,
    });
    const hubCar = runFunction(enhancementsSrc, "shouldReturnToCarExpenses", "ctx", {
      ctx: { suite: false, startedOnCar: true, category: "fuel" },
      CAR_CLAIM_IDS,
    });
    expect(suite).toBe(false);
    expect(hubExpenses).toBe(false);
    expect(hubCar).toBe(false);
  });
});
