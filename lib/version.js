/**
 * App display version derived from merged GitHub PR count.
 *
 * Rules (as product convention):
 * - PR 1–49  → "Version .1" … "Version .49"
 * - PR 50    → "Version 1.0"
 * - PR 51–99 → "Version .1" … "Version .49" again
 * - PR 100   → "Version 2.0"
 * - and so on every 50 PRs.
 *
 * Bump HAULAGE_PR_NUMBER when opening the next PR so the footer stays in sync.
 */
const HAULAGE_PR_NUMBER = 83;

function formatVersionLabel(prNumber = HAULAGE_PR_NUMBER) {
  const n = Math.max(0, Math.floor(Number(prNumber) || 0));
  if (n <= 0) return "Version .0";
  const pos = ((n - 1) % 50) + 1; // 1..50 within the current cycle
  if (pos === 50) {
    const major = Math.floor(n / 50);
    return `Version ${major}.0`;
  }
  return `Version .${pos}`;
}

module.exports = {
  HAULAGE_PR_NUMBER,
  formatVersionLabel,
};
