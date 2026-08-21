const {
  stripCheque,
  sanitizeIncomeFields,
  buildIncomeDescription,
  resolveIncomeCompanyName,
  companyFromEmailDomain,
} = require("./lib/income-labels");

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
    expect(obj.entity).toBe("Linfox");
    expect(obj.payer).toBe("Linfox");
    expect(/cheque/i.test(obj.description)).toBe(false);
    expect(/cheque/i.test(obj.summaryNotes)).toBe(false);
    expect(obj.amount).toBe(3116.8);
  });

  it("replaces Facsimile / Payslip clutter with company + pay period", () => {
    const obj = {
      entity: "Facsimilie 02 6777 1080",
      description: "Payslip",
      summaryNotes: "Entity: Facsimilie · Gross: $3064.52 · Taxable: $3064.52",
      rawText: "Email: admin@bettstransport.com.au\nABN: 60 003 894 568",
      payPeriodInfo: {
        from: "2026-06-03",
        to: "2026-06-09",
        text: "03/06/2026 – 09/06/2026",
      },
      documentKind: "payslip",
    };
    sanitizeIncomeFields(obj);
    expect(obj.entity).toBe("Betts Transport");
    expect(obj.description).toBe("Betts Transport, pay period 03/06/2026 to 09/06/2026");
    expect(obj.summaryNotes).toBe(obj.description);
  });
});

describe("buildIncomeDescription", () => {
  it("uses company name + pay period dates", () => {
    const desc = buildIncomeDescription({
      entity: "Betts Transport",
      documentKind: "payslip",
      payPeriodInfo: {
        from: "2026-06-03",
        to: "2026-06-09",
        text: "03/06/2026 – 09/06/2026",
        paymentDateLabel: "Thu 11 Jun 2026",
      },
    });
    expect(desc).toBe("Betts Transport, pay period 03/06/2026 to 09/06/2026");
  });

  it("resolves company from employer email when entity is clutter", () => {
    const desc = buildIncomeDescription({
      entity: "Facsimilie 02 6777 1080",
      rawText: "Pay Period From: 3/6/2026 To: 9/6/2026\nEmail: admin@bettstransport.com.au",
      payPeriodInfo: { from: "2026-06-03", to: "2026-06-09", text: "03/06/2026 – 09/06/2026" },
    });
    expect(desc).toBe("Betts Transport, pay period 03/06/2026 to 09/06/2026");
  });

  it("falls back to pay period ending <date> and remittance kind", () => {
    expect(buildIncomeDescription({ documentKind: "remittance", date: "2026-06-02" })).toBe(
      "Pay period ending 02/06/2026"
    );
  });

  it("defaults to Payslip when nothing is known", () => {
    expect(buildIncomeDescription({})).toBe("Payslip");
  });
});

describe("resolveIncomeCompanyName", () => {
  it("humanises email domains", () => {
    expect(companyFromEmailDomain("admin@bettstransport.com.au")).toBe("Betts Transport");
    expect(companyFromEmailDomain("x@gmail.com")).toBeNull();
  });

  it("rejects person names and addresses", () => {
    expect(
      resolveIncomeCompanyName({ entity: "HILL, David James", rawText: "" })
    ).toBeNull();
    expect(resolveIncomeCompanyName({ entity: "Uralla Road", rawText: "" })).toBeNull();
  });
});
