#!/usr/bin/env node
/**
 * Capture Play (1080×1920) phone shots of Driver Hub.
 * Requires google-chrome and a running server.
 *
 *   HUB_REVIEWER_USERNAME=hub.reviewer HUB_REVIEWER_PASSWORD='…' \
 *     PORT=3070 node mobile/store/capture-screenshots.js
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "screenshots");
const BASE = process.env.HUB_SHOT_URL || `http://127.0.0.1:${process.env.PORT || 3070}/haulage/`;
const USER = process.env.HUB_REVIEWER_USERNAME || process.env.DRIVERHUB_REVIEWER_USERNAME;
const PASS = process.env.HUB_REVIEWER_PASSWORD || process.env.DRIVERHUB_REVIEWER_PASSWORD;
const CDP_PORT = Number(process.env.CDP_PORT || 9667);

const SIZES = {
  "play-1080x1920": { width: 360, height: 640, deviceScaleFactor: 3 },
};

const SHOTS = [
  { name: "01-login", view: null },
  { name: "02-dashboard", view: "dashboard" },
  { name: "03-expenses", view: "expenses" },
  { name: "04-income", view: "income" },
  { name: "05-report", view: "report" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromePath() {
  return process.env.CHROME_PATH || "google-chrome";
}

async function waitHttp(url, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function cdpSession() {
  let nextId = 1;
  let ws;
  const pending = new Map();
  return {
    async connect() {
      await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      const page =
        (targets || []).find((t) => t.type === "page" && t.webSocketDebuggerUrl) ||
        (targets || []).find((t) => t.webSocketDebuggerUrl);
      if (!page) throw new Error("no CDP page target");
      const WS = globalThis.WebSocket;
      if (!WS) throw new Error("WebSocket is not available in this Node");
      ws = new WS(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", reject);
      });
      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      });
    },
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      if (ws) ws.close();
    },
  };
}

async function loginCookie() {
  if (!USER || !PASS) {
    throw new Error("Set HUB_REVIEWER_USERNAME and HUB_REVIEWER_PASSWORD");
  }
  const url = new URL("/api/haulage/auth/login", BASE);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`login failed ${res.status}: ${body}`);
  }
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const line = raw.find((c) => c.startsWith("haulage_sid=")) || "";
  const token = line.split(";")[0].slice("haulage_sid=".length);
  if (!token) throw new Error("login did not return haulage_sid");
  return token;
}

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const token = await loginCookie();
  const origin = new URL(BASE).origin;

  const chrome = spawn(
    chromePath(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--user-data-dir=/tmp/chrome-hub-shots`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-allow-origins=*",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  const cdp = cdpSession();
  try {
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    for (const [folder, size] of Object.entries(SIZES)) {
      const dir = path.join(ROOT, folder);
      fs.mkdirSync(dir, { recursive: true });
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: size.width,
        height: size.height,
        deviceScaleFactor: size.deviceScaleFactor,
        mobile: true,
      });

      for (const shot of SHOTS) {
        await cdp.send("Network.clearBrowserCookies").catch(() => {});
        if (shot.view) {
          await cdp.send("Network.setCookie", {
            name: "haulage_sid",
            value: token,
            url: origin,
            path: "/",
          });
        }

        await cdp.send("Page.navigate", { url: BASE });
        await sleep(1600);

        if (shot.view) {
          await cdp.send("Runtime.evaluate", {
            expression: `
              (function () {
                try { localStorage.setItem("driverhub-selected-app", "taxationhub"); } catch (e) {}
                document.body.classList.remove("auth-locked", "first-run-tour-active");
                var title = document.getElementById("title-screen");
                if (title) title.style.display = "none";
                var tour = document.getElementById("first-run-tour");
                if (tour) tour.remove();
                var alerts = document.getElementById("enh-alerts");
                if (alerts) alerts.remove();
                var toast = document.getElementById("toast");
                if (toast) toast.remove();
                var signed = document.querySelector(".brand-signed-in");
                if (signed) signed.remove();
                var btn = document.querySelector('.nav-btn[data-view="${shot.view}"]');
                if (btn) btn.click();
                return true;
              })()
            `,
          });
          await sleep(1800);
          await cdp.send("Runtime.evaluate", {
            expression: `
              (function () {
                var tour = document.getElementById("first-run-tour");
                if (tour) tour.remove();
                var toast = document.getElementById("toast");
                if (toast) { toast.classList.add("hidden"); toast.remove(); }
                var signed = document.querySelector(".brand-signed-in");
                if (signed) signed.remove();
                return document.querySelector('.nav-btn.active') && document.querySelector('.nav-btn.active').getAttribute('data-view');
              })()
            `,
          });
          await sleep(400);
        } else {
          await cdp.send("Runtime.evaluate", {
            expression: `
              (function () {
                try { localStorage.removeItem("haulage-auth"); } catch (e) {}
                var title = document.getElementById("title-screen");
                if (title) title.style.display = "";
                return true;
              })()
            `,
          });
          await sleep(400);
        }

        const shotRes = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        });
        const dest = path.join(dir, `${shot.name}.png`);
        fs.writeFileSync(dest, Buffer.from(shotRes.data, "base64"));
        console.log("wrote", dest);
      }
    }
  } finally {
    cdp.close();
    chrome.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
