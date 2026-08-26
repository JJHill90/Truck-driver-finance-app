const {
  isEmail,
  guessLitres,
  upsertContact,
  removeContact,
  createFromScan,
  confirmDetails,
  nominate,
  remainingMs,
  assertSendable,
  markSent,
  cancelReceipt,
  removeReceipt,
  buildReport,
  CONFIRM_MS,
  fieldsFromOcr,
} = require("./lib/fuel-receipts");

describe("fuel receipts", () => {
  function store() {
    return { employerContacts: [], fuelReceipts: [] };
  }

  it("validates contact emails and upserts by address", () => {
    expect(isEmail("pay@fleet.example")).toBe(true);
    expect(isEmail("not-an-email")).toBe(false);
    const s = store();
    const a = upsertContact(s, { name: "Pay desk", email: "pay@fleet.example", company: "Betts" });
    const b = upsertContact(s, { name: "Accounts", email: "PAY@fleet.example" });
    expect(b.id).toBe(a.id);
    expect(s.employerContacts).toHaveLength(1);
    expect(s.employerContacts[0].name).toBe("Accounts");
    expect(s.employerContacts[0].company).toBe("Betts");
    expect(removeContact(s, a.id)).toBe(true);
    expect(s.employerContacts).toHaveLength(0);
  });

  it("guesses litres from OCR text and maps scan fields", () => {
    expect(guessLitres({ rawText: "DIESEL  142.50 L  TOTAL $312.10" })).toBe(142.5);
    const fields = fieldsFromOcr({
      vendor: "BP Archerfield",
      entity: "BP Archerfield",
      date: "2026-08-20",
      amount: 312.1,
      rawText: "142.50 L diesel",
    });
    expect(fields.vendor).toBe("BP Archerfield");
    expect(fields.litres).toBe(142.5);
    expect(fields.amount).toBe(312.1);
  });

  it("walks scan → confirm → nominate with a 30s send window", () => {
    const s = store();
    const row = createFromScan(s, {
      ocr: { vendor: "Ampol", date: "2026-08-21", amount: 88, rawText: "40 L" },
      filename: "docket.jpg",
    });
    expect(row.status).toBe("scanned");
    expect(row.litres).toBe(40);

    const confirmed = confirmDetails(s, row.id, {
      vendor: "Ampol Emerald",
      date: "2026-08-21",
      amount: 90.5,
      litres: 41,
      site: "Emerald",
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.amount).toBe(90.5);

    const now = new Date("2026-08-25T10:00:00.000Z");
    const nominated = nominate(
      s,
      row.id,
      { name: "Fleet pay", email: "fuel@employer.test", company: "Betts Transport" },
      { now }
    );
    expect(nominated.receipt.status).toBe("awaiting_send");
    expect(nominated.receipt.contactEmail).toBe("fuel@employer.test");
    expect(nominated.receipt.sendAfter).toBe("2026-08-25T10:00:30.000Z");
    expect(remainingMs(nominated.receipt, { now })).toBe(CONFIRM_MS);

    expect(() => assertSendable(nominated.receipt, { now })).toThrow(/Confirmation period/);
    assertSendable(nominated.receipt, { now, force: true });
    assertSendable(nominated.receipt, { now: new Date("2026-08-25T10:00:31.000Z") });

    const sent = markSent(s, row.id, { sent: true, channel: "smtp" });
    expect(sent.status).toBe("sent");
    expect(sent.mail.channel).toBe("smtp");
  });

  it("cancels before send and builds an employer report", () => {
    const s = store();
    const row = createFromScan(s, { ocr: { vendor: "Shell", amount: 50 } });
    confirmDetails(s, row.id, { vendor: "Shell", amount: 50 });
    nominate(s, row.id, { email: "ops@fleet.test", name: "Ops" });
    cancelReceipt(s, row.id);
    expect(s.fuelReceipts[0].status).toBe("cancelled");
    expect(() => assertSendable(s.fuelReceipts[0], { force: true })).toThrow(/cancelled/);

    const report = buildReport({
      receipt: { vendor: "Shell Barcaldine", date: "2026-08-22", amount: 210, litres: 95, site: "Barcaldine" },
      contact: { name: "Pay", email: "pay@fleet.test", company: "Fleet Co" },
      hub: { displayName: "Jamie", employer: "Fleet Co" },
      username: "jamie",
    });
    expect(report.subject).toMatch(/Shell Barcaldine/);
    expect(report.text).toMatch(/210/);
    expect(report.text).toMatch(/95 L/);
    expect(report.html).toMatch(/Jamie/);
  });

  it("can confirm a manual admin fuel receipt without an image", () => {
    const s = store();
    const row = createFromScan(s, {
      ocr: { vendor: "BP Archerfield", date: "2026-08-26", amount: 210.5, rawText: "95 L" },
      filename: "admin-fuel-receipt",
    });
    const confirmed = confirmDetails(s, row.id, {
      vendor: "BP Archerfield",
      date: "2026-08-26",
      amount: 210.5,
      litres: 95,
      site: "BP Archerfield",
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.hasImage).toBeUndefined();
    expect(confirmed.amount).toBe(210.5);
    expect(confirmed.litres).toBe(95);
    expect(s.fuelReceipts).toHaveLength(1);
  });

  it("removes a receipt row so admin can delete Fuel Hub scans", () => {
    const s = store();
    const row = createFromScan(s, { ocr: { vendor: "United", amount: 88 } });
    expect(s.fuelReceipts).toHaveLength(1);
    expect(removeReceipt(s, row.id)).toBe(true);
    expect(s.fuelReceipts).toHaveLength(0);
    expect(removeReceipt(s, row.id)).toBe(false);
  });
});
