const fs = require("fs");
const http = require("http");
const path = require("path");

const {
  parseCsv,
  sniffDelimiter,
  parseAmount,
  classifyHeader,
  guessVendor,
  guessExpenseCategory,
  guessIncomeType,
  previewCsv,
  importRows,
  MAX_ROWS,
} = require("./lib/csv-import");

describe("parseCsv / delimiter", () => {
  it("reads quoted commas and strips a UTF-8 BOM", () => {
    const rows = parseCsv('\uFEFFDate,Amount,Description\n01/07/2026,-12.50,"WOOLWORTHS, TOOWOOMBA"');
    expect(rows[0]).toEqual(["Date", "Amount", "Description"]);
    expect(rows[1][2]).toBe("WOOLWORTHS, TOOWOOMBA");
  });

  it("sniffs semicolon and tab exports", () => {
    expect(sniffDelimiter("Date;Amount;Description\n01/07/2026;-1;X")).toBe(";");
    expect(sniffDelimiter("Date\tAmount\tDescription\n01/07/2026\t-1\tX")).toBe("\t");
  });
});

describe("parseAmount", () => {
  it("reads dollars, commas, parentheses and DR/CR", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("(45.80)")).toBe(-45.8);
    expect(parseAmount("45.80DR")).toBe(-45.8);
    expect(parseAmount("45.80 CR")).toBe(45.8);
    expect(parseAmount("−12.00")).toBe(-12);
    expect(parseAmount("")).toBeNull();
  });
});

describe("classifyHeader", () => {
  it("maps AU bank headings", () => {
    expect(classifyHeader("Transaction Date")).toBe("date");
    expect(classifyHeader("Transaction Details")).toBe("description");
    expect(classifyHeader("Debit Amount")).toBe("debit");
    expect(classifyHeader("Credit Amount")).toBe("credit");
    expect(classifyHeader("Balance")).toBe("skip");
  });
});

describe("previewCsv — CommBank signed amount", () => {
  const csv = [
    "Date,Amount,Description",
    "01/07/2026,-45.80,VISA-WOOLWORTHS 3124",
    "02/07/2026,1850.00,BETTS TRANSPORT PAY",
    "03/07/2026,0.00,OPENING BALANCE",
    "04/07/2026,-89.50,EFTPOS BP ARCHERFIELD",
  ].join("\n");

  it("splits debits to expenses and credits to income", () => {
    const preview = previewCsv(csv, { filename: "cba.csv" });
    expect(preview.ok).toBe(true);
    expect(preview.filename).toBe("cba.csv");
    const wool = preview.rows.find((r) => /woolworths/i.test(r.vendor));
    const pay = preview.rows.find((r) => r.purpose === "income");
    const bp = preview.rows.find((r) => /bp/i.test(r.vendor));
    expect(wool).toMatchObject({
      purpose: "expense",
      date: "2026-07-01",
      amount: 45.8,
      category: "groceries_travel",
    });
    expect(pay).toMatchObject({
      purpose: "income",
      date: "2026-07-02",
      amount: 1850,
      type: "salary_wages",
    });
    expect(bp.purpose).toBe("expense");
    expect(bp.amount).toBe(89.5);
    expect(preview.skipped.some((s) => /zero/i.test(s.reason) || /balance/i.test(s.reason))).toBe(true);
  });
});

describe("previewCsv — Debit/Credit columns", () => {
  const csv = [
    "Date,Narrative,Debit Amount,Credit Amount,Balance",
    "08/05/2026,BP ARCHERFIELD,128.40,,540.10",
    "09/05/2026,WEEKLY PAY BETTS,,2100.00,2640.10",
    "10/05/2026,INTERNAL TRANSFER,200.00,,2440.10",
  ].join("\n");

  it("uses debit as expense and credit as income, and unticks transfers", () => {
    const preview = previewCsv(csv);
    expect(preview.ok).toBe(true);
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0]).toMatchObject({
      purpose: "expense",
      date: "2026-05-08",
      amount: 128.4,
    });
    expect(preview.rows[1]).toMatchObject({
      purpose: "income",
      date: "2026-05-09",
      amount: 2100,
    });
    expect(preview.rows[2].include).toBe(false);
    expect(preview.rows[2].warning).toMatch(/transfer/i);
  });
});

describe("previewCsv — duplicates and headerless", () => {
  it("flags date + vendor + amount already on the ledger", () => {
    const records = {
      expenses: [{ id: "e1", date: "2026-07-01", vendor: "Woolworths", amount: 45.8 }],
      income: [],
      receipts: [],
    };
    const preview = previewCsv("Date,Amount,Description\n01/07/2026,-45.80,WOOLWORTHS METRO", {
      records,
    });
    expect(preview.rows[0].duplicate).toBe(true);
    expect(preview.rows[0].include).toBe(false);
  });

  it("reads a headerless Date, Description, Amount file", () => {
    const preview = previewCsv("01/07/2026,COLES EXPRESS,32.10");
    expect(preview.ok).toBe(true);
    expect(preview.rows[0].date).toBe("2026-07-01");
    expect(preview.rows[0].amount).toBe(32.1);
    expect(preview.rows[0].purpose).toBe("income");
  });
});

describe("guess helpers", () => {
  it("cleans card prefixes and recognises chains", () => {
    expect(guessVendor("VISA-WOOLWORTHS 3124")).toMatch(/Woolworths/i);
    expect(guessExpenseCategory("VISA-WOOLWORTHS 3124", "Woolworths")).toBe(
      "groceries_travel"
    );
    expect(guessIncomeType("BETTS TRANSPORT WEEKLY PAY")).toBe("salary_wages");
    expect(guessIncomeType("OWNER DRIVER REMITTANCE")).toBe("remittance_owner");
  });
});

describe("importRows", () => {
  function harness() {
    const records = { expenses: [], income: [] };
    return {
      records,
      addExpense: (recs, payload) => {
        const entry = { id: `e-${recs.expenses.length + 1}`, ...payload };
        recs.expenses.unshift(entry);
        return entry;
      },
      addIncome: (recs, payload) => {
        const entry = { id: `i-${recs.income.length + 1}`, ...payload };
        recs.income.unshift(entry);
        return entry;
      },
    };
  }

  it("writes reviewed rows to income and expenses and skips duplicates unless forced", () => {
    const hooks = harness();
    const result = importRows(
      [
        {
          include: true,
          purpose: "expense",
          date: "08/05/2026",
          amount: 20,
          vendor: "Bunnings",
          description: "Tools",
          category: "tools_equipment",
        },
        {
          include: true,
          purpose: "income",
          date: "2026-05-09",
          amount: 1800,
          vendor: "Betts Transport",
          description: "Weekly pay",
          type: "salary_wages",
        },
        {
          include: true,
          purpose: "expense",
          date: "2026-05-10",
          amount: 9,
          vendor: "7-Eleven",
          description: "Coffee",
          category: "meals",
          duplicate: true,
        },
        { include: false, purpose: "expense", date: "2026-05-11", amount: 5, vendor: "Skip" },
      ],
      hooks
    );
    expect(result.ok).toBe(true);
    expect(result.imported).toEqual({ expenses: 1, income: 1 });
    expect(result.skipped).toBe(2);
    expect(hooks.records.expenses[0]).toMatchObject({
      date: "2026-05-08",
      category: "tools_equipment",
      amount: 20,
      vendor: "Bunnings",
      noReceipt: true,
    });
    expect(hooks.records.income[0]).toMatchObject({
      date: "2026-05-09",
      type: "salary_wages",
      amount: 1800,
      payer: "Betts Transport",
    });
  });

  it("imports a forced duplicate", () => {
    const hooks = harness();
    const result = importRows(
      [
        {
          include: true,
          purpose: "expense",
          date: "2026-05-10",
          amount: 9,
          vendor: "7-Eleven",
          category: "meals",
          duplicate: true,
          forceDuplicate: true,
        },
      ],
      hooks
    );
    expect(result.imported.expenses).toBe(1);
  });

  it("rejects a reviewed row with no date", () => {
    const hooks = harness();
    const result = importRows(
      [{ include: true, purpose: "expense", date: "", amount: 4, vendor: "X" }],
      hooks
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID");
  });

  it("caps import size", () => {
    const hooks = harness();
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({
      include: true,
      purpose: "expense",
      date: "2026-05-01",
      amount: 1,
      vendor: `V${i}`,
    }));
    expect(importRows(rows, hooks).code).toBe("TOO_MANY");
  });
});

describe("csv import UI hosts", () => {
  it("adds review panels on expenses and income for both products", () => {
    const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
    const suite = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");
    expect(hub).toMatch(/id="csv-import-panel-expenses"/);
    expect(hub).toMatch(/id="csv-import-panel-income"/);
    expect(suite).toMatch(/id="csv-import-panel-expenses"/);
    expect(suite).toMatch(/id="csv-import-panel-income"/);
  });
});

describe("csv import HTTP", () => {
  let server;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    const { app } = require("./server");
    server = await new Promise((resolve) => {
      const s = http.createServer(app);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("refuses guests on preview and import", async () => {
    const { port } = server.address();
    const preview = await fetch(`http://127.0.0.1:${port}/api/haulage/csv/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: "Date,Amount,Description\n01/07/2026,-10,COLES" }),
    });
    expect(preview.status).toBe(403);
    const imported = await fetch(`http://127.0.0.1:${port}/api/haulage/csv/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [{ include: true, purpose: "expense", date: "2026-07-01", amount: 10, vendor: "Coles" }],
      }),
    });
    expect(imported.status).toBe(403);
  });
});
