/**
 * Mon–Sun week slots for an Australian financial year (1 Jul – 30 Jun).
 * Used so expense ledger / gallery week dropdowns list every week that has
 * already started, even when no receipt was saved that week.
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function toIsoLocal(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function weekStartMonday(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return null;
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return toIsoLocal(dt);
}

function weekEndSunday(startIso) {
  const m = String(startIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  dt.setDate(dt.getDate() + 6);
  return toIsoLocal(dt);
}

function fyForDate(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function addDaysIso(iso, days) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  dt.setDate(dt.getDate() + days);
  return toIsoLocal(dt);
}

/**
 * Weeks that have already started in `fy`, newest last in the raw walk
 * (callers sort). Future FYs return [] unless today overlaps the first week.
 */
function weeksElapsedInFinancialYear(fy, now = new Date()) {
  const startYear = Number(String(fy || "").slice(0, 4));
  if (!Number.isFinite(startYear) || startYear < 2000) return [];
  const fyStart = `${startYear}-07-01`;
  const fyEnd = `${startYear + 1}-06-30`;
  const todayDt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(todayDt.getTime())) return [];
  const today = toIsoLocal(todayDt);
  const currentStart = weekStartMonday(today);
  const first = weekStartMonday(fyStart);
  const lastOfFy = weekStartMonday(fyEnd);
  if (!first || !lastOfFy) return [];

  if (today < fyStart) {
    const overlaps =
      currentStart &&
      (fyForDate(currentStart) === fy || fyForDate(weekEndSunday(currentStart)) === fy);
    return overlaps ? [{ start: currentStart, end: weekEndSunday(currentStart) }] : [];
  }

  const last = today > fyEnd ? lastOfFy : currentStart;
  const out = [];
  let cursor = first;
  while (cursor && last && cursor <= last) {
    out.push({ start: cursor, end: weekEndSunday(cursor) });
    cursor = addDaysIso(cursor, 7);
  }
  return out;
}

module.exports = {
  pad2,
  toIsoLocal,
  weekStartMonday,
  weekEndSunday,
  fyForDate,
  addDaysIso,
  weeksElapsedInFinancialYear,
};
