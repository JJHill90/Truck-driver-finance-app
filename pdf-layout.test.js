const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const PDFDocument = require("pdfkit");
const { wrapToWidth, measureRowHeight, table, MIN_ROW_H } = require("./lib/pdf-layout");
const { buildAccountantPackPdf } = require("./lib/accountant-pack-pdf");
const { buildReportPdf } = require("./lib/report-pdf");
const { buildBasWorksheetPdf } = require("./lib/suite/bas-worksheet-pdf");

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

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

const LONG_DETAIL =
  "Confirm the myGov income statement matches item 1 gross and PAYG withheld, including overtime and allowances already shown on the statement.";
const LONG_NAME = "Alexandra Catherine Hill-Macquarie of Regional Queensland Linehaul";

describe("pdf layout wrapping", () => {
  it("grows a table row instead of clipping or ellipsizing long text", () => {
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    doc.font("Helvetica").fontSize(8.2);
    const shortH = measureRowHeight(doc, ["Status", "Name"], [70, 190], {});
    const longH = measureRowHeight(doc, ["Ask", LONG_DETAIL], [70, 190], {});
    expect(shortH).toBeGreaterThanOrEqual(MIN_ROW_H);
    expect(longH).toBeGreaterThan(shortH);
    const wrapped = wrapToWidth(doc, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 40);
    expect(wrapped).toMatch(/\n/);
    doc.end();
  });

  it("keeps the full long cell text in a rendered table", async () => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
    table(doc, ["Status", "Detail"], [{ cells: ["Ask", LONG_DETAIL] }], [70, 400], ["left", "left"]);
    const text = pdfPlainText(await collectPdf(doc));
    expect(text).toMatch(/Confirm the myGov income statement/);
    expect(text).toMatch(/already shown on the statement/);
    expect(text).not.toMatch(/\.\.\./);
  });

  it("does not clip long fields in the accountant pack, FY report or BAS PDF", async () => {
    const pack = {
      financialYear: "2026-27",
      generatedAt: "2026-10-25T01:00:00.000Z",
      disclaimer: LONG_DETAIL,
      identity: { name: LONG_NAME, employer: "Betts Transport" },
      registration: { id: "employee", label: "Employee (PAYG)" },
      income: { items: [], payers: [] },
      deductions: { schedules: [] },
      totals: {},
      payg: {},
      travel: {},
      checklist: {
        items: [{ status: "unknown", label: "Income statement", detail: LONG_DETAIL }],
      },
      agentNotes: [LONG_DETAIL],
    };
    const packText = pdfPlainText(await collectPdf(buildAccountantPackPdf(pack)));
    expect(packText).toMatch(/Alexandra Catherine Hill-Macquarie/);
    expect(packText).toMatch(/already shown on the statement/);

    const report = {
      generatedAt: "2026-10-25T01:00:00.000Z",
      driver: { name: LONG_NAME, employer: "Betts Transport", driverType: "linehaul" },
      summary: {
        financialYear: "2026-27",
        profile: { salaryBand: "band1" },
        income: {
          breakdown: [{ label: LONG_DETAIL, grossTotal: 2200, assessableTotal: 2200 }],
          grossTotal: 2200,
          assessableTotal: 2200,
        },
        expenses: { breakdown: [], deductibleTotal: 0, grossTotal: 0 },
        taxEstimate: { taxableIncome: 2200, incomeTax: 0, medicareLevy: 0, totalTax: 0, effectiveRate: 0 },
        allowances: {},
      },
    };
    const fyText = pdfPlainText(await collectPdf(buildReportPdf(report, { income: [], expenses: [] }, "2026-27")));
    expect(fyText).toMatch(/Alexandra Catherine Hill-Macquarie/);
    expect(fyText).toMatch(/already shown on the statement/);

    const basText = pdfPlainText(
      await collectPdf(
        buildBasWorksheetPdf({
          financialYear: "2026-27",
          quarterLabel: "Q1",
          identity: { name: LONG_NAME, tradingName: LONG_NAME, abnFormatted: "51 824 753 556" },
          boxes: [{ id: "g1", atoBox: "G1", label: LONG_DETAIL, amount: 1100 }],
          lodgement: { howToLodge: [] },
        })
      )
    );
    expect(basText).toMatch(/Alexandra Catherine Hill-Macquarie/);
    expect(basText).toMatch(/already shown on the statement/);
  });

  it("uses the shared wrap helper from every report PDF builder", () => {
    const files = [
      "lib/accountant-pack-pdf.js",
      "lib/report-pdf.js",
      "lib/suite/bas-worksheet-pdf.js",
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(__dirname, rel), "utf8");
      expect(src).toMatch(/require\(["'].*pdf-layout["']\)/);
      expect(src).not.toMatch(/ellipsis:\s*true/);
      expect(src).not.toMatch(/lineBreak:\s*false/);
    }
  });
});
