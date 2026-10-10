const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const auth = require("./lib/auth");
const suite = require("./lib/suite");

const strongPass = "RoadSafe!99x";

function tinyPayslipPdf() {
  const body =
    "BETTS TRANSPORT PAYSLIP\nPay period 03/06/2026 to 09/06/2026\nNet Pay 2431.00\nGross 3043.00\n";
  return Buffer.from(
    `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${body.length + 20}>>stream\nBT /F1 12 Tf 20 160 Td (${body.replace(/\n/g, ") Tj T* (")}) Tj ET\nendstream\nendobj\nxref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\n%%EOF\n`
  );
}

describe("Android post-OCR freeze guards", () => {
  it("skips the next refreshAll after a successful scan", () => {
    const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(src).toMatch(/__haulageSkipNextRefreshAll = true/);
    expect(src).toMatch(/function installQuietRefreshAll/);
    expect(src).toMatch(/function quietUiAfterScanSave/);
    expect(src).toMatch(/function slimClientScanPayload/);
    expect(src).toMatch(/isQuietHeavyForecastGet/);
  });

  it("copies picker PDFs as octet-stream blobs so Chrome Pdfium does not Aw Snap", () => {
    const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(src).toMatch(/function copyPdfToMemory/);
    expect(src).toMatch(/function detachedPdfBlob/);
    expect(src).toMatch(/application\/octet-stream/);
    expect(src).not.toMatch(/new File\(\[buf\], name, \{ type \}\)/);
    expect(src).toMatch(/function patchUploadSkipRefresh/);
    expect(src).toMatch(/Opening it inside the app can freeze Android/);
  });

  it("cache-busts enhancements so the Play WebView loads the skip", () => {
    const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
    const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");
    expect(hub).toMatch(/enhancements\.js\?v=pdf-aw-snap-6/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=pdf-aw-snap-6/);
  });
});

describe("scan HTTP confirm payload", () => {
  let server;
  let tmp;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scan-freeze-"));
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

  it("returns a confirm-sized scan body with no rawText", async () => {
    const username = `pdfscan_${Date.now().toString(36)}`;
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    const token = auth.createSession(username);
    const { port } = server.address();
    const pdf = tinyPayslipPdf();
    const imageBase64 = `data:application/pdf;base64,${pdf.toString("base64")}`;
    const res = await fetch(`http://127.0.0.1:${port}/api/haulage/receipts/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `haulage_sid=${token}`,
      },
      body: JSON.stringify({
        imageBase64,
        mimeType: "application/pdf",
        filename: "Betts-payslip.pdf",
        purpose: "income",
      }),
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.receipt && data.receipt.id).toBeTruthy();
    expect(data.ocrResult).toBeTruthy();
    expect(data.ocrResult.rawText).toBeUndefined();
    expect(data.ocrResult.rawTextPreview).toBeUndefined();
    expect(JSON.stringify(data).length).toBeLessThan(20_000);

    const recordsRes = await fetch(`http://127.0.0.1:${port}/api/haulage/records`, {
      headers: { Cookie: `haulage_sid=${token}` },
    });
    const records = await recordsRes.json();
    const saved = (records.receipts || []).find((r) => r.id === data.receipt.id);
    expect(saved).toBeTruthy();
    expect(saved.ocrResult.rawText).toBeUndefined();
  }, 30000);
});
