const { stripCheque, sanitizeIncomeFields, buildIncomeDescription } = require("./lib/income-labels");

describe("stripCheque", () => {
  it("removes cheque / chq wording and tidies leftovers", () => {
    expect(stripCheque("Payment by cheque")).toBe("");
    expect(stripCheque("Cheque No. 4471")).toBe("");
    expect(stripCheque("Payment method: Cheque")).toBe("");
    expect(stripCheque("ACME Transport · paid by cheque")).toBe("ACME Transport");
    expect(stripCheque("Wages · chq 22")).toBe("Wages");
  });

  it("leaves non-cheque text untouched", () => {
    expect(stripCheque("ACME Transport Pty Ltd")).toBe("ACME Transport Pty Ltd");
    expect(stripCheque("")).toBe("");
    expect(stripCheque(null)).toBe(null);
  });
});

describe("sanitizeIncomeFields", () => {
  it("strips cheque from all user-facing income text fields", () => {
    const obj = {
      entity: "Payment by cheque",
      payer: "Linfox (cheque)",
      description: "Owner-driver remittance · paid by cheque",
      summaryNotes: "Gross $3,116.80 · cheque",
      amount: 3116.8,
    };
    sanitizeIncomeFields(obj);
    expect(obj.entity).toBe("");
    expect(obj.payer).toBe("Linfox");
    expect(/cheque/i.test(obj.description)).toBe(false);
    expect(/cheque/i.test(obj.summaryNotes)).toBe(false);
    expect(obj.amount).toBe(3116.8);
  });
});

describe("buildIncomeDescription", () => {
  it("uses payslip + pay period with dates", () => {
    const desc = buildIncomeDescription({
      documentKind: "payslip",
      payPeriodInfo: { from: "2026-06-17", to: "2026-06-23", text: "17/06/2026–23/06/2026", paymentDateLabel: "25/06/2026" },
    });
    expect(desc).toBe("Payslip — pay period 17/06/2026–23/06/2026 · paid 25/06/2026");
  });

  it("falls back to pay period ending <date> and remittance kind", () => {
    expect(buildIncomeDescription({ documentKind: "remittance", date: "2026-06-02" })).toBe(
      "Remittance — pay period ending 2026-06-02"
    );
  });

  it("defaults to Payslip when nothing is known", () => {
    expect(buildIncomeDescription({})).toBe("Payslip");
  });
});
