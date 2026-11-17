/**
 * Tax-invoice parser for income scans (Suite and Hub).
 *
 * A "TAX INVOICE" with a From / To layout is not a payslip. The payer is the
 * bill-to party, the document date is the issue date (not the due date), and
 * GST is the dollar amount on the GST line (not the "10%" rate).
 *
 * Fuel dockets also print "TAX INVOICE" without a bill-to party. Those stay
 * expense receipts — this detector requires a From/To (or invoice-number + To)
 * layout.
 */

const { getFinancialYearForDate } = require("./ato-standards");

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseMoney(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, "");
  if (!s || /%$/.test(String(raw).trim())) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  if (Number.isInteger(n) && n >= 1900 && n <= 2100 && !String(raw).includes(".")) return null;
  return round2(n);
}

/** AU day/month token → ISO. Does not rewrite a plausible year. */
function parseAuDateToken(token) {
  const m = String(token || "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(check.getTime())) return null;
  if (check.getMonth() + 1 !== month || check.getDate() !== day) return null;
  return iso;
}

function cleanParty(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/[,;]+$/, "")
    .trim()
    .slice(0, 80);
}

/**
 * True for a bill (From / To, or an invoice number plus a bill-to party).
 * Thermal fuel dockets that only say "TAX INVOICE" return false.
 */
function isTaxInvoiceText(text) {
  const src = String(text || "");
  if (!/\btax\s*invoice\b/i.test(src)) return false;
  const hasFrom = /\bfrom\s*:/i.test(src);
  const hasTo = /\bto\s*:/i.test(src);
  const hasNumber = /\b(?:inv|invoice|haul)[\s\-:#]*\d{2,}\b/i.test(src);
  if (hasFrom && hasTo) return true;
  if (hasNumber && hasTo) return true;
  return false;
}

function lineItemsFromText(text) {
  const skip =
    /^(tax\s*invoice|from\s*:|to\s*:|abn\b|date\s*:|due\s*:|gst\b|total\b|pay\s*to|bsb\b|acc\b|paid\b|fleetcard|visa|eftpos)/i;
  const items = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (!trimmed || skip.test(trimmed)) continue;
    if (!/[A-Za-z]{3,}/.test(trimmed)) continue;
    if (/^\d/.test(trimmed) && !/[A-Za-z]{4,}/.test(trimmed)) continue;
    items.push(trimmed.slice(0, 120));
  }
  return items.slice(0, 8);
}

/**
 * Dollar amount on a GST line. Ignores a bare "10%" rate.
 * "GST 10%    $220.00" → 220. "GST INCLUDED $80.00" → 80.
 */
function gstAmountFromText(text) {
  const src = String(text || "");
  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    if (!/\bgst\b/i.test(line)) continue;
    if (/\bgst\s*free\b/i.test(line)) continue;
    const withoutRate = line.replace(/\b\d{1,2}(?:\.\d+)?\s*%/g, " ");
    const monies = [];
    const re = /\$?\s*((?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{2})?)/g;
    let m;
    while ((m = re.exec(withoutRate))) {
      const amount = parseMoney(m[1]);
      if (amount != null && amount > 0 && amount !== 10) monies.push(amount);
    }
    if (monies.length) return monies[monies.length - 1];
  }
  return null;
}

function labeledParty(text, label) {
  const re = new RegExp(`\\b${label}\\s*:\\s*(.+)`, "i");
  const m = String(text || "").match(re);
  if (!m) return "";
  return cleanParty(m[1].split(/\b(?:abn|date|due|to|from)\b/i)[0]);
}

function invoiceNumberFromText(text) {
  const m = String(text || "").match(/\b((?:INV|HAUL|INVOICE)[\s\-:#]*\d{2,})\b/i);
  if (!m) return "";
  return m[1].replace(/\s+/g, "").toUpperCase();
}

function totalDueFromText(text) {
  const src = String(text || "");
  const labeled = src.match(
    /\b(?:total\s*due|amount\s*due|invoice\s*total|total)\b[^\d$]{0,40}\$?\s*((?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{2})?)/i
  );
  if (labeled) {
    const amount = parseMoney(labeled[1]);
    if (amount != null && amount > 20) return amount;
  }
  return null;
}

/**
 * Suggested income type for a tax invoice. Never PAYG salary.
 * Suite: business sales for a sole trader or an employee who issues the
 * invoice; partnership invoices use contractor fees.
 * Hub: owner-driver / contract remittance.
 */
function incomeTypeForInvoice(product, entityType) {
  if (product === "suite") {
    const entity = String(entityType || "").toLowerCase();
    if (entity === "partnership") return "services_income";
    return "business_income";
  }
  return "remittance_owner";
}

function assessFy(dateIso, selectedFy) {
  if (!dateIso) return { outside: false, documentFy: null, selectedFy: selectedFy || null };
  let documentFy = null;
  try {
    documentFy = getFinancialYearForDate(dateIso);
  } catch {
    documentFy = null;
  }
  const selected = String(selectedFy || "").trim();
  if (!selected || !documentFy) {
    return { outside: false, documentFy, selectedFy: selected || null };
  }
  return {
    outside: documentFy !== selected,
    documentFy,
    selectedFy: selected,
  };
}

/**
 * Parse a tax invoice. Returns null when the text is not a From/To invoice.
 */
function parseTaxInvoice(text, { product = "haulage", entityType = "", selectedFy = "" } = {}) {
  const src = String(text || "");
  if (!isTaxInvoiceText(src)) return null;

  const issuer = labeledParty(src, "from");
  const billTo = labeledParty(src, "to");
  const issueMatch = src.match(/\bdate\s*:\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i);
  const dueMatch = src.match(/\bdue\s*:\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i);
  const issueDate = issueMatch ? parseAuDateToken(issueMatch[1]) : null;
  const dueDate = dueMatch ? parseAuDateToken(dueMatch[1]) : null;
  const gstAmount = gstAmountFromText(src);
  const total = totalDueFromText(src);
  const exGst =
    total != null && gstAmount != null && total > gstAmount ? round2(total - gstAmount) : null;
  const items = lineItemsFromText(src);
  const invoiceNumber = invoiceNumberFromText(src);
  const payer = billTo || "";
  const description = invoiceDescription({ invoiceNumber, items, payer, issuer });
  const fy = assessFy(issueDate || dueDate, selectedFy);

  return {
    documentType: "income",
    documentKind: "tax_invoice",
    invoiceNumber,
    issuer,
    billTo: payer,
    payer,
    entity: payer,
    vendor: payer,
    date: issueDate,
    issueDate,
    dueDate,
    gstAmount,
    gst: gstAmount,
    grossTotal: total,
    taxableIncome: exGst != null ? exGst : total,
    netPay: total,
    amount: total,
    lineItems: items,
    description,
    suggestedIncomeType: incomeTypeForInvoice(product, entityType),
    suggestedCategory: null,
    dateOutsideSelectedFy: fy.outside,
    documentFinancialYear: fy.documentFy,
    selectedFinancialYear: fy.selectedFy || null,
    fyWarning: fy.outside
      ? `Issue date ${issueDate} is in FY ${fy.documentFy}, outside the selected FY ${fy.selectedFy}.`
      : "",
  };
}

function invoiceDescription({ invoiceNumber, items, payer, issuer }) {
  const item = (items && items[0]) || "";
  const shortItem = item.replace(/\s{2,}/g, " ").replace(/\s+\$[\d,.]+.*$/, "").trim();
  const who = payer || issuer || "";
  const bits = [];
  if (invoiceNumber) bits.push(invoiceNumber.replace(/\s+/g, ""));
  if (shortItem) bits.push(shortItem.slice(0, 80));
  if (who) bits.push(who);
  if (bits.length) return bits.join(" — ");
  return "Tax invoice";
}

/**
 * Overlay invoice fields onto an OCR result. No-op for payslips and fuel dockets.
 * Mutates and returns ocrResult.
 */
function applyTaxInvoiceToOcr(ocrResult, options = {}) {
  if (!ocrResult || typeof ocrResult !== "object") return ocrResult;
  const text = ocrResult.rawText || ocrResult.rawTextPreview || "";
  const parsed = parseTaxInvoice(text, options);
  if (!parsed) return ocrResult;

  ocrResult.documentType = "income";
  ocrResult.documentKind = "tax_invoice";
  ocrResult.invoiceNumber = parsed.invoiceNumber;
  ocrResult.issuer = parsed.issuer;
  if (parsed.payer) {
    ocrResult.payer = parsed.payer;
    ocrResult.entity = parsed.payer;
    ocrResult.vendor = parsed.payer;
  }
  if (parsed.issueDate) ocrResult.date = parsed.issueDate;
  if (parsed.dueDate) ocrResult.dueDate = parsed.dueDate;
  if (parsed.gstAmount != null) {
    ocrResult.gstAmount = parsed.gstAmount;
    ocrResult.gst = parsed.gstAmount;
  }
  if (parsed.grossTotal != null) {
    ocrResult.grossTotal = parsed.grossTotal;
    ocrResult.amount = parsed.grossTotal;
    ocrResult.netPay = parsed.grossTotal;
  }
  if (parsed.taxableIncome != null) ocrResult.taxableIncome = parsed.taxableIncome;
  if (parsed.description) ocrResult.description = parsed.description;
  if (parsed.lineItems && parsed.lineItems.length) ocrResult.lineItems = parsed.lineItems;
  ocrResult.suggestedIncomeType = parsed.suggestedIncomeType;
  ocrResult.dateOutsideSelectedFy = parsed.dateOutsideSelectedFy;
  ocrResult.documentFinancialYear = parsed.documentFinancialYear;
  ocrResult.selectedFinancialYear = parsed.selectedFinancialYear;
  if (parsed.fyWarning) ocrResult.fyWarning = parsed.fyWarning;
  ocrResult.summaryNotes = [
    parsed.invoiceNumber ? `Invoice ${parsed.invoiceNumber}` : "Tax invoice",
    parsed.payer ? `To ${parsed.payer}` : null,
    parsed.issuer ? `From ${parsed.issuer}` : null,
    parsed.issueDate ? `Issued ${parsed.issueDate}` : null,
    parsed.gstAmount != null ? `GST $${parsed.gstAmount.toFixed(2)}` : null,
    parsed.fyWarning || null,
  ]
    .filter(Boolean)
    .join(" · ");
  return ocrResult;
}

module.exports = {
  isTaxInvoiceText,
  parseTaxInvoice,
  applyTaxInvoiceToOcr,
  gstAmountFromText,
  parseAuDateToken,
  incomeTypeForInvoice,
  assessFy,
  lineItemsFromText,
};
