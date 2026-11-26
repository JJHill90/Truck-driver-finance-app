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
const { guessAbn } = require("./local-receipt-ocr");
const { cleanPartyName } = require("./ocr-keywords");

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
  return cleanPartyName(raw);
}

/**
 * True for a bill (From / To, or an invoice number plus a bill-to party).
 * Thermal fuel dockets that only say "TAX INVOICE" return false.
 */
function isTaxInvoiceText(text) {
  const src = String(text || "");
  if (!/\btax\s*invoice\b/i.test(src)) return false;
  if (/\b(diesel|unleaded|\d+(?:\.\d+)?\s*l)\b/i.test(src) && !/\binvoice\s*(?:no|number|#)/i.test(src)) {
    return false;
  }
  const fuel = /\b(diesel|unleaded|pump|\d+(?:\.\d+)?\s*l)\b/i.test(src);
  const bill = /\b(?:bill\s*to|sold\s*to)\b/i.test(src);
  const due = /\bdue\s+date\b/i.test(src);
  const hasFrom = /\bfrom\s*:/i.test(src);
  const hasTo = /\b(?:to|bill\s*to)\s*:/i.test(src);
  const hasNumber = /\b(?:inv(?:oice)?|haul)[\s\-:#]*\d{2,}\b/i.test(src);
  if (fuel && !bill && !due && !hasFrom) return false;
  if (hasFrom && hasTo) return true;
  if (bill && (due || hasNumber)) return true;
  if (hasNumber && (hasTo || hasFrom || /\babn\b/i.test(src))) return true;
  if (due && /\b(?:invoice\s*date|issue\s*date)\b/i.test(src)) return true;
  return false;
}

function lineItemsFromText(text) {
  const skip =
    /^(tax\s*invoice|from\s*:|to\s*:|bill\s*to|abn\b|date\s*:|due\b|gst\b|total\b|subtotal\b|invoice\b|pay\s*to|bsb\b|acc\b|paid\b|fleetcard|visa|eftpos)/i;
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
function moneyTokens(blob) {
  const withoutRate = String(blob || "").replace(/\b\d{1,2}(?:\.\d+)?\s*%/g, " ");
  const monies = [];
  const re = /\$?\s*((?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{2})?)/g;
  let m;
  while ((m = re.exec(withoutRate))) {
    const amount = parseMoney(m[1]);
    if (amount != null && amount > 0 && amount !== 10) monies.push(amount);
  }
  return monies;
}

/** Every dollar amount printed on a GST line, including the following line. */
function gstCandidatesFromText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/\bgst\b/i.test(lines[i])) continue;
    if (/\bgst\s*free\b/i.test(lines[i])) continue;
    const own = moneyTokens(lines[i]);
    const amounts = own.length ? own : moneyTokens(lines[i + 1] || "");
    for (const amount of amounts) {
      if (!found.includes(amount)) found.push(amount);
    }
  }
  return found;
}

function gstAmountFromText(text, gross) {
  const found = gstCandidatesFromText(text);
  const chosen = chooseGstAmount(found, gross, moneyTokens(text));
  return chosen.amount;
}

/**
 * Pick the GST dollars. A printed amount close to 1/11 of the gross wins.
 * $1 or a bare rate is kept only as an unsure value when nothing else is printed.
 */
function chooseGstAmount(candidates, gross, documentAmounts) {
  const list = (candidates || []).filter((n) => Number(n) > 0);
  const grossN = Number(gross) || 0;
  const close = (amount, target) => Math.abs(amount - target) <= Math.max(0.5, target * 0.08);
  if (grossN > 20) {
    const target = grossN / 11;
    const onLine = [...list].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    if (onLine != null && close(onLine, target)) return { amount: round2(onLine), unsure: false };
    const elsewhere = (documentAmounts || []).find(
      (amount) => amount !== grossN && amount !== onLine && close(amount, target)
    );
    if (onLine != null && !close(onLine, target) && elsewhere != null) {
      return { amount: round2(elsewhere), unsure: false };
    }
  }
  const plausible = list.filter((n) => n !== 1 && n !== 10);
  const amount = plausible.length ? plausible[plausible.length - 1] : list.length ? list[list.length - 1] : null;
  const unsure = amount != null && grossN > 20 && Math.abs(amount - grossN / 11) > Math.max(1, grossN * 0.02);
  return { amount: amount == null ? null : round2(amount), unsure };
}

function issuerFromHeader(text, labeledFrom) {
  if (labeledFrom) return cleanParty(labeledFrom);
  const fromAnywhere = String(text || "").match(/\bfrom\s*:?\s+([A-Za-z][^\n]{2,80})/i);
  if (fromAnywhere) return cleanParty(fromAnywhere[1]);
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pty = lines.find((line) => /\bpty\.?\s*ltd\b|\blimited\b/i.test(line));
  if (pty) return cleanParty(pty);
  for (const line of lines) {
    if (/tax\s*invoice|abn\b|invoice\b|due\b|^date\b|bill\s*to|page\b|^--|\d+\s+of\s+\d+/i.test(line)) continue;
    if (/[A-Za-z]{4,}/.test(line)) return cleanParty(line);
  }
  return "";
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
  const re =
    /\b(invoice\s*total|amount\s*due|total\s*due|total)\b(?!\s*gst)\s*:?\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)/gi;
  let best = null;
  let match;
  while ((match = re.exec(src))) {
    const amount = parseMoney(match[2]);
    if (amount != null && amount > 20) best = amount;
  }
  return best;
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

  const issuer = issuerFromHeader(src, labeledParty(src, "from"));
  const billTo = labeledParty(src, "bill\\s*to") || labeledParty(src, "to");
  const labeled = [];
  const dateRe =
    /\b((?:invoice|issue|tax|payment)\s+date|due(?:\s+date)?|date)\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/gi;
  let dateHit;
  while ((dateHit = dateRe.exec(src))) {
    labeled.push({ label: String(dateHit[1] || "").toLowerCase(), token: dateHit[2] });
  }
  const dueHit = labeled.find((row) => /\bdue\b/.test(row.label));
  const dueDate = dueHit ? parseAuDateToken(dueHit.token) : null;
  let issueHit = labeled.find((row) => /invoice|issue/.test(row.label) && !/\bdue\b/.test(row.label));
  if (!issueHit) {
    issueHit = labeled.find((row) => !/\bdue\b/.test(row.label) && row.token !== (dueHit && dueHit.token));
  }
  let issueDate = issueHit ? parseAuDateToken(issueHit.token) : null;
  if (!issueDate && dueDate) {
    const any = [];
    const anyRe = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/g;
    let anyHit;
    while ((anyHit = anyRe.exec(src))) {
      const iso = parseAuDateToken(anyHit[1]);
      if (iso && iso !== dueDate) any.push(iso);
    }
    if (any.length) issueDate = any[0];
  }
  const total = totalDueFromText(src);
  const gstChoice = chooseGstAmount(gstCandidatesFromText(src), total, moneyTokens(src));
  const gstAmount = gstChoice.amount;
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
    vendorAbn: guessAbn(src),
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
    netPay: exGst != null ? exGst : total,
    gstUnsure: Boolean(gstChoice.unsure),
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
  const names = new Set([cleanPartyName(payer), cleanPartyName(issuer)].filter(Boolean));
  const item =
    (items || []).find((row) => {
      const cleaned = cleanPartyName(String(row || ""));
      return cleaned && !names.has(cleaned);
    }) || "";
  const shortItem = cleanPartyName(item.replace(/\s+/g, " ").replace(/\s+\$[\d,.]+.*$/, "").trim());
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
  if (parsed.vendorAbn) ocrResult.vendorAbn = parsed.vendorAbn;
  if (parsed.payer) {
    ocrResult.payer = parsed.payer;
    ocrResult.entity = parsed.payer;
    ocrResult.vendor = parsed.payer;
  }
  if (parsed.issueDate) {
    ocrResult.date = parsed.issueDate;
    ocrResult.issueDate = parsed.issueDate;
  }
  if (parsed.dueDate) ocrResult.dueDate = parsed.dueDate;
  if (parsed.gstAmount != null) {
    ocrResult.gstAmount = parsed.gstAmount;
    ocrResult.gst = parsed.gstAmount;
  }
  if (parsed.grossTotal != null) {
    ocrResult.grossTotal = parsed.grossTotal;
    ocrResult.amount = parsed.grossTotal;
    ocrResult.netPay = parsed.netPay != null ? parsed.netPay : parsed.grossTotal;
  }
  if (parsed.gstUnsure) {
    ocrResult.gstUnsure = true;
    ocrResult.notes = `${ocrResult.notes || ""} GST amount looks wrong — check it.`.trim();
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
