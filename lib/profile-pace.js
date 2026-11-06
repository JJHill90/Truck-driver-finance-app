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

function givenName(profile = {}) {
  const parts = String(profile.name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] || "";
}

const LICENCE_LABELS = {
  lr_mr: "LR/MR",
  hr: "HR",
  hc: "HC",
  mc: "MC",
};

const VEHICLE_LABELS = {
  rigid: "heavy rigid",
  semi: "prime mover and semi",
  b_double: "B-double",
  b_triple: "B-triple",
  road_train_t1: "Type 1 road train",
  road_train_t2: "Type 2 road train",
};

function aud(n) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);
}

function formatAbn(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return String(value || "").trim();
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

/**
 * Short introduction built from the profile fields the person is editing.
 * Driver Hub mentions licence and work vehicle. Suite mentions occupation,
 * GST, travel and partnership share.
 */
function profilePortrait(profile = {}, opts = {}) {
  const suite = Boolean(opts && opts.suite);
  const given = givenName(profile);
  const situation = situationLabel(profile);
  const employer = String(profile.employer || profile.tradingName || "").trim();
  const occupation = String(profile.occupation || "").trim();
  const salary = round2(profile.annualSalary);
  const paragraphs = [];

  if (situation && employer) paragraphs.push(`${situation} at ${employer}.`);
  else if (situation) paragraphs.push(`${situation}.`);
  else if (employer) paragraphs.push(`Working with ${employer}.`);

  if (suite && occupation) paragraphs.push(`Occupation is ${occupation}.`);

  const facts = [];
  if (!suite) {
    const licence = LICENCE_LABELS[String(profile.licenceClass || "").toLowerCase()];
    const vehicle = VEHICLE_LABELS[String(profile.workCombination || "").toLowerCase()];
    if (licence && vehicle) facts.push(`${licence} licence, ${vehicle}.`);
    else if (licence) facts.push(`${licence} licence.`);
    else if (vehicle) facts.push(`${vehicle.charAt(0).toUpperCase()}${vehicle.slice(1)}.`);
  }
  if (salary > 0) {
    facts.push(`This year is measured against ${aud(salary)} ${targetLabel(profile).toLowerCase()}.`);
  }
  if (facts.length) paragraphs.push(facts.join(" "));

  if (suite && String(profile.entityType || profile.driverType || "") === "partnership") {
    const share = Number(profile.partnerSharePercent);
    const partnership = String(profile.partnershipName || "").trim();
    if (Number.isFinite(share) && share > 0) {
      paragraphs.push(
        partnership
          ? `Your share is ${share}% of ${partnership}.`
          : `Your share is ${share}%.`
      );
    } else if (partnership) {
      paragraphs.push(`Partnership is ${partnership}.`);
    }
  }

  const extras = [];
  if (suite && (profile.gstRegistered === true || profile.gstRegistered === "true" || profile.gstRegistered === "on")) {
    extras.push("GST registered");
  }
  const abn = formatAbn(profile.abn);
  if (suite && abn) extras.push(`ABN ${abn}`);
  if (extras.length) paragraphs.push(`${extras.join(". ")}.`);

  if (profile.travelsForWork === true || profile.travelsForWork === "true" || profile.travelsForWork === "on") {
    const overnight =
      profile.overnightAllowance === true ||
      profile.overnightAllowance === "true" ||
      profile.overnightAllowance === "on";
    paragraphs.push(
      overnight
        ? "Travel for work includes overnight stays."
        : "Travel for work is on."
    );
  }
  if (profile.tfnSupplied === true || profile.tfnSupplied === "true" || profile.tfnSupplied === "on") {
    paragraphs.push("TFN is marked as supplied.");
  }

  if (!paragraphs.length) {
    paragraphs.push(
      suite
        ? "Add your name, registration and expected income. Dashboard and Forecast then follow your year."
        : "Add your name, employer and salary. Dashboard and Forecast then follow your year."
    );
  }

  return {
    heading: given ? `${given}, this profile is yours.` : "This profile is yours.",
    givenName: given,
    paragraphs,
  };
}

function truthyFlag(value) {
  return value === true || value === "true" || value === "on" || value === 1 || value === "1";
}

/**
 * One green confirmation per saved profile field. Shown under that field
 * after the value is stored, so each choice reads as active on its own.
 */
function profileFieldConfirmations(profile = {}, opts = {}) {
  const suite = Boolean(opts && opts.suite);
  const lines = [];
  const add = (key, choice) => {
    const text = String(choice || "").trim();
    if (!text) return;
    lines.push({ key, text: `${text} is active on your profile.` });
  };
  add("name", profile.name);
  add("driverType", situationLabel(profile));
  add("employer", profile.employer || profile.tradingName);
  if (suite) add("occupation", profile.occupation);
  const salary = round2(profile.annualSalary);
  if (salary > 0) add("annualSalary", `${aud(salary)} ${targetLabel(profile).toLowerCase()}`);
  if (!suite) {
    const licence = LICENCE_LABELS[String(profile.licenceClass || "").toLowerCase()];
    if (licence) add("licenceClass", `${licence} licence`);
    const vehicle = VEHICLE_LABELS[String(profile.workCombination || "").toLowerCase()];
    if (vehicle) add("workCombination", `${vehicle.charAt(0).toUpperCase()}${vehicle.slice(1)}`);
  }
  if (suite) {
    const abn = formatAbn(profile.abn);
    if (abn) add("abn", `ABN ${abn}`);
    if (String(profile.entityType || profile.driverType || "") === "partnership") {
      add("partnershipName", profile.partnershipName);
      const share = Number(profile.partnerSharePercent);
      if (Number.isFinite(share) && share > 0) add("partnerShare", `${share}% partnership share`);
    }
    if (truthyFlag(profile.gstRegistered)) add("gstRegistered", "GST registered");
    if (truthyFlag(profile.travelsForWork)) add("travelsForWork", "Travel for work");
    if (truthyFlag(profile.travelsForWork) && truthyFlag(profile.overnightAllowance)) {
      add("overnightAllowance", "Overnight travel allowance");
    }
  }
  const fy = String(profile.financialYear || "").trim();
  if (fy) add("financialYear", `Financial year ${fy}`);
  if (truthyFlag(profile.tfnSupplied)) add("tfnSupplied", "TFN supplied");
  return lines;
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
  const name = givenName(profile);
  return {
    situation,
    employer,
    name,
    who: [name, situation, employer].filter(Boolean).join(" · "),
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

module.exports = {
  profilePace,
  profilePortrait,
  profileFieldConfirmations,
  situationLabel,
  targetLabel,
  givenName,
};
