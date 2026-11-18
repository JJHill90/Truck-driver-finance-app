/**
 * Fill a blank description from receipt / invoice line items.
 * Skips headers (TAX INVOICE, ABN, Date, Total, GST, card tenders).
 */

const SKIP_RE =
  /^(tax\s*invoice|invoice\b|from\s*:|to\s*:|abn\b|date\s*:|due\s*:|gst\b|total\b|pay\s*to|bsb\b|acc(?:ount)?\b|paid\b|fleetcard|visa\b|mastercard|eftpos|subtotal|change\b|thank)/i;

function cleanLine(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .replace(/\s+\$[\d,.]+.*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function linesFrom(text, lineItems) {
  const fromItems = Array.isArray(lineItems) ? lineItems.map((row) => {
    if (row && typeof row === "object") return row.description || row.label || row.name || "";
    return row;
  }) : [];
  const fromText = String(text || "").split(/\r?\n/);
  return [...fromItems, ...fromText];
}

function descriptionFromDocument({ text = "", lineItems = [], vendor = "", kind = "" } = {}) {
  const picked = [];
  for (const raw of linesFrom(text, lineItems)) {
    const line = cleanLine(raw);
    if (!line || line.length < 3) continue;
    if (SKIP_RE.test(line)) continue;
    if (!/[A-Za-z]{3,}/.test(line)) continue;
    if (/^\d{1,2}[./-]\d{1,2}[./-]/.test(line)) continue;
    picked.push(line.slice(0, 80));
    if (picked.length >= 2) break;
  }
  if (picked.length) return picked.join("; ");
  const who = cleanLine(vendor);
  if (who && !SKIP_RE.test(who)) {
    return kind === "tax_invoice" ? `Tax invoice — ${who}` : who;
  }
  return "";
}

function applyDescription(target, extras = {}) {
  if (!target || typeof target !== "object") return target;
  const current = String(target.description || "").trim();
  if (current && !/^(payslip|remittance|tax\s*invoice|receipt)$/i.test(current)) return target;
  const next = descriptionFromDocument({
    text: extras.text || target.rawText || target.rawTextPreview || "",
    lineItems: extras.lineItems || target.lineItems,
    vendor: extras.vendor || target.vendor || target.entity || "",
    kind: extras.kind || target.documentKind || "",
  });
  if (next) target.description = next;
  return target;
}

module.exports = {
  descriptionFromDocument,
  applyDescription,
};
