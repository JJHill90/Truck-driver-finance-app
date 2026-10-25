const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const auth = require("./lib/auth");
const suite = require("./lib/suite");
const storage = require("./lib/storage");
const {
  isPdfReceipt,
  siblingThumbRelative,
  dataUrlForReceipt,
  deleteThumb,
} = require("./lib/pdf-thumbnail");

const strongPass = "RoadSafe!99x";

function tinyPayslipPdf() {
  const body = "QUIRKTRAK ASIA PACIFIC PTY LTD  NET PAY 1240.10";
  return Buffer.from(
    `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${body.length + 20}>>stream\nBT /F1 12 Tf 20 160 Td (${body}) Tj ET\nendstream\nendobj\nxref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\n%%EOF\n`
  );
}

describe("pdf-thumbnail helpers", () => {
  it("maps a stored PDF path to a sibling thumb", () => {
    expect(siblingThumbRelative("receipts/abc-123.pdf")).toBe("receipts/abc-123.thumb.png");
    expect(siblingThumbRelative("receipts/shot.jpg")).toBeNull();
    expect(isPdfReceipt({ mimeType: "application/pdf", imagePath: "receipts/a.pdf" })).toBe(true);
    expect(isPdfReceipt({ mimeType: "image/jpeg", filename: "slip.jpg" })).toBe(false);
  });

  it("rasterises the first page to a PNG data URL and writes the thumb", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-thumb-"));
    const pdfPath = path.join(dir, "doc.pdf");
    const pdf = tinyPayslipPdf();
    fs.writeFileSync(pdfPath, pdf);
    const dataUrl = `data:application/pdf;base64,${pdf.toString("base64")}`;
    const fakeStorage = {
      getReceiptFileInfo: () => ({ filePath: pdfPath }),
      readReceiptImage: (rel) => {
        if (String(rel).endsWith(".thumb.png")) {
          const thumb = path.join(dir, "doc.thumb.png");
          if (!fs.existsSync(thumb)) return null;
          return `data:image/png;base64,${fs.readFileSync(thumb).toString("base64")}`;
        }
        return dataUrl;
      },
      deleteReceiptFile: (rel) => {
        const thumb = path.join(dir, path.basename(rel));
        if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
        return true;
      },
    };
    const receipt = { id: "r1", mimeType: "application/pdf", imagePath: "receipts/doc.pdf" };
    const out = await dataUrlForReceipt(receipt, fakeStorage);
    expect(out).toMatch(/^data:image\/png;base64,/);
    expect(fs.existsSync(path.join(dir, "doc.thumb.png"))).toBe(true);
    expect(deleteThumb("receipts/doc.pdf", fakeStorage)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);
});

describe("GET /receipts/:id/image PDF thumb", () => {
  let server;
  let tmp;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-thumb-http-"));
    auth.setDataDirForTests(tmp);
    suite.setDataDirForTests(tmp);
    fs.mkdirSync(path.join(tmp, "users"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "receipts"), { recursive: true });
    auth.ensureAdminBootstrap();
    const { app } = require("./server");
    server = await new Promise((resolve) => {
      const s = http.createServer(app);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    auth.setDataDirForTests(null);
    suite.setDataDirForTests(null);
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns a first-page PNG instead of 415 for a PDF remittance", async () => {
    const username = `pdfthumb_${Date.now().toString(36)}`;
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    const token = auth.createSession(username);
    const { port } = server.address();
    const pdf = tinyPayslipPdf();
    const imageBase64 = `data:application/pdf;base64,${pdf.toString("base64")}`;
    const scanRes = await fetch(`http://127.0.0.1:${port}/api/haulage/receipts/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `haulage_sid=${token}`,
      },
      body: JSON.stringify({
        imageBase64,
        mimeType: "application/pdf",
        filename: "Quirktrak-15.09.26 AUD$1240.10.pdf",
        purpose: "income",
      }),
    });
    const scan = await scanRes.json();
    expect(scanRes.status).toBe(200);
    expect(scan.receipt && scan.receipt.id).toBeTruthy();

    const imgRes = await fetch(
      `http://127.0.0.1:${port}/api/haulage/receipts/${scan.receipt.id}/image`,
      { headers: { Cookie: `haulage_sid=${token}` } }
    );
    const img = await imgRes.json();
    expect(imgRes.status).toBe(200);
    expect(img.kind).toBe("pdf-thumb");
    expect(img.dataUrl).toMatch(/^data:image\/png;base64,/);

    const recordsRes = await fetch(`http://127.0.0.1:${port}/api/haulage/records`, {
      headers: { Cookie: `haulage_sid=${token}` },
    });
    const records = await recordsRes.json();
    const saved = (records.receipts || []).find((r) => r.id === scan.receipt.id);
    if (saved && saved.imagePath) {
      deleteThumb(saved.imagePath, storage);
      storage.deleteReceiptFile(saved.imagePath);
    }
  }, 30000);
});

describe("gallery uses PDF thumbs", () => {
  it("replaces the blank PDF tile with a receipt-thumb image", () => {
    const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
    const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");
    expect(src).toMatch(/receipt-pdf-thumb/);
    expect(src).toMatch(/data-receipt-thumb/);
    expect(src).toMatch(/__haulagePdfThumb/);
    expect(hub).toMatch(/enhancements\.js\?v=lodgement-brief-1/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=lodgement-brief-1/);
  });
});
