const fs = require("fs");
const http = require("http");
const path = require("path");

process.env.NODE_ENV = "test";

const { HAULAGE_PR_NUMBER, formatVersionLabel } = require("./lib/version");
const patchNotes = require("./lib/patch-notes");

const hubOverview = fs.readFileSync(path.join(__dirname, "public/welcome-driverhub.html"), "utf8");
const suiteOverview = fs.readFileSync(path.join(__dirname, "public/welcome-suite.html"), "utf8");
const taxOverview = fs.readFileSync(path.join(__dirname, "public/welcome-taxationhub.html"), "utf8");
const welcomeJs = fs.readFileSync(path.join(__dirname, "public/welcome.js"), "utf8");

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function get(server, urlPath, headers = {}) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers, redirect: "manual" });
  const text = await res.text();
  return { status: res.status, location: res.headers.get("location"), text };
}

describe("Driver Hub patch notes", () => {
  const label = formatVersionLabel(HAULAGE_PR_NUMBER);

  it("publishes this version with the new bullets and the support contact", () => {
    expect(HAULAGE_PR_NUMBER).toBe(207);
    expect(label).toBe("Version 4.03");
    const notes = patchNotes.publishedNotes();
    expect(notes[0].prNumber).toBe(HAULAGE_PR_NUMBER);
    expect(notes[0].label).toBe(label);
    expect(notes[0].bullets.join("\n")).toMatch(/public Driver Hub patch notes page at \/patch-notes/);
    expect(notes[0].bullets.join("\n")).toMatch(/same version label the app shows/);
    expect(notes[0].bullets.join("\n")).toMatch(/support@godriverhub\.com/);
    expect(notes[0].bullets.join("\n")).toMatch(/first public entry/);

    const html = patchNotes.renderPage();
    expect(html).toContain(label);
    expect(html).toContain(`This public log starts at ${label}.`);
    expect(html).toContain("Published this public Driver Hub patch notes page at /patch-notes on godriverhub.com.");
    expect(html).toContain("mailto:support@godriverhub.com");
    expect(html).toContain('id="support-contact-form"');
    expect(html).toContain('name="message"');
    expect(html).toContain('src="/welcome.js"');
    expect(html).toContain('href="/support"');
    expect(html).toContain('href="/welcome-support-driverhub"');
    expect(welcomeJs).toMatch(/\/support\/contact/);
    expect(html.indexOf(label)).toBeLessThan(html.indexOf("Contact support"));
  });

  it("links the page from the Driver Hub overview only", () => {
    expect(hubOverview).toMatch(/href="\/patch-notes"/);
    expect(suiteOverview).not.toMatch(/\/patch-notes/);
    expect(taxOverview).not.toMatch(/\/patch-notes/);
  });

  it("refuses Suite standalone and the Suite or Taxation Hub hosts", () => {
    expect(patchNotes.shouldServeDriverHubPatchNotes({ headers: { host: "localhost" } })).toBe(true);
    expect(
      patchNotes.shouldServeDriverHubPatchNotes({
        headers: { "x-forwarded-host": "godriverhub.com" },
      })
    ).toBe(true);
    expect(
      patchNotes.shouldServeDriverHubPatchNotes({
        headers: { "x-forwarded-host": "gotaxationsuite.com" },
      })
    ).toBe(false);
    expect(
      patchNotes.shouldServeDriverHubPatchNotes({
        headers: { "x-forwarded-host": "www.gotaxationsuite.com" },
      })
    ).toBe(false);
    expect(
      patchNotes.shouldServeDriverHubPatchNotes({
        headers: { "x-forwarded-host": "gotaxationhub.com" },
      })
    ).toBe(false);
    expect(
      patchNotes.shouldServeDriverHubPatchNotes({
        headers: { "x-forwarded-host": "www.gotaxationhub.com" },
      })
    ).toBe(false);

    const prev = process.env.APP_PRODUCT;
    process.env.APP_PRODUCT = "suite";
    try {
      expect(
        patchNotes.shouldServeDriverHubPatchNotes({
          headers: { host: "localhost", "x-forwarded-host": "godriverhub.com" },
        })
      ).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.APP_PRODUCT;
      else process.env.APP_PRODUCT = prev;
    }
  });
});

describe("Driver Hub patch notes HTTP", () => {
  let app;
  let server;
  const prevProduct = process.env.APP_PRODUCT;
  const label = formatVersionLabel(HAULAGE_PR_NUMBER);

  beforeAll(async () => {
    delete process.env.APP_PRODUCT;
    ({ app } = require("./server"));
    server = await listen(app);
  });

  afterAll(async () => {
    if (prevProduct === undefined) delete process.env.APP_PRODUCT;
    else process.env.APP_PRODUCT = prevProduct;
    await new Promise((resolve) => server.close(resolve));
  });

  function expectPatchPage(res) {
    expect(res.status).toBe(200);
    expect(res.text).toContain(label);
    expect(res.text).toContain("Published this public Driver Hub patch notes page at /patch-notes on godriverhub.com.");
    expect(res.text).toContain("mailto:support@godriverhub.com");
    expect(res.text).toContain('id="support-contact-form"');
    expect(res.text).toContain('src="/welcome.js"');
    expect(res.text).toContain('href="/support"');
  }

  function expectNotPatchPage(res) {
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('id="support-contact-form"');
    expect(res.text).not.toContain("Patch notes — Driver Hub");
    expect(res.text).not.toContain(label);
  }

  it("serves the page on localhost and godriverhub.com, and the overview links to it", async () => {
    delete process.env.APP_PRODUCT;
    expectPatchPage(await get(server, "/patch-notes"));
    expectPatchPage(
      await get(server, "/patch-notes", { "x-forwarded-host": "godriverhub.com" })
    );

    const www = await get(server, "/patch-notes", { "x-forwarded-host": "www.godriverhub.com" });
    expect(www.status).toBe(301);
    expect(www.location).toBe("https://godriverhub.com/patch-notes");

    const home = await get(server, "/", { "x-forwarded-host": "godriverhub.com" });
    expect(home.status).toBe(200);
    expect(home.text).toMatch(/href="\/patch-notes"/);
    expect(home.text).toMatch(/Driver Hub/);

    const { port } = server.address();
    const posted = await fetch(`http://127.0.0.1:${port}/api/haulage/support/contact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-host": "godriverhub.com",
      },
      body: JSON.stringify({
        name: "Sam",
        email: "sam@example.com",
        message: "Patch notes page question",
      }),
    });
    expect(posted.status).toBe(200);
    const saved = await posted.json();
    expect(saved.ok).toBe(true);
    expect(saved.id).toBeTruthy();
    expect(String(saved.mailto || "")).toMatch(/^mailto:/);
  });

  it("does not serve the page for Suite standalone, the Suite host, or Go Taxation Hub", async () => {
    delete process.env.APP_PRODUCT;
    expectNotPatchPage(
      await get(server, "/patch-notes", { "x-forwarded-host": "gotaxationsuite.com" })
    );
    expectNotPatchPage(
      await get(server, "/patch-notes", { "x-forwarded-host": "www.gotaxationsuite.com" })
    );
    expectNotPatchPage(
      await get(server, "/patch-notes", { "x-forwarded-host": "gotaxationhub.com" })
    );
    expectNotPatchPage(
      await get(server, "/patch-notes", { "x-forwarded-host": "www.gotaxationhub.com" })
    );

    const suiteHome = await get(server, "/", { "x-forwarded-host": "gotaxationsuite.com" });
    expect(suiteHome.status).toBe(200);
    expect(suiteHome.text).not.toMatch(/href="\/patch-notes"/);

    const taxHome = await get(server, "/", { "x-forwarded-host": "gotaxationhub.com" });
    expect(taxHome.status).toBe(200);
    expect(taxHome.text).not.toMatch(/href="\/patch-notes"/);

    process.env.APP_PRODUCT = "suite";
    try {
      expectNotPatchPage(await get(server, "/patch-notes"));
      expectNotPatchPage(
        await get(server, "/patch-notes", { "x-forwarded-host": "godriverhub.com" })
      );
      const suiteRoot = await get(server, "/");
      expect(suiteRoot.status).toBe(200);
      expect(suiteRoot.text).toMatch(/Go Taxation Suite/);
      expect(suiteRoot.text).not.toMatch(/href="\/patch-notes"/);
    } finally {
      delete process.env.APP_PRODUCT;
    }
  });
});
