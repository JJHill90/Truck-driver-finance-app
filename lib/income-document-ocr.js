const { parseMoney, uniqueAmounts } = require("./receipt-ocr-money");
const { extractMoneyFromText, dataUrlToBuffer } = require("./local-receipt-ocr");

function isIncomeDocumentText(text) {
  const src = String(text || "").toLowerCase();
  return /payslip|pay\s*slip|payment\s*advice|remittance|pay\s*period|gross\s*pay|net\s*pay|taxable|payg|year\s*to\s*date|\bytd\b|employer|salary|wages|contractor\s*payment/.test(
    src
  );
}

function guessDocumentKind(text) {
  const src = String(text || "").toLowerCase();
  if (/remittance|contractor|owner.?driver|abn\s*payment|tax\s*invoice.*services/.test(src)) {
    return "remittance";
  }
  if (/payslip|pay\s*slip|payment\s*advice|salary|wages|payg/.test(src)) return "payslip";
  return isIncomeDocumentText(src) ? "payslip" : null;
}

function labeledAmount(text, patterns) {
  const src = String(text || "");
  // Allow spaces/dots/newlines between the label and the amount (common on payslips).
  const money = "((?:\\d{1,3}(?:,\\d{3})+|\\d{1,7})(?:\\.\\d{1,2})?)";
  for (const pattern of patterns) {
    const re = new RegExp(`${pattern}[^\\d$]{0,60}\\$?\\s*${money}`, "i");
    const m = src.match(re);
    if (m) {
      const amount = parseMoney(m[1]);
      // Ignore OCR'd years mistaken for pay figures.
      if (amount && amount > 0 && !(Number.isInteger(amount) && amount >= 1900 && amount <= 2100)) {
        return amount;
      }
    }
  }
  return null;
}

function guessEntity(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 12)) {
    const employer = line.match(/^(?:employer|paid\s*by|company|from|entity)[:\s]+(.+)$/i);
    if (employer) return employer[1].slice(0, 60).trim();
  }

  for (const line of lines.slice(0, 8)) {
    if (/payslip|pay\s*slip|remittance|payment\s*advice|tax\s*invoice|abn|page\s*\d/i.test(line)) {
      continue;
    }
    if (/^\d+$/.test(line)) continue;
    if (line.length >= 3 && line.length <= 60) return line.slice(0, 60);
  }
  return "";
}

function guessPayPeriod(text) {
  const src = String(text || "");
  const range = src.match(
    /(?:period|pay\s*period|for\s*period)[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s*(?:to|-|–)\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i
  );
  if (range) return `${range[1]} – ${range[2]}`;
  return "";
}

function buildIncomeSummaryFromText(text, purpose = "income") {
  const money = extractMoneyFromText(text);
  const kind = guessDocumentKind(text) || (purpose === "income" ? "payslip" : null);
  const isIncome = purpose === "income" || Boolean(kind);

  const labeledGross = labeledAmount(text, [
    "gross\\s*pay",
    "gross\\s*earnings",
    "gross\\s*wages",
    "gross\\s*amount",
    "total\\s*gross",
    "ordinary\\s*time\\s*earnings",
    "remittance\\s*total",
    "payment\\s*total",
    "invoice\\s*total",
    "gross",
  ]);
  const candidates = uniqueAmounts([
    ...(money.candidateAmounts || []),
    money.amount,
  ]).sort((a, b) => b - a);
  // Prefer an explicit gross label; else largest plausible payslip amount.
  const grossTotal = labeledGross || money.amount || candidates[0] || null;

  const taxableIncome =
    labeledAmount(text, [
      "taxable\\s*income",
      "taxable\\s*earnings",
      "taxable\\s*pay",
      "taxable\\s*wages",
      "assessable\\s*income",
      "taxable",
    ]) || grossTotal;

  const gstAmount =
    labeledAmount(text, ["gst\\s*payable", "gst\\s*amount", "total\\s*gst", "gst"]) ||
    money.gst ||
    null;

  const netPay =
    labeledAmount(text, [
      "net\\s*pay",
      "net\\s*amount",
      "take\\s*home",
      "net\\s*wages",
      "net\\s*earnings",
    ]) || null;

  const entity = guessEntity(text);
  const payPeriod = guessPayPeriod(text);
  const resolvedAmount = netPay || grossTotal || money.amount || null;

  return {
    documentType: isIncome ? "income" : "expense",
    documentKind: kind,
    vendor: entity,
    entity,
    payer: entity,
    vendorAbn: "",
    date: null,
    amount: resolvedAmount,
    grossTotal,
    taxableIncome: taxableIncome || grossTotal,
    gst: gstAmount,
    gstAmount,
    netPay,
    payPeriod,
    description: kind === "remittance" ? "Owner-driver remittance" : kind === "payslip" ? "Payslip" : "",
    suggestedCategory: "other_work",
    suggestedIncomeType: kind === "remittance" ? "remittance_owner" : "salary_wages",
    lineItems: money.lineItems,
    candidateAmounts: uniqueAmounts([
      ...(money.candidateAmounts || []),
      grossTotal,
      taxableIncome,
      gstAmount,
      netPay,
      resolvedAmount,
    ]),
    confidence: grossTotal ? "medium" : "low",
    // Full text helps tabular payslip breakdown (DESCRIPTION / AMOUNT / YTD).
    rawText: String(text || "").slice(0, 12000),
    summaryNotes: [
      entity ? `Entity: ${entity}` : null,
      payPeriod ? `Period: ${payPeriod}` : null,
      grossTotal != null ? `Gross: $${Number(grossTotal).toFixed(2)}` : null,
      taxableIncome != null ? `Taxable: $${Number(taxableIncome).toFixed(2)}` : null,
      gstAmount ? `GST: $${Number(gstAmount).toFixed(2)}` : null,
      netPay != null ? `Net: $${Number(netPay).toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

async function extractIncomeFromPdf(imageBase64) {
  const buffer = dataUrlToBuffer(imageBase64);
  if (!buffer.length) return null;
  try {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    let text = "";
    try {
      const parsed = await parser.getText();
      text = parsed?.text || "";
    } finally {
      await parser.destroy().catch(() => {});
    }

    if (!text.trim()) {
      return {
        documentType: "income",
        documentKind: "payslip",
        amount: null,
        grossTotal: null,
        taxableIncome: null,
        gstAmount: null,
        ocrSource: "pdf",
        confidence: "low",
        notes: "PDF saved but no readable text. Enter totals manually, then approve.",
        suggestedIncomeType: "salary_wages",
      };
    }
    const summary = buildIncomeSummaryFromText(text, "income");
    return {
      ...summary,
      ocrSource: "pdf-text",
      notes: summary.grossTotal || summary.amount
        ? `PDF remittance/payslip scanned. ${summary.summaryNotes}`
        : "PDF saved. Enter totals from the document, then approve.",
      rawText: text.slice(0, 12000),
      rawTextPreview: text.slice(0, 1200),
    };
  } catch (err) {
    console.error("PDF income parse error:", err.message);
    return {
      documentType: "income",
      documentKind: "payslip",
      amount: null,
      ocrSource: "pdf",
      confidence: "low",
      notes: "PDF saved. Enter totals manually, then approve.",
      suggestedIncomeType: "salary_wages",
    };
  }
}

module.exports = {
  isIncomeDocumentText,
  guessDocumentKind,
  buildIncomeSummaryFromText,
  extractIncomeFromPdf,
};
