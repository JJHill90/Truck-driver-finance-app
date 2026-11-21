/**
 * Hub owner-driver income. Gross stays GST-inclusive. Taxable/assessable
 * income drops the GST when the profile is GST-registered or the invoice
 * shows a GST amount. Salary and allowances are unchanged.
 */
const BUSINESS_TYPES = new Set(["remittance_owner", "business_income", "services_income"]);

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isGstRegistered(profile = {}) {
  const flag = profile.gstRegistered;
  return flag === true || flag === "true" || flag === 1 || flag === "1";
}

function applyHubBusinessIncomeGst(payload = {}, profile = {}) {
  if (!BUSINESS_TYPES.has(payload.type)) return payload;
  const gross = round2(
    payload.grossTotal != null && payload.grossTotal !== ""
      ? payload.grossTotal
      : payload.amount
  );
  const gst = round2(payload.gstAmount != null && payload.gstAmount !== "" ? payload.gstAmount : payload.gst);
  const registered = isGstRegistered(profile);
  if (!(registered || gst > 0) || !(gross > 0)) return payload;
  let taxable;
  if (gst > 0 && gross > gst) taxable = round2(gross - gst);
  else if (registered) taxable = round2(gross - gross / 11);
  else taxable = gross;
  payload.grossTotal = gross;
  payload.taxableIncome = taxable;
  if (!(Number(payload.amount) > 0)) payload.amount = gross;
  return payload;
}

module.exports = {
  BUSINESS_TYPES,
  isGstRegistered,
  applyHubBusinessIncomeGst,
};
