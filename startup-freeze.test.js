const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`could not extract ${name}`);
}

describe("startup freeze: lodgement brief observer", () => {
  it("does not remove-then-append the brief on every enhance", () => {
    const fn = extractFn("injectLodgementBrief");
    expect(fn).toMatch(/const existing = el\.querySelector\("\.report-lodgement-brief"\)/);
    expect(fn).toMatch(/if \(existing\) return/);
    expect(fn).not.toMatch(/querySelector\("\.report-lodgement-brief"\)\?\.remove\(\);\s*const report/);
  });

  it("disconnects the report observer while enhanceReport mutates", () => {
    const fn = extractFn("enhanceReport");
    expect(fn).toMatch(/reportObserver\.disconnect\(\)/);
    expect(fn).toMatch(/reportObserver\.observe\(report/);
    expect(src).toMatch(/reportObserver = new MutationObserver\(enhanceReport\)/);
  });

  it("cache-busts enhancements so Play / desktop load the guard", () => {
    expect(hub).toMatch(/enhancements\.js\?v=startup-freeze-1/);
    expect(suiteHtml).toMatch(/enhancements\.js\?v=startup-freeze-1/);
  });

  it("settles after one inject when the observer fires on append", () => {
    let children = [];
    let mutations = 0;
    const MAX = 40;

    function inject(brief) {
      const existing = children.find((c) => c === "brief");
      if (!brief) {
        if (existing) {
          children = children.filter((c) => c !== "brief");
          mutations += 1;
        }
        return;
      }
      if (existing) return;
      children.push("brief");
      mutations += 1;
    }

    function enhance() {
      inject({ ok: true });
    }

    enhance();
    // Observer delivers after the current turn — same as MutationObserver.
    while (mutations < MAX) {
      const before = mutations;
      enhance();
      if (mutations === before) break;
    }

    expect(children).toEqual(["brief"]);
    expect(mutations).toBe(1);
    expect(mutations).toBeLessThan(MAX);
  });
});
