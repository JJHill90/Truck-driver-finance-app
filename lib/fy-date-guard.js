/**
 * Flag a document date that falls outside the financial year the user has selected.
 * Does not rewrite the date. Confirm must send acknowledgeOutsideFy to keep it.
 */

const { getFinancialYearForDate } = require("./ato-standards");

function assessDocumentFy(dateIso, selectedFy) {
  const selected = String(selectedFy || "").trim();
  const date = String(dateIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !selected) {
    return { outside: false, documentFy: null, selectedFy: selected || null, warning: "" };
  }
  let documentFy = null;
  try {
    documentFy = getFinancialYearForDate(date);
  } catch {
    documentFy = null;
  }
  const outside = Boolean(documentFy && documentFy !== selected);
  return {
    outside,
    documentFy,
    selectedFy: selected,
    warning: outside
      ? `This date is in FY ${documentFy}, outside the selected FY ${selected}.`
      : "",
  };
}

/**
 * Quick approve and the gallery modal both require an explicit tick when the
 * document date is outside the selected financial year. A warning alone is
 * not acknowledgement.
 */
function outsideFySaveAllowed({ outside, acknowledged }) {
  if (!outside) return true;
  return acknowledged === true;
}

function stampFyWarning(target, selectedFy) {
  if (!target || typeof target !== "object") return target;
  const fy = assessDocumentFy(target.date, selectedFy);
  target.dateOutsideSelectedFy = fy.outside;
  target.documentFinancialYear = fy.documentFy;
  target.selectedFinancialYear = fy.selectedFy;
  if (fy.warning) target.fyWarning = fy.warning;
  else delete target.fyWarning;
  return target;
}

module.exports = {
  assessDocumentFy,
  stampFyWarning,
  outsideFySaveAllowed,
};
