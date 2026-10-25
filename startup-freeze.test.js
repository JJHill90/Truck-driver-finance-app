const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const auth = require("./lib/auth");
const suite = require("./lib/suite");
const { writeJsonAtomic } = require("./lib/atomic-write");

const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
const suiteHtml = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");
const strongPass = "RoadSafe!99x";

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

  it("eval'd injectLodgementBrief appends once under a MutationObserver", async () => {
    const injectSrc = extractFn("injectLodgementBrief");
    let mutations = 0;
    const kids = [];
    const el = {
      querySelector(sel) {
        if (sel === ".report-lodgement-brief") return kids.find((k) => /\breport-lodgement-brief\b/.test(k.className)) || null;
        return null;
      },
      appendChild(node) {
        kids.push(node);
        mutations += 1;
        if (el.__mo && !el.__mo.dead) queueMicrotask(() => el.__mo.cb());
        return node;
      },
    };
    const document = {
      getElementById(id) {
        return id === "report-content" ? el : null;
      },
      createElement() {
        const node = {
          className: "",
          innerHTML: "",
          remove() {
            const i = kids.indexOf(node);
            if (i >= 0) {
              kids.splice(i, 1);
              mutations += 1;
              if (el.__mo && !el.__mo.dead) queueMicrotask(() => el.__mo.cb());
            }
          },
        };
        return node;
      },
    };
    const state = {
      report: {
        lodgementBrief: {
          identity: { occupation: "Linehaul" },
          taxPosition: { outcomeLabel: "Refund", paygWithheld: 100, estimatedTax: 40 },
          payers: [],
          incomeLabels: [],
          deductionLabels: [],
          entitySpecific: { points: [] },
          extraEntities: [],
          gaps: [],
          questions: [],
          returnTitle: "IITR",
          entityLabel: "Employee (PAYG)",
          purpose: "Working paper",
          disclaimer: "Not advice",
        },
      },
    };
    const inject = new Function(
      "document",
      "state",
      "esc",
      "money",
      `${injectSrc}; return injectLodgementBrief;`
    )(document, state, (s) => String(s ?? ""), () => "$0.00");

    let reportObserver = {
      dead: false,
      cb() {
        if (this.dead) return;
        inject();
      },
      disconnect() {
        this.dead = true;
      },
      observe() {
        this.dead = false;
        el.__mo = this;
      },
    };
    el.__mo = reportObserver;

    function enhanceReport() {
      reportObserver.disconnect();
      try {
        inject();
      } finally {
        reportObserver.observe();
      }
    }

    enhanceReport();
    await new Promise((r) => setTimeout(r, 20));
    expect(kids).toHaveLength(1);
    expect(kids[0].className).toMatch(/report-lodgement-brief/);
    expect(mutations).toBe(1);
  });
});

describe("startup freeze: Pro+ /report still carries the brief", () => {
  let server;
  let tmp;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "startup-freeze-"));
    auth.setDataDirForTests(tmp);
    suite.setDataDirForTests(tmp);
    fs.mkdirSync(path.join(tmp, "users"), { recursive: true });
    auth.ensureAdminBootstrap();
    const { app } = require("./server");
    server = await new Promise((resolve) => {
      const s = http.createServer(app);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    auth.setDataDirForTests(null);
    suite.setDataDirForTests(null);
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("attaches lodgementBrief for Pro+ and omits it for Free", async () => {
    const { port } = server.address();
    const records = {
      profile: { name: "Alex", employer: "Betts", entityType: "employee", financialYear: "2026-27" },
      income: [{ id: "inc-1", date: "2026-08-03", type: "salary_wages", amount: 1800 }],
      expenses: [],
    };
    const plus = `plus_${Date.now().toString(36)}`;
    const free = `free_${Date.now().toString(36)}`;
    auth.createUser(plus, strongPass, {}, `${plus}@example.com`);
    auth.createUser(free, strongPass, {}, `${free}@example.com`);
    auth.setPlanGrant(plus, "pro_plus", { by: "test" });
    writeJsonAtomic(auth.recordsFileFor(plus), records);
    writeJsonAtomic(auth.recordsFileFor(free), records);
    const plusSid = auth.createSession(plus);
    const freeSid = auth.createSession(free);

    const plusRes = await fetch(`http://127.0.0.1:${port}/api/haulage/report?financialYear=2026-27`, {
      headers: { Cookie: `haulage_sid=${plusSid}` },
    });
    expect(plusRes.status).toBe(200);
    const plusBody = await plusRes.json();
    expect(plusBody.lodgementBrief).toBeTruthy();
    expect(plusBody.lodgementBrief.entityLabel).toMatch(/Employee/i);

    const freeRes = await fetch(`http://127.0.0.1:${port}/api/haulage/report?financialYear=2026-27`, {
      headers: { Cookie: `haulage_sid=${freeSid}` },
    });
    expect(freeRes.status).toBe(200);
    const freeBody = await freeRes.json();
    expect(freeBody.lodgementBrief).toBeUndefined();
  });
});
