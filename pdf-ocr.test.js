const PDFDocument = require("pdfkit");
const { renderPdfPagesToPng, pdfResultNeedsOcr } = require("./lib/pdf-ocr");

function makePdf(lines) {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(14);
    for (const l of lines) doc.text(l);
    doc.end();
  });
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("pdfResultNeedsOcr", () => {
  it("flags expense results with no dollar total", () => {
    expect(pdfResultNeedsOcr(null, "expense")).toBe(true);
    expect(pdfResultNeedsOcr({ amount: null }, "expense")).toBe(true);
    expect(pdfResultNeedsOcr({ amount: 0 }, "expense")).toBe(true);
    expect(pdfResultNeedsOcr({ amount: 50.05 }, "expense")).toBe(false);
  });

  it("uses income totals (gross/net/taxable) to decide", () => {
    expect(pdfResultNeedsOcr({ amount: null, grossTotal: null }, "income")).toBe(true);
    expect(pdfResultNeedsOcr({ grossTotal: 2500 }, "income")).toBe(false);
    expect(pdfResultNeedsOcr({ netPay: 2000 }, "income")).toBe(false);
  });
});

describe("renderPdfPagesToPng", () => {
  it("rasterises each PDF page to a PNG image", async () => {
    const pdf = await makePdf(["BP TRUCK STOP", "TOTAL 50.05"]);
    const pngs = await renderPdfPagesToPng(pdf.toString("base64"));
    expect(pngs.length).toBe(1);
    const bytes = Buffer.from(pngs[0], "base64");
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
  }, 30000);

  it("accepts a data: URL and caps the page count", async () => {
    const pdf = await makePdf(["page one"]);
    const dataUrl = `data:application/pdf;base64,${pdf.toString("base64")}`;
    const pngs = await renderPdfPagesToPng(dataUrl, { maxPages: 1 });
    expect(pngs.length).toBe(1);
  }, 30000);

  it("returns an empty list for empty input", async () => {
    expect(await renderPdfPagesToPng("")).toEqual([]);
  });
});
