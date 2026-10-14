const fs = require("fs");
const http = require("http");
const path = require("path");

process.env.NODE_ENV = "test";

const suiteHtml = fs.readFileSync(path.join(__dirname, "public/welcome-suite.html"), "utf8");
const hubHtml = fs.readFileSync(path.join(__dirname, "public/welcome-driverhub.html"), "utf8");
const suiteSupport = fs.readFileSync(path.join(__dirname, "public/welcome-support-suite.html"), "utf8");
const hubSupport = fs.readFileSync(path.join(__dirname, "public/welcome-support-driverhub.html"), "utf8");
const playShot = path.join(
  __dirname,
  "mobile-suite",
  "store",
  "screenshots",
  "play-1080x1920",
  "01-login.png"
);
const hubShot = path.join(__dirname, "public", "welcome-hub-shots", "01-login.png");

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
  return { status: res.status, location: res.headers.get("location"), text, type: res.headers.get("content-type") };
}

describe("marketing overview pages", () => {
  it("Suite overview is store-safe and points at the web app plus coming-soon stores", () => {
    expect(suiteHtml).toMatch(/Go Taxation Suite/);
    expect(suiteHtml).toMatch(/Try it in the browser/);
    expect(suiteHtml).toMatch(/href="\/suite\/"/);
    expect(suiteHtml).toMatch(/id="welcome-appstore"/);
    expect(suiteHtml).toMatch(/id="welcome-play"/);
    expect(suiteHtml).toMatch(/Coming soon on the/);
    expect(suiteHtml).toMatch(/Coming soon on/);
    expect(suiteHtml).toMatch(/\/welcome\/shots\/01-login\.png/);
    expect(suiteHtml).toMatch(/\/welcome\/shots\/05-report\.png/);
    expect(suiteHtml).not.toMatch(/Driver Hub/i);
    expect(suiteHtml).not.toMatch(/Taxation Hub/i);
    expect(suiteHtml).not.toMatch(/Fuel Hub/i);
    expect(suiteHtml).not.toMatch(/truck-driver/i);
    expect(suiteHtml).toMatch(/rel="canonical" href="https:\/\/gotaxationsuite\.com\/"/);
  });

  it("Driver Hub overview links to /haulage/ and names both picker apps", () => {
    expect(hubHtml).toMatch(/Driver Hub/);
    expect(hubHtml).toMatch(/Taxation Hub/);
    expect(hubHtml).toMatch(/Fuel Hub/);
    expect(hubHtml).toMatch(/href="\/haulage\/"/);
    expect(hubHtml).toMatch(/\/welcome\/hub-shots\/01-login\.png/);
    expect(hubHtml).toMatch(/id="welcome-appstore"/);
    expect(hubHtml).toMatch(/id="welcome-play"/);
  });

  it("Suite website Support tab has the in-app help, contact form, FAQ, and no driver-product names", () => {
    expect(suiteSupport).toMatch(/id="support-contact-form"/);
    expect(suiteSupport).toMatch(/How each tab works/);
    expect(suiteSupport).toMatch(/FAQ/);
    expect(suiteSupport).toMatch(/does not lodge a BAS or tax return/i);
    expect(suiteSupport).toMatch(/support-help-btn/);
    expect(suiteSupport).not.toMatch(/Driver Hub/i);
    expect(suiteSupport).not.toMatch(/Taxation Hub/i);
    expect(suiteSupport).not.toMatch(/Fuel Hub/i);
  });

  it("Driver Hub website Support tab includes Fuel Hub help and the contact form", () => {
    expect(hubSupport).toMatch(/id="support-contact-form"/);
    expect(hubSupport).toMatch(/data-help-topic="fuelhub"/);
    expect(hubSupport).toMatch(/FAQ/);
    expect(hubSupport).toMatch(/Taxation Hub/);
    expect(hubSupport).toMatch(/Fuel Hub/);
  });

  it("serves Play screenshots for the overview without duplicating binaries", () => {
    expect(fs.existsSync(playShot)).toBe(true);
    expect(fs.existsSync(hubShot)).toBe(true);
  });
});

describe("marketing overview HTTP", () => {
  let app;
  let server;
  const prevProduct = process.env.APP_PRODUCT;

  beforeAll(async () => {
    ({ app } = require("./server"));
    server = await listen(app);
  });

  afterAll(async () => {
    if (prevProduct === undefined) delete process.env.APP_PRODUCT;
    else process.env.APP_PRODUCT = prevProduct;
    await new Promise((resolve) => server.close(resolve));
  });

  it("serves the Driver Hub overview at / instead of redirecting to the app", async () => {
    delete process.env.APP_PRODUCT;
    const home = await get(server, "/");
    expect(home.status).toBe(200);
    expect(home.location).toBeNull();
    expect(home.text).toMatch(/Driver Hub/);
    expect(home.text).toMatch(/Try it in the browser/);

    const json = await get(server, "/welcome.json");
    expect(json.status).toBe(200);
    const body = JSON.parse(json.text);
    expect(body.appUrl).toBe("/haulage/");
    expect(body.playStoreUrl).toBe("");
    expect(body.appStoreUrl).toBe("");

    const shot = await get(server, "/welcome/shots/02-dashboard.png");
    expect(shot.status).toBe(200);
    expect(shot.type).toMatch(/image\/png/);

    const appPage = await get(server, "/haulage/");
    expect(appPage.status).toBe(200);
    expect(appPage.text).toMatch(/title-screen|Driver Hub|TaxationHub/i);

    const supportPage = await get(server, "/support");
    expect(supportPage.status).toBe(200);
    expect(supportPage.text).toMatch(/Contact support/);
    expect(supportPage.text).toMatch(/id="support-contact-form"/);
    expect(supportPage.text).toMatch(/FAQ/);
    expect(supportPage.text).toMatch(/Fuel Hub/);

    const posted = await fetch(`http://127.0.0.1:${server.address().port}/api/haulage/support/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Sam",
        email: "sam@example.com",
        message: "Website FAQ question",
      }),
    });
    expect(posted.status).toBe(200);
    const saved = await posted.json();
    expect(saved.ok).toBe(true);
    expect(saved.id).toBeTruthy();
  }, 20_000);

  it("serves the Suite overview at / on APP_PRODUCT=suite and keeps /suite/ as the app", async () => {
    process.env.APP_PRODUCT = "suite";
    const home = await get(server, "/");
    expect(home.status).toBe(200);
    expect(home.text).toMatch(/Go Taxation Suite/);
    expect(home.text).not.toMatch(/Driver Hub/);

    const json = await get(server, "/welcome.json");
    const body = JSON.parse(json.text);
    expect(body.appUrl).toBe("/suite/");

    const named = await get(server, "/welcome-suite");
    expect(named.status).toBe(200);
    expect(named.text).toMatch(/Go Taxation Suite/);

    const suiteSupportPage = await get(server, "/support");
    expect(suiteSupportPage.status).toBe(200);
    expect(suiteSupportPage.text).toMatch(/Go Taxation Suite/);
    expect(suiteSupportPage.text).toMatch(/id="support-contact-form"/);
    expect(suiteSupportPage.text).not.toMatch(/Driver Hub/);

    const appPage = await get(server, "/suite/");
    expect(appPage.status).toBe(200);
    expect(appPage.text).toMatch(/Go Taxation Suite|title-brand-suite/i);
    delete process.env.APP_PRODUCT;
  });
});
