/**
 * Build a static preview website for Ace Host / cPanel public_html.
 *
 * The live tax app stays on Render. Open-the-app links and the Support form
 * call https://go-taxation-suite.onrender.com (override with SUITE_APP_PUBLIC_URL).
 *
 *   node scripts/build-cpanel-site.js
 *   npm run cpanel-site
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "cpanel-site");
const PUBLIC = path.join(ROOT, "public");
const SHOTS = path.join(ROOT, "mobile-suite", "store", "screenshots", "play-1080x1920");

function appOrigin(env = process.env) {
  const raw = String(env.SUITE_APP_PUBLIC_URL || "https://go-taxation-suite.onrender.com").trim();
  return raw.replace(/\/+$/, "");
}

function rewriteHtml(html, origin) {
  let out = String(html || "");
  out = out.replace(
    /<body([^>]*?)class="welcome-page welcome-suite"/,
    `<body$1class="welcome-page welcome-suite" data-app-origin="${origin}"`
  );
  out = out.replace(/href="\/suite\/privacy"/g, 'href="privacy.html"');
  out = out.replace(/href="\/suite\/terms"/g, 'href="terms.html"');
  out = out.replace(/href="\/suite\/support"/g, 'href="support.html"');
  out = out.replace(/href="\/privacy(?:\.html)?"/g, 'href="privacy.html"');
  out = out.replace(/href="\/terms(?:\.html)?"/g, 'href="terms.html"');
  out = out.replace(/href="\/support(?:\.html)?"/g, 'href="support.html"');
  out = out.replace(/href="\/welcome-support-suite"/g, 'href="support.html"');
  out = out.replace(/href="\/welcome-suite(?:\.html)?"/g, 'href="index.html"');
  out = out.replace(/href="\/#about"/g, 'href="index.html#about"');
  out = out.replace(/class="legal-nav"[\s\S]*?<\/p>/, (block) =>
    block.replace(/href="\/suite\/"/g, 'href="index.html"')
  );
  out = out.replace(/data-welcome-app href="\/suite\/"/g, `data-welcome-app href="${origin}/suite/"`);
  out = out.replace(/href="\/suite\/"/g, `href="${origin}/suite/"`);
  out = out.replace(/href="\/"/g, 'href="index.html"');
  out = out.replace(/href="\/welcome\.css"/g, 'href="welcome.css"');
  out = out.replace(/src="\/welcome\.js"/g, 'src="welcome.js"');
  out = out.replace(/href="\/legal\.css"/g, 'href="legal.css"');
  out = out.replace(/href="\/suite\/icon-512\.png"/g, 'href="icon-512.png"');
  out = out.replace(/src="\/suite\/icon-512\.png"/g, 'src="icon-512.png"');
  out = out.replace(/\/welcome\/shots\//g, "shots/");
  out = out.replace(
    "https://gotaxationsuite.com/welcome/shots/02-dashboard.png",
    "https://gotaxationsuite.com/shots/02-dashboard.png"
  );
  return out;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function writeHtaccess() {
  return `# Go Taxation Suite preview website (cPanel).
# The live app is NOT hosted here — it stays on Render.
Options -Indexes
DirectoryIndex index.html

RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

RewriteRule ^support/?$ support.html [L]
RewriteRule ^privacy/?$ privacy.html [L]
RewriteRule ^terms/?$ terms.html [L]
RewriteRule ^about/?$ index.html [L]
`;
}

function build(env = process.env, outDir = OUT) {
  const origin = appOrigin(env);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });

  const pages = [
    ["welcome-suite.html", "index.html"],
    ["welcome-support-suite.html", "support.html"],
    ["privacy.html", "privacy.html"],
    ["terms.html", "terms.html"],
  ];
  for (const [srcName, destName] of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, srcName), "utf8");
    fs.writeFileSync(path.join(outDir, destName), rewriteHtml(html, origin));
  }

  copyFile(path.join(PUBLIC, "welcome.css"), path.join(outDir, "welcome.css"));
  copyFile(path.join(PUBLIC, "welcome.js"), path.join(outDir, "welcome.js"));
  copyFile(path.join(PUBLIC, "legal.css"), path.join(outDir, "legal.css"));
  copyFile(path.join(PUBLIC, "suite", "icon-512.png"), path.join(outDir, "icon-512.png"));

  for (const name of fs.readdirSync(SHOTS)) {
    if (!name.toLowerCase().endsWith(".png")) continue;
    copyFile(path.join(SHOTS, name), path.join(outDir, "shots", name));
  }

  fs.writeFileSync(path.join(outDir, ".htaccess"), writeHtaccess());
  fs.writeFileSync(
    path.join(outDir, "README.txt"),
    `Go Taxation Suite — cPanel preview website
==========================================

Upload EVERY file in this folder into the domain's public_html
(File Manager → public_html for gotaxationsuite.com).

Do NOT upload the Node/Render tax app here. "Open the app" goes to:
  ${origin}/suite/

Keep the DNS A record on this cPanel server. Do not point @ at Render.

See docs/cpanel-site.md in the git repo for the full steps.
`
  );

  return { outDir, origin };
}

if (require.main === module) {
  const result = build();
  console.log(`Wrote ${result.outDir} (app origin ${result.origin})`);
}

module.exports = { appOrigin, rewriteHtml, build, OUT };
