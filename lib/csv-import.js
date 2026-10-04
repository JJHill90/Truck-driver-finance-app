/**
 * Bank-statement CSV preview + import for income / expense ledgers.
 * Reads common AU bank exports (CommBank, NAB, ANZ, Westpac, ING and similar).
 * Rows are reviewed in the UI — nothing is auto-lodged with the ATO.
 */

const { toIsoAusDate } = require("./aus-date");
const { findDuplicateMatches } = require("./duplicate-receipt");
const {
  suggestCategoryFromText,
  inferBusinessTypeCategory,
  matchCanonicalVendorInText,
  matchCanonicalVendorByCompactText,
  resolveCanonicalVendor,
  menuSafeCategory,
} = require("./vendor-enrichment");
const { normalizeExpenseCategoryId } = require("./expense-menu");
const { normalizeIncomeTypeId, DEFAULT_INCOME_TYPE } = require("./income-menu");

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 400;
const DEFAULT_EXPENSE_CATEGORY = "other_work";

const DATE_HEADERS = new Set([
  "date",
  "transaction date",
  "transactiondate",
  "value date",
  "valuedate",
  "processed",
  "processed date",
  "posted",
  "posted date",
  "trans date",
  "txn date",
  "effective date",
]);

const DESC_HEADERS = new Set([
  "description",
  "particulars",
  "narrative",
  "details",
  "transaction details",
  "transactiondetails",
  "memo",
  "merchant",
  "payee",
  "transaction description",
  "narration",
  "transaction",
]);

const AMOUNT_HEADERS = new Set([
  "amount",
  "transaction amount",
  "aud",
  "aud amount",
  "value",
  "txn amount",
  "aud$",
]);

const DEBIT_HEADERS = new Set([
  "debit",
  "debit amount",
  "withdrawal",
  "withdrawals",
  "money out",
  "spent",
  "payments",
  "debit aud",
  "dr",
]);

const CREDIT_HEADERS = new Set([
  "credit",
  "credit amount",
  "deposit",
  "deposits",
  "money in",
  "received",
  "credit aud",
  "cr",
]);

const TYPE_HEADERS = new Set([
  "type",
  "transaction type",
  "debit/credit",
  "dr/cr",
  "cr/dr",
  "direction",
]);

const SKIP_HEADERS = new Set([
  "balance",
  "account",
  "account number",
  "account name",
  "bsb",
  "currency",
]);

const SKIP_NARRATIVE_RE =
  /\b(?:opening\s+balance|closing\s+balance|brought\s+forward|carried\s+forward|balance\s+brought|balance\s+carried)\b/i;

const TRANSFER_RE =
  /\b(?:internal\s+transfer|funds?\s*tfr|m-?banking\s+funds|transfer\s+to\s+(?:self|own)|osko\s+to\s+self|payid\s+to\s+self)\b/i;

const INCOME_HINT_RE =
  /\b(?:salary|wages?|payroll|payslip|pay\s*run|weekly\s+pay|fortnightly\s+pay|remittance|owner[\s-]?driver|contract\s+pay|interest|dividend|bonus|commission|allowance|refund)\b/i;

const SALARY_RE = /\b(?:salary|wages?|payroll|payslip|pay\s*run|weekly\s+pay|fortnightly\s+pay)\b/i;
const REMIT_RE = /\b(?:remittance|owner[\s-]?driver|contract\s+(?:pay|income)|abn\s+pay)\b/i;
const INTEREST_RE = /\binterest\b/i;
const DIVIDEND_RE = /\bdividends?\b/i;
const TRAVEL_ALLOW_RE = /\b(?:travel\s+allowance|lafha|living\s+away)\b/i;
const CAR_ALLOW_RE = /\b(?:car\s+allowance|km\s+allowance|kilometre\s+allowance)\b/i;

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ");
}

function compactHeader(value) {
  return normalizeHeader(value).replace(/[^a-z0-9]/g, "");
}

function sniffDelimiter(text) {
  const sample = stripBom(text)
    .split(/\r\n|\n|\r/)
    .find((line) => String(line).trim()) || "";
  let best = ",";
  let bestCount = -1;
  for (const delim of [",", ";", "\t", "|"]) {
    const rows = parseCsv(sample, delim);
    const cols = (rows[0] || []).length;
    if (cols > bestCount) {
      bestCount = cols;
      best = delim;
    }
  }
  return bestCount > 1 ? best : ",";
}

function parseCsv(text, delimiter = ",") {
  const s = stripBom(text);
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\r") {
      if (s[i + 1] === "\n") continue;
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    if (c === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  return rows;
}

function looksLikeDate(value) {
  return Boolean(toIsoAusDate(value));
}

function looksLikeAmount(value) {
  const n = parseAmount(value);
  return n != null;
}

function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/,/g, "").replace(/[$\s]/g, "").replace(/[−–—]/g, "-");
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  const drCr = s.match(/^(.+?)(dr|cr)$/i);
  if (drCr) {
    s = drCr[1];
    if (/^dr$/i.test(drCr[2])) sign = -1;
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * sign * 100) / 100;
}

function classifyHeader(name) {
  const norm = normalizeHeader(name);
  const compact = compactHeader(name);
  if (DATE_HEADERS.has(norm) || DATE_HEADERS.has(compact) || compact === "date") return "date";
  if (DESC_HEADERS.has(norm) || DESC_HEADERS.has(compact)) return "description";
  if (AMOUNT_HEADERS.has(norm) || AMOUNT_HEADERS.has(compact)) return "amount";
  if (DEBIT_HEADERS.has(norm) || DEBIT_HEADERS.has(compact)) return "debit";
  if (CREDIT_HEADERS.has(norm) || CREDIT_HEADERS.has(compact)) return "credit";
  if (TYPE_HEADERS.has(norm) || TYPE_HEADERS.has(compact)) return "type";
  if (SKIP_HEADERS.has(norm) || SKIP_HEADERS.has(compact)) return "skip";
  return null;
}

function mapColumns(headers) {
  const cols = {
    date: -1,
    description: -1,
    amount: -1,
    debit: -1,
    credit: -1,
    type: -1,
  };
  headers.forEach((name, idx) => {
    const role = classifyHeader(name);
    if (role && role !== "skip" && cols[role] < 0) cols[role] = idx;
  });
  return cols;
}

function inferHeaderlessColumns(firstRow) {
  const cols = {
    date: -1,
    description: -1,
    amount: -1,
    debit: -1,
    credit: -1,
    type: -1,
  };
  if (!firstRow || !firstRow.length) return cols;
  if (looksLikeDate(firstRow[0])) cols.date = 0;
  if (firstRow.length === 2 && looksLikeAmount(firstRow[1])) {
    cols.amount = 1;
    return cols;
  }
  if (firstRow.length >= 3 && looksLikeAmount(firstRow[1]) && !looksLikeAmount(firstRow[2])) {
    cols.amount = 1;
    cols.description = 2;
    return cols;
  }
  if (firstRow.length >= 3 && !looksLikeAmount(firstRow[1]) && looksLikeAmount(firstRow[2])) {
    cols.description = 1;
    cols.amount = 2;
    return cols;
  }
  if (firstRow.length >= 4 && looksLikeAmount(firstRow[2]) && looksLikeAmount(firstRow[3])) {
    cols.description = 1;
    cols.debit = 2;
    cols.credit = 3;
    return cols;
  }
  const amountIdx = firstRow.findIndex((cell, i) => i > 0 && looksLikeAmount(cell));
  const descIdx = firstRow.findIndex((cell, i) => i > 0 && !looksLikeAmount(cell) && String(cell).trim());
  if (amountIdx >= 0) cols.amount = amountIdx;
  if (descIdx >= 0) cols.description = descIdx;
  return cols;
}

function cell(row, idx) {
  if (idx == null || idx < 0) return "";
  return row[idx] == null ? "" : String(row[idx]).trim();
}

function purposeFromType(typeValue) {
  const s = String(typeValue || "").trim().toLowerCase();
  if (!s) return null;
  if (/^(dr|debit|withdrawal|payment|spend|purchase|pos)$/.test(s)) return "expense";
  if (/^(cr|credit|deposit|salary|wage|pay|incoming)$/.test(s)) return "income";
  return null;
}

function tidyBankNarrative(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(
    /^(visa|mastercard|mc|eftpos|pos|atm|purchase|wdl|withdrawal|debit card|credit card|aus|au)\s*[-:/]?\s*/gi,
    ""
  );
  s = s.replace(/\b(?:visa|mastercard|eftpos|pos purchase|card transaction)\b/gi, " ");
  s = s.replace(/\b\d{5,}\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return String(raw || "").trim();
  return s.replace(/\w\S*/g, (word) => {
    if (/^[A-Z0-9&'-]+$/.test(word) && word.length <= 3) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function guessVendor(narrative) {
  const raw = String(narrative || "").trim();
  if (!raw) return "";
  const canonical =
    matchCanonicalVendorInText(raw) ||
    matchCanonicalVendorByCompactText(raw) ||
    resolveCanonicalVendor({ vendor: raw, text: raw });
  if (canonical && canonical.name) return canonical.name;
  return tidyBankNarrative(raw);
}

function guessExpenseCategory(narrative, vendor) {
  const blob = `${vendor || ""}\n${narrative || ""}`;
  const business = inferBusinessTypeCategory({ name: vendor, text: blob });
  if (business) {
    const safe = menuSafeCategory(business);
    if (safe) return safe;
  }
  const fromText = suggestCategoryFromText(blob, vendor);
  if (fromText) return fromText;
  return DEFAULT_EXPENSE_CATEGORY;
}

function guessIncomeType(narrative) {
  const blob = String(narrative || "");
  if (TRAVEL_ALLOW_RE.test(blob)) return "allowance_travel";
  if (CAR_ALLOW_RE.test(blob)) return "allowance_car";
  if (REMIT_RE.test(blob)) return "remittance_owner";
  if (SALARY_RE.test(blob) || INTEREST_RE.test(blob) || DIVIDEND_RE.test(blob)) {
    return DEFAULT_INCOME_TYPE;
  }
  return DEFAULT_INCOME_TYPE;
}

function shouldSuggestSkip(narrative) {
  const s = String(narrative || "");
  if (SKIP_NARRATIVE_RE.test(s)) return { include: false, warning: "Looks like a statement balance line — left unticked." };
  if (TRANSFER_RE.test(s)) return { include: false, warning: "Looks like an internal transfer — left unticked." };
  return { include: true, warning: "" };
}

function resolveMoney(row, cols) {
  const debit = parseAmount(cell(row, cols.debit));
  const credit = parseAmount(cell(row, cols.credit));
  const typed = purposeFromType(cell(row, cols.type));
  if (debit != null && Math.abs(debit) > 0 && !(credit != null && Math.abs(credit) > 0)) {
    return { amount: Math.abs(debit), purpose: "expense" };
  }
  if (credit != null && Math.abs(credit) > 0 && !(debit != null && Math.abs(debit) > 0)) {
    return { amount: Math.abs(credit), purpose: "income" };
  }
  const signed = parseAmount(cell(row, cols.amount));
  if (signed == null) return null;
  if (signed === 0) return { amount: 0, purpose: typed || "expense" };
  if (typed === "expense") return { amount: Math.abs(signed), purpose: "expense" };
  if (typed === "income") return { amount: Math.abs(signed), purpose: "income" };
  if (signed < 0) return { amount: Math.abs(signed), purpose: "expense" };
  return { amount: signed, purpose: "income" };
}

function presentRow(index, sourceRow, cols, records) {
  const dateRaw = cell(sourceRow, cols.date);
  const date = toIsoAusDate(dateRaw);
  const description = cell(sourceRow, cols.description) || cell(sourceRow, cols.amount ? -1 : 1);
  const money = resolveMoney(sourceRow, cols);
  if (!date) {
    return {
      ok: false,
      index,
      reason: dateRaw ? "Could not read the date (use DD/MM/YYYY)." : "Missing date.",
    };
  }
  if (!money || !(money.amount > 0)) {
    return { ok: false, index, reason: "Missing or zero amount." };
  }
  const purpose = money.purpose;
  const vendor = guessVendor(description);
  const skip = shouldSuggestSkip(description);
  const category = guessExpenseCategory(description, vendor);
  const type = guessIncomeType(description);
  let extraWarning = skip.warning;
  if (!extraWarning && purpose === "expense" && INCOME_HINT_RE.test(description)) {
    extraWarning = "This debit looks like pay or a refund — check income vs expense before importing.";
  }
  const matches = findDuplicateMatches(
    records || { expenses: [], income: [], receipts: [] },
    {
      date,
      vendor,
      entity: vendor,
      payer: vendor,
      amount: money.amount,
      grossTotal: money.amount,
    },
    purpose,
    money.amount
  );
  return {
    ok: true,
    row: {
      index,
      include: skip.include && matches.length === 0,
      purpose,
      date,
      amount: money.amount,
      vendor,
      description,
      category: normalizeExpenseCategoryId(category) || DEFAULT_EXPENSE_CATEGORY,
      type: normalizeIncomeTypeId(type) || DEFAULT_INCOME_TYPE,
      workUsePercent: 100,
      noReceipt: true,
      source: "csv_import",
      duplicate: matches.length > 0,
      duplicateMatches: matches.slice(0, 3),
      warning:
        extraWarning ||
        (matches.length ? "Possible duplicate of a row already on this profile." : ""),
    },
  };
}

function previewCsv(text, options = {}) {
  const filename = String(options.filename || "statement.csv");
  const raw = stripBom(text);
  if (!raw.trim()) {
    return { ok: false, status: 400, code: "EMPTY", error: "The CSV file is empty." };
  }
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > (options.maxBytes || MAX_BYTES)) {
    return {
      ok: false,
      status: 413,
      code: "TOO_LARGE",
      error: "CSV is too large (max 1 MB).",
    };
  }
  const delimiter = options.delimiter || sniffDelimiter(raw);
  const table = parseCsv(raw, delimiter);
  if (!table.length) {
    return { ok: false, status: 400, code: "EMPTY", error: "No rows found in that CSV." };
  }

  const headerRoles = table[0].map((h) => classifyHeader(h));
  const headerHits = headerRoles.filter((role) => role && role !== "skip").length;
  const hasHeader = headerHits >= 2 || headerRoles.includes("date");
  const headers = hasHeader ? table[0] : table[0].map((_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? table.slice(1) : table;
  const cols = hasHeader ? mapColumns(headers) : inferHeaderlessColumns(table[0]);

  if (cols.date < 0 || (cols.amount < 0 && cols.debit < 0 && cols.credit < 0)) {
    return {
      ok: false,
      status: 400,
      code: "COLUMNS",
      error:
        "Could not find Date plus Amount (or Debit/Credit) columns. Export a bank statement CSV and try again.",
      headers,
      delimiter,
    };
  }

  const maxRows = options.maxRows || MAX_ROWS;
  const records = options.records || { expenses: [], income: [], receipts: [] };
  const rows = [];
  const skipped = [];
  let truncated = false;
  dataRows.forEach((sourceRow, i) => {
    if (rows.length >= maxRows) {
      truncated = true;
      return;
    }
    const presented = presentRow(i, sourceRow, cols, records);
    if (!presented.ok) {
      skipped.push({ line: i + (hasHeader ? 2 : 1), reason: presented.reason });
      return;
    }
    rows.push(presented.row);
  });

  const warnings = [];
  if (truncated) {
    warnings.push(`Only the first ${maxRows} rows were read. Split a larger statement into two files.`);
  }
  if (!rows.length) {
    return {
      ok: false,
      status: 400,
      code: "NO_ROWS",
      error: "No usable transactions were found. Check the date and amount columns.",
      headers,
      delimiter,
      skipped,
    };
  }

  return {
    ok: true,
    filename,
    delimiter: delimiter === "\t" ? "tab" : delimiter,
    headers,
    rows,
    skipped,
    warnings,
    counts: {
      total: rows.length,
      expenses: rows.filter((r) => r.purpose === "expense").length,
      income: rows.filter((r) => r.purpose === "income").length,
      duplicates: rows.filter((r) => r.duplicate).length,
    },
  };
}

function validateImportRow(raw, index) {
  if (!raw || raw.include === false) {
    return { ok: false, skipped: true };
  }
  const date = toIsoAusDate(raw.date);
  const amount = Math.round(Math.abs(Number(raw.amount) || 0) * 100) / 100;
  const purpose = raw.purpose === "income" ? "income" : "expense";
  if (!date) {
    return { ok: false, error: `Row ${index + 1}: missing or invalid date.` };
  }
  if (!(amount > 0)) {
    return { ok: false, error: `Row ${index + 1}: amount must be greater than zero.` };
  }
  if (raw.duplicate && !raw.forceDuplicate) {
    return { ok: false, skipped: true, reason: "duplicate" };
  }
  const vendor = String(raw.vendor || raw.payer || raw.description || "").trim();
  const description = String(raw.description || vendor || "Bank statement line").trim();
  return {
    ok: true,
    row: {
      purpose,
      date,
      amount,
      vendor,
      description,
      category: normalizeExpenseCategoryId(raw.category) || DEFAULT_EXPENSE_CATEGORY,
      type: normalizeIncomeTypeId(raw.type) || DEFAULT_INCOME_TYPE,
      workUsePercent:
        raw.workUsePercent == null || raw.workUsePercent === ""
          ? 100
          : Math.min(100, Math.max(0, Number(raw.workUsePercent) || 100)),
      noReceipt: true,
      source: "csv_import",
    },
  };
}

function importRows(rawRows, hooks = {}) {
  const list = Array.isArray(rawRows) ? rawRows : [];
  if (!list.length) {
    return { ok: false, status: 400, code: "EMPTY", error: "No rows to import." };
  }
  if (list.length > MAX_ROWS) {
    return {
      ok: false,
      status: 400,
      code: "TOO_MANY",
      error: `Import is limited to ${MAX_ROWS} reviewed rows.`,
    };
  }
  const records = hooks.records;
  if (!records) {
    return { ok: false, status: 500, code: "NO_RECORDS", error: "No account records were loaded." };
  }
  const addExpense = hooks.addExpense;
  const addIncome = hooks.addIncome;
  if (typeof addExpense !== "function" || typeof addIncome !== "function") {
    return { ok: false, status: 500, code: "NO_HOOKS", error: "Import hooks are missing." };
  }
  const normExpense = hooks.normalizeExpenseCategory || ((id) => normalizeExpenseCategoryId(id));
  const normIncome = hooks.normalizeIncomeType || ((id) => normalizeIncomeTypeId(id));

  const expenses = [];
  const income = [];
  const skipped = [];
  for (let i = 0; i < list.length; i += 1) {
    const checked = validateImportRow(list[i], i);
    if (!checked.ok) {
      if (checked.error) {
        return { ok: false, status: 400, code: "INVALID", error: checked.error };
      }
      skipped.push({ index: i, reason: checked.reason || "skipped" });
      continue;
    }
    const row = checked.row;
    if (row.purpose === "income") {
      const payload = {
        date: row.date,
        type: normIncome(row.type) || DEFAULT_INCOME_TYPE,
        amount: row.amount,
        description: row.description,
        payer: row.vendor,
        entity: row.vendor,
        grossTotal: row.amount,
        taxableIncome: row.amount,
        netPay: row.amount,
        notes: "Imported from bank statement CSV",
      };
      const entry = addIncome(records, payload);
      if (entry) income.push(entry);
    } else {
      const payload = {
        date: row.date,
        category: normExpense(row.category) || DEFAULT_EXPENSE_CATEGORY,
        amount: row.amount,
        description: row.description,
        vendor: row.vendor,
        workUsePercent: row.workUsePercent,
        noReceipt: true,
        notes: "Imported from bank statement CSV",
      };
      const entry = addExpense(records, payload);
      if (entry) expenses.push(entry);
    }
  }

  return {
    ok: true,
    imported: { expenses: expenses.length, income: income.length },
    skipped: skipped.length,
    entries: { expenses, income },
  };
}

module.exports = {
  MAX_BYTES,
  MAX_ROWS,
  DEFAULT_EXPENSE_CATEGORY,
  stripBom,
  sniffDelimiter,
  parseCsv,
  parseAmount,
  classifyHeader,
  mapColumns,
  guessVendor,
  guessExpenseCategory,
  guessIncomeType,
  previewCsv,
  validateImportRow,
  importRows,
};
