const {
  buildComponentBreakdown,
  parseLabeledLineItems,
  assessIncomeCompliance,
  assessExpenseCompliance,
  analyzeScan,
  sgRate,
} = require("./lib/document-breakdown");

describe("sgRate", () => {
  it("returns the SG rate for known years and defaults to 12%", () => {
    expect(sgRate("2024-25")).toBe(0.115);
    expect(sgRate("2025-26")).toBe(0.12);
    expect(sgRate("2099-00")).toBe(0.12);
  });
});

describe("buildComponentBreakdown (income)", () => {
  it("breaks a payslip into typed components from line items", () => {
    const ocr = {
      documentType: "income",
      grossTotal: 2000,
      netPay: 1500,
      gstAmount: 0,
      lineItems: [
        { description: "Gross wages", amount: 2000 },
        { description: "PAYG tax withheld", amount: 400 },
        { description: "Superannuation", amount: 240 },
        { description: "Annual leave loading", amount: 100 },
      ],
    };
    const { components } = buildComponentBreakdown(ocr, true, "2025-26");
    const byType = Object.fromEntries(components.map((c) => [c.type, c]));
    expect(byType.wages.amount).toBe(2000);
    expect(byType.tax.amount).toBe(400);
    expect(byType.super.amount).toBe(240);
    expect(byType.super.detected).toBe(true);
    expect(byType.entitlements.amount).toBe(100);
    expect(byType.net.amount).toBe(1500);
  });

  it("estimates super when not shown on the document", () => {
    const { components } = buildComponentBreakdown(
      { documentType: "income", grossTotal: 1000, netPay: 800 },
      true,
      "2025-26"
    );
    const superComp = components.find((c) => c.type === "super");
    expect(superComp.detected).toBe(false);
    expect(superComp.amount).toBe(120); // 1000 * 12%
  });
});

describe("parseLabeledLineItems", () => {
  it("labels entries with the text preceding the amount", () => {
    const text = [
      "BP Truck Stop",
      "Diesel 450.3L        $720.48",
      "AdBlue 10L           $18.90",
      "Coffee               $5.50",
      "GST                  $67.71",
      "TOTAL                $744.88",
    ].join("\n");
    const items = parseLabeledLineItems(text);
    const map = Object.fromEntries(items.map((i) => [i.description, i.amount]));
    expect(map["Diesel 450.3L"]).toBe(720.48);
    expect(map["AdBlue 10L"]).toBe(18.9);
    expect(map["Coffee"]).toBe(5.5);
  });
});

describe("buildComponentBreakdown (expense, multi-entry receipt)", () => {
  it("labels each entry from the receipt image text and separates GST/total", () => {
    const ocr = {
      documentType: "expense",
      amount: 744.88,
      gst: 67.71,
      rawTextPreview: [
        "BP Truck Stop",
        "Diesel 450.3L        $720.48",
        "AdBlue 10L           $18.90",
        "Coffee               $5.50",
        "GST                  $67.71",
        "TOTAL                $744.88",
      ].join("\n"),
    };
    const { components, kind } = buildComponentBreakdown(ocr, false, "2025-26");
    expect(kind).toBe("expense");
    const lines = components.filter((c) => c.type === "line").map((c) => c.label);
    expect(lines).toContain("Diesel 450.3L");
    expect(lines).toContain("AdBlue 10L");
    expect(lines).toContain("Coffee");
    // GST and grand total are captured as their own components, not line items.
    expect(components.find((c) => c.type === "gst").amount).toBe(67.71);
    expect(components.find((c) => c.type === "total").amount).toBe(744.88);
    expect(lines).not.toContain("TOTAL");
    expect(lines).not.toContain("GST");
  });
});

describe("buildComponentBreakdown (income, labels from document text)", () => {
  const ocr = {
    documentType: "income",
    grossTotal: 2000,
    netPay: 1520,
    rawTextPreview: [
      "ACME Freight Pty Ltd - Remittance Advice",
      "Gross wages: $2,000.00",
      "PAYG tax withheld: $480.00",
      "Superannuation: $180.00",
      "Annual leave loading: $120.00",
      "Net pay: $1,520.00",
    ].join("\n"),
  };

  it("labels each income entry with the document wording and types them", () => {
    const { components } = buildComponentBreakdown(ocr, true, "2025-26");
    const byLabel = Object.fromEntries(components.map((c) => [c.label, c]));
    expect(byLabel["Gross wages"].type).toBe("wages");
    expect(byLabel["PAYG tax withheld"].type).toBe("tax");
    expect(byLabel["Superannuation"].type).toBe("super");
    expect(byLabel["Superannuation"].detected).toBe(true);
    expect(byLabel["Annual leave loading"].type).toBe("entitlements");
    expect(byLabel["Net pay"].type).toBe("net");
  });

  it("detects a super breach from the document (super below 12% of gross)", () => {
    const breakdown = buildComponentBreakdown(ocr, true, "2025-26");
    const c = assessIncomeCompliance(ocr, breakdown, "2025-26");
    const sg = c.checks.find((x) => x.name === "Superannuation Guarantee");
    expect(sg.status).toBe("breach"); // 180 < 12% of 2000 (240)
    expect(c.status).toBe("breach");
  });
});

describe("assessIncomeCompliance", () => {
  it("flags a breach when super is below the SG minimum", () => {
    const ocr = {
      documentType: "income",
      grossTotal: 2000,
      netPay: 1600,
      lineItems: [
        { description: "PAYG tax", amount: 400 },
        { description: "Super", amount: 100 }, // should be 240 at 12%
      ],
    };
    const breakdown = buildComponentBreakdown(ocr, true, "2025-26");
    const c = assessIncomeCompliance(ocr, breakdown, "2025-26");
    const sg = c.checks.find((x) => x.name === "Superannuation Guarantee");
    expect(sg.status).toBe("breach");
    expect(c.status).toBe("breach");
  });

  it("is within policy when super meets the SG minimum", () => {
    const ocr = {
      documentType: "income",
      grossTotal: 2000,
      netPay: 1600,
      lineItems: [
        { description: "PAYG tax", amount: 400 },
        { description: "Super", amount: 240 },
      ],
    };
    const breakdown = buildComponentBreakdown(ocr, true, "2025-26");
    const c = assessIncomeCompliance(ocr, breakdown, "2025-26");
    const sg = c.checks.find((x) => x.name === "Superannuation Guarantee");
    expect(sg.status).toBe("within_policy");
  });

  it("flags review when super is not detected", () => {
    const ocr = { documentType: "income", grossTotal: 2000, netPay: 1600 };
    const breakdown = buildComponentBreakdown(ocr, true, "2025-26");
    const c = assessIncomeCompliance(ocr, breakdown, "2025-26");
    expect(c.status).toBe("review");
  });
});

describe("assessExpenseCompliance", () => {
  it("flags meals over the ATO reasonable amount as exceeds", () => {
    const c = assessExpenseCompliance({ amount: 200, suggestedCategory: "meals_dinner" }, "2025-26");
    const meal = c.checks.find((x) => x.name === "Reasonable amount (meals)");
    expect(meal.status).toBe("exceeds");
    expect(c.status).toBe("exceeds");
  });

  it("passes meals within the reasonable amount", () => {
    const c = assessExpenseCompliance({ amount: 40, suggestedCategory: "meals_dinner" }, "2025-26");
    const meal = c.checks.find((x) => x.name === "Reasonable amount (meals)");
    expect(meal.status).toBe("within_policy");
  });
});

describe("analyzeScan", () => {
  it("returns breakdown and compliance for an income scan", () => {
    const r = analyzeScan(
      { documentType: "income", grossTotal: 2000, netPay: 1600 },
      "income",
      { financialYear: "2025-26" }
    );
    expect(r.componentBreakdown.length).toBeGreaterThan(0);
    expect(r.compliance.scope).toBe("income");
  });
});
