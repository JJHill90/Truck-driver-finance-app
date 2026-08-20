const {
  extractTravelAllowance,
  applyTravelAllowanceToEntry,
} = require("./lib/travel-allowance-extract");

describe("extractTravelAllowance", () => {
  it("reads amount after Travel Allowance label", () => {
    const result = extractTravelAllowance({
      rawText: "Wages 2,400.00\nTravel Allowance 640.00\nNet Pay 1,900.00",
      date: "2025-09-12",
    });
    expect(result.detected).toBe(true);
    expect(result.amount).toBe(640);
    expect(result.overnightDays).toBeGreaterThan(0);
    expect(result.daysSource).toBe("amount_div_rate");
  });

  it("prefers explicit overnight day counts", () => {
    const result = extractTravelAllowance({
      rawText: "Travel Allowance $512.00 for 4 nights away",
      date: "2025-09-12",
    });
    expect(result.detected).toBe(true);
    expect(result.overnightDays).toBe(4);
    expect(result.daysSource).toBe("payslip_days");
  });

  it("ignores synthetic overnight_allowance breakdown with detected:false", () => {
    const result = extractTravelAllowance({
      rawText: "Gross wages 3000 Net 2200",
      componentBreakdown: [
        {
          type: "overnight_allowance",
          label: "Travel / overnight allowance",
          amount: 896,
          detected: false,
        },
      ],
      date: "2025-09-12",
    });
    expect(result.detected).toBe(false);
    expect(result.amount).toBeNull();
  });

  it("applies fields onto an income entry", () => {
    const entry = { id: "x" };
    applyTravelAllowanceToEntry(entry, {
      amount: 256,
      overnightDays: 2,
      daysSource: "ocr",
    });
    expect(entry.travelAllowanceAmount).toBe(256);
    expect(entry.overnightDays).toBe(2);
    expect(entry.overnightDaysSource).toBe("ocr");
  });
});
