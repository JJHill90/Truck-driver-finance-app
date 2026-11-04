const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { HAULAGE_PR_NUMBER } = require("./lib/version");

function loadLiveReload() {
  const code = fs.readFileSync(path.join(__dirname, "public/live-reload.js"), "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.HaulageLiveReload.decideLiveReload;
}

describe("live reload", () => {
  const decide = loadLiveReload();

  it("reloads an open page when the server build is different", () => {
    expect(
      decide({ pagePr: 214, serverPr: 215, busy: false, alreadyReloadedFor: "" })
    ).toEqual({ reload: true, reason: "stale", serverPr: 215 });
  });

  it("leaves the page alone when it is already the live build", () => {
    expect(decide({ pagePr: 215, serverPr: 215, busy: false })).toEqual({
      reload: false,
      reason: "current",
    });
  });

  it("waits while a scan, camera, or form is in use", () => {
    expect(decide({ pagePr: 214, serverPr: 215, busy: true })).toEqual({
      reload: false,
      reason: "busy",
    });
  });

  it("does not reload in a loop when the new page did not stick", () => {
    expect(
      decide({ pagePr: 214, serverPr: 215, busy: false, alreadyReloadedFor: "215" })
    ).toEqual({ reload: false, reason: "already-reloaded", serverPr: 215 });
  });

  it("ignores a version response that has no build number", () => {
    expect(decide({ pagePr: 215, serverPr: null })).toEqual({ reload: false, reason: "unknown" });
    expect(decide({ pagePr: 0, serverPr: 215 })).toEqual({ reload: false, reason: "unknown" });
  });

  it("ships the same build number in the app pages and the version constant", () => {
    expect(HAULAGE_PR_NUMBER).toBe(218);
    for (const file of ["public/index.html", "public/suite/index.html"]) {
      const html = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(html).toMatch(/name="haulage-build" content="218"/);
      expect(html).toMatch(/live-reload\.js\?v=218/);
      expect(html.indexOf("live-reload.js?v=218")).toBeLessThan(html.indexOf("enhancements.js?v=218"));
    }
    const client = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
    expect(client).toMatch(/HaulageLiveReload/);
    expect(client).toMatch(/\/version\?t=/);
    expect(client).toMatch(/location\.reload/);
    expect(client).toMatch(/data-del-receipt/);
    expect(client).toMatch(/method: "DELETE"/);
    expect(client).toMatch(/Photo file missing — re-upload this document/);
  });
});
