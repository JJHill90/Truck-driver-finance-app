/**
 * Recurring fixed-cost expenses (sole-trader super, rent, subscriptions).
 * Templates live on records.recurringExpenses. Each due date posts one
 * ledger row (no receipt required) so the driver can reconcile later.
 */
const crypto = require("crypto");

const TZ = "Australia/Sydney";
const FREQUENCIES = ["daily", "weekly", "fortnightly", "monthly", "quarterly", "yearly"];
const MAX_CATCHUP = 400;

const FREQUENCY_LABEL = {
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatYmd(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function todayYmd(now = new Date(), timeZone = TZ) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function cmpYmd(a, b) {
  return String(a).localeCompare(String(b));
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(ymd, days) {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(days)));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function addMonths(ymd, months) {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const total = p.y * 12 + (p.m - 1) + Number(months);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(p.d, daysInMonth(y, m));
  return formatYmd(y, m, d);
}

function addFrequency(ymd, frequency) {
  const freq = normalizeFrequency(frequency);
  if (freq === "daily") return addDays(ymd, 1);
  if (freq === "weekly") return addDays(ymd, 7);
  if (freq === "fortnightly") return addDays(ymd, 14);
  if (freq === "monthly") return addMonths(ymd, 1);
  if (freq === "quarterly") return addMonths(ymd, 3);
  if (freq === "yearly") return addMonths(ymd, 12);
  return addDays(ymd, 7);
}

function normalizeFrequency(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "fortnight" || v === "biweekly") return "fortnightly";
  if (v === "month") return "monthly";
  if (v === "year" || v === "annual") return "yearly";
  if (v === "quarter") return "quarterly";
  if (v === "day") return "daily";
  if (v === "week") return "weekly";
  return FREQUENCIES.includes(v) ? v : null;
}

function ensureList(records) {
  if (!records.recurringExpenses || !Array.isArray(records.recurringExpenses)) {
    records.recurringExpenses = [];
  }
  return records.recurringExpenses;
}

function isTruthy(value) {
  if (value === true || value === 1) return true;
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function wantsRecurring(body) {
  if (!body) return false;
  return isTruthy(body.recurring) || isTruthy(body.recurringFixedCost) || isTruthy(body.fixedCost);
}

function templatePayloadFromBody(body, startDate) {
  return {
    amount: Number(body.amount) || 0,
    category: body.category || "other_work",
    description: String(body.description || "").trim(),
    vendor: String(body.vendor || "").trim(),
    vendorAbn: String(body.vendorAbn || body.abn || "").trim(),
    workUsePercent: body.workUsePercent == null || body.workUsePercent === "" ? 100 : Number(body.workUsePercent),
    reimbursed: Boolean(body.reimbursed),
    cashTransaction: Boolean(body.cashTransaction),
    noReceipt: body.noReceipt == null ? true : Boolean(body.noReceipt),
    vendingMachine: Boolean(body.vendingMachine),
    entityId: body.entityId || null,
    notes: String(body.notes || "").trim(),
    frequency: normalizeFrequency(body.recurringFrequency || body.frequency) || "weekly",
    startDate,
  };
}

function createTemplate(records, body, opts = {}) {
  const freq = normalizeFrequency(body && (body.recurringFrequency || body.frequency));
  if (!freq) {
    return { ok: false, error: "Choose how often this fixed cost repeats." };
  }
  const start = parseYmd(body.recurringStartDate || body.startDate || body.date);
  if (!start) {
    return { ok: false, error: "Choose a start date for the recurring expense." };
  }
  const startDate = formatYmd(start.y, start.m, start.d);
  const amount = Number(body.amount) || 0;
  if (!(amount > 0)) {
    return { ok: false, error: "Enter an amount for the recurring expense." };
  }
  const firstPosted = opts.firstPostedDate && parseYmd(opts.firstPostedDate) ? String(opts.firstPostedDate).slice(0, 10) : null;
  const template = {
    id: crypto.randomUUID(),
    active: true,
    nextDue: firstPosted && firstPosted === startDate ? addFrequency(startDate, freq) : startDate,
    lastPostedDate: firstPosted && firstPosted === startDate ? startDate : null,
    sourceExpenseId: opts.sourceExpenseId || null,
    createdAt: new Date().toISOString(),
    ...templatePayloadFromBody(body, startDate),
    frequency: freq,
    startDate,
  };
  if (!template.notes) {
    const freqLabel = FREQUENCY_LABEL[freq] || freq;
    template.notes = `Recurring fixed cost (${String(freqLabel).toLowerCase()})`;
  }
  ensureList(records).unshift(template);
  return { ok: true, template };
}

function alreadyPosted(records, templateId, date) {
  return (records.expenses || []).some(
    (e) => e && !e.deletedAt && e.recurringId === templateId && String(e.date || "").slice(0, 10) === date
  );
}

function expensePayloadFromTemplate(template, date) {
  const freqLabel = FREQUENCY_LABEL[template.frequency] || template.frequency;
  const desc = template.description || `${freqLabel} fixed cost`;
  return {
    date,
    category: template.category,
    amount: template.amount,
    description: desc,
    vendor: template.vendor,
    vendorAbn: template.vendorAbn,
    workUsePercent: template.workUsePercent,
    reimbursed: template.reimbursed,
    notes: template.notes || `Recurring fixed cost (${String(freqLabel).toLowerCase()})`,
  };
}

function stampOccurrence(entry, template) {
  if (!entry) return entry;
  entry.recurringId = template.id;
  entry.recurringOccurrence = true;
  entry.noReceipt = Boolean(template.noReceipt);
  entry.cashTransaction = Boolean(template.cashTransaction);
  entry.vendingMachine = Boolean(template.vendingMachine);
  if (template.entityId) entry.entityId = template.entityId;
  if (template.notes && !entry.notes) entry.notes = template.notes;
  return entry;
}

/**
 * Post every due occurrence up to today (Sydney). Skips dates that already
 * have a matching ledger row. Returns created entries.
 */
function materializeDue(records, opts = {}) {
  const addExpense = opts.addExpense;
  if (typeof addExpense !== "function") return { created: [] };
  const today = opts.today || todayYmd(opts.now || new Date());
  const created = [];
  for (const template of ensureList(records)) {
    if (!template || template.active === false) continue;
    let next = parseYmd(template.nextDue || template.startDate)
      ? String(template.nextDue || template.startDate).slice(0, 10)
      : null;
    if (!next) continue;
    let n = 0;
    while (cmpYmd(next, today) <= 0 && n < MAX_CATCHUP) {
      if (template.endDate && cmpYmd(next, template.endDate) > 0) break;
      if (!alreadyPosted(records, template.id, next)) {
        const payload = expensePayloadFromTemplate(template, next);
        if (typeof opts.stampBody === "function") opts.stampBody(payload);
        const entry = addExpense(records, payload);
        stampOccurrence(entry, template);
        created.push(entry);
        template.lastPostedDate = next;
        if (!template.sourceExpenseId) template.sourceExpenseId = entry.id;
      }
      next = addFrequency(next, template.frequency);
      template.nextDue = next;
      n += 1;
    }
  }
  return { created };
}

function listActive(records) {
  return ensureList(records).filter((t) => t && t.active !== false);
}

function findTemplate(records, id) {
  return ensureList(records).find((t) => t && t.id === id) || null;
}

function stopTemplate(records, id) {
  const t = findTemplate(records, id);
  if (!t) return null;
  t.active = false;
  t.stoppedAt = new Date().toISOString();
  return t;
}

function presentTemplate(template, today) {
  if (!template) return null;
  const due = String(template.nextDue || template.startDate || "");
  const todayY = today || todayYmd();
  return {
    id: template.id,
    active: template.active !== false,
    amount: template.amount,
    category: template.category,
    description: template.description,
    vendor: template.vendor,
    frequency: template.frequency,
    frequencyLabel: FREQUENCY_LABEL[template.frequency] || template.frequency,
    startDate: template.startDate,
    nextDue: template.nextDue,
    lastPostedDate: template.lastPostedDate || null,
    noReceipt: Boolean(template.noReceipt),
    awaitingFirst: template.active !== false && due && cmpYmd(due, todayY) > 0,
  };
}

module.exports = {
  TZ,
  FREQUENCIES,
  FREQUENCY_LABEL,
  MAX_CATCHUP,
  todayYmd,
  parseYmd,
  addDays,
  addMonths,
  addFrequency,
  normalizeFrequency,
  ensureList,
  wantsRecurring,
  createTemplate,
  materializeDue,
  listActive,
  findTemplate,
  stopTemplate,
  presentTemplate,
  stampOccurrence,
};
