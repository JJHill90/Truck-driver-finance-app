const { createWorker } = require("tesseract.js");
const { parseMoney, uniqueAmounts } = require("./receipt-ocr-money");

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        logger: () => {},
      });
      await worker.setParameters({
        tessedit_char_whitelist:
          "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz$.,:-/() %",
      });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function dataUrlToBuffer(dataUrlOrBase64) {
  const raw = String(dataUrlOrBase64 || "");
  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(base64, "base64");
}

/** Match AUD-style amounts: 1234, 1,234.56, 1234.5 — keep decimals inside the capture. */
const MONEY_CAPTURE = "((?:\\d{1,3}(?:,\\d{3})+|\\d{1,7})(?:\\.\\d{1,2})?)";

/**
 * Pull AUD-style money amounts and a best-guess grand total from OCR text.
 */
function extractMoneyFromText(text) {
  const src = String(text || "");
  const amounts = [];

  const moneyRe = new RegExp(`\\$?\\s*${MONEY_CAPTURE}\\b`, "g");
  let match;
  while ((match = moneyRe.exec(src)) !== null) {
    const amount = parseMoney(match[1]);
    // Ignore tiny OCR noise and absurdly large values.
    if (amount && amount >= 1 && amount < 1000000) amounts.push(amount);
  }

  const labeled = [];
  const labelRe = new RegExp(
    `\\b(GRAND\\s*TOTAL|AMOUNT\\s*DUE|BALANCE\\s*DUE|TOTAL\\s*DUE|EFT|VISA|MASTERCARD|MAESTRO|PAY\\s*TOTAL|GROSS\\s*PAY|GROSS\\s*WAGES|GROSS\\s*EARNINGS|NET\\s*PAY|TAXABLE\\s*INCOME|TOTAL(?!\\s*INCLUDES)|SUBTOTAL|GST|TAX)\\b[^\\d$]{0,40}\\$?\\s*${MONEY_CAPTURE}`,
    "gi"
  );
  while ((match = labelRe.exec(src)) !== null) {
    const label = match[1].replace(/\s+/g, " ").toUpperCase();
    const amount = parseMoney(match[2]);
    if (!amount) continue;
    labeled.push({ label, amount });
    amounts.push(amount);
  }

  const candidates = uniqueAmounts(amounts).sort((a, b) => b - a);

  let amount = null;
  const preferred = labeled.find((l) =>
    /^(GRAND TOTAL|AMOUNT DUE|BALANCE DUE|TOTAL DUE|PAY TOTAL|GROSS PAY|GROSS WAGES|GROSS EARNINGS|TOTAL|EFT|VISA|MASTERCARD)$/.test(
      l.label.replace(/\s+/g, " ")
    )
  );
  if (preferred) {
    amount = preferred.amount;
  } else {
    const totalLine = labeled.find((l) => l.label.includes("TOTAL") && !l.label.includes("SUB"));
    amount = totalLine?.amount || candidates[0] || null;
  }

  const gst =
    labeled.find((l) => l.label === "GST" || l.label.includes("GST"))?.amount || null;

  const lineItems = labeled
    .filter((l) => !/TOTAL|EFT|VISA|MASTERCARD|GST|SUBTOTAL/.test(l.label))
    .slice(0, 8)
    .map((l) => ({ description: l.label, amount: l.amount }));

  return {
    amount,
    gst,
    candidateAmounts: candidates,
    lineItems,
    rawText: src.slice(0, 12000),
  };
}

async function extractTotalsWithTesseract(imageBase64, mimeType = "image/jpeg", options = {}) {
  const purpose = options.purpose === "income" ? "income" : "expense";
  const buffer = dataUrlToBuffer(imageBase64);
  if (!buffer.length || buffer.length < 200) {
    return null;
  }

  const worker = await getWorker();
  const {
    data: { text },
  } = await worker.recognize(buffer);

  if (purpose === "income") {
    const { buildIncomeSummaryFromText } = require("./income-document-ocr");
    const summary = buildIncomeSummaryFromText(text, "income");
    return {
      ...summary,
      date: summary.date || guessDate(text),
      vendorAbn: summary.vendorAbn || guessAbn(text),
      ocrSource: "tesseract",
      notes: summary.grossTotal || summary.amount
        ? `Local payslip/remittance scan. ${summary.summaryNotes}`
        : "Local scan found limited totals — enter amounts from the image, then approve.",
      rawText: text.slice(0, 12000),
      rawTextPreview: text.slice(0, 1200),
    };
  }

  const parsed = extractMoneyFromText(text);
  const { isIncomeDocumentText, buildIncomeSummaryFromText } = require("./income-document-ocr");
  if (isIncomeDocumentText(text)) {
    const summary = buildIncomeSummaryFromText(text, "income");
    return {
      ...summary,
      date: summary.date || guessDate(text),
      vendorAbn: summary.vendorAbn || guessAbn(text),
      ocrSource: "tesseract",
      notes: summary.grossTotal || summary.amount
        ? `Detected income document. ${summary.summaryNotes}`
        : "Detected income document — confirm totals below.",
      rawText: text.slice(0, 12000),
      rawTextPreview: text.slice(0, 1200),
    };
  }

  if (!parsed.candidateAmounts.length && !parsed.amount) {
    return {
      ...parsed,
      ocrSource: "tesseract",
      confidence: "low",
      notes: "Local scan found no dollar amounts. Enter the total from the image.",
    };
  }

  return {
    documentType: "expense",
    vendor: guessVendor(text),
    vendorAbn: guessAbn(text),
    date: guessDate(text),
    amount: parsed.amount,
    gst: parsed.gst,
    description: "",
    suggestedCategory: guessCategory(text),
    suggestedIncomeType: null,
    lineItems: parsed.lineItems,
    candidateAmounts: parsed.candidateAmounts,
    confidence: parsed.amount ? "medium" : "low",
    ocrSource: "tesseract",
    notes: parsed.amount
      ? `Local PNG/JPG scan found ${parsed.candidateAmounts.length} dollar amount(s). Confirm the total below.`
      : "Local scan found amounts — pick the correct total below.",
    rawTextPreview: parsed.rawText.slice(0, 500),
  };
}

function guessVendor(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 10)) {
    if (/woolworths/i.test(line)) return "Woolworths";
    if (/\bbp\b/i.test(line)) return "BP";
    if (/shell/i.test(line)) return "Shell";
    if (/caltex|ampol/i.test(line)) return /ampol/i.test(line) ? "Ampol" : "Caltex";
    if (/coles/i.test(line)) return "Coles";
    if (/aldi/i.test(line)) return "ALDI";
    if (/7-?eleven/i.test(line)) return "7-Eleven";
    if (/united\s*petroleum/i.test(line)) return "United Petroleum";
    if (/roadhouse|servo|truck\s*stop/i.test(line)) return line.slice(0, 40);
  }
  return lines[0] ? lines[0].slice(0, 40) : "";
}

function guessAbn(text) {
  const src = String(text || "");
  const labeled = src.match(/\bABN[:\s#]*([0-9][0-9\s]{9,16}[0-9])/i);
  const digits = (labeled?.[1] || "").replace(/\D/g, "");
  if (digits.length === 11) return formatAbn(digits);

  const loose = src.match(/\b(\d{2}\s\d{3}\s\d{3}\s\d{3})\b/);
  if (loose) {
    const d = loose[1].replace(/\D/g, "");
    if (d.length === 11) return formatAbn(d);
  }
  return "";
}

function formatAbn(digits) {
  const d = String(digits).replace(/\D/g, "");
  if (d.length !== 11) return d;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}`;
}

function guessCategory(text) {
  const src = String(text || "").toLowerCase();
  if (/diesel|petrol|unleaded|fuel|ulp|e10|truck\s*stop|servo|\bbp\b|shell|caltex|ampol/.test(src)) {
    return "fuel";
  }
  if (/motel|hotel|accommodation|ibis|quest|room\s*rate/.test(src)) return "accommodation";
  if (/toll|e-?tag|parking|car\s*park/.test(src)) return "parking_tolls";
  if (/breakfast|lunch|dinner|meal|cafe|restaurant|mcdonald|hungry\s*jack|kfc/.test(src)) {
    if (/breakfast/.test(src)) return "meals_breakfast";
    if (/lunch/.test(src)) return "meals_lunch";
    return "meals_dinner";
  }
  if (/woolworths|coles|aldi|iga|supermarket/.test(src)) return "other_work";
  return "other_work";
}

function guessDate(text) {
  const m =
    String(text).match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/) ||
    String(text).match(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (!m) return null;
  if (m[1].length === 4) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

module.exports = {
  extractTotalsWithTesseract,
  extractMoneyFromText,
  dataUrlToBuffer,
};
