/**
 * Extra taxpayer entity on one Go Taxation Suite login (Pro+).
 * Typical use: employee PAYG plus a side sole trader.
 */
const crypto = require("crypto");
const { normalizeEntityType } = require("./profile");

const PRIMARY_ID = "primary";
const MAX_EXTRA_ENTITIES = 1;

function truthyFlag(value) {
  return value === true || value === "true" || value === "on" || value === 1 || value === "1";
}

function newEntityId() {
  return `ent_${crypto.randomBytes(6).toString("hex")}`;
}

function extraEntityType(id) {
  const entity = normalizeEntityType(id);
  return entity === "partnership" ? "sole_trader" : entity;
}

function normalizeExtraEntity(raw = {}) {
  const existingId = String(raw.id || "").trim();
  const entityType = extraEntityType(raw.entityType || raw.driverType || "sole_trader");
  const annual = Number(raw.annualSalary);
  return {
    id: existingId || newEntityId(),
    entityType,
    tradingName: String(raw.tradingName || raw.employer || "").trim(),
    abn: String(raw.abn || "").replace(/\s/g, ""),
    gstRegistered: truthyFlag(raw.gstRegistered),
    occupation: String(raw.occupation || "").trim(),
    annualSalary: Number.isFinite(annual) && annual >= 0 ? annual : 0,
    notes: String(raw.notes || "").trim(),
  };
}

function normalizeExtraEntities(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list.slice(0, MAX_EXTRA_ENTITIES)) {
    const next = normalizeExtraEntity(raw);
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  return out;
}

function findExtraEntity(profile, id) {
  const key = String(id || "").trim();
  if (!key || key === PRIMARY_ID) return null;
  return (normalizeExtraEntities((profile && profile.extraEntities) || [])).find((e) => e.id === key) || null;
}

function activeEntityId(profile) {
  const id = String((profile && profile.activeEntityId) || PRIMARY_ID).trim() || PRIMARY_ID;
  if (id === PRIMARY_ID) return PRIMARY_ID;
  return findExtraEntity(profile, id) ? id : PRIMARY_ID;
}

function ensureExtraEntities(profile = {}) {
  const next = profile;
  next.extraEntities = normalizeExtraEntities(next.extraEntities);
  next.activeEntityId = activeEntityId(next);
  return next;
}

function applyExtraEntities(profile, extras, { replace = false } = {}) {
  const next = profile || {};
  if (replace || extras != null) {
    next.extraEntities = normalizeExtraEntities(extras);
  }
  return ensureExtraEntities(next);
}

function profileForActiveEntity(profile = {}) {
  const id = activeEntityId(profile);
  if (id === PRIMARY_ID) return { ...profile, activeEntityId: PRIMARY_ID };
  const extra = findExtraEntity(profile, id);
  if (!extra) return { ...profile, activeEntityId: PRIMARY_ID };
  return {
    ...profile,
    activeEntityId: extra.id,
    entityType: extra.entityType,
    driverType: extra.entityType,
    employer: extra.tradingName || profile.employer,
    tradingName: extra.tradingName,
    abn: extra.abn || profile.abn,
    gstRegistered: extra.gstRegistered,
    occupation: extra.occupation || profile.occupation,
    annualSalary: extra.annualSalary || profile.annualSalary,
  };
}

function entryMatchesEntity(entry, entityId) {
  const id = String(entityId || PRIMARY_ID);
  const rowId = String((entry && entry.entityId) || PRIMARY_ID);
  if (id === PRIMARY_ID) return rowId === PRIMARY_ID || !entry.entityId;
  return rowId === id;
}

function stampActiveEntity(records, body) {
  if (!body) return body;
  const profile = (records && records.profile) || {};
  const id = activeEntityId(profile);
  if (!body.entityId) body.entityId = id;
  return body;
}

function scopeRecords(records) {
  if (!records) return records;
  const profile = profileForActiveEntity(records.profile || {});
  const id = activeEntityId(profile);
  return {
    ...records,
    profile,
    expenses: (records.expenses || []).filter((e) => entryMatchesEntity(e, id)),
    income: (records.income || []).filter((e) => entryMatchesEntity(e, id)),
  };
}

module.exports = {
  PRIMARY_ID,
  MAX_EXTRA_ENTITIES,
  extraEntityType,
  normalizeExtraEntity,
  normalizeExtraEntities,
  findExtraEntity,
  activeEntityId,
  ensureExtraEntities,
  applyExtraEntities,
  profileForActiveEntity,
  entryMatchesEntity,
  stampActiveEntity,
  scopeRecords,
};
