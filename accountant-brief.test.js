const {
  buildLodgementBrief,
  attachLodgementBrief,
  shouldAttachLodgementBrief,
  normalizeEntity,
} = require("./lib/accountant-brief");
const { buildReportPdf } = require("./lib/report-pdf");

function fyIncome(overrides) {
  return {
    date: "2026-03-10",
    type: "salary_wages",
    vendor: "Acme Transport",
    vendorAbn: "51824753556",
    amount: 2400,
    grossTotal: 3000,
    taxWithheld: 600,
    ...overrides,
  };
}

describe("normalizeEntity", () => {
  it("treats haulage profiles as PAYG employees", () => {
    expect(normalizeEntity({ driverType: "long_haul" }, "haulage")).toBe("employee");
  });

  it("reads Suite registration types", () => {
    expect(normalizeEntity({ entityType: "sole_trader" }, "suite")).toBe("sole_trader");
    expect(normalizeEntity({ driverType: "partnership" }, "suite")).toBe("partnership");
    expect(normalizeEntity({ entityType: "payg" }, "suite")).toBe("employee");
  });
});

describe("PAYG employee brief", () => {
  const profile = {
    name: "Alex Driver",
    employer: "Acme Transport",
    occupation: "Truck driver",
    tfnSupplied: true,
    annualSalary: 78000,
    entityType: "employee",
    financialYear: "2025-26",
  };
  const records = {
    income: [fyIncome()],
    expenses: [
      {
        date: "2026-02-01",
        category: "tools_equipment",
        amount: 120,
        receiptId: "r1",
      },
    ],
  };
  const summary = {
    financialYear: "2025-26",
    income: {
      assessableTotal: 3000,
      paygWithheld: 600,
      breakdown: [{ type: "salary_wages", label: "Salary & wages (PAYG)", assessableTotal: 3000, grossTotal: 3000, count: 1 }],
    },
    expenses: {
      deductibleTotal: 120,
      breakdown: [{ category: "tools_equipment", label: "Tools", atoSchedule: "D5", deductibleTotal: 120, count: 1 }],
    },
    taxEstimate: { taxableIncome: 2880, totalTax: 200, taxPayable: -400, lito: 700, medicareLevy: 0 },
    substantiation: { threshold: 300, message: "Keep records." },
    allowances: { enabled: false },
  };

  it("maps salary to item 1 and shows payer PAYG", () => {
    const brief = buildLodgementBrief(records, profile, summary, { product: "suite" });
    expect(brief.entityType).toBe("employee");
    expect(brief.returnKind).toBe("individual_iitr");
    expect(brief.payers[0]).toMatchObject({
      payer: "Acme Transport",
      abn: "51824753556",
      paygWithheld: 600,
      assessable: 3000,
    });
    expect(brief.incomeLabels[0]).toMatchObject({ returnItem: "Item 1", assessable: 3000 });
    expect(brief.deductionLabels[0].schedule).toBe("D5");
    expect(brief.taxPosition.outcome).toBe("estimated_refund");
    expect(brief.questions.some((q) => /income statement/i.test(q))).toBe(true);
  });
});

describe("sole trader brief", () => {
  it("asks for ABN and GST when the profile is a GST-registered trader", () => {
    const brief = buildLodgementBrief(
      {
        income: [
          {
            date: "2026-01-15",
            type: "business_income",
            vendor: "Site client",
            amount: 11000,
            gstAmount: 1000,
          },
        ],
        expenses: [],
      },
      {
        name: "Sam Sole",
        entityType: "sole_trader",
        tradingName: "Sam Electrical",
        gstRegistered: true,
        financialYear: "2025-26",
      },
      {
        financialYear: "2025-26",
        income: {
          breakdown: [{ type: "business_income", label: "Business sales", assessableTotal: 11000, grossTotal: 11000, count: 1 }],
          gstOnSales: 1000,
          paygWithheld: 0,
        },
        expenses: { deductibleTotal: 0, breakdown: [], gstOnPurchases: 0 },
        taxEstimate: { taxableIncome: 11000, totalTax: 1500, taxPayable: 1500 },
        bas: { gstOnSales: 1000, gstOnPurchases: 0, netGst: 1000, note: "Indicative" },
        substantiation: { threshold: 300 },
      },
      { product: "suite" }
    );
    expect(brief.returnKind).toBe("individual_sole_trader");
    expect(brief.incomeLabels[0].returnItem).toBe("Business schedule");
    expect(brief.entitySpecific.gstSnapshot.netGst).toBe(1000);
    expect(brief.gaps.some((g) => g.code === "abn")).toBe(true);
    expect(brief.questions.some((q) => /PSI/i.test(q))).toBe(true);
  });
});

describe("partnership brief", () => {
  it("uses partner share and item 13 labels", () => {
    const brief = buildLodgementBrief(
      {
        income: [
          {
            date: "2026-04-01",
            type: "partnership_distribution",
            vendor: "Hill & Co",
            amount: 40000,
          },
        ],
        expenses: [],
      },
      {
        name: "Pat Partner",
        entityType: "partnership",
        partnershipName: "Hill & Co",
        abn: "12345678901",
        partnerSharePercent: 50,
        tfnSupplied: true,
        financialYear: "2025-26",
      },
      {
        financialYear: "2025-26",
        income: {
          breakdown: [
            {
              type: "partnership_distribution",
              label: "Partnership distribution",
              assessableTotal: 40000,
              grossTotal: 40000,
              count: 1,
            },
          ],
          paygWithheld: 0,
        },
        expenses: { deductibleTotal: 0, breakdown: [] },
        taxEstimate: { taxableIncome: 40000, totalTax: 5000, taxPayable: 5000 },
        substantiation: { threshold: 300 },
      },
      { product: "suite" }
    );
    expect(brief.returnKind).toBe("partnership_interest");
    expect(brief.identity.partnerSharePercent).toBe(50);
    expect(brief.incomeLabels[0].returnItem).toBe("Item 13");
    expect(brief.entitySpecific.points.some((p) => /50%/.test(p))).toBe(true);
    expect(brief.questions.some((q) => /partnership tax return/i.test(q))).toBe(true);
  });
});

describe("attachLodgementBrief", () => {
  const emptySummary = {
    financialYear: "2025-26",
    income: { breakdown: [], paygWithheld: 0 },
    expenses: { breakdown: [], deductibleTotal: 0 },
    taxEstimate: {},
  };

  it("hangs the brief on the accountant report for Pro+", () => {
    const report = { summary: emptySummary };
    attachLodgementBrief(
      report,
      { income: [], expenses: [] },
      { name: "A", entityType: "employee" },
      { product: "suite", entitlements: { isProPlus: true } }
    );
    expect(report.lodgementBrief.entityLabel).toBe("Employee (PAYG)");
  });

  it("does not attach for Free, leftover trial, or Suite/Haulage Pro", () => {
    expect(shouldAttachLodgementBrief(null)).toBe(false);
    expect(shouldAttachLodgementBrief({ isPro: false, isProPlus: false })).toBe(false);
    expect(shouldAttachLodgementBrief({ isPro: true, isProPlus: false })).toBe(false);
    expect(shouldAttachLodgementBrief({ isProPlus: true })).toBe(true);

    const report = { summary: emptySummary, lodgementBrief: { leftover: true } };
    attachLodgementBrief(
      report,
      { income: [], expenses: [] },
      { name: "A", entityType: "employee" },
      { product: "suite", entitlements: { isPro: true, isProPlus: false } }
    );
    expect(report.lodgementBrief).toBeUndefined();
  });
});

describe("EOFY PDF lodgement brief", () => {
  it("prints the agent brief heading when attached", async () => {
    const report = {
      generatedAt: "2026-08-26T00:00:00.000Z",
      driver: { name: "Alex Driver", employer: "Acme", driverType: "employee", tfnSupplied: true },
      summary: {
        financialYear: "2025-26",
        profile: { salaryBand: "band1" },
        income: {
          breakdown: [{ label: "Salary", grossTotal: 3000, assessableTotal: 3000 }],
          grossTotal: 3000,
          assessableTotal: 3000,
        },
        expenses: { breakdown: [], deductibleTotal: 0, grossTotal: 0 },
        taxEstimate: { taxableIncome: 3000, incomeTax: 0, medicareLevy: 0, totalTax: 0, effectiveRate: 0 },
        allowances: {},
      },
    };
    attachLodgementBrief(
      report,
      { income: [fyIncome()], expenses: [] },
      { name: "Alex Driver", employer: "Acme Transport", entityType: "employee", tfnSupplied: true },
      { product: "suite", entitlements: { isProPlus: true } }
    );
    const doc = buildReportPdf(report, { income: [fyIncome()], expenses: [] }, "2025-26");
    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    });
    expect(buf.length).toBeGreaterThan(500);
    expect(report.lodgementBrief.payers[0].payer).toBe("Acme Transport");
  });
});
