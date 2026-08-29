const zlib = require("zlib");
const { buildReportPdf } = require("./lib/report-pdf");

function pdfPlainText(buf) {
  const parts = [];
  let pos = 0;
  while (true) {
    const i = buf.indexOf(Buffer.from("stream"), pos);
    if (i < 0) break;
    let start = i + 6;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const j = buf.indexOf(Buffer.from("endstream"), start);
    if (j < 0) break;
    let end = j;
    if (buf[end - 1] === 0x0a) end -= 1;
    if (buf[end - 1] === 0x0d) end -= 1;
    try {
      const inflated = zlib.inflateSync(buf.subarray(start, end)).toString("utf8");
      for (const m of inflated.matchAll(/<([0-9A-Fa-f]+)>/g)) {
        if (m[1].length % 2 === 0) {
          try {
            parts.push(Buffer.from(m[1], "hex").toString("utf8"));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore non-flate streams */
    }
    pos = j + 9;
  }
  return parts.join("");
}

describe("EOFY PDF vending machine rows", () => {
  it("shades vending expenses and lists the Vending flag", async () => {
    const report = {
      generatedAt: "2026-08-26T00:00:00.000Z",
      driver: {
        name: "Test Driver",
        employer: "Haul Co",
        abn: "",
        driverType: "linehaul",
        tfnSupplied: true,
      },
      summary: {
        financialYear: "2025-26",
        profile: { salaryBand: "band1" },
        income: { breakdown: [], grossTotal: 0, assessableTotal: 0 },
        expenses: { breakdown: [], deductibleTotal: 4.5, grossTotal: 4.5 },
        taxEstimate: {
          taxableIncome: 0,
          incomeTax: 0,
          medicareLevy: 0,
          totalTax: 0,
          effectiveRate: 0,
          ratesFinancialYear: "2025-26",
        },
        allowances: {},
      },
    };
    const records = {
      expenses: [
        {
          id: "e-vend",
          date: "2026-03-10",
          vendor: "Roadhouse Vending",
          category: "incidentals",
          amount: 4.5,
          workUsePercent: 100,
          vendingMachine: true,
          noReceipt: true,
        },
        {
          id: "e-normal",
          date: "2026-03-11",
          vendor: "BP",
          category: "incidentals",
          amount: 12,
          workUsePercent: 100,
        },
      ],
      income: [],
    };

    const doc = buildReportPdf(report, records, "2025-26");
    const chunks = [];
    await new Promise((resolve, reject) => {
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", resolve);
      doc.on("error", reject);
      doc.end();
    });
    const buf = Buffer.concat(chunks);
    expect(buf.length).toBeGreaterThan(500);
    const text = pdfPlainText(buf);
    expect(text).toMatch(/Vending/);
    expect(text).toMatch(/Roadhouse/);
    expect(text).toMatch(/Flags/);
    expect(text).toMatch(/slate-teal/i);
  });
});
