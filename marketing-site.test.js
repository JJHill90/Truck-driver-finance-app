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
const taxHtml = fs.readFileSync(path.join(__dirname, "public/welcome-taxationhub.html"), "utf8");
const taxSupport = fs.readFileSync(path.join(__dirname, "public/welcome-support-taxationhub.html"), "utf8");
const taxPrivacy = fs.readFileSync(path.join(__dirname, "public/privacy-taxationhub.html"), "utf8");
const taxTerms = fs.readFileSync(path.join(__dirname, "public/terms-taxationhub.html"), "utf8");
const taxShot = path.join(__dirname, "mobile", "store", "screenshots", "play-1080x1920", "02-dashboard.png");

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
    expect(suiteHtml).toMatch(/id="about"/);
    expect(suiteHtml).toMatch(/About us/);
    expect(suiteHtml).toMatch(/id="get-the-app"/);
    expect(suiteHtml).toMatch(/id="help"/);
    expect(suiteHtml).toMatch(/href="\/support"/);
    expect(suiteHtml).toMatch(/data-store="appstore"/);
    expect(suiteHtml).toMatch(/data-store="play"/);
  });

  it("Driver Hub overview links to /haulage/ and names both picker apps", () => {
    expect(hubHtml).toMatch(/Driver Hub/);
    expect(hubHtml).toMatch(/Taxation Hub/);
    expect(hubHtml).toMatch(/Fuel Hub/);
    expect(hubHtml).toMatch(/href="\/haulage\/"/);
    expect(hubHtml).toMatch(/\/welcome\/hub-shots\/01-login\.png/);
    expect(hubHtml).toMatch(/id="welcome-appstore"/);
    expect(hubHtml).toMatch(/id="welcome-play"/);
    expect(hubHtml).toMatch(/rel="canonical" href="https:\/\/godriverhub\.com\/"/);
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
    expect(fs.existsSync(taxShot)).toBe(true);
  });

  it("Go Taxation Hub overview keeps the Driver Hub layout and drops Fuel Hub", () => {
    expect(taxHtml).toMatch(/Go Taxation Hub/);
    expect(taxHtml).toMatch(/Taxation Hub for the driver app/);
    expect(taxHtml).toMatch(/Open Taxation Hub in the browser/);
    expect(taxHtml).toMatch(/href="https:\/\/godriverhub\.com\/haulage\/\?app=taxationhub"/);
    expect(taxHtml).toMatch(/id="welcome-appstore"/);
    expect(taxHtml).toMatch(/id="welcome-play"/);
    expect(taxHtml).toMatch(/Coming soon on the/);
    expect(taxHtml).toMatch(/class="features"/);
    expect(taxHtml).toMatch(/class="shot-row"/);
    expect(taxHtml).toMatch(/\/welcome\/taxhub-shots\/02-dashboard\.png/);
    expect(taxHtml).toMatch(/\/welcome\/taxhub-shots\/03-expenses\.png/);
    expect(taxHtml).toMatch(/\/welcome\/taxhub-shots\/04-income\.png/);
    expect(taxHtml).toMatch(/\/welcome\/taxhub-shots\/05-report\.png/);
    expect(taxHtml).not.toMatch(/01-login\.png/);
    expect(taxHtml).not.toMatch(/Fuel Hub/i);
    expect(taxHtml).not.toMatch(/fuelhub/i);
    expect(taxHtml).not.toMatch(/Driver Hub/);
    expect(taxHtml).toMatch(/rel="canonical" href="https:\/\/gotaxationhub\.com\/"/);
    expect(taxHtml).toMatch(/property="og:url" content="https:\/\/gotaxationhub\.com\/"/);
    expect(taxHtml).toMatch(
      /property="og:image" content="https:\/\/gotaxationhub\.com\/welcome\/taxhub-shots\/02-dashboard\.png"/
    );
    expect(taxHtml).toMatch(/support@godriverhub\.com/);
  });

  it("Go Taxation Hub support, privacy and terms keep the same contact address", () => {
    for (const html of [taxSupport, taxPrivacy, taxTerms]) {
      expect(html).toMatch(/support@godriverhub\.com/);
      expect(html).not.toMatch(/Fuel Hub/i);
      expect(html).not.toMatch(/fuelhub/i);
      expect(html).not.toMatch(/Driver Hub/);
      expect(html).toMatch(/https:\/\/gotaxationhub\.com\//);
    }
    expect(taxSupport).toMatch(/Taxation Hub for the driver app/);
    expect(taxPrivacy).toMatch(/Taxation Hub for the driver app/);
    expect(taxTerms).toMatch(/Taxation Hub for the driver app/);
    expect(taxSupport).toMatch(/id="support-contact-form"/);
    expect(taxSupport).toMatch(/How each tab works/);
    expect(taxSupport).toMatch(/FAQ/);
    expect(taxSupport).not.toMatch(/data-help-topic="fuelhub"/);
    expect(taxSupport).toMatch(/rel="canonical" href="https:\/\/gotaxationhub\.com\/support"/);
    expect(taxPrivacy).toMatch(/rel="canonical" href="https:\/\/gotaxationhub\.com\/privacy"/);
    expect(taxTerms).toMatch(/rel="canonical" href="https:\/\/gotaxationhub\.com\/terms"/);
    expect(taxTerms).toMatch(/\$5 \/ month or \$60/);
    expect(taxPrivacy).toMatch(/does not lodge a BAS or tax return/i);
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

    const privacy = await get(server, "/privacy");
    expect(privacy.status).toBe(200);
    expect(privacy.text).toMatch(/Privacy Policy/);
    expect(privacy.text).toMatch(/Driver Hub/);
    expect(privacy.text).not.toMatch(/Go Taxation Suite/);

    const terms = await get(server, "/terms");
    expect(terms.status).toBe(200);
    expect(terms.text).toMatch(/Driver Hub/);
    expect(terms.text).toMatch(/\$5 \/ month or \$60/);
  }, 20_000);

  it("serves Hub pages on godriverhub.com and redirects www to the apex", async () => {
    delete process.env.APP_PRODUCT;
    const hubHost = { "x-forwarded-host": "godriverhub.com", "x-forwarded-proto": "https" };
    const home = await get(server, "/", hubHost);
    expect(home.status).toBe(200);
    expect(home.text).toMatch(/Driver Hub/);
    expect(home.text).not.toMatch(/Go Taxation Suite/);

    const privacy = await get(server, "/privacy", hubHost);
    expect(privacy.status).toBe(200);
    expect(privacy.text).toMatch(/Driver Hub/);
    expect(privacy.text).toMatch(/rel="canonical" href="https:\/\/godriverhub\.com\/privacy"/);

    const json = await get(server, "/welcome.json", hubHost);
    expect(JSON.parse(json.text).appUrl).toBe("/haulage/");

    const www = await get(server, "/privacy", {
      "x-forwarded-host": "www.godriverhub.com",
      "x-forwarded-proto": "https",
    });
    expect(www.status).toBe(301);
    expect(www.location).toBe("https://godriverhub.com/privacy");
  });

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
    expect(named.text).toMatch(/About us/);
    expect(named.text).toMatch(/Get the app/);

    const about = await get(server, "/about");
    expect(about.status).toBe(302);
    expect(about.location).toBe("/#about");

    const suiteSupportPage = await get(server, "/support");
    expect(suiteSupportPage.status).toBe(200);
    expect(suiteSupportPage.text).toMatch(/Go Taxation Suite/);
    expect(suiteSupportPage.text).toMatch(/id="support-contact-form"/);
    expect(suiteSupportPage.text).not.toMatch(/Driver Hub/);

    const privacy = await get(server, "/privacy");
    expect(privacy.status).toBe(200);
    expect(privacy.text).toMatch(/Go Taxation Suite/);
    expect(privacy.text).not.toMatch(/Driver Hub/);

    const appPage = await get(server, "/suite/");
    expect(appPage.status).toBe(200);
    expect(appPage.text).toMatch(/Go Taxation Suite|title-brand-suite/i);
    delete process.env.APP_PRODUCT;
  });

  it("serves Go Taxation Hub on gotaxationhub.com and redirects www once to the apex", async () => {
    delete process.env.APP_PRODUCT;
    const apex = { "x-forwarded-host": "gotaxationhub.com", "x-forwarded-proto": "https" };
    const home = await get(server, "/", apex);
    expect(home.status).toBe(200);
    expect(home.location).toBeNull();
    expect(home.text).toMatch(/Go Taxation Hub/);
    expect(home.text).toMatch(/Taxation Hub for the driver app/);
    expect(home.text).toMatch(/https:\/\/godriverhub\.com\/haulage\/\?app=taxationhub/);
    expect(home.text).not.toMatch(/Fuel Hub/i);
    expect(home.text).not.toMatch(/Driver Hub/);
    expect(home.text).toMatch(/rel="canonical" href="https:\/\/gotaxationhub\.com\/"/);

    const support = await get(server, "/support", apex);
    expect(support.status).toBe(200);
    expect(support.text).toMatch(/id="support-contact-form"/);
    expect(support.text).not.toMatch(/Fuel Hub/i);

    const privacy = await get(server, "/privacy", apex);
    expect(privacy.status).toBe(200);
    expect(privacy.text).toMatch(/Privacy Policy/);
    expect(privacy.text).toMatch(/rel="canonical" href="https:\/\/gotaxationhub\.com\/privacy"/);
    expect(privacy.text).not.toMatch(/Fuel Hub/);

    const terms = await get(server, "/terms", apex);
    expect(terms.status).toBe(200);
    expect(terms.text).toMatch(/\$5 \/ month or \$60/);

    const json = await get(server, "/welcome.json", apex);
    expect(JSON.parse(json.text).appUrl).toBe("https://godriverhub.com/haulage/?app=taxationhub");

    const sitemap = await get(server, "/sitemap.xml", apex);
    expect(sitemap.status).toBe(200);
    expect(sitemap.type).toMatch(/xml/);
    expect(sitemap.text).toMatch(/https:\/\/gotaxationhub\.com\/support/);
    expect(sitemap.text).not.toMatch(/www\.gotaxationhub\.com/);

    const robots = await get(server, "/robots.txt", apex);
    expect(robots.status).toBe(200);
    expect(robots.text).toMatch(/Sitemap: https:\/\/gotaxationhub\.com\/sitemap\.xml/);

    const shot = await get(server, "/welcome/taxhub-shots/02-dashboard.png", apex);
    expect(shot.status).toBe(200);
    expect(shot.type).toMatch(/image\/png/);
    const hidden = await get(server, "/welcome/taxhub-shots/01-login.png", apex);
    expect(hidden.status).toBe(404);

    const www = await get(server, "/privacy?x=1", {
      "x-forwarded-host": "www.gotaxationhub.com",
      "x-forwarded-proto": "https",
    });
    expect(www.status).toBe(301);
    expect(www.location).toBe("https://gotaxationhub.com/privacy?x=1");

    const wwwHome = await get(server, "/", {
      "x-forwarded-host": "www.gotaxationhub.com",
    });
    expect(wwwHome.status).toBe(301);
    expect(wwwHome.location).toBe("https://gotaxationhub.com/");

    const haulage = await get(server, "/haulage/", apex);
    expect(haulage.status).toBe(302);
    expect(haulage.location).toBe("https://godriverhub.com/haulage/?app=taxationhub");

    const wwwHaulage = await get(server, "/haulage/", {
      "x-forwarded-host": "www.gotaxationhub.com",
    });
    expect(wwwHaulage.status).toBe(301);
    expect(wwwHaulage.location).toBe("https://gotaxationhub.com/haulage/");

    const driverHome = await get(server, "/", {
      "x-forwarded-host": "godriverhub.com",
    });
    expect(driverHome.status).toBe(200);
    expect(driverHome.text).toMatch(/Fuel Hub/);
    expect(driverHome.text).toMatch(/rel="canonical" href="https:\/\/godriverhub\.com\/"/);

    const driverSitemap = await get(server, "/sitemap.xml", {
      "x-forwarded-host": "godriverhub.com",
    });
    expect(driverSitemap.status).toBe(404);

    const { port } = server.address();
    const posted = await fetch(`http://127.0.0.1:${port}/api/haulage/support/contact`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-host": "www.gotaxationhub.com",
      },
      body: JSON.stringify({
        name: "Sam",
        email: "sam@example.com",
        message: "Taxation Hub website question",
      }),
    });
    expect(posted.status).toBe(200);
  }, 20_000);

  it("keeps the Suite overview when APP_PRODUCT=suite and the host is not Go Taxation Hub", async () => {
    process.env.APP_PRODUCT = "suite";
    const home = await get(server, "/", {
      "x-forwarded-host": "gotaxationsuite.com",
    });
    expect(home.status).toBe(200);
    expect(home.text).toMatch(/Go Taxation Suite/);
    expect(home.text).not.toMatch(/Go Taxation Hub/);

    const taxHost = await get(server, "/", {
      "x-forwarded-host": "gotaxationhub.com",
    });
    expect(taxHost.status).toBe(200);
    expect(taxHost.text).toMatch(/Go Taxation Hub/);
    expect(taxHost.text).not.toMatch(/Go Taxation Suite/);
    delete process.env.APP_PRODUCT;
  });
});
