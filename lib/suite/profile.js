/**
 * Taxpayer registration types for Go Taxation Suite.
 * Stored on `profile.entityType` and also in `profile.driverType` so the
 * verbatim app.js #driver-type select continues to work.
 */

const ENTITY_TYPES = {
  employee: {
    label: "Employee (PAYG)",
    description: "Salary or wages from an employer under pay-as-you-go withholding.",
    annualSalary: 75000,
    notes: "Work-related deductions (D1–D5), home office, donations and tax-agent fees. Super Guarantee is paid by the employer.",
  },
  sole_trader: {
    label: "Sole trader",
    description: "You run a business in your own name or ABN — profit is taxed at individual rates.",
    annualSalary: 85000,
    notes: "Business income minus business expenses, plus any PAYG salary. GST/BAS if registered. Instant asset write-off may apply.",
  },
  partnership: {
    label: "Partnership",
    description: "You report your share of partnership net income on your individual return.",
    annualSalary: 85000,
    notes: "The partnership is not taxed itself. Record your distribution share, partner salary, and partner-level deductions.",
  },
};

const OCCUPATIONS = [
  { name: "Office / administration", keywords: ["admin", "office", "clerk", "receptionist"] },
  { name: "Retail / hospitality", keywords: ["retail", "shop", "cafe", "restaurant", "hospitality"] },
  { name: "Healthcare", keywords: ["nurse", "health", "medical", "carer", "allied"] },
  { name: "Education", keywords: ["teacher", "tutor", "education", "school"] },
  { name: "Construction / trades", keywords: ["builder", "trade", "electrician", "plumber", "carpenter"] },
  { name: "Professional services", keywords: ["accountant", "lawyer", "consultant", "advisor"] },
  { name: "IT / software", keywords: ["developer", "it", "software", "engineer", "tech"] },
  { name: "Sales / marketing", keywords: ["sales", "marketing", "account manager"] },
  { name: "Public service", keywords: ["aps", "government", "public servant", "council"] },
  { name: "Self-employed professional", keywords: ["freelance", "contractor", "consultant"] },
];

function normalizeEntityType(id) {
  const key = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "soletrader" || key === "sole_trader" || key === "own_business") return "sole_trader";
  if (key === "partner" || key === "partnership") return "partnership";
  if (key === "employee" || key === "payg" || key === "salary") return "employee";
  // Never keep trucking driver types on a Suite profile.
  if (["local", "short_haul", "long_haul", "owner_driver"].includes(key)) return "employee";
  return ENTITY_TYPES[key] ? key : "employee";
}

function presentEntityTypes() {
  const out = {};
  for (const [id, meta] of Object.entries(ENTITY_TYPES)) {
    out[id] = { ...meta };
  }
  return out;
}

function listEntityDefaults() {
  return Object.entries(ENTITY_TYPES).map(([id, meta]) => ({
    id,
    label: meta.label,
    description: meta.description,
    annualSalary: meta.annualSalary,
    notes: meta.notes,
  }));
}

function getEntityDefaults(id) {
  const entityType = normalizeEntityType(id);
  const meta = ENTITY_TYPES[entityType];
  return {
    driverType: entityType,
    entityType,
    annualSalary: meta.annualSalary,
    label: meta.label,
    notes: meta.notes,
  };
}

function searchOccupations(query, { limit = 12 } = {}) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const rows = OCCUPATIONS.map((o) => o.name);
  if (!q) return rows.slice(0, limit);
  return rows
    .filter((name) => {
      const n = name.toLowerCase();
      if (n.includes(q)) return true;
      const occ = OCCUPATIONS.find((o) => o.name === name);
      return (occ.keywords || []).some((k) => k.includes(q) || q.includes(k));
    })
    .slice(0, limit);
}

function ensureProfile(profile = {}) {
  const entityType = normalizeEntityType(profile.entityType || profile.driverType);
  const next = { ...profile };
  next.entityType = entityType;
  next.driverType = entityType;
  if (next.vehicleType === "truck" || !next.vehicleType) next.vehicleType = "car";
  if (next.gstRegistered == null) next.gstRegistered = false;
  if (next.partnerSharePercent == null || next.partnerSharePercent === "") {
    next.partnerSharePercent = 100;
  }
  next.occupation = String(next.occupation || "").trim();
  next.partnershipName = String(next.partnershipName || "").trim();
  next.tradingName = String(next.tradingName || "").trim();
  if (["local", "short_haul", "long_haul", "owner_driver"].includes(String(profile.driverType || ""))) {
    next.licenceClass = "";
    next.workCombination = "";
  }
  return next;
}

function applySuiteProfile(body, existing = {}) {
  const next = { ...(existing || {}), ...(body || {}) };
  const entityType = normalizeEntityType(next.entityType || next.driverType);
  next.entityType = entityType;
  next.driverType = entityType;
  next.gstRegistered =
    next.gstRegistered === true ||
    next.gstRegistered === "on" ||
    next.gstRegistered === "true" ||
    next.gstRegistered === 1 ||
    next.gstRegistered === "1";
  if (next.partnerSharePercent != null && next.partnerSharePercent !== "") {
    const n = Number(next.partnerSharePercent);
    next.partnerSharePercent = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
  }
  next.occupation = String(next.occupation || "").trim();
  next.partnershipName = String(next.partnershipName || "").trim();
  next.tradingName = String(next.tradingName || next.employer || "").trim();
  next.abn = String(next.abn || "").replace(/\s/g, "");
  delete next.licenceClass;
  delete next.workCombination;
  delete next.fuelVehicles;
  delete next.salaryBand;
  return ensureProfile(next);
}

function emptyGuestRecords(financialYear) {
  return {
    profile: ensureProfile({
      name: "",
      employer: "",
      abn: "",
      occupation: "",
      entityType: "employee",
      driverType: "employee",
      annualSalary: 75000,
      financialYear: financialYear || "",
      vehicleType: "car",
      tfnSupplied: false,
      gstRegistered: false,
      partnershipName: "",
      partnerSharePercent: 100,
    }),
    vendors: [],
    expenses: [],
    income: [],
    receipts: [],
  };
}

module.exports = {
  ENTITY_TYPES,
  OCCUPATIONS,
  normalizeEntityType,
  presentEntityTypes,
  listEntityDefaults,
  getEntityDefaults,
  searchOccupations,
  ensureProfile,
  applySuiteProfile,
  emptyGuestRecords,
};
