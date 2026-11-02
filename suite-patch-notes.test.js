const { HAULAGE_PR_NUMBER, formatVersionLabel } = require("./lib/version");
const { listPatchNotes, currentPatchNote } = require("./lib/suite-patch-notes");
const { renderPatchNotesPage, formatNoteDate } = require("./lib/suite-patch-notes-page");

describe("suite patch notes", () => {
  it("opens with the current shipped version and keeps newer releases first", () => {
    const notes = listPatchNotes();
    expect(notes.length).toBeGreaterThan(1);
    expect(currentPatchNote().prNumber).toBe(HAULAGE_PR_NUMBER);
    expect(currentPatchNote().version).toBe(formatVersionLabel(HAULAGE_PR_NUMBER));
    expect(currentPatchNote().version).toBe("Version 4.05");
    for (let i = 1; i < notes.length; i += 1) {
      expect(notes[i - 1].prNumber).toBeGreaterThan(notes[i].prNumber);
      expect(notes[i].items.length).toBeGreaterThan(0);
      expect(notes[i].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(notes[i].version).toBe(formatVersionLabel(notes[i].prNumber));
    }
  });

  it("renders the Updates page with point-form notes and the support contact", () => {
    const html = renderPatchNotesPage();
    expect(html).toMatch(/rel="canonical" href="https:\/\/gotaxationsuite\.com\/updates"/);
    expect(html).toMatch(/href="\/updates" aria-current="page"/);
    expect(html).toMatch(/<h2>Version 4\.05<\/h2>/);
    expect(html).toMatch(/<h2>Version 4\.02<\/h2>/);
    expect(html).toMatch(/<li>Add receipt, Edit and Delete/);
    expect(html).toMatch(/id="support-contact-form"/);
    expect(html).toMatch(/mailto:support@godriverhub\.com/);
    expect(html).toMatch(/id="support-send"/);
    expect(html).toMatch(/href="\/support"/);
    expect(html).toMatch(/welcome-suite/);
    expect(html).not.toMatch(/Driver Hub/i);
    expect(html).not.toMatch(/Taxation Hub/i);
    expect(html).not.toMatch(/Fuel Hub/i);
    expect(formatNoteDate("2026-11-03")).toBe("3 November 2026");
  });
});
