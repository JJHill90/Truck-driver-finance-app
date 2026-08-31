const {
  peekScanJsonMeta,
  extractScanJsonFields,
  shouldUseMultipartScan,
} = require("./lib/scan-body-client");
const { normalizeScanUpload, fileToDataUrl } = require("./lib/scan-upload");

describe("peekScanJsonMeta", () => {
  it("reads income purpose from the JSON tail without parsing", () => {
    const body = JSON.stringify({
      imageBase64: `data:application/pdf;base64,${"A".repeat(5000)}`,
      mimeType: "application/pdf",
      filename: "Remittance-26.08 $3081.90.pdf",
      purpose: "income",
    });
    expect(peekScanJsonMeta(body)).toEqual({ purpose: "income", forceDuplicate: false });
  });

  it("detects forceDuplicate", () => {
    const body = JSON.stringify({
      imageBase64: "data:image/jpeg;base64,xx",
      mimeType: "image/jpeg",
      filename: "a.jpg",
      purpose: "expense",
      forceDuplicate: true,
    });
    expect(peekScanJsonMeta(body).forceDuplicate).toBe(true);
  });
});

describe("extractScanJsonFields", () => {
  it("extracts data URL and meta from app.js field order", () => {
    const dataUrl = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 remittance").toString("base64")}`;
    const body = JSON.stringify({
      imageBase64: dataUrl,
      mimeType: "application/pdf",
      filename: "Remittance-26.08 $3081.90.pdf",
      purpose: "income",
    });
    const fields = extractScanJsonFields(body);
    expect(fields).toMatchObject({
      dataUrl,
      mimeType: "application/pdf",
      filename: "Remittance-26.08 $3081.90.pdf",
      purpose: "income",
      forceDuplicate: false,
    });
  });

  it("flags large bodies for multipart", () => {
    expect(shouldUseMultipartScan("x".repeat(400_000))).toBe(true);
    expect(shouldUseMultipartScan("small")).toBe(false);
  });
});

describe("normalizeScanUpload", () => {
  it("uses JSON imageBase64 when present", () => {
    const out = normalizeScanUpload({
      body: {
        imageBase64: "data:image/jpeg;base64,abc",
        mimeType: "image/jpeg",
        filename: "r.jpg",
        purpose: "expense",
      },
    });
    expect(out.imageBase64).toBe("data:image/jpeg;base64,abc");
    expect(out.purpose).toBe("expense");
  });

  it("builds a data URL from a multer file buffer", () => {
    const buf = Buffer.from("hello");
    const out = normalizeScanUpload({
      body: { purpose: "income", filename: "pay.pdf" },
      file: { buffer: buf, mimetype: "application/pdf", originalname: "pay.pdf" },
    });
    expect(out.imageBase64).toBe(fileToDataUrl({ buffer: buf, mimetype: "application/pdf" }));
    expect(out.purpose).toBe("income");
    expect(out.mimeType).toBe("application/pdf");
    expect(out.forceDuplicate).toBe(false);
  });

  it("parses forceDuplicate from multipart string fields", () => {
    const out = normalizeScanUpload({
      body: {
        imageBase64: "data:image/jpeg;base64,x",
        forceDuplicate: "true",
      },
    });
    expect(out.forceDuplicate).toBe(true);
  });
});
