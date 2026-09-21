/**
 * Partnership second seat — the other partner logs in to the same Suite ledger.
 */
const { normalizeEntityType } = require("./profile");

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function ownerOf(user) {
  if (!user) return null;
  const owner = String(user.partnershipOwner || "").trim();
  return owner || null;
}

function resolveLedgerUsername(username, getUserRecord) {
  const key = String(username || "").trim();
  if (!key) return key;
  if (typeof getUserRecord !== "function") return key;
  const user = getUserRecord(key);
  const owner = ownerOf(user);
  if (!owner) return key;
  const ownerUser = getUserRecord(owner);
  return ownerUser ? owner : key;
}

function presentSeat(profile, ownerUsername) {
  const seat = (profile && profile.partnerSeat) || null;
  if (!seat || !seat.username) {
    return { owner: ownerUsername || null, partner: null, invitedAt: null, acceptedAt: null };
  }
  return {
    owner: ownerUsername || null,
    partner: seat.username,
    invitedAt: seat.invitedAt || null,
    acceptedAt: seat.acceptedAt || null,
  };
}

function invitePartner({ ownerUsername, partnerUsername, ownerRecords, getUserRecord, saveUser }) {
  const ownerKey = String(ownerUsername || "").trim();
  const partnerKey = String(partnerUsername || "").trim();
  if (!ownerKey) {
    const err = new Error("Sign in to invite a partner.");
    err.code = "AUTH_REQUIRED";
    throw err;
  }
  if (!partnerKey) {
    const err = new Error("Enter the other partner’s username.");
    err.code = "USERNAME_REQUIRED";
    throw err;
  }
  if (normalizeUsername(ownerKey) === normalizeUsername(partnerKey)) {
    const err = new Error("You cannot invite your own login as the second seat.");
    err.code = "SELF_SEAT";
    throw err;
  }
  const profile = (ownerRecords && ownerRecords.profile) || {};
  if (normalizeEntityType(profile.entityType || profile.driverType) !== "partnership") {
    const err = new Error("Set registration type to Partnership before inviting a partner.");
    err.code = "NOT_PARTNERSHIP";
    throw err;
  }
  const partner = getUserRecord(partnerKey);
  if (!partner) {
    const err = new Error("No profile exists for that username — they need to create a login first.");
    err.code = "USER_NOT_FOUND";
    throw err;
  }
  if (partner.isAdmin) {
    const err = new Error("The primary mod cannot be seated as a partner.");
    err.code = "ADMIN_SEAT";
    throw err;
  }
  const existingOwner = ownerOf(partner);
  if (existingOwner && normalizeUsername(existingOwner) !== normalizeUsername(ownerKey)) {
    const err = new Error("That login is already seated on another partnership.");
    err.code = "SEAT_TAKEN";
    throw err;
  }
  const now = new Date().toISOString();
  partner.partnershipOwner = ownerKey;
  partner.partnershipSeatAt = now;
  if (typeof saveUser === "function") saveUser(partner);

  ownerRecords.profile = ownerRecords.profile || {};
  ownerRecords.profile.partnerSeat = {
    username: partner.username,
    invitedAt: (ownerRecords.profile.partnerSeat && ownerRecords.profile.partnerSeat.invitedAt) || now,
    acceptedAt: now,
  };
  return presentSeat(ownerRecords.profile, ownerKey);
}

function revokePartner({ ownerUsername, ownerRecords, getUserRecord, saveUser }) {
  const ownerKey = String(ownerUsername || "").trim();
  const seat = ownerRecords && ownerRecords.profile && ownerRecords.profile.partnerSeat;
  const partnerName = seat && seat.username;
  if (partnerName) {
    const partner = getUserRecord(partnerName);
    if (partner && normalizeUsername(ownerOf(partner)) === normalizeUsername(ownerKey)) {
      partner.partnershipOwner = null;
      partner.partnershipSeatAt = null;
      if (typeof saveUser === "function") saveUser(partner);
    }
  }
  if (ownerRecords && ownerRecords.profile) ownerRecords.profile.partnerSeat = null;
  return presentSeat(ownerRecords && ownerRecords.profile, ownerKey);
}

module.exports = {
  ownerOf,
  resolveLedgerUsername,
  presentSeat,
  invitePartner,
  revokePartner,
};
