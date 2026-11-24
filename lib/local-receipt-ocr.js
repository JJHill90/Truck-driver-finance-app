const { createWorker } = require("tesseract.js");
const { parseMoney, uniqueAmounts } = require("./receipt-ocr-money");
const { tesseractCacheDir } = require("./tesseract-cache");

const { isValidAbn, formatAbn } = require("./vendor-enrichment");

let workerPromise = null;
let workerChain = Promise.resolve();

function withWorkerLock(task) {
  const run = workerChain.then(task, task);
  workerChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        logger: () => {},
        cachePath: tesseractCacheDir(),
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

/** Boot-time warm so the first driver scan does not pay createWorker + model load. */
function warmTesseractWorker() {
  return getWorker();
}

function dataUrlToBuffer(dataUrlOrBase64) {
  const raw = String(dataUrlOrBase64 || "");
  const base64 = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(base64, "base64");
}

/**
 * Unlabeled money must look like currency (cents and/or thousands separators).
 * Bare integers are excluded so dates (24/07/2026) and ABN groups are not treated as totals.
 */
const MONEY_LOOSE = "((?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d{2})?)|(?:\\d{1,7}\\.\\d{2}))";
/** After a TOTAL/GST label, allow whole dollars too (TOTAL 187). */
const MONEY_LABELED = "((?:\\d{1,3}(?:,\\d{3})+|\\d{1,7})(?:\\.\\d{1,2})?)";

function isPlausibleReceiptAmount(amount) {
  const n = Number(amount);
  if (!(n > 0) || n >= 1000000) return false;
  // Years from OCR'd dates must not become the document total.
  if (Number.isInteger(n) && n >= 1900 && n <= 2100) return false;
  return true;
}

/**
 * Pull AUD-style money amounts and a best-guess grand total from OCR text.
 */
function extractMoneyFromText(text) {
  const src = String(text || "");
  const amounts = [];

  const moneyRe = new RegExp(`\\$?\\s*${MONEY_LOOSE}(?!\\d)`, "g");
  let match;
  while ((match = moneyRe.exec(src)) !== null) {
    const amount = parseMoney(match[1]);
    if (isPlausibleReceiptAmount(amount)) amounts.push(amount);
  }

  const labeled = [];
  const labelRe = new RegExp(
    `\\b(GRAND\\s*TOTAL|AMOUNT\\s*DUE|BALANCE\\s*DUE|TOTAL\\s*DUE|EFT|VISA|MASTERCARD|MAESTRO|PAY\\s*TOTAL|GROSS\\s*PAY|GROSS\\s*WAGES|GROSS\\s*EARNINGS|NET\\s*PAY|TAXABLE\\s*INCOME|TOTAL(?!\\s*INCLUDES)|SUBTOTAL|GST|TAX)\\b[^\\d$]{0,40}\\$?\\s*${MONEY_LABELED}`,
    "gi"
  );
  while ((match = labelRe.exec(src)) !== null) {
    const label = match[1].replace(/\s+/g, " ").toUpperCase();
    const amount = parseMoney(match[2]);
    if (!isPlausibleReceiptAmount(amount)) continue;
    labeled.push({ label, amount });
    amounts.push(amount);
  }

  const candidates = uniqueAmounts(amounts)
    .filter(isPlausibleReceiptAmount)
    .sort((a, b) => b - a);

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

/** Build an expense OCR result from plain document text (image OCR or PDF text layer). */
function buildExpenseSummaryFromText(text) {
  const parsed = extractMoneyFromText(text);
  const extras = guessPrintedExtras(text);
  return {
    documentType: "expense",
    vendor: guessVendor(text),
    vendorAbn: guessAbn(text),
    date: guessDate(text),
    ...extras,
    amount: parsed.amount,
    gst: parsed.gst,
    description: "",
    suggestedCategory: guessCategory(text),
    suggestedIncomeType: null,
    lineItems: parsed.lineItems,
    candidateAmounts: parsed.candidateAmounts,
    confidence: parsed.amount ? "medium" : "low",
    notes: parsed.amount
      ? `Found ${parsed.candidateAmounts.length} dollar amount(s). Confirm the total below.`
      : "No dollar total detected automatically — enter the total from the document.",
    rawText: String(text || "").slice(0, 12000),
    rawTextPreview: String(text || "").slice(0, 1200),
  };
}

async function extractTotalsWithTesseract(imageBase64, mimeType = "image/jpeg", options = {}) {
  const purpose = options.purpose === "income" ? "income" : "expense";
  const buffer = dataUrlToBuffer(imageBase64);
  if (!buffer.length || buffer.length < 200) {
    return null;
  }

  if (options.signal && options.signal.aborted) {
    const err = new Error("Scan cancelled");
    err.name = "AbortError";
    throw err;
  }
  if (buffer.length > 8_000_000) return null;
  const text = await withWorkerLock(async () => {
    if (options.signal && options.signal.aborted) {
      const err = new Error("Scan cancelled");
      err.name = "AbortError";
      throw err;
    }
    const worker = await getWorker();
    const recognized = await worker.recognize(buffer);
    return recognized.data.text || "";
  });

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
      ...buildExpenseSummaryFromText(text),
      ocrSource: "tesseract",
      confidence: "low",
      notes: "Local scan found no dollar amounts. Enter the total from the image.",
    };
  }

  return {
    ...buildExpenseSummaryFromText(text),
    ocrSource: "tesseract",
    notes: parsed.amount
      ? `Local PNG/JPG scan found ${parsed.candidateAmounts.length} dollar amount(s). Confirm the total below.`
      : "Local scan found amounts — pick the correct total below.",
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
  const src = String(text || "")
    .replace(/A\s*\.\s*B\s*\.\s*N\s*\.?/gi, "ABN ")
    .replace(/Australian\s+Business\s+Number/gi, "ABN ");
  const candidates = [];
  const labeled = src.match(/\bABN[:\s#.\-]*((?:\d[\s.]*){10}\d)/i);
  if (labeled) candidates.push(labeled[1]);
  const spaced = src.match(/\b(\d{2}[\s.]+\d{3}[\s.]+\d{3}[\s.]+\d{3})\b/);
  if (spaced) candidates.push(spaced[1]);
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (/\bABN\b/i.test(lines[i]) && lines[i + 1]) candidates.push(lines[i + 1]);
  }
  const compact = src.match(/\b(\d{11})\b/);
  if (compact) candidates.push(compact[1]);
  for (const raw of candidates) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (digits.length === 11 && isValidAbn(digits)) return formatAbn(digits);
  }
  return "";
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

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isoIfReal(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function guessDate(text) {
  const src = String(text || "");
  const named = src.match(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/i
  );
  if (named) {
    const iso = isoIfReal(named[3], MONTHS[named[2].toLowerCase()], named[1]);
    if (iso) return iso;
  }
  const iso = src.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const checked = isoIfReal(iso[1], iso[2], iso[3]);
    if (checked) return checked;
  }
  const m = src.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return isoIfReal(year, m[2], m[1]);
}

function guessPrintedExtras(text) {
  const src = String(text || "");
  const litres = src.match(/\b(\d+(?:\.\d+)?)\s*l(?:itres)?\b/i);
  const fuel = src.match(/\b(diesel|unleaded|ulp|e10|petrol|adblue|premium)\b/i);
  const pay = src.match(/\b(visa|mastercard|eftpos|cash|amex|debit)\b/i);
  const receiptNo = src.match(/\b(?:receipt|docket|inv(?:oice)?)\s*(?:no|number|#)?[:\s#-]*([A-Z0-9-]{4,})/i);
  return {
    dieselLitres: litres ? Number(litres[1]) : null,
    fuelType: fuel ? fuel[1].toLowerCase() : "",
    paymentMethod: pay ? pay[1].toLowerCase() : "",
    receiptNumber: receiptNo ? receiptNo[1] : "",
  };
}

module.exports = {
  extractTotalsWithTesseract,
  extractMoneyFromText,
  buildExpenseSummaryFromText,
  isPlausibleReceiptAmount,
  dataUrlToBuffer,
  warmTesseractWorker,
  guessAbn,
  guessDate,
  guessPrintedExtras,
  withWorkerLock,
};
