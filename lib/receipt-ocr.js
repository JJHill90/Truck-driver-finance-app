const { EXPENSE_CATEGORIES, INCOME_TYPES } = require("./ato-standards");
const { parseMoney, uniqueAmounts } = require("./receipt-ocr-money");
const {
  extractTotalsWithTesseract,
  buildExpenseSummaryFromText,
} = require("./local-receipt-ocr");
const {
  extractIncomeFromPdf,
} = require("./income-document-ocr");
const { extractPdfText } = require("./pdf-text");
const { isValidAbn, normaliseAbn, formatAbn } = require("./vendor-enrichment");

const CATEGORY_IDS = Object.keys(EXPENSE_CATEGORIES);
const INCOME_TYPE_IDS = Object.keys(INCOME_TYPES);

function normalizeOcrResult(raw) {
  if (!raw || typeof raw !== "object") return raw;

  const lineItems = (raw.lineItems || [])
    .map((item) => ({
      ...item,
      amount: parseMoney(item.amount),
    }))
    .filter((item) => item.amount);

  let amount = parseMoney(raw.amount);
  const gst = parseMoney(raw.gst) || parseMoney(raw.gstAmount);
  const grossTotal = parseMoney(raw.grossTotal);
  const taxableIncome = parseMoney(raw.taxableIncome);
  const gstAmount = parseMoney(raw.gstAmount) || gst;
  const netPay = parseMoney(raw.netPay);
  const candidateAmounts = uniqueAmounts([
    ...(Array.isArray(raw.candidateAmounts) ? raw.candidateAmounts : []),
    amount,
    gst,
    grossTotal,
    taxableIncome,
    gstAmount,
    netPay,
    ...lineItems.map((item) => item.amount),
  ])
    .filter((n) => {
      // Drop calendar years that leak in from OCR'd dates.
      if (Number.isInteger(n) && n >= 1900 && n <= 2100) return false;
      return n > 0 && n < 1000000;
    })
    .sort((a, b) => b - a);

  if (!amount && candidateAmounts.length) {
    amount = netPay || grossTotal || candidateAmounts[0];
  } else if (!amount && lineItems.length) {
    amount = Math.max(...lineItems.map((i) => i.amount));
  }

  const isIncome = raw.documentType === "income";
  // Keep missing GST as null for income payslips so the UI does not read out $0.00.
  const resolvedGstAmount = gstAmount || (isIncome ? null : 0);

  return {
    ...raw,
    amount,
    gst: gst || null,
    grossTotal: grossTotal || amount || null,
    taxableIncome: taxableIncome || grossTotal || amount || null,
    gstAmount: resolvedGstAmount,
    netPay: netPay || null,
    entity: raw.entity || raw.vendor || raw.payer || "",
    documentKind: raw.documentKind || null,
    payPeriod: raw.payPeriod || "",
    summaryNotes: raw.summaryNotes || "",
    lineItems,
    candidateAmounts,
    rawText: raw.rawText || raw.rawTextPreview || "",
  };
}

function getDetectedTotals(ocrResult) {
  const ocr = normalizeOcrResult(ocrResult);
  if (!ocr) return [];

  const totals = [];
  const used = new Set();
  const isIncome = ocr.documentType === "income";

  const push = (label, amount, primary = false) => {
    const value = parseMoney(amount);
    if (!value) return;
    const key = `${label}:${value.toFixed(2)}`;
    if (used.has(key) && !primary) return;
    used.add(key);
    totals.push({ label, amount: value, primary: Boolean(primary) });
  };

  if (isIncome) {
    push("Gross total", ocr.grossTotal || ocr.amount, true);
    push("Taxable income", ocr.taxableIncome);
    push("GST", ocr.gstAmount || ocr.gst);
    push("Net pay", ocr.netPay);
  } else {
    push("Grand total", ocr.amount, true);
    push("GST", ocr.gst);
  }

  for (const item of ocr.lineItems || []) {
    push(item.description || "Line item", item.amount);
  }

  for (const amount of ocr.candidateAmounts || []) {
    push(`Detected $${amount.toFixed(2)}`, amount);
  }

  if (totals.length && !totals.some((t) => t.primary)) {
    totals[0].primary = true;
  }

  return totals;
}

function isOverallTotalLabel(label) {
  return /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|amount\s*payable|card\s*payment|total)\b/i.test(
    String(label || "")
  );
}

/**
 * Merge OCR totals with component breakdown for the scan-confirm UI.
 * Expenses: only one primary — overall/grand total label when present, else largest amount.
 * Income: keep multi-field primaries (gross first).
 */
function mergeDetectedTotals(ocrResult, components = [], purpose = "expense") {
  const out = [];
  const seen = new Set();
  const add = (label, amount, primary) => {
    const v = Number(amount);
    if (!(v > 0)) return;
    const key = v.toFixed(2);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, amount: v, primary: Boolean(primary) });
  };
  for (const c of components) {
    if (c.detected !== false) add(c.label, c.amount, false);
  }
  const hasBreakdown = components.length > 0;
  for (const t of getDetectedTotals(ocrResult)) {
    if (hasBreakdown && /^Detected \$/.test(t.label)) continue;
    add(t.label, t.amount, t.primary);
  }

  if (purpose === "income") {
    // Prefer an explicit gross/wages total as the primary readout (not PAYG/net/GST).
    const isGrossLabel = (label) =>
      /\b(gross|wages\s*\/\s*gross|ordinary\s*time|remittance\s*total|payment\s*total)\b/i.test(
        String(label || "")
      );
    const grossHits = out.filter((t) => isGrossLabel(t.label));
    const best =
      (grossHits.length
        ? grossHits.reduce((a, b) => (a.amount >= b.amount ? a : b))
        : null) ||
      out.find((t) => t.primary) ||
      (out.length ? out.reduce((a, b) => (a.amount >= b.amount ? a : b)) : null);
    for (const t of out) t.primary = false;
    if (best) {
      best.primary = true;
      out.sort((a, b) => Number(b.primary) - Number(a.primary) || b.amount - a.amount);
    }
    return out;
  }

  // Expense: only the overall total matters for approval — pick grand/total
  // label when present, otherwise the largest detected amount.
  if (!out.length) return out;
  const overall = out.filter((t) => isOverallTotalLabel(t.label));
  const best = (overall.length ? overall : out).reduce((a, b) =>
    a.amount >= b.amount ? a : b
  );
  for (const t of out) t.primary = false;
  best.primary = true;
  if (!isOverallTotalLabel(best.label)) best.label = "Total";
  // Put the approved total first; keep other amounts for reference only.
  out.sort((a, b) => Number(b.primary) - Number(a.primary) || b.amount - a.amount);
  return out;
}

function buildOcrPrompt(purpose = "expense") {
  if (purpose === "income") {
    return `You extract structured data from Australian payslips and remittance advices for truck drivers.
Return ONLY valid JSON with this shape:
{
  "documentType": "income",
  "documentKind": "payslip" | "remittance" | "other",
  "vendor": "employer or payer company name",
  "entity": "same as vendor / company",
  "vendorAbn": "11-digit ABN string or empty if not visible",
  "date": "YYYY-MM-DD or null",
  "payPeriod": "string pay period if shown",
  "amount": number or null,
  "grossTotal": number or null,
  "taxableIncome": number or null,
  "gst": number or null,
  "gstAmount": number or null,
  "netPay": number or null,
  "description": "string",
  "suggestedCategory": "other_work",
  "suggestedIncomeType": "one of: ${INCOME_TYPE_IDS.join(", ")}",
  "lineItems": [{"description":"", "amount": number}],
  "candidateAmounts": [number],
  "confidence": "high" | "medium" | "low",
  "summaryNotes": "one short sentence: entity + key totals",
  "notes": "any ATO-relevant notes"
}
CRITICAL:
- Prefer payslip/remittance fields: grossTotal, taxableIncome, gstAmount, netPay.
- Set amount to netPay when shown, otherwise grossTotal / remittance total.
- Put all distinct dollar amounts into candidateAmounts.
- suggestedIncomeType: salary_wages for payslips, remittance_owner for owner-driver remittances.`;
  }

  return `You extract structured data from Australian truck driver receipts and remittance slips.
Return ONLY valid JSON with this shape:
{
  "documentType": "expense" | "income" | "unknown",
  "documentKind": "payslip" | "remittance" | null,
  "vendor": "string",
  "entity": "employer/payer when income document",
  "vendorAbn": "11-digit ABN string or empty if not visible",
  "date": "YYYY-MM-DD or null",
  "amount": number or null,
  "grossTotal": number or null,
  "taxableIncome": number or null,
  "gst": number or null,
  "gstAmount": number or null,
  "netPay": number or null,
  "payPeriod": "string",
  "description": "string",
  "suggestedCategory": "one of: ${CATEGORY_IDS.join(", ")}",
  "suggestedIncomeType": "one of: ${INCOME_TYPE_IDS.join(", ")} or null",
  "lineItems": [{"description":"", "amount": number}],
  "candidateAmounts": [number],
  "confidence": "high" | "medium" | "low",
  "summaryNotes": "short entity + totals line for income docs",
  "notes": "any ATO-relevant notes for a line haulage driver"
}
CRITICAL — dollar totals:
- Scan the whole receipt for every AUD money amount (with or without $).
- Put ALL distinct dollar amounts into candidateAmounts (e.g. [12.50, 3.86, 40.55]).
- Set amount to the final GRAND TOTAL / TOTAL / AMOUNT DUE / BALANCE (usually the largest payable total near the bottom).
- Set gst when GST is shown separately.
- Extract vendorAbn when an ABN is printed (11 digits, including spaces or dots). If not visible, use "".
- Never invent a vendor, date, amount or ABN. Use null or "" when it is not printed.
- Include dieselLitres, fuelType, paymentMethod and receiptNumber when printed.
- fieldConfidence is an object of vendor, date, amount, abn, gst each "high", "medium" or "low".
- amount, gst, lineItems[].amount, and candidateAmounts must be plain numbers (e.g. 40.55), not strings.
Prefer truck-driver categories: fuel, meals_*, accommodation, repairs_maintenance, parking_tolls, clothing_protective, training_education.
For remittance/pay documents use income types like salary_wages, remittance_owner, allowance_taxable and fill grossTotal, taxableIncome, gstAmount.`;
}

function resolveImageDataUrl(imageBase64, mimeType = "image/jpeg") {
  if (imageBase64.startsWith("data:")) return imageBase64;
  return `data:${mimeType};base64,${imageBase64}`;
}

function mimeFromDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,/);
  return match ? match[1] : null;
}

function mergeOcrResults(primary, local) {
  if (!local) return normalizeOcrResult(primary);
  if (!primary) return normalizeOcrResult(local);

  const merged = {
    ...primary,
    vendor: primary.vendor || (local.lowConfidence ? "" : local.vendor) || "",
    entity: primary.entity || local.entity || primary.vendor || local.vendor || "",
    vendorAbn:
      (isValidAbn(primary.vendorAbn) ? primary.vendorAbn : "") ||
      (isValidAbn(local.vendorAbn) ? local.vendorAbn : "") ||
      "",
    date: primary.date || local.date || null,
    amount: parseMoney(primary.amount) || parseMoney(local.amount),
    gst: parseMoney(primary.gst) || parseMoney(local.gst),
    grossTotal: parseMoney(primary.grossTotal) || parseMoney(local.grossTotal),
    taxableIncome: parseMoney(primary.taxableIncome) || parseMoney(local.taxableIncome),
    gstAmount: parseMoney(primary.gstAmount) || parseMoney(local.gstAmount),
    netPay: parseMoney(primary.netPay) || parseMoney(local.netPay),
    payPeriod: primary.payPeriod || local.payPeriod || "",
    documentKind: primary.documentKind || local.documentKind || null,
    documentType: primary.documentType || local.documentType,
    summaryNotes: primary.summaryNotes || local.summaryNotes || "",
    description: primary.description || local.description || "",
    suggestedCategory:
      (primary.suggestedCategory && primary.suggestedCategory !== "other_work"
        ? primary.suggestedCategory
        : null) ||
      local.suggestedCategory ||
      primary.suggestedCategory ||
      "other_work",
    suggestedIncomeType: primary.suggestedIncomeType || local.suggestedIncomeType || null,
    lineItems: [...(primary.lineItems || []), ...(local.lineItems || [])],
    candidateAmounts: uniqueAmounts([
      ...(primary.candidateAmounts || []),
      ...(local.candidateAmounts || []),
      primary.amount,
      local.amount,
      primary.grossTotal,
      local.grossTotal,
    ]),
    confidence: primary.amount ? primary.confidence : local.confidence || primary.confidence,
    ocrSource:
      primary.ocrSource === "openai" && local.ocrSource === "tesseract"
        ? "openai+tesseract"
        : local.ocrSource || primary.ocrSource,
    notes: primary.amount
      ? primary.notes
      : local.notes || primary.notes,
    ocrError: primary.amount ? primary.ocrError : primary.ocrError || local.ocrError,
  };

  return normalizeOcrResult(merged);
}

async function runLocalTotals(imageBase64, mimeType, purpose = "expense", signal) {
  try {
    return await extractTotalsWithTesseract(imageBase64, mimeType, { purpose, signal });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    console.error("Local receipt OCR error:", err.message);
    return { ocrSource: "tesseract", ocrError: err.message || "Tesseract failed", amount: null, rawText: "" };
  }
}

const UNREADABLE = "Couldn't read this receipt, try again or enter manually";

function localIsUseful(local) {
  if (!local) return false;
  if (local.ocrError && !String(local.rawText || "").trim()) return false;
  return Boolean(
    local.amount ||
      (local.candidateAmounts && local.candidateAmounts.length) ||
      local.vendor ||
      local.date ||
      local.vendorAbn ||
      (local.rawText && String(local.rawText).replace(/\s/g, "").length > 8)
  );
}

function unreadableResult(purpose, detail) {
  return normalizeOcrResult({
    documentType: purpose === "income" ? "income" : "expense",
    vendor: "",
    date: null,
    amount: null,
    gst: null,
    description: "",
    suggestedCategory: "other_work",
    suggestedIncomeType: null,
    documentKind: null,
    lineItems: [],
    candidateAmounts: [],
    confidence: "low",
    fieldConfidence: { vendor: "low", date: "low", amount: "low", abn: "low", gst: "low" },
    ocrSource: "unreadable",
    notes: UNREADABLE,
    ocrError: detail || UNREADABLE,
  });
}

function inferDocumentKind(result, purpose) {
  const text = `${result.rawText || ""} ${result.description || ""} ${result.notes || ""}`;
  if (/credit\s*note/i.test(text) || Number(result.amount) < 0) return "credit_note";
  if (/tax\s*invoice/i.test(text)) return "tax_invoice";
  if (purpose === "income") {
    if (/remittance/i.test(text)) return "remittance";
    if (/payslip|pay\s*advice/i.test(text)) return "payslip";
    return result.documentKind || null;
  }
  return result.documentKind && result.documentKind !== "payslip" ? result.documentKind : "receipt";
}

function withFieldConfidence(result) {
  if (!result) return result;
  const level = (value, high) => {
    if (value == null || value === "") return "low";
    return high ? "high" : "medium";
  };
  const abnOk = isValidAbn(result.vendorAbn || "");
  result.fieldConfidence = {
    vendor: level(result.vendor, result.ocrSource === "openai" || result.ocrSource === "openai+tesseract"),
    date: level(result.date, true),
    amount: level(result.amount, result.confidence === "high"),
    abn: abnOk ? "high" : result.vendorAbn ? "low" : "low",
    gst: result.gstFree ? "high" : level(result.gstAmount ?? result.gst, true),
  };
  if (result.vendorAbn && !abnOk) result.vendorAbn = "";
  else if (abnOk) result.vendorAbn = formatAbn(normaliseAbn(result.vendorAbn));
  result.documentKind = inferDocumentKind(result, result.documentType === "income" ? "income" : "expense");
  const text = `${result.rawText || ""} ${result.description || ""}`;
  const blob = `${result.rawText || ""} ${result.description || ""}`;
  const customerInvoice =
    /\b(bill\s*to|sold\s*to|due\s+date)\b/i.test(blob) ||
    (/\binvoice\s*(?:no|number|#)/i.test(blob) && /\bfrom\s*:/i.test(blob));
  if (result.documentType !== "income" && result.documentKind === "tax_invoice" && customerInvoice) {
    result.offerAsIncome = true;
    result.notes = `${result.notes || ""} This looks like an invoice. Save it as income instead of an expense.`.trim();
  } else if (result.documentType !== "income") {
    result.offerAsIncome = false;
  }
  if (/credit\s*note/i.test(text)) result.documentKind = "credit_note";
  return result;
}

function forceIncomeResult(result, purpose) {
  if (purpose !== "income" || !result) return withFieldConfidence(normalizeOcrResult(result));
  const kind = inferDocumentKind(result, "income");
  const normalized = normalizeOcrResult({
    ...result,
    documentType: "income",
    documentKind: kind,
    entity: result.entity || result.vendor || "",
    suggestedIncomeType:
      result.suggestedIncomeType ||
      (result.documentKind === "remittance" ? "remittance_owner" : "salary_wages"),
  });
  if (!normalized.summaryNotes) {
    normalized.summaryNotes = [
      normalized.entity ? `Entity: ${normalized.entity}` : null,
      normalized.grossTotal != null ? `Gross: $${Number(normalized.grossTotal).toFixed(2)}` : null,
      normalized.taxableIncome != null
        ? `Taxable: $${Number(normalized.taxableIncome).toFixed(2)}`
        : null,
      normalized.gstAmount ? `GST: $${Number(normalized.gstAmount).toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return withFieldConfidence(normalized);
}

async function extractReceiptData(
  openai,
  imageBase64,
  mimeType = "image/jpeg",
  filename = "",
  options = {}
) {
  const purpose = options.purpose === "income" ? "income" : "expense";
  const isPdf =
    mimeType === "application/pdf" || /\.pdf$/i.test(filename || "");

  if (isPdf) {
    if (purpose === "income") {
      const pdfResult = await extractIncomeFromPdf(imageBase64, options);
      return forceIncomeResult(pdfResult, purpose);
    }
    // Expense / tax-invoice PDFs: pull totals from the text layer when present.
    try {
      const text = await extractPdfText(imageBase64);
      if (text && text.trim()) {
        const summary = buildExpenseSummaryFromText(text);
        return withFieldConfidence(normalizeOcrResult({
          ...summary,
          rawText: text.slice(0, 12000),
          ocrSource: "pdf-text",
          notes: summary.amount
            ? `PDF invoice/receipt scanned. ${summary.notes}`
            : "PDF saved but no dollar total found in text. Enter the total, then confirm.",
        }));
      }
    } catch (err) {
      console.warn("Expense PDF text extract failed:", err.message);
    }
    return normalizeOcrResult({
      documentType: "expense",
      vendor: "",
      date: null,
      amount: null,
      description: "",
      suggestedCategory: "other_work",
      confidence: "low",
      ocrSource: "pdf",
      notes: "PDF saved but no readable text. Enter the dollar total from the document, then confirm.",
    });
  }

  // Always run local OCR for PNG/JPG so dollar totals still appear if cloud OCR fails.
  const localPromise = runLocalTotals(
    options.tesseractImage || imageBase64,
    options.tesseractMime || mimeType,
    purpose,
    options.signal
  );

  async function settleLocal() {
    let local = await localPromise;
    if (!localIsUseful(local) && options.tesseractImage && imageBase64 !== options.tesseractImage) {
      try {
        const again = await runLocalTotals(imageBase64, mimeType, purpose, options.signal);
        if (localIsUseful(again) || (again && again.ocrError && !(local && local.ocrError))) local = again;
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
      }
    }
    return local;
  }

  if (!openai) {
    const local = await settleLocal();
    if (localIsUseful(local)) return forceIncomeResult(local, purpose);
    return unreadableResult(purpose, (local && local.ocrError) || "No totals detected");
  }

  const dataUrl = resolveImageDataUrl(imageBase64, mimeType);

  let cloudResult = null;
  let cloudError = null;
  let cloudTimer = null;

  try {
    const cloudAbort = new AbortController();
    cloudTimer = setTimeout(() => cloudAbort.abort(), 35000);
    if (options.signal) {
      if (options.signal.aborted) cloudAbort.abort();
      else options.signal.addEventListener("abort", () => cloudAbort.abort(), { once: true });
    }
    const response = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildOcrPrompt(purpose) },
              {
                type: "image_url",
                image_url: { url: dataUrl, detail: "high" },
              },
            ],
          },
        ],
        max_tokens: 900,
        temperature: 0.1,
      },
      { signal: cloudAbort.signal }
    );
    const text = response.choices[0]?.message?.content?.trim() || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse receipt data from OCR response.");
    }
    cloudResult = normalizeOcrResult({ ...JSON.parse(jsonMatch[0]), ocrSource: "openai" });
    clearTimeout(cloudTimer);
  } catch (err) {
    clearTimeout(cloudTimer);
    if (options.signal && options.signal.aborted) throw err;
    cloudError =
      err.status === 429 || /quota/i.test(String(err.message || ""))
        ? "OpenAI quota exceeded"
        : /timeout|aborted|abort/i.test(String(err.message || err.name || ""))
          ? "OCR timed out"
          : err.message || "OCR service unavailable";
    console.warn("Cloud receipt OCR failed:", cloudError);
  }

  const local = await settleLocal();

  if (cloudResult) {
    const merged = mergeOcrResults(cloudResult, local);
    if (!merged.amount && local?.amount) {
      merged.amount = local.amount;
      merged.candidateAmounts = uniqueAmounts([
        ...(merged.candidateAmounts || []),
        ...(local.candidateAmounts || []),
      ]);
      merged.notes = local.notes;
      merged.ocrSource = "openai+tesseract";
    }
    return forceIncomeResult(merged, purpose);
  }

  if (localIsUseful(local)) {
    return forceIncomeResult(
      {
        ...local,
        ocrError: cloudError || undefined,
        notes: cloudError
          ? `Cloud scan unavailable (${cloudError}). ${local.notes || "Confirm the local total below."}`
          : local.notes,
      },
      purpose
    );
  }

  return unreadableResult(purpose, (local && local.ocrError) || cloudError || "No totals detected");
}

function mockOcrResult() {
  return {
    documentType: "expense",
    vendor: "Sample Roadhouse",
    date: new Date().toISOString().slice(0, 10),
    amount: 42.5,
    gst: 3.86,
    description: "Driver meal – dinner",
    suggestedCategory: "meals_dinner",
    suggestedIncomeType: null,
    lineItems: [{ description: "Meal", amount: 42.5 }],
    candidateAmounts: [42.5, 3.86],
    confidence: "low",
    notes: "Demo OCR — configure OPENAI_API_KEY for live receipt scanning.",
  };
}

module.exports = {
  extractReceiptData,
  mockOcrResult,
  getDetectedTotals,
  mergeDetectedTotals,
  isOverallTotalLabel,
  parseMoney,
  normalizeOcrResult,
};
