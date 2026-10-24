const fs = require("fs");
const os = require("os");
const path = require("path");
const { rewriteHtml, build, appOrigin } = require("./scripts/build-cpanel-site");

describe("cPanel static preview site", () => {
  it("rewrites app links to Render and local pages to relative html", () => {
    const origin = "https://go-taxation-suite.onrender.com";
    const html = rewriteHtml(
      `<body class="welcome-page welcome-suite">
        <a data-welcome-app href="/suite/">Open the app</a>
        <a href="/support">Support</a>
        <a href="/#about">About</a>
        <img src="/welcome/shots/01-login.png" alt="" />
        <meta property="og:image" content="https://gotaxationsuite.com/welcome/shots/02-dashboard.png" />
        <link rel="icon" href="/suite/icon-512.png" />
      </body>`,
      origin
    );
    expect(html).toMatch(`data-app-origin="${origin}"`);
    expect(html).toMatch(`href="${origin}/suite/"`);
    expect(html).toMatch('href="support.html"');
    expect(html).toMatch('href="index.html#about"');
    expect(html).toMatch('src="shots/01-login.png"');
    expect(html).toMatch('content="https://gotaxationsuite.com/shots/02-dashboard.png"');
    expect(html).not.toMatch("gotaxationsuite.comshots");
    expect(html).toMatch('href="icon-512.png"');
    expect(html).not.toMatch('href="/suite/"');
  });

  it("builds a cPanel folder with index, support, shots and htaccess", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cpanel-site-"));
    const { origin } = build({}, dir);
    expect(origin).toBe(appOrigin());
    const index = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    expect(index).toMatch(/About us/);
    expect(index).toMatch(/data-app-origin="https:\/\/go-taxation-suite\.onrender\.com"/);
    expect(index).toMatch(/href="https:\/\/go-taxation-suite\.onrender\.com\/suite\/"/);
    expect(index).not.toMatch(/Driver Hub/i);
    expect(fs.existsSync(path.join(dir, "support.html"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "privacy.html"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "terms.html"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "welcome.js"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "shots", "01-login.png"))).toBe(true);
    const ht = fs.readFileSync(path.join(dir, ".htaccess"), "utf8");
    expect(ht).toMatch(/Options -Indexes/);
    expect(ht).toMatch(/RewriteRule \^support/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
