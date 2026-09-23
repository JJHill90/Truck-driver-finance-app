const zlib = require("zlib");
const { buildBasPack } = require("./lib/suite/bas-pack");
const { buildBasWorksheetPdf } = require("./lib/suite/bas-worksheet-pdf");
const {
  buildBasWorksheetCsv,
  buildBasWorksheetExcel,
  basExportFilename,
} = require("./lib/suite/bas-worksheet-export");

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

function samplePack() {
  return buildBasPack(
    {
      income: [{ date: "2026-08-15", amount: 1100 }],
      expenses: [{ date: "2026-08-16", amount: 220 }],
    },
    {
      name: "Alex Driver",
      tradingName: "Alex Haulage",
      abn: "51824753556",
      entityType: "sole_trader",
      gstRegistered: true,
      financialYear: "2026-27",
    },
    { financialYear: "2026-27", quarter: "q1", now: "2026-09-22T00:00:00.000Z" }
  );
}

describe("BAS worksheet exports", () => {
  it("writes ATO boxes, identity and a not-lodged disclaimer into the PDF", async () => {
    const pack = samplePack();
    const buf = await collectPdf(buildBasWorksheetPdf(pack));
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    const text = pdfPlainText(buf);
    expect(text).toMatch(/GST activity statement worksheet/);
    expect(text).toMatch(/Not a lodged BAS/);
    expect(text).toMatch(/G1/);
    expect(text).toMatch(/1A/);
    expect(text).toMatch(/G11/);
    expect(text).toMatch(/1B/);
    expect(text).toMatch(/Alex Driver/);
    expect(text).toMatch(/51 824 753 556/);
    expect(text).toMatch(/Lodge by 28\/10\/2026/);
  });

  it("writes an Excel workbook and a UTF-8 CSV that both include G1 and box 9", () => {
    const pack = samplePack();
    const csv = buildBasWorksheetCsv(pack);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toMatch(/G1,Total sales,1100.00/);
    expect(csv).toMatch(/9,Payment,80.00/);
    expect(csv).toMatch(/not a lodged BAS/i);

    const xls = buildBasWorksheetExcel(pack);
    expect(xls).toMatch(/Excel.Sheet/);
    expect(xls).toMatch(/<Data ss:Type="String">G1<\/Data>/);
    expect(xls).toMatch(/<Data ss:Type="Number">1100.00<\/Data>/);
    expect(xls).toMatch(/BAS worksheet/);
    expect(basExportFilename(pack, "xls", "suite")).toBe("gotax-bas-2026-27-q1.xls");
    expect(basExportFilename(pack, "pdf", "haulage")).toBe("haulage-bas-2026-27-q1.pdf");
  });

  it("includes quarterly lodge-by dates on a full-year pack", () => {
    const pack = buildBasPack(
      {
        income: [
          { date: "2025-08-15", amount: 1100 },
          { date: "2025-11-15", amount: 220 },
        ],
        expenses: [],
      },
      { entityType: "sole_trader", gstRegistered: true, financialYear: "2025-26" },
      { financialYear: "2025-26" }
    );
    expect(pack.quarter).toBe("all");
    expect(pack.quarterly).toHaveLength(4);
    expect(pack.quarterly[0].sales).toBe(1100);
    expect(pack.quarterly[1].sales).toBe(220);
    expect(pack.quarterly[1].period.dueDate).toBe("2026-03-02");
    expect(pack.sales).toBe(1320);
  });
});
