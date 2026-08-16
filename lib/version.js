/**
 * App display version derived from merged GitHub PR count.
 *
 * Ladder:
 * - PR 1–50  → "Version .1" … "Version .50"
 * - Next     → "Version 1.00"
 * - Then     → "Version 1.01" … "Version 1.50"
 * - Next     → "Version 2.00"
 * - Then     → "Version 2.01" … "Version 2.50" → "Version 3.00" …
 *
 * After the initial .1–.50 band, each major uses minors .00–.50 (51 steps),
 * then rounds up to the next whole number (N.50 → (N+1).00).
 *
 * Bump HAULAGE_PR_NUMBER when opening the next PR so the footer stays in sync.
 */
const HAULAGE_PR_NUMBER = 93;

/** Minors per major after 1.00 (inclusive .00 through .50). */
const MINORS_PER_MAJOR = 51;

function formatVersionLabel(prNumber = HAULAGE_PR_NUMBER) {
  const n = Math.max(0, Math.floor(Number(prNumber) || 0));
  if (n <= 0) return "Version .0";

  // Pre-1.00 band: .1 … .50
  if (n <= 50) return `Version .${n}`;

  // PR 51 → 1.00, PR 52 → 1.01, … PR 101 → 1.50, PR 102 → 2.00, …
  const remaining = n - 50;
  const major = Math.ceil(remaining / MINORS_PER_MAJOR);
  const minor = (remaining - 1) % MINORS_PER_MAJOR; // 0..50
  return `Version ${major}.${String(minor).padStart(2, "0")}`;
}

module.exports = {
  HAULAGE_PR_NUMBER,
  MINORS_PER_MAJOR,
  formatVersionLabel,
};
