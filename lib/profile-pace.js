/**
 * How close recorded income is to the annual salary / expected income
 * stored on the profile. Shared by Driver Hub and Go Taxation Suite.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function situationLabel(profile = {}) {
  const entity = String(profile.entityType || profile.driverType || "")
    .trim()
    .toLowerCase();
  const labels = {
    sole_trader: "Sole trader",
    partnership: "Partnership",
    employee: "Employee (PAYG)",
    owner_driver: "Owner-driver",
    long_haul: "Linehaul driver",
    short_haul: "Short-haul driver",
    local: "Local driver",
  };
  if (labels[entity]) return labels[entity];
  if (!entity) return "";
  return entity.replace(/_/g, " ");
}

function targetLabel(profile = {}) {
  const entity = String(profile.entityType || profile.driverType || "")
    .trim()
    .toLowerCase();
  if (entity === "sole_trader" || entity === "partnership" || entity === "owner_driver") {
    return "Expected income";
  }
  return "Annual salary";
}

/**
 * @param {object} profile
 * @param {number} actualIncome recorded assessable income for the year
 */
function profilePace(profile = {}, actualIncome = 0) {
  const target = round2(profile.annualSalary);
  const actual = round2(actualIncome);
  const hasTarget = target > 0;
  const percent = hasTarget ? round2((actual / target) * 100) : null;
  const remaining = hasTarget ? round2(Math.max(0, target - actual)) : null;
  const overBy = hasTarget && actual > target ? round2(actual - target) : 0;
  const employer = String(profile.employer || profile.tradingName || "").trim();
  const situation = situationLabel(profile);
  return {
    situation,
    employer,
    who: [situation, employer].filter(Boolean).join(" · "),
    targetLabel: targetLabel(profile),
    target,
    actual,
    remaining,
    overBy,
    percent,
    barPercent: hasTarget ? Math.min(100, Math.max(0, percent || 0)) : 0,
    hasTarget,
    ahead: overBy > 0,
  };
}

module.exports = { profilePace, situationLabel, targetLabel };
