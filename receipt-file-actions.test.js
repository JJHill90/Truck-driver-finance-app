const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const auth = require("./lib/auth");
const suite = require("./lib/suite");

const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");
const strongPass = "RoadSafe!99x";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("receipt viewer file actions", () => {
  it("does not navigate Play WebViews to /receipts/:id/file", () => {
    const fromLightbox = src.slice(src.indexOf("function openLightbox"), src.indexOf("function closeLightbox"));
    const fromPaint = src.slice(src.indexOf("function paintAndroidPdfViewer"), src.indexOf("function patchPdfReceiptViewer"));
    expect(fromLightbox).toMatch(/data-open-receipt-file/);
    expect(fromLightbox).not.toMatch(/<a class="btn primary" href="\$\{esc\(src\)\}" target="_blank"/);
    expect(fromPaint).toMatch(/data-open-receipt-file/);
    expect(src).not.toMatch(/receiptFileUrl\(receiptId\) : "#"/);
    expect(src).toMatch(/function triggerBlobDownload/);
    expect(src).toMatch(/function fetchReceiptFileBlob/);
    expect(src).toMatch(/function bindReceiptFileActions/);
    expect(src).toMatch(/#receipt-viewer-download/);
    expect(src).toMatch(/credentials: "same-origin"/);
  });

  it("cache-busts enhancements so Play WebViews load the blob download", () => {
    expect(hub).toMatch(/enhancements\.js\?v=receipt-file-1/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=receipt-file-1/);
  });
});

describe("GET /receipts/:id/file still serves the saved photo", () => {
  let server;
  let tmp;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-file-"));
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

  it("returns the image bytes with an attachment name when download=1", async () => {
    const username = `fileact_${Date.now().toString(36)}`;
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    const sid = auth.createSession(username);
    const { port } = server.address();
    const scanRes = await fetch(`http://127.0.0.1:${port}/api/haulage/receipts/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `haulage_sid=${sid}`,
      },
      body: JSON.stringify({
        imageBase64: `data:image/png;base64,${TINY_PNG.toString("base64")}`,
        mimeType: "image/png",
        filename: "25.10.26 AUD$12.00.png",
        purpose: "expense",
      }),
    });
    const scan = await scanRes.json();
    expect(scanRes.status).toBe(200);
    expect(scan.receipt && scan.receipt.id).toBeTruthy();
    const receiptId = scan.receipt.id;

    const res = await fetch(`http://127.0.0.1:${port}/api/haulage/receipts/${receiptId}/file?download=1`, {
      headers: { Cookie: `haulage_sid=${sid}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image\/png/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment;/i);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.slice(0, 8).toString("hex")).toBe(TINY_PNG.slice(0, 8).toString("hex"));

    const imageRes = await fetch(`http://127.0.0.1:${port}/api/haulage/receipts/${receiptId}/image`, {
      headers: { Cookie: `haulage_sid=${sid}` },
    });
    expect(imageRes.status).toBe(200);
    const imageBody = await imageRes.json();
    expect(imageBody.dataUrl).toMatch(/^data:image\/png;base64,/);
  }, 30000);
});
