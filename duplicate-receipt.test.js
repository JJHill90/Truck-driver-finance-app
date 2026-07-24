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

  it("returns empty when keys are incomplete", () => {
    expect(findDuplicateMatches(records, { vendor: "Shell", amount: 95 }, "expense", 95)).toEqual(
      []
    );
  });
});
