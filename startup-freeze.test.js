const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const inject = src.slice(src.indexOf("function injectLodgementBrief"), src.indexOf("function enhanceReport"));

describe("startup freeze: lodgement brief observer", () => {
  it("does not remove-and-reinsert the brief on every report mutation", () => {
    expect(inject).toMatch(/if \(existing\) return/);
    expect(inject).not.toMatch(/querySelector\("\.report-lodgement-brief"\)\?\.remove\(\)/);
  });

  it("disconnects the report observer while enhancing so appends do not loop", () => {
    const start = src.slice(src.indexOf("function start()"), src.indexOf("if (document.readyState === \"loading\")", src.indexOf("function start()")));
    expect(start).toMatch(/observer\.disconnect\(\)/);
    expect(start).toMatch(/observer\.observe\(report/);
  });
});
