const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getCurrentFinancialYear } = require("./ato-standards");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_FILE = path.join(DATA_DIR, "driver-records.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function defaultRecords() {
  return {
    profile: {
      name: "",
      employer: "",
      abn: "",
      driverType: "long_haul",
      annualSalary: 85000,
      financialYear: getCurrentFinancialYear(),
      vehicleType: "truck",
      tfnSupplied: false,
    },
    vendors: [],
    expenses: [],
    income: [],
    receipts: [],
  };
}

function normaliseAbn(abn) {
  return String(abn || "")
    .replace(/\s/g, "")
    .replace(/[^\d]/g, "");
}

function upsertVendor(records, { name, abn }) {
  const vendorName = String(name || "").trim();
  if (!vendorName) return null;

  const abnClean = normaliseAbn(abn);
  records.vendors = records.vendors || [];

  let existing = null;
  if (abnClean) {
    existing = records.vendors.find((v) => normaliseAbn(v.abn) === abnClean);
  }
  if (!existing) {
    existing = records.vendors.find(
      (v) => v.name.toLowerCase() === vendorName.toLowerCase()
    );
  }

  if (existing) {
    existing.name = vendorName;
    if (abnClean) existing.abn = abnClean;
    existing.lastUsed = new Date().toISOString();
    return existing;
  }

  const vendor = {
    id: newId(),
    name: vendorName,
    abn: abnClean,
    lastUsed: new Date().toISOString(),
  };
  records.vendors.unshift(vendor);
  return vendor;
}

function listVendors(records) {
  return (records.vendors || []).slice().sort((a, b) => {
    const aTime = a.lastUsed || "";
    const bTime = b.lastUsed || "";
    return bTime.localeCompare(aTime);
  });
}

function saveReceiptImage(receiptId, dataUrl) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  const mime = match[1];
  let ext = "jpg";
  if (mime.includes("png")) ext = "png";
  else if (mime.includes("webp")) ext = "webp";
  else if (mime.includes("pdf")) ext = "pdf";
  else if (mime.includes("heic") || mime.includes("heif")) ext = "heic";
  const dir = path.join(DATA_DIR, "receipts");
  fs.mkdirSync(dir, { recursive: true });
  const relativePath = `receipts/${receiptId}.${ext}`;
  const filePath = path.join(DATA_DIR, relativePath);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return relativePath;
}

function readReceiptImage(relativePath) {
  const filePath = path.join(DATA_DIR, relativePath);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeMap = {
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
    heic: "image/heic",
  };
  const mime = mimeMap[ext] || "image/jpeg";
  const base64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${base64}`;
}

function getReceiptFileInfo(relativePath) {
  if (!relativePath) return null;
  const filePath = path.join(DATA_DIR, relativePath);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeMap = {
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
    heic: "image/heic",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  return {
    filePath,
    mime: mimeMap[ext] || "image/jpeg",
    filename: path.basename(filePath),
  };
}

function alignProfileFinancialYear(records) {
  const currentFy = getCurrentFinancialYear();
  records.profile = records.profile || {};
  if (!records.profile.financialYear) {
    records.profile.financialYear = currentFy;
    return true;
  }
  return false;
}

function loadRecords(filePath = DEFAULT_FILE) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    const data = defaultRecords();
    saveRecords(data, filePath);
    return data;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const data = { ...defaultRecords(), ...JSON.parse(raw) };
  data.profile = { ...defaultRecords().profile, ...(data.profile || {}) };
  data.expenses = data.expenses || [];
  data.income = data.income || [];
  data.receipts = data.receipts || [];
  data.vendors = data.vendors || [];
  if (alignProfileFinancialYear(data)) {
    saveRecords(data, filePath);
  }
  return data;
}

function saveRecords(data, filePath = DEFAULT_FILE) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function newId() {
  return crypto.randomUUID();
}

function addExpense(records, payload) {
  const vendorName = payload.vendor || "";
  const vendorAbn = payload.vendorAbn || payload.abn || "";
  if (vendorName) upsertVendor(records, { name: vendorName, abn: vendorAbn });

  const entry = {
    id: newId(),
    date: payload.date || new Date().toISOString().slice(0, 10),
    category: payload.category,
    amount: Number(payload.amount) || 0,
    description: payload.description || "",
    vendor: vendorName,
    vendorAbn: normaliseAbn(vendorAbn),
    vendorId: payload.vendorId || null,
    workUsePercent: payload.workUsePercent ?? 100,
    reimbursed: Boolean(payload.reimbursed),
    method: payload.method || null,
    kilometres: payload.kilometres || null,
    laundryLoads: payload.laundryLoads || null,
    laundryMixed: payload.laundryMixed || false,
    receiptId: payload.receiptId || null,
    notes: payload.notes || "",
    createdAt: new Date().toISOString(),
  };
  records.expenses.unshift(entry);
  return entry;
}

function addIncome(records, payload) {
  const entry = {
    id: newId(),
    date: payload.date || new Date().toISOString().slice(0, 10),
    type: payload.type || "salary_wages",
    amount: Number(payload.amount) || 0,
    description: payload.description || "",
    payer: payload.payer || payload.entity || "",
    reference: payload.reference || "",
    claimingDeduction: Boolean(payload.claimingDeduction),
    receiptId: payload.receiptId || null,
    // Miniature payslip / remittance summary
    documentKind: payload.documentKind || null, // payslip | remittance | null
    entity: payload.entity || payload.payer || "",
    grossTotal: payload.grossTotal != null ? Number(payload.grossTotal) : Number(payload.amount) || 0,
    taxableIncome:
      payload.taxableIncome != null ? Number(payload.taxableIncome) : Number(payload.amount) || 0,
    gstAmount: payload.gstAmount != null ? Number(payload.gstAmount) : 0,
    netPay: payload.netPay != null ? Number(payload.netPay) : null,
    payPeriod: payload.payPeriod || "",
    summaryNotes: payload.summaryNotes || "",
    createdAt: new Date().toISOString(),
  };
  records.income.unshift(entry);
  return entry;
}

function addReceipt(records, payload) {
  const entry = {
    id: newId(),
    source: payload.source || "scan",
    filename: payload.filename || "receipt.jpg",
    mimeType: payload.mimeType || "image/jpeg",
    imagePath: null,
    dataUrl: null,
    manual: payload.manual || null,
    ocrResult: payload.ocrResult || null,
    linkedExpenseId: payload.linkedExpenseId || null,
    linkedIncomeId: payload.linkedIncomeId || null,
    createdAt: new Date().toISOString(),
  };

  if (payload.dataUrl) {
    entry.imagePath = saveReceiptImage(entry.id, payload.dataUrl);
  }

  records.receipts.unshift(entry);
  return entry;
}

function addManualReceipt(records, payload) {
  const vendorName = payload.vendor || "";
  const vendorAbn = payload.vendorAbn || payload.abn || "";
  const vendor = vendorName ? upsertVendor(records, { name: vendorName, abn: vendorAbn }) : null;

  const receipt = addReceipt(records, {
    source: "manual",
    filename: "manual-entry",
    manual: {
      date: payload.date,
      category: payload.category,
      vendor: vendorName,
      vendorAbn: normaliseAbn(vendorAbn),
      description: payload.description || "",
      amount: Number(payload.amount) || 0,
    },
  });

  const expense = addExpense(records, {
    date: payload.date,
    category: payload.category,
    amount: payload.amount,
    description: payload.description,
    vendor: vendorName,
    vendorAbn,
    vendorId: vendor?.id || payload.vendorId || null,
    workUsePercent: payload.workUsePercent ?? 100,
    reimbursed: payload.reimbursed,
    receiptId: receipt.id,
  });

  receipt.linkedExpenseId = expense.id;
  return { receipt, expense };
}

function updateProfile(records, profile) {
  records.profile = { ...records.profile, ...profile };
  return records.profile;
}

function deleteEntry(records, type, id) {
  const key = type === "expense" ? "expenses" : type === "income" ? "income" : "receipts";
  const before = records[key].length;
  records[key] = records[key].filter((e) => e.id !== id);
  return before !== records[key].length;
}

module.exports = {
  loadRecords,
  saveRecords,
  addExpense,
  addIncome,
  addReceipt,
  addManualReceipt,
  upsertVendor,
  listVendors,
  readReceiptImage,
  getReceiptFileInfo,
  updateProfile,
  deleteEntry,
  DEFAULT_FILE,
};
