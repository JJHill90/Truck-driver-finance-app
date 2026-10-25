const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const {
  findReceiptInStores,
  fileAvailable,
  serveReceiptImage,
  getReceiptFileInfoSafe,
} = require("./lib/receipt-image-serve");
const { setDataDirForTests } = require("./lib/data-dir");
const auth = require("./lib/auth");
const suite = require("./lib/suite");
const storage = require("./lib/storage");

const strongPass = "RoadSafe!99x";

function tinyJpeg() {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAkABwAHAA8ADwAPABAAEAAQABAAEAAA/9sAQwAEAwMEAwQFBQQFBgYGBQ0KCwsKCwwOCwwMCwwPEA0ODg0PEQ8SExISEhEPFRgXGRcSFB0dGx0dGx0dHf/AABEIAAoACgMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/2gAMAwEAAhEDEQA/ALxQAB//2Q==",
    "base64"
  );
}

describe("receipt-image-serve helpers", () => {
  it("finds a receipt in the first matching product store", () => {
    const receipt = { id: "r-suite", imagePath: "receipts/r-suite.jpg" };
    const found = findReceiptInStores("r-suite", [
      { product: "haulage", records: { receipts: [] } },
      { product: "suite", records: { receipts: [receipt] } },
    ]);
    expect(found.product).toBe("suite");
    expect(found.receipt.id).toBe("r-suite");
  });

  it("returns 404 missingFile when the ledger row has no bytes on disk", async () => {
    const result = await serveReceiptImage({
      receipt: { id: "missing", mimeType: "image/jpeg", imagePath: "receipts/does-not-exist.jpg" },
      storage,
      pdfThumbnail: { isPdfReceipt: () => false },
    });
    expect(result.status).toBe(404);
    expect(result.body.missingFile).toBe(true);
  });

  it("returns 200 pdf-file instead of 415 when the PDF exists but the thumb fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-file-"));
    const rel = "receipts/payslip.pdf";
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "%PDF-1.1\n%%EOF\n");
    const fakeStorage = {
      getReceiptFileInfo: (imagePath) =>
        imagePath === rel ? { filePath: abs, mime: "application/pdf", filename: "payslip.pdf" } : null,
      readReceiptImage: () => null,
    };
    const result = await serveReceiptImage({
      receipt: { id: "p1", mimeType: "application/pdf", imagePath: rel },
      storage: fakeStorage,
      pdfThumbnail: {
        isPdfReceipt: () => true,
        dataUrlForReceipt: async () => {
          throw new Error("mupdf failed");
        },
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.kind).toBe("pdf-file");
    expect(result.body.fileAvailable).toBe(true);
    expect(result.body.dataUrl).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a file from DATA_DIR when storage's repo path misses it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "data-dir-receipt-"));
    setDataDirForTests(dir);
    const rel = "receipts/from-disk.jpg";
    fs.mkdirSync(path.join(dir, "receipts"), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), tinyJpeg());
    expect(fileAvailable(rel, { getReceiptFileInfo: () => null })).toBe(true);
    const info = getReceiptFileInfoSafe(rel, { getReceiptFileInfo: () => null });
    expect(info.filePath).toBe(path.join(dir, rel));
    setDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("GET /receipts/:id/image on Suite", () => {
  let server;
  let tmp;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_PRODUCT;
    delete process.env.GOTAX_STANDALONE;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "suite-thumb-http-"));
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

  it("uses X-Gotax-Product so Suite income thumbs do not look in the Hub store", async () => {
    const username = `suitethumb_${Date.now().toString(36)}`;
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    const token = auth.createSession(username);
    const { port } = server.address();
    const jpeg = tinyJpeg();
    const scanRes = await fetch(`http://127.0.0.1:${port}/api/haulage/receipts/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `haulage_sid=${token}`,
        "X-Gotax-Product": "suite",
      },
      body: JSON.stringify({
        imageBase64: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
        mimeType: "image/jpeg",
        filename: "Quirktrak-21.10.26 AUD$2832.90.jpg",
        purpose: "income",
      }),
    });
    const scan = await scanRes.json();
    expect(scanRes.status).toBe(200);
    expect(scan.receipt && scan.receipt.id).toBeTruthy();

    const imgRes = await fetch(
      `http://127.0.0.1:${port}/api/haulage/receipts/${scan.receipt.id}/image`,
      {
        headers: {
          Cookie: `haulage_sid=${token}`,
          "X-Gotax-Product": "suite",
        },
      }
    );
    const img = await imgRes.json();
    expect(imgRes.status).toBe(200);
    expect(img.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(img.fileAvailable).toBe(true);

    const hubImg = await fetch(
      `http://127.0.0.1:${port}/api/haulage/receipts/${scan.receipt.id}/image`,
      { headers: { Cookie: `haulage_sid=${token}` } }
    );
    const hubBody = await hubImg.json();
    // Sibling lookup still finds the Suite row so Hub clients are not blank.
    expect(hubImg.status).toBe(200);
    expect(hubBody.dataUrl).toMatch(/^data:image\//);
  }, 30000);
});

describe("gallery fallback copy", () => {
  it("restores a PDF tile and names a missing Suite file", () => {
    const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(src).toMatch(/function restorePdfIcon/);
    expect(src).toMatch(/__suiteThumbFallback/);
    expect(src).toMatch(/X-Gotax-Product/);
    expect(src).toMatch(/Photo file missing — re-upload this document/);
    expect(src).toMatch(/function withSuiteProductHeader/);
  });
});
