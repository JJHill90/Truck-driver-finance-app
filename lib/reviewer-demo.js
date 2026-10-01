/**
 * Optional Play / App Store reviewer account.
 *
 * Set SUITE_REVIEWER_USERNAME + SUITE_REVIEWER_PASSWORD on the Suite host
 * (never commit the password). On boot this creates a non-admin profile with
 * complimentary Pro+ and a small sample PAYG ledger so reviewers can sign in
 * without using the primary mod.
 *
 * Idempotent: existing username is left alone (password not reset). Sample
 * records are written only when the Suite ledger file is missing.
 */
const fs = require("fs");
const auth = require("./auth");
const suite = require("./suite");
const { writeJsonAtomic } = require("./atomic-write");

function envTrim(name) {
  return String(process.env[name] || "").trim();
}

function reviewerConfig() {
  return {
    username: envTrim("SUITE_REVIEWER_USERNAME"),
    password: envTrim("SUITE_REVIEWER_PASSWORD"),
    email: envTrim("SUITE_REVIEWER_EMAIL") || "support+reviewer@godriverhub.com",
  };
}

function sampleRecords() {
  const profile = suite.ensureProfile({
    name: "Alex Chen",
    employer: "Metro Health",
    occupation: "Registered nurse",
    occupationId: "",
    entityType: "employee",
    driverType: "employee",
    annualSalary: 82000,
    financialYear: "2025-26",
    vehicleType: "car",
    tfnSupplied: true,
    gstRegistered: false,
  });
  return {
    profile,
    vendors: [],
    expenses: [
      {
        id: "review-e-union",
        date: "2025-08-12",
        category: "union_fees",
        description: "ANMF membership",
        amount: 68.4,
        workUsePercent: 100,
      },
      {
        id: "review-e-office",
        date: "2025-09-03",
        category: "home_office_hours",
        description: "Home office hours",
        hours: 18,
        amount: 0,
        workUsePercent: 100,
      },
      {
        id: "review-e-gift",
        date: "2025-09-18",
        category: "donations_dgr",
        description: "DGR donation",
        amount: 50,
        workUsePercent: 100,
      },
    ],
    income: [
      {
        id: "review-i-1",
        date: "2025-08-14",
        type: "salary_wages",
        description: "Metro Health, pay period 07/08/2025 to 13/08/2025",
        amount: 1580,
        taxWithheld: 280,
      },
      {
        id: "review-i-2",
        date: "2025-08-28",
        type: "salary_wages",
        description: "Metro Health, pay period 21/08/2025 to 27/08/2025",
        amount: 1610,
        taxWithheld: 290,
      },
    ],
    receipts: [],
  };
}

function seedSuiteLedger(username) {
  const dest = suite.recordsFileFor(username);
  if (fs.existsSync(dest)) return { seeded: false, file: dest };
  writeJsonAtomic(dest, sampleRecords());
  return { seeded: true, file: dest };
}

/**
 * @returns {{
 *   ready: boolean,
 *   created?: boolean,
 *   seeded?: boolean,
 *   username?: string,
 *   reason?: string,
 *   error?: string
 * }}
 */
function ensureReviewerDemo() {
  const { username, password, email } = reviewerConfig();
  if (!username || !password) {
    return { ready: false, reason: "unset" };
  }

  const adminName = auth.envAdminUsername();
  if (adminName && auth.usernameKey(username) === auth.usernameKey(adminName)) {
    return { ready: false, reason: "reserved-admin" };
  }

  try {
    // Reviewer must not become the first/only account — that user is promoted
    // to primary mod, and Pro+ grants are refused for admins.
    auth.ensureAdminBootstrap();

    let created = false;
    let user = auth.getUser(username);
    if (!user) {
      user = auth.createUser(username, password, {}, email);
      auth.setPlanGrant(username, "pro_plus", { by: "reviewer-demo" });
      user = auth.getUser(username);
      created = true;
    }
    const { seeded } = seedSuiteLedger(user.username);
    return {
      ready: true,
      created,
      seeded,
      username: user.username,
    };
  } catch (err) {
    return {
      ready: false,
      reason: "error",
      error: err && err.message ? err.message : String(err),
    };
  }
}

module.exports = {
  reviewerConfig,
  sampleRecords,
  seedSuiteLedger,
  ensureReviewerDemo,
};
