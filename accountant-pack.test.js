const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const auth = require("./lib/auth");
const suite = require("./lib/suite");
const { writeJsonAtomic } = require("./lib/atomic-write");
const { buildAccountantPack, resolveRegistration, mapIncomeItem, deductionBucket } = require("./lib/accountant-pack");
const { buildAccountantPackPdf } = require("./lib/accountant-pack-pdf");

function pdfPlainText(buf) {
  const parts = [];
  let pos = 0;
  while (true) {
    const i = buf.indexOf(Buffer.from("stream"), pos);
    if (i < 0) break;
    let start = i + 6;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const j = buf.indexOf(Buffer.from("endstream"), start);
    if (j < 0) break;
    let end = j;
    if (buf[end - 1] === 0x0a) end -= 1;
    if (buf[end - 1] === 0x0d) end -= 1;
    try {
      const inflated = zlib.inflateSync(buf.subarray(start, end)).toString("utf8");
      for (const m of inflated.matchAll(/<([0-9A-Fa-f]+)>/g)) {
        if (m[1].length % 2 === 0) {
          try {
            parts.push(Buffer.from(m[1], "hex").toString("utf8"));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore non-flate streams */
    }
    pos = j + 9;
  }
  return parts.join("");
}

function pdfBuffer(pack) {
  const doc = buildAccountantPackPdf(pack);
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

describe("resolveRegistration", () => {
  it("treats Hub linehaul as a PAYG employee", () => {
    const reg = resolveRegistration({ driverType: "long_haul" }, "haulage");
    expect(reg.id).toBe("employee");
    expect(reg.label).toMatch(/PAYG/i);
  });

  it("treats Hub owner-driver as a sole-trader style contractor", () => {
    const reg = resolveRegistration({ driverType: "owner_driver" }, "haulage");
    expect(reg.id).toBe("sole_trader");
    expect(reg.label).toMatch(/owner-driver/i);
  });

  it("uses Suite entityType for sole trader and partnership", () => {
    expect(resolveRegistration({ entityType: "sole_trader" }, "suite").id).toBe("sole_trader");
    expect(resolveRegistration({ entityType: "partnership" }, "suite").label).toMatch(/Partnership/i);
  });
});

describe("IITR mapping", () => {
  it("maps salary and allowances to items 1 and 2", () => {
    expect(mapIncomeItem("salary_wages").item).toBe("1");
    expect(mapIncomeItem("allowance_travel").item).toBe("2");
    expect(mapIncomeItem("business_income").item).toBe("P8 / 15");
    expect(mapIncomeItem("partnership_distribution").item).toBe("13");
    expect(mapIncomeItem("interest").item).toBe("10");
  });

  it("buckets car claims to D1 and Suite donations to D9", () => {
    expect(deductionBucket("vehicle_car", "haulage").id).toBe("D1");
    expect(deductionBucket("donations_dgr", "suite").id).toBe("D9");
  });
});

describe("PAYG employee briefing", () => {
  const profile = {
    name: "Alex Hill",
    employer: "Betts Transport",
    occupation: "Linehaul driver",
    driverType: "long_haul",
    annualSalary: 85000,
    tfnSupplied: true,
    licenceClass: "HC",
    financialYear: "2026-27",
    cars: [
      {
        make: "Toyota",
        model: "Hilux",
        registration: "ABC123",
        active: true,
        estimatedWorkUsePercent: 63,
      },
    ],
  };
  const records = {
    profile,
    income: [
      {
        id: "inc-pay",
        date: "2026-08-03",
        type: "salary_wages",
        amount: 1800,
        grossTotal: 2200,
        taxWithheld: 410,
        payer: "Betts Transport",
      },
      {
        id: "inc-allow",
        date: "2026-08-03",
        type: "allowance_travel",
        amount: 640,
        payer: "Betts Transport",
      },
    ],
    expenses: [
      { id: "exp-car", date: "2026-08-04", category: "vehicle_car", amount: 88, deductibleAmount: 88 },
      { id: "exp-meals", date: "2026-08-05", category: "meals", amount: 24.5, deductibleAmount: 24.5 },
    ],
  };

  it("builds item 1 / item 2 schedules, PAYG withheld and a still-needed checklist", () => {
    const pack = buildAccountantPack(records, profile, { product: "haulage", financialYear: "2026-27" });
    expect(pack.kind).toBe("taxpayer_briefing");
    expect(pack.registration.id).toBe("employee");
    expect(pack.identity.employer).toBe("Betts Transport");
    expect(pack.identity.activeCarWorkUsePercent).toBe(63);
    const item1 = pack.income.items.find((i) => i.item === "1");
    const item2 = pack.income.items.find((i) => i.item === "2");
    expect(item1.assessableTotal).toBe(2200);
    expect(item2.assessableTotal).toBe(640);
    expect(pack.income.payers[0].payer).toBe("Betts Transport");
    const unnamed = buildAccountantPack(
      {
        income: [
          {
            id: "inc-bare",
            date: "2026-08-03",
            type: "salary_wages",
            amount: 1800,
            taxWithheld: 200,
          },
        ],
      },
      { name: "Alex Hill", employer: "Betts Transport", driverType: "long_haul" },
      {
        product: "haulage",
        financialYear: "2026-27",
        summary: { taxEstimate: { estimatedTax: 0, taxableIncome: 1800, taxPayable: -200 } },
      }
    );
    expect(unnamed.income.payers[0].payer).toBe("Betts Transport");
    expect(unnamed.payg.estimatedTax).toBe(0);
    expect(unnamed.payg.refundEstimate).toBe(200);
    expect(pack.payg.withheld).toBe(410);
    expect(pack.deductions.schedules.some((s) => s.id === "D1")).toBe(true);
    expect(pack.checklist.items.find((i) => i.id === "employer").status).toBe("have");
    expect(pack.checklist.items.find((i) => i.id === "tfn").detail).toMatch(/not stored/i);
    expect(pack.checklist.items.find((i) => i.id === "private_health").status).toBe("unknown");
    expect(pack.checklist.items.find((i) => i.id === "help").status).toBe("unknown");
    expect(pack.checklist.items.find((i) => i.id === "spouse").status).toBe("unknown");
    expect(JSON.stringify(pack)).not.toMatch(/\b\d{8,9}\b/);
    expect(pack.agentNotes.join(" ")).toMatch(/Super Guarantee/i);
    expect(pack.disclaimer).toMatch(/not a lodged return/i);
  });

  it("drops soft-deleted ledger rows", () => {
    const pack = buildAccountantPack(
      {
        ...records,
        income: [
          ...records.income,
          { id: "inc-gone", date: "2026-08-10", type: "salary_wages", amount: 9999, deletedAt: "2026-08-11" },
        ],
      },
      profile,
      { product: "haulage", financialYear: "2026-27" }
    );
    expect(pack.income.assessableTotal).toBe(2840);
  });
});

describe("sole trader and partnership briefings", () => {
  it("maps owner-driver remittances to P8 / 15 and asks for ABN", () => {
    const profile = {
      name: "Sam Owner",
      driverType: "owner_driver",
      tradingName: "Sam Haulage",
      gstRegistered: true,
    };
    const pack = buildAccountantPack(
      {
        profile,
        income: [{ id: "inc-1", date: "2026-09-01", type: "remittance_owner", amount: 8000, payer: "Freight Co" }],
        expenses: [{ id: "exp-1", date: "2026-09-02", category: "fuel", amount: 400, deductibleAmount: 400 }],
      },
      profile,
      { product: "haulage", financialYear: "2026-27" }
    );
    expect(pack.registration.id).toBe("sole_trader");
    expect(pack.income.items[0].item).toBe("P8 / 15");
    expect(pack.checklist.items.find((i) => i.id === "gst").status).toBe("have");
    expect(pack.agentNotes.join(" ")).toMatch(/cash versus accruals/i);
  });

  it("maps Suite sole-trader sales to P8 and partnership share to item 13", () => {
    const sole = buildAccountantPack(
      {
        income: [{ id: "inc-biz", date: "2026-08-01", type: "business_income", amount: 12000, payer: "Walk-in clients" }],
        expenses: [{ id: "exp-gift", date: "2026-08-02", category: "donations_dgr", amount: 50, deductibleAmount: 50 }],
      },
      {
        name: "Riley Trade",
        entityType: "sole_trader",
        tradingName: "Riley Plumbing",
        abn: "51824753556",
        occupation: "Plumber",
      },
      { product: "suite", financialYear: "2026-27" }
    );
    expect(sole.registration.id).toBe("sole_trader");
    expect(sole.identity.abn).toBe("51824753556");
    expect(sole.income.items[0].item).toBe("P8 / 15");
    expect(sole.deductions.schedules.some((s) => s.id === "D9")).toBe(true);

    const partner = buildAccountantPack(
      {
        income: [
          {
            id: "inc-dist",
            date: "2026-08-01",
            type: "partnership_distribution",
            amount: 40000,
            payer: "Hill & Co",
          },
        ],
        expenses: [{ id: "exp-agent", date: "2026-08-03", category: "tax_affairs", amount: 440, deductibleAmount: 440 }],
      },
      {
        name: "Alex Hill",
        entityType: "partnership",
        partnershipName: "Hill & Co",
        partnerSharePercent: 40,
        occupation: "Partner",
      },
      { product: "suite", financialYear: "2026-27" }
    );
    expect(partner.registration.id).toBe("partnership");
    expect(partner.identity.partnerSharePercent).toBe(40);
    expect(partner.income.items[0].item).toBe("13");
    expect(partner.checklist.items.find((i) => i.id === "partnership").detail).toMatch(/40%/);
    expect(partner.deductions.schedules.some((s) => s.id === "D10")).toBe(true);
    expect(partner.agentNotes.join(" ")).toMatch(/partnership lodges/i);
  });
});

describe("taxpayer briefing PDF", () => {
  it("renders registration-aware working-paper text", async () => {
    const pack = buildAccountantPack(
      {
        income: [
          {
            id: "inc-pay",
            date: "2026-08-03",
            type: "salary_wages",
            amount: 2200,
            grossTotal: 2200,
            taxWithheld: 410,
            payer: "Betts Transport",
          },
        ],
        expenses: [{ id: "exp-car", date: "2026-08-04", category: "vehicle_car", amount: 88, deductibleAmount: 88 }],
      },
      { name: "Alex Hill", employer: "Betts Transport", driverType: "long_haul", occupation: "Linehaul driver" },
      { product: "haulage", financialYear: "2026-27" }
    );
    const buf = await pdfBuffer(pack);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
    const text = pdfPlainText(buf);
    expect(text).toMatch(/Taxpayer briefing/);
    expect(text).toMatch(/Alex Hill/);
    expect(text).toMatch(/Betts Transport/);
    expect(text).toMatch(/not a lodged return/i);
    expect(text).toMatch(/PAYG withheld/);
  });
});

describe("GET /accountant-pack", () => {
  let server;
  let tmp;
  const strongPass = "RoadSafe!99x";

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "accountant-pack-http-"));
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

  function seedUser(username, grant, records) {
    auth.createUser(username, strongPass, {}, `${username}@example.com`);
    if (grant) auth.setPlanGrant(username, grant, { by: "test" });
    writeJsonAtomic(auth.recordsFileFor(username), records);
    return auth.createSession(username);
  }

  it("returns a PAYG briefing for Pro and 402 for Free", async () => {
    const { port } = server.address();
    const records = {
      profile: {
        name: "Alex Hill",
        employer: "Betts Transport",
        occupation: "Linehaul driver",
        driverType: "long_haul",
        annualSalary: 85000,
        financialYear: "2026-27",
        tfnSupplied: true,
      },
      income: [
        {
          id: "inc-1",
          date: "2026-08-03",
          type: "salary_wages",
          amount: 1800,
          grossTotal: 2200,
          taxWithheld: 410,
          payer: "Betts Transport",
        },
      ],
      expenses: [{ id: "exp-1", date: "2026-08-04", category: "vehicle_car", amount: 88, deductibleAmount: 88 }],
    };
    const proUser = `packpro_${Date.now().toString(36)}`;
    const freeUser = `packfree_${Date.now().toString(36)}`;
    const proSid = seedUser(proUser, "pro_plus", records);
    const freeSid = seedUser(freeUser, null, records);

    const blocked = await fetch(`http://127.0.0.1:${port}/api/haulage/accountant-pack`, {
      headers: { Cookie: `haulage_sid=${freeSid}` },
    });
    expect(blocked.status).toBe(402);
    const blockedBody = await blocked.json();
    expect(blockedBody.code).toBe("PRO_PLUS_REQUIRED");

    const res = await fetch(`http://127.0.0.1:${port}/api/haulage/accountant-pack?financialYear=2026-27`, {
      headers: { Cookie: `haulage_sid=${proSid}` },
    });
    expect(res.status).toBe(200);
    const pack = await res.json();
    expect(pack.kind).toBe("taxpayer_briefing");
    expect(pack.registration.id).toBe("employee");
    expect(pack.identity.employer).toBe("Betts Transport");
    expect(pack.income.items.some((i) => i.item === "1")).toBe(true);
    expect(pack.payg.withheld).toBe(410);

    const pdfRes = await fetch(`http://127.0.0.1:${port}/api/haulage/accountant-pack.pdf?financialYear=2026-27`, {
      headers: { Cookie: `haulage_sid=${proSid}` },
    });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toMatch(/pdf/);
    const buf = Buffer.from(await pdfRes.arrayBuffer());
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });
});
