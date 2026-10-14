/**
 * Slim OCR payloads for browser / Android WebView responses.
 * Full text stays on the stored receipt for server-side re-reads.
 */

const RAW_TEXT_CLIENT_MAX = 1200;
const LINE_ITEM_CLIENT_MAX = 40;
const CANDIDATE_CLIENT_MAX = 24;

function slimOcrResultForClient(ocr) {
  if (!ocr || typeof ocr !== "object") return ocr || null;
  const raw = String(ocr.rawText || "");
  const preview = String(ocr.rawTextPreview || raw).slice(0, RAW_TEXT_CLIENT_MAX);
  const out = {
    ...ocr,
    rawText: raw ? raw.slice(0, RAW_TEXT_CLIENT_MAX) : preview,
    rawTextPreview: preview,
  };
  if (Array.isArray(out.lineItems) && out.lineItems.length > LINE_ITEM_CLIENT_MAX) {
    out.lineItems = out.lineItems.slice(0, LINE_ITEM_CLIENT_MAX);
  }
  if (Array.isArray(out.candidateAmounts) && out.candidateAmounts.length > CANDIDATE_CLIENT_MAX) {
    out.candidateAmounts = out.candidateAmounts.slice(0, CANDIDATE_CLIENT_MAX);
  }
  return out;
}

function presentScanJson(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...payload };
  if (out.ocrResult) out.ocrResult = slimOcrResultForClient(out.ocrResult);
  return out;
}

function capDetectedTotals(totals) {
  if (!Array.isArray(totals)) return totals || [];
  return totals.slice(0, 16);
}

function slimComplianceForConfirm(compliance) {
  if (!compliance || typeof compliance !== "object") return compliance || null;
  return {
    status: compliance.status || null,
    summary: typeof compliance.summary === "string" ? compliance.summary.slice(0, 240) : "",
  };
}

function slimBreakdownForConfirm(breakdown) {
  if (!Array.isArray(breakdown)) return breakdown || [];
  return breakdown.slice(0, 16).map((row) => {
    if (!row || typeof row !== "object") return row;
    return {
      type: row.type || null,
      label: row.label || "",
      amount: row.amount ?? null,
      estimated: Boolean(row.estimated),
    };
  });
}

/**
 * Scan + receipt-poll payloads only need confirm-form fields. Drop raw text
 * so Android does not parse the payslip dump after "OCR finished".
 */
function presentScanConfirmJson(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    receipt: payload.receipt || undefined,
    ocrResult: slimOcrResultForList(payload.ocrResult),
    detectedTotals: capDetectedTotals(payload.detectedTotals),
    componentBreakdown: slimBreakdownForConfirm(payload.componentBreakdown),
    breakdownKind: payload.breakdownKind || null,
    compliance: slimComplianceForConfirm(payload.compliance),
    payPeriod: payload.payPeriod || null,
    possibleDuplicate: Boolean(payload.possibleDuplicate),
    matches: Array.isArray(payload.matches) ? payload.matches.slice(0, 8) : payload.matches,
    message: payload.message || undefined,
    ocrPending: Boolean(payload.ocrPending),
    error: payload.error,
    code: payload.code,
    entitlements: payload.entitlements,
  };
}

/**
 * /records is fetched after every scan. Keep only gallery / approve fields so
 * Android does not parse every payslip's raw text and breakdown at once.
 */
function slimOcrResultForList(ocr) {
  if (!ocr || typeof ocr !== "object") return ocr || null;
  const notes = typeof ocr.notes === "string" ? ocr.notes.slice(0, 240) : ocr.notes;
  return {
    documentType: ocr.documentType,
    documentKind: ocr.documentKind,
    date: ocr.date || null,
    vendor: ocr.vendor || "",
    entity: ocr.entity || ocr.vendor || "",
    amount: ocr.amount ?? null,
    grossTotal: ocr.grossTotal ?? null,
    taxableIncome: ocr.taxableIncome ?? null,
    gst: ocr.gst ?? null,
    gstAmount: ocr.gstAmount ?? ocr.gst ?? null,
    netPay: ocr.netPay ?? null,
    payPeriod: ocr.payPeriod || "",
    description: ocr.description || "",
    suggestedIncomeType: ocr.suggestedIncomeType || null,
    suggestedCategory: ocr.suggestedCategory || null,
    ocrPending: Boolean(ocr.ocrPending),
    travelAllowance: ocr.travelAllowance || null,
    notes: notes || "",
  };
}

module.exports = {
  RAW_TEXT_CLIENT_MAX,
  slimOcrResultForClient,
  slimOcrResultForList,
  presentScanJson,
  presentScanConfirmJson,
};
