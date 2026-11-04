const fs = require("fs");
const path = require("path");
const vm = require("vm");

function extractFunction(src, name) {
  const marker = `function ${name}`;
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

function loadHelpers() {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const names = ["isRecordsGet", "recordsGetUsesLiveBody", "mergeAttachedReceipt", "attachedPeriodUpdate"];
  const code = `${names.map((name) => extractFunction(src, name)).join("\n")}\n${names
    .map((name) => `this.${name} = ${name};`)
    .join("\n")}`;
  const sandbox = {};
  vm.runInNewContext(code, sandbox, { filename: "attach-receipt-live.js" });
  return sandbox;
}

describe("add receipt shows the photo without a restart", () => {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const api = loadHelpers();

  it("keeps a live records read out of the quiet-window cache", () => {
    const url = "http://127.0.0.1:3000/api/haulage/records";
    expect(api.recordsGetUsesLiveBody(url, "GET", {}, false)).toBe(false);
    expect(api.recordsGetUsesLiveBody(url, "GET", {}, true)).toBe(true);
    expect(
      api.recordsGetUsesLiveBody(url, "GET", { headers: { "X-Haulage-Live-Records": "1" } }, false)
    ).toBe(true);
    expect(api.recordsGetUsesLiveBody(url, "POST", { headers: { "X-Haulage-Live-Records": "1" } }, true)).toBe(
      false
    );
  });

  it("puts the saved photo on the receipt list and links the ledger row", () => {
    const records = {
      receipts: [{ id: "stub", filename: "manual-entry" }],
      expenses: [{ id: "e1", receiptId: "stub", noReceipt: true, amount: 12 }],
      income: [],
    };
    const next = api.mergeAttachedReceipt(
      records,
      { id: "e1", receiptId: "r-new" },
      { id: "r-new", filename: "04.11.26 AUD$12.00.jpg", purpose: "expense" },
      "stub"
    );
    expect(next.receipts.map((row) => row.id)).toEqual(["r-new"]);
    expect(next.receipts[0].hasImage).toBe(true);
    expect(next.expenses[0].receiptId).toBe("r-new");
    expect(next.expenses[0].noReceipt).toBe(false);
    expect(next.expenses[0].amount).toBe(12);
    expect(next.receipts[0].linkedExpenseId).toBe("e1");
    expect(next.receipts[0].purpose).toBe("expense");
  });

  it("files an invoice on the income side and lines up that month", () => {
    const records = {
      receipts: [{ id: "stub", filename: "manual-entry" }],
      expenses: [{ id: "e1", amount: 9 }],
      income: [{ id: "i1", type: "invoice", receiptId: "stub", amount: 440, date: "2026-11-04" }],
    };
    const next = api.mergeAttachedReceipt(
      records,
      { id: "i1", type: "invoice", date: "2026-11-04", amount: 440 },
      { id: "r-new", filename: "04.11.26 AUD$440.00.jpg" },
      "stub",
      "income"
    );
    expect(next.receipts.map((row) => row.id)).toEqual(["r-new"]);
    expect(next.receipts[0].purpose).toBe("income");
    expect(next.receipts[0].hasImage).toBe(true);
    expect(next.receipts[0].linkedIncomeId).toBe("i1");
    expect(next.receipts[0].linkedExpenseId).toBeUndefined();
    expect(next.income[0].receiptId).toBe("r-new");
    expect(next.income[0].noReceipt).toBe(false);
    expect(next.income[0].amount).toBe(440);
    expect(next.income[0].type).toBe("invoice");
    expect(next.expenses).toEqual([{ id: "e1", amount: 9 }]);
    expect(api.attachedPeriodUpdate("income", "2026-11-04")).toEqual({
      kind: "month",
      value: "2026-11",
    });
    expect(api.attachedPeriodUpdate("expense", "2026-11-04", () => "2026-11-02")).toEqual({
      kind: "week",
      value: "2026-11-02",
    });
  });

  it("paints the gallery from the attach response instead of waiting for a full reload", () => {
    const attach = extractFunction(src, "attachReceiptFile");
    expect(attach).toMatch(/showAttachedReceipt/);
    expect(attach).not.toMatch(/refreshAll/);
    expect(src).toMatch(/function showAttachedReceipt/);
    expect(src).toMatch(/receiptImageCache\.set/);
    expect(src).toMatch(/function haulageRevealReceiptPhoto/);
    expect(src).toMatch(/X-Haulage-Live-Records/);
  });
});
