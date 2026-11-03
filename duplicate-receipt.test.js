const {
  normalizeDate,
  vendorsMatch,
  amountsMatch,
  findDuplicateMatches,
} = require("./lib/duplicate-receipt");

describe("normalizeDate", () => {
  it("normalises ISO and AU formats", () => {
    expect(normalizeDate("2026-07-23")).toBe("2026-07-23");
    expect(normalizeDate("23/07/2026")).toBe("2026-07-23");
    expect(normalizeDate("23.07.26")).toBe("2026-07-23");
  });
});

describe("vendorsMatch", () => {
  it("matches ignoring Pty Ltd and case", () => {
    expect(vendorsMatch("Sample Roadhouse Pty Ltd", "sample roadhouse")).toBe(true);
    expect(vendorsMatch("BP", "Shell")).toBe(false);
  });
});

describe("amountsMatch", () => {
  it("compares to cents", () => {
    expect(amountsMatch(42.5, "42.50")).toBe(true);
    expect(amountsMatch(42.5, 43)).toBe(false);
  });
});

describe("findDuplicateMatches", () => {
  const records = {
    expenses: [
      { id: "e1", date: "2026-07-23", vendor: "Sample Roadhouse", amount: 42.5 },
      { id: "e2", date: "2026-07-23", vendor: "Shell", amount: 95 },
    ],
    income: [
      { id: "i1", date: "2026-07-01", entity: "Betts Transport", amount: 3200, grossTotal: 3200 },
    ],
    receipts: [
      {
        id: "r1",
        purpose: "expense",
        filename: "23.07.26 AUD$42.50.png",
        ocrResult: { date: "2026-07-23", vendor: "Sample Roadhouse", amount: 42.5 },
      },
    ],
  };

  it("finds expense duplicates by date, vendor, amount", () => {
    const matches = findDuplicateMatches(
      records,
      { date: "2026-07-23", vendor: "Sample Roadhouse Pty Ltd", amount: 42.5 },
      "expense",
      42.5
    );
    expect(matches.some((m) => m.source === "expense" && m.id === "e1")).toBe(true);
    expect(matches.some((m) => m.source === "receipt" && m.id === "r1")).toBe(true);
    expect(matches.some((m) => m.id === "e2")).toBe(false);
  });

  it("does not treat expense receipts as income duplicates", () => {
    const matches = findDuplicateMatches(
      records,
      { date: "2026-07-23", vendor: "Sample Roadhouse", amount: 42.5, documentType: "income" },
      "income",
      42.5
    );
    expect(matches.some((m) => m.source === "receipt")).toBe(false);
  });

  it("finds income duplicates by date, entity, gross", () => {
    const matches = findDuplicateMatches(
      records,
      { date: "2026-07-01", entity: "Betts Transport", amount: 3200, grossTotal: 3200 },
      "income",
      3200
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("i1");
  });

  it("matches the shop and amount when the new entry has no date", () => {
    const matches = findDuplicateMatches(records, { vendor: "Shell", amount: 95 }, "expense", 95);
    expect(matches.map((m) => m.id)).toEqual(["e2"]);
  });

  it("returns empty when only the amount is known", () => {
    expect(findDuplicateMatches(records, { amount: 95 }, "expense", 95)).toEqual([]);
  });

  it("matches the same day and amount when the shop name differs", () => {
    const matches = findDuplicateMatches(
      records,
      { date: "23/07/2026", vendor: "Not The Roadhouse", amount: 42.5 },
      "expense",
      42.5
    );
    expect(matches.some((m) => m.source === "expense" && m.id === "e1")).toBe(true);
    expect(matches.some((m) => m.source === "receipt" && m.id === "r1")).toBe(true);
    expect(matches.some((m) => m.id === "e2")).toBe(false);
  });

  it("does not match a different amount on the same day", () => {
    const matches = findDuplicateMatches(
      records,
      { date: "2026-07-23", vendor: "Sample Roadhouse", amount: 10 },
      "expense",
      10
    );
    expect(matches).toEqual([]);
  });

  it("skips a soft-deleted ledger row", () => {
    const deleted = {
      ...records,
      expenses: [
        ...records.expenses.map((e) => (e.id === "e1" ? { ...e, deletedAt: "2026-07-24" } : e)),
      ],
    };
    const matches = findDuplicateMatches(
      deleted,
      { date: "2026-07-23", vendor: "Other Shop", amount: 42.5 },
      "expense",
      42.5
    );
    expect(matches.some((m) => m.id === "e1")).toBe(false);
    expect(matches.some((m) => m.id === "r1")).toBe(true);
  });

  it("does not treat the receipt being approved as its own duplicate", () => {
    const matches = findDuplicateMatches(
      records,
      { date: "2026-07-23", vendor: "Sample Roadhouse", amount: 42.5 },
      "expense",
      42.5,
      { excludeReceiptId: "r1" }
    );
    expect(matches.some((m) => m.id === "r1")).toBe(false);
    expect(matches.some((m) => m.id === "e1")).toBe(true);
  });

  it("matches a labeled filename when the stored scan date differs", () => {
    const labeled = {
      expenses: [],
      income: [],
      receipts: [
        {
          id: "r2",
          purpose: "expense",
          filename: "23.07.26 AUD$42.50.jpg",
          ocrResult: { date: "2026-01-01", vendor: "TAX INVOICE", amount: 1.5 },
        },
      ],
    };
    const matches = findDuplicateMatches(
      labeled,
      { date: "2026-07-23", vendor: "", amount: 42.5 },
      "expense",
      42.5
    );
    expect(matches.some((m) => m.id === "r2")).toBe(true);
    expect(matches[0].amount).toBe(42.5);
    expect(matches[0].date).toBe("2026-07-23");
  });

  it("lists a saved photo once when its ledger row already matched", () => {
    const linked = {
      expenses: records.expenses,
      income: [],
      receipts: [
        {
          ...records.receipts[0],
          linkedExpenseId: "e1",
        },
      ],
    };
    const matches = findDuplicateMatches(
      linked,
      { date: "2026-07-23", vendor: "Other", amount: 42.5 },
      "expense",
      42.5
    );
    expect(matches.map((m) => m.source)).toEqual(["expense"]);
    expect(matches[0].id).toBe("e1");
  });

  it("uses the approved total when OCR also stored a smaller line amount", () => {
    const matches = findDuplicateMatches(
      records,
      { date: "2026-07-23", vendor: "", amount: 3.86 },
      "expense",
      42.5
    );
    expect(matches.some((m) => m.id === "e1")).toBe(true);
  });
});

describe("ledger save asks before a second copy", () => {
  const fs = require("fs");
  const http = require("http");
  const os = require("os");
  const path = require("path");
  const auth = require("./lib/auth");
  const suite = require("./lib/suite");
  const strongPass = "RoadSafe!99x";

  let server;
  let tmp;
  let port;
  let cookie;

  function seedRecords(username) {
    const file = auth.recordsFileFor(username);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        meta: { invoiceDateRefreshV1: true, vendorRepairV1: true },
        profile: { name: "Dup Driver", financialYear: "2026-27" },
        vendors: [],
        expenses: [
          {
            id: "e-existing",
            date: "2026-07-23",
            vendor: "BP Archerfield",
            amount: 86.4,
            category: "fuel",
            createdAt: "2026-07-23T00:00:00.000Z",
          },
        ],
        income: [
          {
            id: "i-existing",
            date: "2026-07-01",
            entity: "Betts Transport",
            payer: "Betts Transport",
            amount: 2100,
            grossTotal: 2500,
            netPay: 2100,
            type: "salary_wages",
          },
        ],
        receipts: [
          {
            id: "r-expense",
            purpose: "expense",
            filename: "23.07.26 AUD$86.40.jpg",
            source: "scan",
            ocrResult: { date: "2026-01-01", vendor: "TAX INVOICE", amount: 1.5 },
          },
          {
            id: "r-income",
            purpose: "income",
            filename: "payslip.pdf",
            source: "scan",
            ocrResult: { date: "2026-01-01", entity: "UNKNOWN", amount: 10 },
          },
        ],
      })
    );
  }

  async function post(urlPath, body) {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function activeExpenses() {
    const res = await fetch(`http://127.0.0.1:${port}/api/haulage/records`, {
      headers: { Cookie: cookie },
    });
    const data = await res.json();
    return data.expenses || [];
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dup-ledger-"));
    process.env.DATA_DIR = tmp;
    auth.setDataDirForTests(tmp);
    suite.setDataDirForTests(tmp);
    const username = `dup${Date.now().toString(36)}`;
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    seedRecords(username);
    cookie = `haulage_sid=${auth.createSession(username)}`;
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
    delete process.env.DATA_DIR;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("blocks a second expense on the same day and amount until the driver continues", async () => {
    const countBefore = (await activeExpenses()).length;
    const blocked = await post("/api/haulage/expenses", {
      date: "23/07/2026",
      vendor: "Some Other Servo",
      amount: 86.4,
      category: "fuel",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.data.possibleDuplicate).toBe(true);
    expect(blocked.data.code).toBe("POSSIBLE_DUPLICATE");
    expect(blocked.data.matches.some((m) => m.id === "e-existing" && m.vendor === "BP Archerfield")).toBe(
      true
    );
    const beforeIds = (await activeExpenses()).map((e) => e.id);
    expect(beforeIds).toContain("e-existing");
    expect(beforeIds.length).toBe(countBefore);

    const saved = await post("/api/haulage/expenses", {
      date: "2026-07-23",
      vendor: "Some Other Servo",
      amount: "86.40",
      category: "fuel",
      forceDuplicate: true,
    });
    expect(saved.status).toBe(200);
    expect(saved.data.entry.amount).toBe(86.4);
    expect(saved.data.entry.date).toBe("2026-07-23");
    expect(saved.data.entry.vendor).toBe("Some Other Servo");
    const afterIds = (await activeExpenses()).map((e) => e.id);
    expect(afterIds).toContain(saved.data.entry.id);
    expect(afterIds.length).toBe(beforeIds.length + 1);
  });

  it("still saves a different amount on that day", async () => {
    const saved = await post("/api/haulage/expenses", {
      date: "2026-07-23",
      vendor: "BP Archerfield",
      amount: 12,
      category: "meals",
    });
    expect(saved.status).toBe(200);
    expect(saved.data.entry.amount).toBe(12);
    expect(saved.data.entry.date).toBe("2026-07-23");
  });

  it("asks again when approving a scan whose OCR shop name does not match the ledger", async () => {
    const before = (await activeExpenses()).length;
    const blocked = await post("/api/haulage/receipts/r-expense/confirm", {
      confirmed: true,
      purpose: "expense",
      date: "2026-07-23",
      vendor: "TAX INVOICE",
      amount: 86.4,
      category: "fuel",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.data.possibleDuplicate).toBe(true);
    expect((await activeExpenses()).length).toBe(before);

    const saved = await post("/api/haulage/receipts/r-expense/confirm", {
      confirmed: true,
      purpose: "expense",
      date: "2026-07-23",
      vendor: "BP Archerfield",
      amount: 86.4,
      category: "fuel",
      forceDuplicate: true,
    });
    expect(saved.status).toBe(200);
    expect(saved.data.entry.amount).toBe(86.4);
    expect(saved.data.entry.date).toBe("2026-07-23");
    expect(saved.data.entry.vendor).toBe("BP Archerfield");
    expect(saved.data.entry.receiptId).toBe("r-expense");
  });

  it("asks before a second payslip with the same day and amount", async () => {
    const blocked = await post("/api/haulage/receipts/r-income/confirm", {
      confirmed: true,
      purpose: "income",
      date: "01/07/2026",
      entity: "Not Betts",
      amount: 2100,
      grossTotal: 2500,
      netPay: 2100,
      type: "salary_wages",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.data.matches.some((m) => m.id === "i-existing")).toBe(true);

    const otherDay = await post("/api/haulage/income", {
      date: "2026-08-01",
      payer: "Betts Transport",
      entity: "Betts Transport",
      amount: 2100,
      grossTotal: 2500,
      netPay: 2100,
      type: "salary_wages",
    });
    expect(otherDay.status).toBe(200);
    expect(otherDay.data.entry.date).toBe("2026-08-01");
    expect(otherDay.data.entry.amount).toBe(2100);
    expect(otherDay.data.entry.grossTotal).toBe(2500);
  });

  it("allows the same day and amount again after that row is deleted", async () => {
    const first = await post("/api/haulage/expenses", {
      date: "2026-09-01",
      vendor: "United Crestmead",
      amount: 33.33,
      category: "fuel",
    });
    expect(first.status).toBe(200);
    const again = await post("/api/haulage/receipts/manual", {
      date: "2026-09-01",
      vendor: "A Different Shop",
      amount: 33.33,
      category: "fuel",
    });
    expect(again.status).toBe(409);
    const removed = await fetch(
      `http://127.0.0.1:${port}/api/haulage/expenses/${first.data.entry.id}`,
      { method: "DELETE", headers: { Cookie: cookie } }
    );
    expect(removed.status).toBe(200);
    const saved = await post("/api/haulage/receipts/manual", {
      date: "01/09/2026",
      vendor: "United Crestmead",
      amount: 33.33,
      category: "fuel",
    });
    expect(saved.status).toBe(200);
    expect(saved.data.entry.amount).toBe(33.33);
    expect(saved.data.entry.date).toBe("2026-09-01");
    expect(saved.data.entry.vendor).toBe("United Crestmead");
  });

  it("wires the save prompt into the app", () => {
    const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(src).toMatch(/function isLedgerSavePost/);
    expect(src).toMatch(/function settleDuplicateSave/);
    expect(src).toMatch(/forceDuplicate = true/);
    expect(src).toMatch(/that date and amount is already in the ledger/);
  });
});
