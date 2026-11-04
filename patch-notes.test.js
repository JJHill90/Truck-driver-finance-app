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
  const label = formatVersionLabel(208);

  it("publishes this version with the new bullets and the support contact", () => {
    expect(HAULAGE_PR_NUMBER).toBeGreaterThanOrEqual(208);
    expect(label).toBe("Version 4.04");
    const notes = patchNotes.publishedNotes();
    expect(notes[0].prNumber).toBe(217);
    expect(notes[0].label).toBe("Version 4.13");
    expect(notes[0].bullets).toHaveLength(1);
    expect(notes[0].bullets.join("\n")).toMatch(/does not report focus/);
    expect(notes[0].bullets.join("\n")).toMatch(/camera's own pixels/);
    const pageFocus = notes.find((note) => note.prNumber === 216);
    expect(pageFocus && pageFocus.label).toBe("Version 4.12");
    expect(pageFocus.bullets.join("\n")).toMatch(/focuses on the page inside the amber frame/);
    expect(pageFocus.bullets.join("\n")).toMatch(/Tap the page if it looks soft/);
    const liveReload = notes.find((note) => note.prNumber === 215);
    expect(liveReload && liveReload.label).toBe("Version 4.11");
    expect(liveReload.bullets.join("\n")).toMatch(/loads a new version on its own/);
    expect(liveReload.bullets.join("\n")).toMatch(/even when the file is already missing/);
    expect(liveReload.bullets.join("\n")).toMatch(/same day and amount/);
    const keptPhoto = notes.find((note) => note.prNumber === 214);
    expect(keptPhoto && keptPhoto.label).toBe("Version 4.10");
    expect(keptPhoto.bullets.join("\n")).toMatch(/keeps the photo on the disk/);
    const camera = notes.find((note) => note.prNumber === 213);
    expect(camera && camera.label).toBe("Version 4.09");
    expect(camera.bullets.join("\n")).toMatch(/camera permission is blocked/);
    expect(camera.bullets.join("\n")).toMatch(/turn Camera on in settings/);
    const previous = notes.find((note) => note.prNumber === 212);
    expect(previous && previous.label).toBe("Version 4.08");
    expect(previous.bullets.join("\n")).toMatch(/copied onto the saved disk/);
    const kept = notes.find((note) => note.prNumber === 211);
    expect(kept && kept.label).toBe("Version 4.07");
    expect(kept.bullets.join("\n")).toMatch(/photos stay saved/);
    const first = notes.find((note) => note.prNumber === 208);
    expect(first && first.label).toBe(label);
    expect(first.bullets.join("\n")).toMatch(/public Driver Hub patch notes page at \/patch-notes/);
    expect(first.bullets.join("\n")).toMatch(/same version label the app shows/);
    expect(first.bullets.join("\n")).toMatch(/support@godriverhub\.com/);
    expect(first.bullets.join("\n")).toMatch(/first public entry/);

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
  const label = formatVersionLabel(208);

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

  function expectNotDriverHubPatchPage(res) {
    expect(res.text).not.toContain("Patch notes — Driver Hub");
    expect(res.text).not.toContain("Published this public Driver Hub patch notes page");
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
    const suiteNotes = await get(server, "/patch-notes", { "x-forwarded-host": "gotaxationsuite.com" });
    expect(suiteNotes.status).toBe(200);
    expect(suiteNotes.text).toContain("Updates — Go Taxation Suite");
    expectNotDriverHubPatchPage(suiteNotes);
    expectNotDriverHubPatchPage(
      await get(server, "/patch-notes", { "x-forwarded-host": "www.gotaxationsuite.com" })
    );
    const taxNotes = await get(server, "/patch-notes", { "x-forwarded-host": "gotaxationhub.com" });
    expect(taxNotes.status).not.toBe(200);
    expectNotDriverHubPatchPage(taxNotes);
    expectNotDriverHubPatchPage(
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
      const suiteLocal = await get(server, "/patch-notes");
      expect(suiteLocal.status).toBe(200);
      expect(suiteLocal.text).toContain("Updates — Go Taxation Suite");
      expectNotDriverHubPatchPage(suiteLocal);
      const suiteOnHubHost = await get(server, "/patch-notes", { "x-forwarded-host": "godriverhub.com" });
      expect(suiteOnHubHost.status).not.toBe(200);
      expectNotDriverHubPatchPage(suiteOnHubHost);
      const suiteRoot = await get(server, "/");
      expect(suiteRoot.status).toBe(200);
      expect(suiteRoot.text).toMatch(/Go Taxation Suite/);
      expect(suiteRoot.text).not.toMatch(/href="\/patch-notes"/);
    } finally {
      delete process.env.APP_PRODUCT;
    }
  });
});
