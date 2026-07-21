// First-party helper to extract the FULL text of a PDF (the provided
// income-document-ocr module only exposes a short preview). Used to label every
// row of tabular payslips/remittances.
const { PDFParse } = require("pdf-parse");

function toBuffer(dataUrlOrBase64) {
  const raw = String(dataUrlOrBase64 || "");
  const b64 = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(b64, "base64");
}

async function extractPdfText(dataUrlOrBase64) {
  const buffer = toBuffer(dataUrlOrBase64);
  if (!buffer.length) return "";
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return (parsed && parsed.text) || "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

module.exports = { extractPdfText };
