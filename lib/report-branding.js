/**
 * Layer branding / display fixes over the verbatim accountant report builder
 * (lib/tax-calculator.js) without editing that file.
 */
const { driverTypeLabel } = require("./driver-role-defaults");

const EOFY_REPORT_TITLE = "Linehaul Driver – Performance & Tax Summary";

/**
 * Normalize EOFY report title + driver type display for Taxation Hub /
 * Fuel Hub (and PDF working papers that read report.driver).
 */
function decorateAccountantReport(report) {
  if (!report || typeof report !== "object") return report;
  report.title = EOFY_REPORT_TITLE;
  if (report.driver) {
    const id = report.driver.driverType || "long_haul";
    report.driver.driverType = id;
    report.driver.driverTypeLabel = driverTypeLabel(id);
  }
  return report;
}

module.exports = {
  EOFY_REPORT_TITLE,
  decorateAccountantReport,
};
