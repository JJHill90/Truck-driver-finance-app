const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const auth = require("./lib/auth");
const suite = require("./lib/suite");

const strongPass = "RoadSafe!99x";

function tinyJpeg() {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAkABwAHAA8ADwAPABAAEAAQABAAEAAA/9sAQwAEAwMEAwQFBQQFBgYGBQ0KCwsKCwwOCwwMCwwPEA0ODg0PEQ8SExISEhEPFRgXGRcSFB0dGx0dGx0dHf/AABEIAAoACgMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/2gAMAwEAAhEDEQA/ALxQAB//2Q==",
    "base64"
  );
}

describe("receipt viewer file actions", () => {
  it("opens and downloads via a blob so the WebView does not navigate home", () => {
    const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(src).toMatch(/function fetchReceiptBlob/);
    expect(src).toMatch(/function saveBlobAsFile/);
    expect(src).toMatch(/function openReceiptBlob/);
    expect(src).toMatch(/data-open-receipt-file/);
    expect(src).toMatch(/Open PDF/);
    expect(src).toMatch(/#receipt-viewer \.modal-actions/);
    expect(src).toMatch(/__haulageActiveReceiptId/);
    expect(src).toMatch(/__haulageBlobDl/);
    expect(src).toMatch(/#receipt-viewer-download/);
    expect(src).not.toMatch(/target="_blank" rel="noopener">Open PDF<\/a>/);
    expect(src).toMatch(/Always run app\.js first so `activeReceiptId` is set/);
  });

  it("cache-busts enhancements so phones load the blob file actions", () => {
    const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
    const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");
    expect(hub).toMatch(/enhancements\.js\?v=receipt-file-1/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=receipt-file-1/);
  });
});

describe("GET /receipts/:id/file after upload", () => {
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

  it("returns the uploaded photo bytes and a viewable image data URL", async () => {
    const username = `fileopen_${Date.now().toString(36)}`;
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    const token = auth.createSession(username);
    const { port } = server.address();
    const jpeg = tinyJpeg();
    const scanRes = await fetch(`http://127.0.0.1:${port}/api/haulage/receipts/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `haulage_sid=${token}`,
      },
      body: JSON.stringify({
        imageBase64: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
        mimeType: "image/jpeg",
        filename: "servo-coffee.jpg",
        purpose: "expense",
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
    expect(img.dataUrl).toMatch(/^data:image\/jpeg;base64,/);

    const fileRes = await fetch(
      `http://127.0.0.1:${port}/api/haulage/receipts/${scan.receipt.id}/file?download=1`,
      { headers: { Cookie: `haulage_sid=${token}` } }
    );
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("content-type")).toMatch(/image\/jpeg/);
    expect(fileRes.headers.get("content-disposition")).toMatch(/attachment/);
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(20);
    expect(bytes.slice(0, 2).toString("hex")).toBe("ffd8");
  }, 30000);
});
