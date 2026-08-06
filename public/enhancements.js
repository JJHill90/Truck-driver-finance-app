/*
 * Progressive enhancement layer (loaded after app.js, which is kept verbatim).
 * Adds, without modifying app.js:
 *   1. A "Breakdown by type" + "ATO compliance" panel in the scan-review boxes,
 *      driven by the enriched /receipts/scan response.
 *   2. Click-to-enlarge lightbox for the scanned receipt/payslip image so the
 *      user can read the totals while reviewing.
 */
(function () {
  "use strict";

  let latest = null; // { breakdown, compliance, purpose, token }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const fmt = (n) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);

  function fmtDateShort(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("en-AU");
    } catch {
      return String(d);
    }
  }

  /** Modal: possible duplicate detected — Continue or Cancel. */
  function promptDuplicateContinue(data) {
    return new Promise((resolve) => {
      const existing = document.getElementById("enh-dup-modal");
      if (existing) existing.remove();

      const matches = (data && data.matches) || [];
      const o = (data && data.ocrResult) || {};
      const matchRows = matches
        .slice(0, 5)
        .map(
          (m) =>
            `<li><strong>${esc(m.vendor || "—")}</strong> · ${esc(fmtDateShort(m.date))} · ${fmt(m.amount)} <span class="muted">(${esc(m.source)})</span></li>`
        )
        .join("");

      const modal = document.createElement("div");
      modal.id = "enh-dup-modal";
      modal.className = "enh-dup-modal";
      modal.innerHTML = `
        <div class="enh-dup-backdrop" data-dup-cancel></div>
        <div class="enh-dup-card" role="dialog" aria-modal="true" aria-labelledby="enh-dup-title">
          <h3 id="enh-dup-title">Possible duplicate detected</h3>
          <p>possible duplicate detected, do you wish to continue with the upload?</p>
          <p class="muted">This file looks similar to an existing entry:</p>
          <ul class="enh-dup-matches">${matchRows || "<li class='muted'>Matching date, vendor and amount</li>"}</ul>
          <p class="enh-dup-scan muted">Scanned: <strong>${esc(o.vendor || o.entity || "—")}</strong> · ${esc(fmtDateShort(o.date))} · ${fmt(o.amount ?? o.grossTotal)}</p>
          <div class="enh-dup-actions">
            <button type="button" class="btn secondary" data-dup-cancel>Cancel upload</button>
            <button type="button" class="btn primary" data-dup-continue>Continue upload</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      const finish = (value) => {
        modal.remove();
        resolve(value);
      };
      modal.querySelectorAll("[data-dup-cancel]").forEach((el) => {
        el.addEventListener("click", () => finish(false));
      });
      modal.querySelector("[data-dup-continue]")?.addEventListener("click", () => finish(true));
    });
  }

  // --- Capture enriched scan responses by wrapping fetch ------------------
  // Also intercepts possible-duplicate responses and prompts before saving.
  // Network failures on /api/haulage get a clear message (hosted vs local) and
  // one short retry — app.js otherwise always says "npm start" / localhost.
  const origFetch = window.fetch;

  function isLocalDevHost() {
    const h = String(window.location.hostname || "");
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function isHaulageApiUrl(url) {
    return Boolean(url && /\/api\/haulage(?:\/|$|\?)/.test(String(url)));
  }

  function networkErrorMessage() {
    if (window.location.protocol === "file:") {
      return "Open the app at http://localhost:3000/haulage/ — not as a local file.";
    }
    if (isLocalDevHost()) {
      return `Network error — start the server (npm start) and open http://localhost:${window.location.port || 3000}/haulage/`;
    }
    return "Network error — check your connection and try again. If the site was idle, wait a moment and retry (the server may be waking up).";
  }

  function networkErrorResponse() {
    return new Response(JSON.stringify({ error: networkErrorMessage() }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function haulageFetchWithRetry(run) {
    try {
      return await run();
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      // One retry covers brief blips and hosted cold-starts (e.g. Render idle).
      await sleep(1500);
      try {
        return await run();
      } catch (err2) {
        if (err2 && err2.name === "AbortError") throw err2;
        return networkErrorResponse();
      }
    }
  }

  window.fetch = async function (...args) {
    let url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
    let options = args[1] || {};

    // Inject cash / no-receipt flags from the manual expense form (app.js
    // builds its own payload and does not read these checkboxes).
    if (
      url &&
      /\/receipts\/manual(\?|$)/.test(url) &&
      String(options.method || "GET").toUpperCase() === "POST" &&
      typeof options.body === "string"
    ) {
      try {
        const bodyObj = JSON.parse(options.body);
        const cashEl = document.querySelector(
          "#manual-receipt-form [name=cashTransaction], #manual-cash-transaction"
        );
        const noReceiptEl = document.querySelector(
          "#manual-receipt-form [name=noReceipt], #manual-no-receipt"
        );
        if (cashEl) bodyObj.cashTransaction = Boolean(cashEl.checked);
        if (noReceiptEl) bodyObj.noReceipt = Boolean(noReceiptEl.checked);
        options = {
          ...options,
          body: JSON.stringify(bodyObj),
          headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
          },
        };
        args = [url, options];
      } catch {
        /* leave body as-is */
      }
    }

    const runScanOrPassthrough = async () => {
      if (url && /\/receipts\/scan(\?|$)/.test(url)) {
        let bodyObj = {};
        try {
          if (options.body) bodyObj = JSON.parse(options.body);
        } catch {
          /* ignore */
        }
        const purpose = bodyObj.purpose === "income" ? "income" : "expense";

        let res = await origFetch.apply(this, args);
        let data = null;
        try {
          data = await res.clone().json();
        } catch {
          return res;
        }

        if (data && data.possibleDuplicate && !bodyObj.forceDuplicate) {
          const proceed = await promptDuplicateContinue(data);
          if (!proceed) {
            return new Response(
              JSON.stringify({
                error: "Upload cancelled — possible duplicate detected.",
              }),
              { status: 409, headers: { "Content-Type": "application/json" } }
            );
          }
          bodyObj.forceDuplicate = true;
          res = await origFetch(url, {
            ...options,
            method: options.method || "POST",
            credentials: options.credentials || "same-origin",
            headers: {
              "Content-Type": "application/json",
              ...(options.headers || {}),
            },
            body: JSON.stringify(bodyObj),
          });
          try {
            data = await res.clone().json();
          } catch {
            data = null;
          }
        }

        if (data && data.receipt) {
          const mimeType = (data.receipt && data.receipt.mimeType) || "";
          const ocr = data.ocrResult || {};
          latest = {
            breakdown: data.componentBreakdown || [],
            compliance: data.compliance || null,
            payPeriod: data.payPeriod || null,
            vendorMatch: ocr.vendorMatch || null,
            categorySource: ocr.categorySource || null,
            suggestedCategory: ocr.suggestedCategory || null,
            vendorAbn: ocr.vendorAbn || null,
            vendor: ocr.vendor || ocr.entity || null,
            purpose,
            receiptId: data.receipt && data.receipt.id,
            isPdf: /pdf/i.test(mimeType),
            token: `${Date.now()}-${Math.random()}`,
          };
        }
        return res;
      }

      return origFetch.apply(this, args);
    };

    if (isHaulageApiUrl(url)) {
      return haulageFetchWithRetry(() => runScanOrPassthrough.call(this));
    }
    return runScanOrPassthrough.call(this);
  };

  // --- Render the panel into a scan-review box ----------------------------
  function buildPanel(data) {
    const wrap = document.createElement("div");
    wrap.className = "enh-panel";
    wrap.id = "enh-panel";

    const rows = (data.breakdown || [])
      .map((c) => {
        const badge = c.detected === false ? '<span class="enh-badge">estimate</span>' : "";
        const note = c.note ? `<div class="enh-note">${esc(c.note)}</div>` : "";
        return `<tr>
          <td>${esc(c.label)}${badge}${note}</td>
          <td class="enh-amt">${fmt(c.amount)}</td>
        </tr>`;
      })
      .join("");

    const breakdownHtml = rows
      ? `<div class="enh-section">
           <h4>Breakdown by type</h4>
           <table class="enh-breakdown"><tbody>${rows}</tbody></table>
         </div>`
      : "";

    let payPeriodHtml = "";
    const pp = data.payPeriod;
    if (pp && (pp.from || pp.paymentDate)) {
      const line = (labelText, value) =>
        value ? `<div class="enh-pp-row"><span>${labelText}</span><strong>${esc(value)}</strong></div>` : "";
      payPeriodHtml = `<div class="enh-section enh-payperiod">
          <h4>Pay period</h4>
          ${line("Payment date", pp.paymentDateLabel)}
          ${line("Period start", pp.fromLabel)}
          ${line("Period end", pp.toLabel)}
          ${line("Cycle", pp.cycleLabel)}
        </div>`;
    }

    let vendorHtml = "";
    if (data.vendorMatch || data.vendorAbn || data.categorySource) {
      const matchBits = [];
      if (data.vendorMatch) {
        matchBits.push(
          data.vendorMatch.source === "abn"
            ? `Matched known business by ABN (${esc(data.vendorMatch.name || data.vendor || "—")})`
            : `Matched known business by name (${esc(data.vendorMatch.name || data.vendor || "—")})`
        );
      } else if (data.vendor) {
        matchBits.push(`Vendor ${esc(data.vendor)}`);
      }
      if (data.vendorAbn) matchBits.push(`ABN ${esc(data.vendorAbn)}`);
      if (data.categorySource === "business_type") {
        matchBits.push("Category set from business type (ABN / business name)");
      } else if (data.categorySource === "vendor_memory") {
        matchBits.push("Category from previous saves for this business");
      } else if (data.categorySource === "text_heuristic") {
        matchBits.push("Category suggested from receipt wording");
      }
      vendorHtml = `<div class="enh-section enh-vendor-match">
          <h4>Business / ABN</h4>
          <p class="muted">${matchBits.join(" · ")}</p>
        </div>`;
    }

    let complianceHtml = "";
    const comp = data.compliance;
    if (comp) {
      const checks = (comp.checks || [])
        .map(
          (c) =>
            `<li class="enh-check enh-${esc(c.status)}">
               <strong>${esc(c.name)}</strong> ${esc(c.message)}
             </li>`
        )
        .join("");
      complianceHtml = `<div class="enh-section enh-compliance enh-status-${esc(comp.status)}">
          <h4>ATO compliance — ${esc(comp.statusLabel || comp.status)}</h4>
          ${checks ? `<ul class="enh-checks">${checks}</ul>` : '<p class="muted">No compliance flags.</p>'}
          <p class="enh-disclaimer">Indicative check against ATO transport-industry standards — not tax advice.</p>
        </div>`;
    }

    const enlargeLabel = data.isPdf ? "Open scanned document" : "Enlarge scanned image";
    wrap.innerHTML = `${vendorHtml}${payPeriodHtml}${breakdownHtml}${complianceHtml}
      <button type="button" class="btn secondary enh-enlarge">${enlargeLabel}</button>`;
    return wrap;
  }

  function enhanceBox(box) {
    if (!latest || !box) return;
    if (!box.querySelector(".scan-confirm")) return;
    if (box.__enhToken === latest.token) return;
    box.__enhToken = latest.token;
    const existing = box.querySelector("#enh-panel");
    if (existing) existing.remove();
    box.appendChild(buildPanel(latest));
  }

  function observe(boxId, purpose) {
    const box = document.getElementById(boxId);
    if (!box) return;
    const mo = new MutationObserver(() => {
      if (latest && latest.purpose === purpose) enhanceBox(box);
    });
    mo.observe(box, { childList: true, subtree: true });
  }

  // --- Image lightbox -----------------------------------------------------
  function openLightbox(src, isPdf) {
    closeLightbox();
    const overlay = document.createElement("div");
    overlay.className = "enh-lightbox";
    overlay.innerHTML = isPdf
      ? `<iframe src="${esc(src)}" title="Scanned document"></iframe>`
      : `<img src="${esc(src)}" alt="Scanned document (enlarged)" />`;
    const close = document.createElement("button");
    close.className = "enh-lightbox-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    overlay.appendChild(close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target === close) closeLightbox();
    });
    const img = overlay.querySelector("img");
    if (img) img.addEventListener("click", () => img.classList.toggle("enh-zoomed"));
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    const existing = document.querySelector(".enh-lightbox");
    if (existing) existing.remove();
    document.body.style.overflow = "";
  }

  function currentPreviewImage() {
    const boxes = ["#income-preview img", "#receipt-preview img"];
    for (const sel of boxes) {
      const img = document.querySelector(sel);
      if (img && img.src) return img.src;
    }
    return null;
  }

  document.addEventListener("click", (e) => {
    const target = e.target;
    // Enlarge button inside the enhancement panel.
    if (target.classList && target.classList.contains("enh-enlarge")) {
      const src = currentPreviewImage();
      if (src) {
        openLightbox(src, false);
      } else if (latest && latest.receiptId) {
        // PDFs (and any doc without an inline preview image) open from storage.
        openLightbox(`/api/haulage/receipts/${latest.receiptId}/file`, latest.isPdf);
      }
      return;
    }
    // Direct click on a scan preview image.
    if (target.tagName === "IMG" && target.closest("#receipt-preview, #income-preview")) {
      openLightbox(target.src, false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  // Add a zoom affordance to preview images as they appear.
  const previewMo = new MutationObserver(() => {
    document.querySelectorAll("#receipt-preview img, #income-preview img").forEach((img) => {
      img.classList.add("enh-zoomable");
      img.title = "Click to enlarge";
    });
  });
  previewMo.observe(document.body, { childList: true, subtree: true });

  function init() {
    observe("scan-result", "expense");
    observe("income-scan-result", "income");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/*
 * Accounts + alerts layer.
 * Lets a first-time user create a profile (username/password) under the Profile
 * tab, logs existing users in, and shows a missing-data alert banner. On a
 * successful auth change the page reloads so app.js re-fetches the now
 * user-scoped data (receipts, income, EOFY projections, tax values).
 */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function apiPost(path, body) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Request failed");
      err.data = data;
      throw err;
    }
    return data;
  }

  async function apiGet(path) {
    const res = await fetch(`${API}${path}`, { credentials: "same-origin" });
    return res.json().catch(() => ({}));
  }

  async function apiDelete(path) {
    const res = await fetch(`${API}${path}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setMessage(text, isError) {
    const el = byId("auth-message");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "var(--red)" : "var(--text-dim)";
  }

  function setTitleMessage(text, isError) {
    const el = byId("title-auth-message");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-error", Boolean(isError));
  }

  function unlockApp() {
    document.body.classList.remove("auth-locked");
    const screen = byId("title-screen");
    if (screen) screen.setAttribute("aria-hidden", "true");
  }

  function lockApp() {
    document.body.classList.add("auth-locked");
    const screen = byId("title-screen");
    if (screen) screen.setAttribute("aria-hidden", "false");
  }

  function readTitleCreds() {
    return {
      username: (byId("title-auth-username") || {}).value || "",
      password: (byId("title-auth-password") || {}).value || "",
      email: (byId("title-auth-email") || {}).value || "",
    };
  }

  async function refreshPasswordStrength(passwordElId, usernameElId, outElId) {
    const out = byId(outElId);
    const password = (byId(passwordElId) || {}).value || "";
    const userEl = byId(usernameElId);
    const username = userEl
      ? String(userEl.value != null && "value" in userEl ? userEl.value : userEl.textContent || "")
          .replace(/\s*\(primary mod\)\s*$/i, "")
          .trim()
      : "";
    if (!out) return;
    if (!password) {
      out.textContent = "";
      out.dataset.level = "";
      return;
    }
    try {
      const data = await apiPost("/auth/password-strength", { password, username });
      out.textContent = data.message || "";
      out.dataset.level = data.label || "weak";
      if (data.hints && data.hints.length && data.label !== "strong") {
        out.textContent = `${data.message} ${data.hints[0]}`;
      }
    } catch {
      /* ignore */
    }
  }

  function showTitleRegisterMode(isRegister) {
    const emailWrap = byId("title-auth-email-wrap");
    const hint = byId("title-password-hint");
    const strength = byId("title-password-strength");
    const pwd = byId("title-auth-password");
    if (emailWrap) emailWrap.classList.toggle("hidden", !isRegister);
    if (hint) hint.classList.toggle("hidden", !isRegister);
    if (strength) strength.classList.toggle("hidden", !isRegister);
    if (pwd) {
      pwd.autocomplete = isRegister ? "new-password" : "current-password";
      pwd.placeholder = isRegister ? "Strong password (8+ chars)" : "Your password";
    }
  }

  function showTitleRecoverMode(show) {
    const authForm = byId("title-auth-form");
    const recoverForm = byId("title-recover-form");
    if (authForm) authForm.classList.toggle("hidden", show);
    if (recoverForm) recoverForm.classList.toggle("hidden", !show);
    if (!show) {
      const linkBox = byId("title-recover-dev");
      if (linkBox) {
        linkBox.classList.add("hidden");
        linkBox.innerHTML = "";
      }
    }
  }

  /** Show same-origin recovery CTA when SMTP/email delivery is unavailable. */
  function showRecoveryLinkFallback(data) {
    const box = byId("title-recover-dev");
    if (!box) return;
    const url = data.recoveryUrl || data.devRecoveryUrl;
    if (!url) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML = `
      <p class="title-recover-fallback-msg">Continue below to reveal your username and choose a new password.</p>
      <a class="btn primary title-recover-continue" href="${esc(url)}">Continue to reset password</a>`;
  }

  function wireTitleScreen() {
    const form = byId("title-auth-form");
    const loginBtn = byId("title-auth-login");
    const registerBtn = byId("title-auth-register");
    const forgotBtn = byId("title-auth-forgot");
    const recoverForm = byId("title-recover-form");
    if (!form || form.dataset.wired) return;
    form.dataset.wired = "1";

    let registerMode = false;

    async function doLogin() {
      setTitleMessage("Logging in…");
      try {
        await apiPost("/auth/login", readTitleCreds());
        resetReviewShown();
        window.location.reload();
      } catch (e) {
        setTitleMessage(e.message, true);
        if (/recover|failed sign-ins|Forgot/i.test(e.message || "")) {
          showTitleRecoverMode(true);
          const data = e.data || {};
          if (data.recoveryUrl || data.devRecoveryUrl) {
            setTitleMessage(
              e.message ||
                "Too many failed sign-ins. Continue below to reset your password.",
              true
            );
            showRecoveryLinkFallback(data);
          }
        }
      }
    }

    async function doRegister() {
      if (!registerMode) {
        registerMode = true;
        showTitleRegisterMode(true);
        setTitleMessage(
          "Choose a strong password and add your email so you can recover this profile later.",
          false
        );
        byId("title-auth-email")?.focus();
        return;
      }
      setTitleMessage("Creating profile…");
      try {
        const creds = readTitleCreds();
        if (!creds.email) {
          setTitleMessage("Email is required when creating a profile.", true);
          return;
        }
        await apiPost("/auth/register", creds);
        resetReviewShown();
        window.location.reload();
      } catch (e) {
        setTitleMessage(e.message, true);
      }
    }

    byId("title-auth-password")?.addEventListener("input", () => {
      if (registerMode) {
        void refreshPasswordStrength(
          "title-auth-password",
          "title-auth-username",
          "title-password-strength"
        );
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void doLogin();
    });
    if (loginBtn) {
      loginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        registerMode = false;
        showTitleRegisterMode(false);
        void doLogin();
      });
    }
    if (registerBtn) {
      registerBtn.addEventListener("click", (e) => {
        e.preventDefault();
        void doRegister();
      });
    }
    if (forgotBtn) {
      forgotBtn.addEventListener("click", (e) => {
        e.preventDefault();
        showTitleRecoverMode(true);
        setTitleMessage("");
      });
    }
    byId("title-recover-back")?.addEventListener("click", () => {
      showTitleRecoverMode(false);
      setTitleMessage("");
    });
    if (recoverForm && !recoverForm.dataset.wired) {
      recoverForm.dataset.wired = "1";
      recoverForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setTitleMessage("Sending recovery link…");
        const email = (byId("title-recover-email") || {}).value || "";
        try {
          const data = await apiPost("/auth/recover/request", { email });
          setTitleMessage(data.message || "Check your email for a recovery link.");
          if (data.recoveryUrl || data.devRecoveryUrl) {
            showRecoveryLinkFallback(data);
          } else {
            showRecoveryLinkFallback({});
          }
        } catch (err) {
          setTitleMessage(err.message, true);
        }
      });
    }
  }

  function updateBrandSignedIn(username) {
    const brand = document.querySelector(".sidebar-brand");
    if (!brand) return;
    let badge = brand.querySelector(".brand-signed-in");
    if (username) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "brand-signed-in";
        brand.appendChild(badge);
      }
      badge.textContent = `(signed in as ${username})`;
      badge.hidden = false;
    } else if (badge) {
      badge.hidden = true;
      badge.textContent = "";
    }
  }

  function showAuthState(user) {
    updateBrandSignedIn(user && user.username ? user.username : null);
    const outEl = byId("auth-logged-out");
    const inEl = byId("auth-logged-in");
    if (!outEl || !inEl) return;
    if (user && user.username) {
      outEl.classList.add("hidden");
      inEl.classList.remove("hidden");
      const nameEl = byId("auth-current-user");
      if (nameEl) {
        nameEl.textContent = user.username;
        if (user.isAdmin) nameEl.textContent += " (primary mod)";
      }
      const emailEl = byId("auth-profile-email");
      if (emailEl) emailEl.value = user.email || "";
      const presets = user.presets || {};
      if (byId("preset-workuse")) byId("preset-workuse").value = presets.defaultWorkUsePercent ?? "";
      if (byId("preset-category")) byId("preset-category").value = presets.defaultCategory ?? "";
    } else {
      outEl.classList.remove("hidden");
      inEl.classList.add("hidden");
    }
    const adminPanel = byId("admin-panel");
    if (adminPanel) {
      if (user && user.isAdmin) adminPanel.classList.remove("hidden");
      else adminPanel.classList.add("hidden");
    }
  }

  const fmt = (n) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);

  function fmtDate(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("en-AU");
    } catch {
      return String(d);
    }
  }

  let adminSelected = null;

  function setAdminCreateMessage(msg, isError) {
    const el = byId("admin-create-message");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "var(--red)" : "";
  }

  async function deleteAdminUser(username) {
    const ok = window.confirm(
      `Delete profile "${username}"?\n\nTheir login, expenses, income, and scanned files will be permanently removed. This cannot be undone.`
    );
    if (!ok) return;
    try {
      await apiDelete(`/admin/users/${encodeURIComponent(username)}`);
      if (adminSelected === username) {
        adminSelected = null;
        renderAdminDetail(null);
      }
      if (window.toast) window.toast(`Deleted ${username}`);
      await loadAdminUsers();
    } catch (e) {
      if (window.toast) window.toast(e.message);
      else window.alert(e.message);
    }
  }

  function renderAdminList(users) {
    const list = byId("admin-user-list");
    if (!list) return;
    const all = users || [];
    const others = all.filter((u) => !u.isAdmin);
    const note = byId("admin-empty-note");

    if (!all.length) {
      list.innerHTML = `<p class="admin-empty">No profiles yet.</p>`;
      if (note) {
        note.textContent =
          "Create a driver profile above, or ask them to register on this same app URL.";
      }
      return;
    }

    if (note) {
      note.textContent = others.length
        ? `${others.length} driver profile${others.length === 1 ? "" : "s"} · open a row to review (read-only), or delete a profile you no longer need.`
        : "No other driver profiles yet. Create one above when someone requests access.";
    }

    // Show drivers first, then the admin account.
    const ordered = [...others, ...all.filter((u) => u.isAdmin)];
    list.innerHTML = ordered
      .map((u) => {
        const totals = u.totals || {};
        const counts = u.counts || {};
        const badge = u.isAdmin ? `<span class="admin-badge">primary mod</span>` : "";
        const active = adminSelected === u.username ? " active" : "";
        const deleteBtn = u.isAdmin
          ? ""
          : `<button type="button" class="btn danger small" data-admin-del="${esc(u.username)}">Delete</button>`;
        return `<div class="admin-user-row${active}">
          <button type="button" class="admin-user-row-main" data-admin-user="${esc(u.username)}">
            <div>
              <div class="admin-user-name">${esc(u.username)}${badge}</div>
              <div class="admin-user-meta">${esc(u.profileName || "No driver name")} · ${esc(u.email || "no email")} · ${counts.expenses || 0} expenses · ${counts.income || 0} income · ${counts.receipts || 0} receipts · joined ${fmtDate(u.createdAt)}</div>
            </div>
            <div class="admin-user-totals">
              <div>Gross ${fmt(totals.grossIncome)}</div>
              <div class="muted">Taxable ${fmt(totals.netTaxableIncome)}</div>
            </div>
          </button>
          <div class="admin-user-row-actions">${deleteBtn}</div>
        </div>`;
      })
      .join("");

    list.querySelectorAll("[data-admin-user]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void openAdminUser(btn.getAttribute("data-admin-user"));
      });
    });
    list.querySelectorAll("[data-admin-del]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void deleteAdminUser(btn.getAttribute("data-admin-del"));
      });
    });
  }

  function renderAdminDetail(data) {
    const detail = byId("admin-user-detail");
    if (!detail) return;
    if (!data) {
      detail.classList.add("hidden");
      detail.innerHTML = "";
      return;
    }
    const s = data.summary || {};
    const profile = data.profile || {};
    const expenses = (data.expenses || []).slice(0, 40);
    const income = (data.income || []).slice(0, 40);
    const receipts = data.receipts || [];

    const expenseRows = expenses
      .map(
        (e) =>
          `<tr><td>${esc(fmtDate(e.date))}</td><td>${esc(e.vendor || e.description || "—")}</td><td>${esc(e.category || "")}</td><td class="amount">${fmt(e.amount)}</td></tr>`
      )
      .join("");
    const incomeRows = income
      .map(
        (i) =>
          `<tr><td>${esc(fmtDate(i.date))}</td><td>${esc(i.entity || i.payer || "—")}</td><td>${esc(i.type || "")}</td><td class="amount">${fmt(i.grossTotal ?? i.amount)}</td></tr>`
      )
      .join("");
    const receiptRows = receipts
      .map((r) => {
        const link = r.hasImage
          ? `<a href="${API}/admin/users/${encodeURIComponent(data.user.username)}/receipts/${r.id}/file?download=1" target="_blank" rel="noopener">Download</a>`
          : "—";
        return `<tr><td>${esc(r.filename || r.id)}</td><td>${esc(r.mimeType || "")}</td><td>${esc(fmtDate(r.createdAt))}</td><td>${link}</td></tr>`;
      })
      .join("");

    const canDelete = data.user && !data.user.isAdmin;
    detail.classList.remove("hidden");
    detail.innerHTML = `
      <div class="admin-detail-head">
        <h3>${esc(data.user.username)}${data.user.isAdmin ? ' <span class="admin-badge">primary mod</span>' : ""}</h3>
        ${canDelete ? `<button type="button" class="btn danger" id="admin-detail-delete">Delete profile</button>` : ""}
        <button type="button" class="btn secondary" id="admin-detail-close">Close</button>
      </div>
      <p class="muted">${esc(profile.name || "Unnamed driver")} · ${esc(profile.driverType || "—")} · ${esc(profile.employer || "No employer")} · FY ${esc(profile.financialYear || "—")}</p>
      <p class="muted">Account email: <strong>${esc((data.user && data.user.email) || "not set")}</strong></p>
      <div class="admin-stat-row">
        <div class="admin-stat"><div class="label">Gross Income</div><div class="value">${fmt(s.income && s.income.assessableTotal)}</div></div>
        <div class="admin-stat"><div class="label">Deductible expenses</div><div class="value">${fmt(s.expenses && s.expenses.deductibleTotal)}</div></div>
        <div class="admin-stat"><div class="label">Net Taxable Income</div><div class="value">${fmt(s.taxEstimate && s.taxEstimate.taxableIncome)}</div></div>
        <div class="admin-stat"><div class="label">Est. tax</div><div class="value">${fmt(s.taxEstimate && s.taxEstimate.totalTax)}</div></div>
      </div>
      <div class="admin-section">
        <h4>Income (${income.length}${data.income && data.income.length > income.length ? "+" : ""})</h4>
        <div class="admin-table-wrap">${
          incomeRows
            ? `<table class="admin-table"><thead><tr><th>Date</th><th>Entity</th><th>Type</th><th>Gross</th></tr></thead><tbody>${incomeRows}</tbody></table>`
            : `<p class="admin-empty">No income entries.</p>`
        }</div>
      </div>
      <div class="admin-section">
        <h4>Expenses (${expenses.length}${data.expenses && data.expenses.length > expenses.length ? "+" : ""})</h4>
        <div class="admin-table-wrap">${
          expenseRows
            ? `<table class="admin-table"><thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Amount</th></tr></thead><tbody>${expenseRows}</tbody></table>`
            : `<p class="admin-empty">No expense entries.</p>`
        }</div>
      </div>
      <div class="admin-section">
        <h4>Receipts (${receipts.length})</h4>
        <div class="admin-table-wrap">${
          receiptRows
            ? `<table class="admin-table"><thead><tr><th>File</th><th>Type</th><th>Added</th><th></th></tr></thead><tbody>${receiptRows}</tbody></table>`
            : `<p class="admin-empty">No scanned files.</p>`
        }</div>
      </div>`;

    byId("admin-detail-close")?.addEventListener("click", () => {
      adminSelected = null;
      renderAdminDetail(null);
      const list = byId("admin-user-list");
      list?.querySelectorAll(".admin-user-row.active").forEach((el) => el.classList.remove("active"));
    });
    byId("admin-detail-delete")?.addEventListener("click", () => {
      void deleteAdminUser(data.user.username);
    });
  }

  async function loadAdminUsers() {
    const panel = byId("admin-panel");
    if (!panel || panel.classList.contains("hidden")) return;
    const data = await apiGet("/admin/users");
    if (data.error) {
      byId("admin-user-list").innerHTML = `<p class="admin-empty">${esc(data.error)}</p>`;
      return;
    }
    renderAdminList(data.users || []);
  }

  async function openAdminUser(username) {
    adminSelected = username;
    byId("admin-user-list")
      ?.querySelectorAll(".admin-user-row")
      .forEach((el) => {
        el.classList.toggle("active", el.getAttribute("data-admin-user") === username);
      });
    const detail = byId("admin-user-detail");
    if (detail) {
      detail.classList.remove("hidden");
      detail.innerHTML = `<p class="muted">Loading ${esc(username)}…</p>`;
    }
    const data = await apiGet(`/admin/users/${encodeURIComponent(username)}`);
    if (data.error) {
      detail.innerHTML = `<p class="admin-empty">${esc(data.error)}</p>`;
      return;
    }
    renderAdminDetail(data);
  }

  function renderAlerts(alerts, user) {
    const main = document.querySelector(".main");
    if (!main) return;
    let bar = byId("enh-alerts");
    if (bar) bar.remove();
    if (!alerts || !alerts.length) return;
    // /alerts may return a public user object or a bare username string.
    bar = document.createElement("div");
    bar.id = "enh-alerts";
    bar.className = "enh-alerts";
    const items = alerts
      .map((a) => {
        const code = a.code || "";
        const goProfile =
          code === "missing_email" || code === "password_age"
            ? ` <button type="button" class="btn link enh-alert-go-profile" data-alert-code="${esc(code)}">Open Profile</button>`
            : "";
        return `<li class="enh-alert enh-alert-${esc(a.level || "info")}">${esc(a.message)}${goProfile}</li>`;
      })
      .join("");
    const whoName = user && typeof user === "object" ? user.username : user;
    const who = whoName
      ? `Signed in as ${esc(whoName)}`
      : "Guest (create a profile to save your data)";
    bar.innerHTML = `
      <div class="enh-alerts-head">
        <strong>Review needed</strong>
        <span class="muted">${who}</span>
        <button type="button" class="enh-alerts-close" aria-label="Dismiss">×</button>
      </div>
      <ul class="enh-alerts-list">${items}</ul>`;
    bar.querySelector(".enh-alerts-close").addEventListener("click", () => bar.remove());
    bar.querySelectorAll(".enh-alert-go-profile").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nav = document.querySelector('.nav-btn[data-view="profile"]');
        if (nav) nav.click();
        else if (typeof window.setView === "function") window.setView("profile");
        byId("auth-profile-email")?.focus();
      });
    });
    const topbar = main.querySelector(".topbar");
    if (topbar && topbar.nextSibling) main.insertBefore(bar, topbar.nextSibling);
    else main.insertBefore(bar, main.firstChild);
  }

  function readCreds() {
    return {
      username: (byId("auth-username") || {}).value || "",
      password: (byId("auth-password") || {}).value || "",
      email: (byId("auth-email") || {}).value || "",
    };
  }

  function wire() {
    const register = byId("auth-register");
    const login = byId("auth-login");
    const logout = byId("auth-logout");
    const savePresets = byId("auth-save-presets");
    const saveEmail = byId("auth-save-email");
    const changePassword = byId("auth-change-password");

    byId("auth-password")?.addEventListener("input", () => {
      void refreshPasswordStrength("auth-password", "auth-username", "auth-password-strength");
    });
    byId("auth-new-password")?.addEventListener("input", () => {
      void refreshPasswordStrength(
        "auth-new-password",
        "auth-current-user",
        "auth-new-password-strength"
      );
    });

    if (register) {
      register.addEventListener("click", async () => {
        setMessage("Creating profile… Use a strong password and include your email.");
        try {
          const creds = readCreds();
          if (!creds.email) {
            setMessage("Email is required when creating a profile.", true);
            return;
          }
          await apiPost("/auth/register", creds);
          resetReviewShown();
          window.location.reload();
        } catch (e) {
          setMessage(e.message, true);
        }
      });
    }
    if (login) {
      login.addEventListener("click", async () => {
        setMessage("Logging in…");
        try {
          await apiPost("/auth/login", readCreds());
          resetReviewShown();
          window.location.reload();
        } catch (e) {
          setMessage(e.message, true);
        }
      });
    }
    if (logout) {
      logout.addEventListener("click", async () => {
        try {
          await apiPost("/auth/logout", {});
        } catch {
          /* ignore */
        }
        resetReviewShown();
        window.location.reload();
      });
    }
    if (saveEmail) {
      saveEmail.addEventListener("click", async () => {
        try {
          const data = await apiPost("/auth/email", {
            email: (byId("auth-profile-email") || {}).value || "",
          });
          showAuthState(data.user);
          if (window.toast) window.toast("Email saved");
          const alertData = await apiGet("/alerts");
          renderAlerts(alertData.alerts, alertData.user);
        } catch (e) {
          if (window.toast) window.toast(e.message);
        }
      });
    }
    if (changePassword) {
      changePassword.addEventListener("click", async () => {
        try {
          const data = await apiPost("/auth/change-password", {
            currentPassword: (byId("auth-current-password") || {}).value || "",
            newPassword: (byId("auth-new-password") || {}).value || "",
          });
          showAuthState(data.user);
          if (byId("auth-current-password")) byId("auth-current-password").value = "";
          if (byId("auth-new-password")) byId("auth-new-password").value = "";
          if (window.toast) window.toast("Password updated");
          const alertData = await apiGet("/alerts");
          renderAlerts(alertData.alerts, alertData.user);
        } catch (e) {
          if (window.toast) window.toast(e.message);
        }
      });
    }
    if (savePresets) {
      savePresets.addEventListener("click", async () => {
        const presets = {
          defaultWorkUsePercent: Number((byId("preset-workuse") || {}).value) || undefined,
          defaultCategory: (byId("preset-category") || {}).value || undefined,
        };
        try {
          await apiPost("/auth/presets", presets);
          if (window.toast) window.toast("Presets saved");
        } catch (e) {
          if (window.toast) window.toast(e.message);
        }
      });
    }

    const adminRefresh = byId("admin-refresh");
    if (adminRefresh) {
      adminRefresh.addEventListener("click", () => {
        void loadAdminUsers();
      });
    }

    const createForm = byId("admin-create-user-form");
    if (createForm) {
      createForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = (byId("admin-new-username") || {}).value || "";
        const password = (byId("admin-new-password") || {}).value || "";
        const email = (byId("admin-new-email") || {}).value || "";
        setAdminCreateMessage("Creating profile…");
        try {
          const data = await apiPost("/admin/users", { username, password, email });
          setAdminCreateMessage(
            `Created ${data.user.username}. Share the username and temporary password so they can log in and change it if needed.`
          );
          createForm.reset();
          if (window.toast) window.toast(`Created profile ${data.user.username}`);
          await loadAdminUsers();
        } catch (err) {
          setAdminCreateMessage(err.message, true);
        }
      });
    }
  }

  function wirePdfDownload() {
    const btn = byId("download-report-pdf");
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      const fySel = byId("fy-select");
      const fy = fySel && fySel.value ? fySel.value : "";
      const url = `${API}/report.pdf${fy ? `?financialYear=${encodeURIComponent(fy)}` : ""}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `haulage-eofy-${fy || "report"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (window.toast) window.toast("Preparing EOFY PDF…");
    });
  }

  // "Review needed" is shown once per login session (not re-shown as the user
  // updates their expense/income uploads). The flag lives in sessionStorage and
  // is reset on any auth change so the next login shows it again once.
  const REVIEW_FLAG = "enh-review-shown";
  function reviewAlreadyShown() {
    try {
      return sessionStorage.getItem(REVIEW_FLAG) === "1";
    } catch {
      return false;
    }
  }
  function markReviewShown() {
    try {
      sessionStorage.setItem(REVIEW_FLAG, "1");
    } catch {
      /* ignore */
    }
  }
  function resetReviewShown() {
    try {
      sessionStorage.removeItem(REVIEW_FLAG);
    } catch {
      /* ignore */
    }
  }

  async function start() {
    wire();
    wireTitleScreen();
    wirePdfDownload();
    try {
      const me = await apiGet("/auth/me");
      if (me.user && me.user.username) {
        unlockApp();
        showAuthState(me.user);
        if (me.user.isAdmin) await loadAdminUsers();
        // Only fetch/show the review banner the first time this session — once on
        // login — so it does not keep reappearing as uploads are added/updated.
        if (!reviewAlreadyShown()) {
          const alertData = await apiGet("/alerts");
          renderAlerts(alertData.alerts, alertData.user);
          markReviewShown();
        }
      } else {
        lockApp();
        showAuthState(null);
        // Focus the title login field for keyboard users.
        byId("title-auth-username")?.focus();
      }
    } catch {
      lockApp();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/*
 * Dashboard "Snapshot" → income-vs-expenses pie/donut with the net position in
 * the centre. Reads the live /summary response and re-renders into
 * #snapshot-content whenever app.js rewrites it (FY change / new data).
 */
(function () {
  "use strict";

  let latest = null;

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (url && /\/summary(\?|$)/.test(url)) {
        const data = await res.clone().json();
        if (data && data.income && data.expenses) {
          latest = data;
          render();
        }
      }
    } catch {
      /* non-fatal */
    }
    return res;
  };

  const fmt = (n) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render() {
    const host = document.getElementById("snapshot-content");
    if (!host || !latest) return;
    if (host.querySelector(".enh-snapshot")) return; // already rendered for this pass

    const income = Number(latest.income.assessableTotal) || 0;
    const expenses = Number(latest.expenses.grossTotal) || 0;
    const net = Math.round((income - expenses) * 100) / 100;
    const total = income + expenses;
    const incPct = total > 0 ? (income / total) * 100 : 0;

    // Preserve the substantiation message. Drop dashboard-noise warnings such
    // as "Unknown expense category." — those are not useful on this page.
    const msg = (host.querySelector("p.muted") && host.querySelector("p.muted").textContent) || "";
    const warnList = host.querySelector(".warning-list");
    let warn = "";
    if (warnList) {
      const kept = [...warnList.querySelectorAll("li")].filter(
        (li) => !/unknown\s+expense\s+categor/i.test(li.textContent || "")
      );
      if (kept.length) {
        warn = `<ul class="warning-list">${kept.map((li) => li.outerHTML).join("")}</ul>`;
      }
    }
    const afterTax =
      latest.taxEstimate && latest.taxEstimate.totalTax != null
        ? income - Number(latest.taxEstimate.totalTax)
        : null;

    let chart;
    if (total <= 0) {
      chart = `<div class="enh-snapshot enh-snapshot-empty">
          <div class="enh-pie-wrap"><div class="enh-pie enh-pie-empty"></div>
            <div class="enh-pie-center"><span class="enh-pie-net-label">Net</span><span class="enh-pie-net">${fmt(0)}</span></div>
          </div>
          <p class="muted">Add income or expenses to see your position.</p>
        </div>`;
    } else {
      chart = `<div class="enh-snapshot">
          <div class="enh-pie-wrap">
            <div class="enh-pie" style="background: conic-gradient(var(--green) 0 ${incPct}%, var(--red) ${incPct}% 100%)"></div>
            <div class="enh-pie-center">
              <span class="enh-pie-net-label">Net position</span>
              <span class="enh-pie-net ${net >= 0 ? "pos" : "neg"}">${fmt(net)}</span>
            </div>
          </div>
          <div class="enh-pie-side">
            <ul class="enh-pie-legend">
              <li><span class="enh-dot enh-dot-green"></span>Income <strong>${fmt(income)}</strong></li>
              <li><span class="enh-dot enh-dot-red"></span>Expenses <strong>${fmt(expenses)}</strong></li>
              <li class="enh-pie-net-row">Net position <strong class="${net >= 0 ? "enh-pos" : "enh-neg"}">${fmt(net)}</strong></li>
            </ul>
            ${afterTax != null ? `<p class="muted enh-aftertax">After estimated tax: <strong>${fmt(afterTax)}</strong></p>` : ""}
          </div>
        </div>`;
    }

    host.innerHTML = `${chart}${msg ? `<p class="muted">${esc(msg)}</p>` : ""}${warn}`;
  }

  const observer = new MutationObserver(() => {
    const host = document.getElementById("snapshot-content");
    if (host && latest && !host.querySelector(".enh-snapshot")) render();
  });

  function start() {
    const host = document.getElementById("snapshot-content");
    if (host) observer.observe(host, { childList: true });
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Receipt gallery: show labeled filename (DD.MM.YY AUD$…) ------------- */
(function () {
  "use strict";
  /* global state */

  const LABEL_RE = /^\d{2}\.\d{2}\.\d{2}\s+AUD\$/;

  function findReceipt(id) {
    try {
      const receipts = state && state.records && state.records.receipts ? state.records.receipts : [];
      return receipts.find((r) => r.id === id);
    } catch {
      return null;
    }
  }

  function labelGalleryCards() {
    const gallery = document.getElementById("receipt-gallery");
    if (!gallery) return;
    gallery.querySelectorAll(".receipt-card[data-receipt-card], .receipt-card[data-receipt-id]").forEach((card) => {
      if (card.dataset.enhLabeled === "1") return;
      const receiptId = card.dataset.receiptCard || card.dataset.receiptId;
      const receipt = findReceipt(receiptId);
      if (!receipt || !receipt.filename) return;
      const name = String(receipt.filename);
      if (!LABEL_RE.test(name) && name === "manual-entry") return;
      const strong = card.querySelector(".receipt-card-meta strong");
      if (strong) {
        strong.textContent = name.replace(/\.[a-z0-9]+$/i, "");
        strong.title = name;
      }
      const openBtn = card.querySelector(".receipt-card-open") || card;
      openBtn.setAttribute("aria-label", `View ${name}`);
      card.dataset.enhLabeled = "1";
    });
  }

  function start() {
    const gallery = document.getElementById("receipt-gallery");
    if (!gallery) return;
    const mo = new MutationObserver(() => labelGalleryCards());
    mo.observe(gallery, { childList: true, subtree: true });
    labelGalleryCards();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Shared Mon–Sun week helpers (expense ledger + galleries + Monday roll) */
(function () {
  "use strict";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toIsoLocal(dt) {
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }

  function weekStartMonday(dateStr) {
    const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(dt.getTime())) return null;
    const day = dt.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff);
    return toIsoLocal(dt);
  }

  function weekEndSunday(startIso) {
    const m = String(startIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    dt.setDate(dt.getDate() + 6);
    return toIsoLocal(dt);
  }

  function weekLabel(startIso, endIso) {
    const a = String(startIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const b = String(endIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!a || !b) return startIso || "";
    const left = `${a[3]}/${a[2]}`;
    const right = `${b[3]}/${b[2]}`;
    if (a[1] !== b[1]) return `${left}/${a[1].slice(-2)} – ${right}/${b[1].slice(-2)}`;
    return `${left} – ${right}`;
  }

  function currentWeekStart(now = new Date()) {
    return weekStartMonday(toIsoLocal(now));
  }

  const STARTED_KEY = "haulage-started-weeks";
  const ACTIVE_KEY = "haulage-active-week-start";

  function listStartedWeeks() {
    try {
      const raw = JSON.parse(localStorage.getItem(STARTED_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)) : [];
    } catch {
      return [];
    }
  }

  /** Persist a week slot the driver can open even before any receipt is saved. */
  function registerStartedWeek(startIso) {
    if (!startIso || !/^\d{4}-\d{2}-\d{2}$/.test(startIso)) return;
    const list = [...new Set([...listStartedWeeks(), startIso])].sort();
    try {
      localStorage.setItem(STARTED_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }

  function getActiveWeekStart() {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  }

  function setActiveWeekStart(startIso) {
    if (!startIso || !/^\d{4}-\d{2}-\d{2}$/.test(startIso)) return;
    try {
      localStorage.setItem(ACTIVE_KEY, startIso);
    } catch {
      /* ignore */
    }
  }

  globalThis.HaulageWeeks = {
    pad2,
    toIsoLocal,
    weekStartMonday,
    weekEndSunday,
    weekLabel,
    currentWeekStart,
    listStartedWeeks,
    registerStartedWeek,
    getActiveWeekStart,
    setActiveWeekStart,
    ACTIVE_KEY,
    STARTED_KEY,
  };
})();

/* --- Per-financial-year (+ week) selector on the document photo galleries -
 * Segments "Expense receipt photos" and "Income document photos" by Australian
 * financial year. Expense receipts also get a Mon–Sun week dropdown
 * (e.g. 27/07 – 02/08) beside the FY picker so large galleries stay scannable.
 */
(function () {
  "use strict";
  /* global getReceiptsWithImages, receiptSummary, formatFinancialYearLabel, getCurrentFinancialYear, HaulageWeeks */

  const GALLERIES = [
    { containerId: "receipt-gallery", purpose: "expense", key: "expense", weekFilter: true },
    { containerId: "income-gallery", purpose: "income", key: "income", weekFilter: false },
  ];

  // Remembers each gallery's chosen FY ("all" or e.g. "2025-26"); null = not set.
  const chosenFy = { expense: null, income: null };
  const chosenWeek = { expense: null, income: null };

  const {
    toIsoLocal,
    weekStartMonday,
    weekEndSunday,
    weekLabel,
    listStartedWeeks,
    registerStartedWeek,
  } = HaulageWeeks;

  function weekStorageKey(key) {
    return `haulage-gallery-week-${key}`;
  }

  function getStoredWeek(key) {
    try {
      return localStorage.getItem(weekStorageKey(key));
    } catch {
      return null;
    }
  }

  function setStoredWeek(key, value) {
    try {
      if (!value || value === "all") localStorage.removeItem(weekStorageKey(key));
      else localStorage.setItem(weekStorageKey(key), value);
    } catch {
      /* ignore */
    }
  }

  /** Australian FY for a date (1 Jul – 30 Jun), mirroring the server. */
  function fyForDate(dateStr) {
    const raw = String(dateStr || "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    let year;
    let month; // 0-based
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]) - 1;
    } else {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return null;
      year = d.getFullYear();
      month = d.getMonth();
    }
    const startYear = month >= 6 ? year : year - 1;
    return `${startYear}-${String(startYear + 1).slice(-2)}`;
  }

  function findReceipt(id) {
    try {
      return (state.records.receipts || []).find((r) => r.id === id) || null;
    } catch {
      return null;
    }
  }

  /** Document date of a receipt, using the same date app.js shows on the card. */
  function receiptDate(receipt) {
    if (!receipt) return null;
    let date = null;
    try {
      if (typeof receiptSummary === "function") date = receiptSummary(receipt).date;
    } catch {
      date = null;
    }
    if (!date) date = (receipt.ocrResult && receipt.ocrResult.date) || receipt.createdAt || null;
    const m = String(date || "").match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  /** FY of a receipt, using the same date app.js shows on the card. */
  function receiptFy(receipt) {
    return fyForDate(receiptDate(receipt));
  }

  function fyLabel(fy) {
    try {
      if (typeof formatFinancialYearLabel === "function") return formatFinancialYearLabel(fy);
    } catch {
      /* fall through */
    }
    return `FY ${fy}`;
  }

  /** Options: "All", then FYs in the 6-past/3-future window in this gallery. */
  function optionsHtml(purpose, selected) {
    const set = new Set();
    let list = [];
    try {
      if (typeof getReceiptsWithImages === "function") list = getReceiptsWithImages(purpose) || [];
    } catch {
      list = [];
    }

    // Same window as the top-bar FY picker (lib/fy-window.js / override below).
    let allowed = null;
    try {
      const top = document.getElementById("fy-select");
      if (top && top.options && top.options.length) {
        allowed = new Set(
          [...top.options].map((o) => o.value).filter((v) => v && v !== "all")
        );
      }
    } catch {
      allowed = null;
    }

    for (const r of list) {
      const fy = receiptFy(r);
      if (!fy) continue;
      if (allowed && !allowed.has(fy)) continue;
      set.add(fy);
    }
    try {
      if (typeof getCurrentFinancialYear === "function") {
        const cur = getCurrentFinancialYear();
        if (!allowed || allowed.has(cur)) set.add(cur);
      }
    } catch {
      /* ignore */
    }
    if (state && state.financialYear) {
      if (!allowed || allowed.has(state.financialYear)) set.add(state.financialYear);
    }
    if (selected && selected !== "all") set.add(selected);

    const years = [...set].sort(
      (a, b) => Number(b.split("-")[0]) - Number(a.split("-")[0])
    );
    return [`<option value="all">All financial years</option>`]
      .concat(years.map((y) => `<option value="${y}">${fyLabel(y)}</option>`))
      .join("");
  }

  function ensureSelector(cfg) {
    const container = document.getElementById(cfg.containerId);
    if (!container) return null;
    const panel = container.closest(".panel");
    const header = panel && panel.querySelector(".panel-header");
    if (!header) return null;

    let actions = header.querySelector(".gallery-header-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "ledger-header-actions gallery-header-actions";
      header.appendChild(actions);
    }

    // Move any legacy FY picker that was appended directly on the header.
    header.querySelectorAll(":scope > .gallery-fy-picker").forEach((el) => {
      actions.appendChild(el);
    });

    let picker = actions.querySelector(".gallery-fy-picker");
    if (!picker) {
      picker = document.createElement("div");
      picker.className = "fy-picker gallery-fy-picker";
      picker.innerHTML =
        `<label for="gallery-fy-${cfg.key}">Financial year</label>` +
        `<select id="gallery-fy-${cfg.key}" class="gallery-fy-select" aria-label="Filter document photos by financial year"></select>`;
      actions.appendChild(picker);
      const select = picker.querySelector("select");
      select.addEventListener("change", () => {
        chosenFy[cfg.key] = select.value;
        // Changing FY resets week to the current week in that year (or all).
        if (cfg.weekFilter) {
          chosenWeek[cfg.key] = null;
          setStoredWeek(cfg.key, null);
        }
        applyFilter(cfg);
      });
    }

    if (cfg.weekFilter && !actions.querySelector(".gallery-week-picker")) {
      const weekPicker = document.createElement("div");
      weekPicker.className = "fy-picker gallery-fy-picker gallery-week-picker";
      weekPicker.innerHTML =
        `<label for="gallery-week-${cfg.key}">Week</label>` +
        `<select id="gallery-week-${cfg.key}" class="gallery-week-select" aria-label="Filter expense receipts by week"></select>`;
      actions.appendChild(weekPicker);
      weekPicker.querySelector("select").addEventListener("change", (e) => {
        chosenWeek[cfg.key] = e.target.value;
        setStoredWeek(cfg.key, e.target.value);
        if (e.target.value && e.target.value !== "all") {
          registerStartedWeek(e.target.value);
        }
        applyFilter(cfg);
      });
    }

    if (!panel.querySelector(".gallery-fy-empty")) {
      const note = document.createElement("p");
      note.className = "muted gallery-fy-empty hidden";
      container.insertAdjacentElement("afterend", note);
    }
    return {
      fySelect: picker.querySelector("select"),
      weekSelect: actions.querySelector(".gallery-week-select"),
    };
  }

  function collectExpenseWeeks(fy) {
    const map = new Map();
    let list = [];
    try {
      if (typeof getReceiptsWithImages === "function") list = getReceiptsWithImages("expense") || [];
    } catch {
      list = [];
    }
    for (const r of list) {
      const date = receiptDate(r);
      if (!date || (fy && fy !== "all" && fyForDate(date) !== fy)) continue;
      const start = weekStartMonday(date);
      if (!start) continue;
      if (!map.has(start)) map.set(start, { start, end: weekEndSunday(start) });
    }
    // Weeks the app has opened for the driver (including empty new Mondays).
    for (const start of listStartedWeeks()) {
      if (fy && fy !== "all" && fyForDate(start) !== fy && fyForDate(weekEndSunday(start)) !== fy) {
        continue;
      }
      if (!map.has(start)) map.set(start, { start, end: weekEndSunday(start) });
    }
    // Always offer the current week when it falls in the selected FY.
    const today = toIsoLocal(new Date());
    const curStart = weekStartMonday(today);
    if (curStart && (!fy || fy === "all" || fyForDate(curStart) === fy || fyForDate(weekEndSunday(curStart)) === fy)) {
      if (!map.has(curStart)) map.set(curStart, { start: curStart, end: weekEndSunday(curStart) });
      registerStartedWeek(curStart);
    }
    return [...map.values()].sort((a, b) => b.start.localeCompare(a.start));
  }

  function syncGalleryWeekOptions(cfg, weekSelect, fy) {
    if (!weekSelect) return "all";
    const weeks = collectExpenseWeeks(fy);
    const stored = chosenWeek[cfg.key] != null ? chosenWeek[cfg.key] : getStoredWeek(cfg.key);
    const todayStart = weekStartMonday(toIsoLocal(new Date()));
    let chosen = stored;
    if (chosen == null) {
      // Default: this week when it has (or will have) a slot, else all weeks.
      chosen = weeks.some((w) => w.start === todayStart) ? todayStart : "all";
    }
    if (chosen !== "all" && !weeks.some((w) => w.start === chosen)) {
      chosen = weeks.some((w) => w.start === todayStart) ? todayStart : "all";
    }
    chosenWeek[cfg.key] = chosen;

    const opts = [`<option value="all">All weeks</option>`].concat(
      weeks.map((w) => {
        const label = weekLabel(w.start, w.end);
        const isCurrent = w.start === todayStart ? " (this week)" : "";
        return `<option value="${w.start}">${label}${isCurrent}</option>`;
      })
    );
    const html = opts.join("");
    if (weekSelect.innerHTML !== html) weekSelect.innerHTML = html;
    if (weekSelect.value !== chosen) weekSelect.value = chosen;
    return weekSelect.value || "all";
  }

  function applyFilter(cfg) {
    const container = document.getElementById(cfg.containerId);
    if (!container) return;
    const sels = ensureSelector(cfg);
    if (!sels || !sels.fySelect) return;
    const select = sels.fySelect;

    // Default to the top-of-screen FY once it is known; until then show all.
    if (chosenFy[cfg.key] == null && state && state.financialYear) {
      chosenFy[cfg.key] = state.financialYear;
    }
    const chosen = chosenFy[cfg.key] || "all";

    // Only rebuild options when they actually change, so an open dropdown is
    // not clobbered by the initial settle poll.
    const nextOptions = optionsHtml(cfg.purpose, chosen);
    if (select.innerHTML !== nextOptions) select.innerHTML = nextOptions;
    if (select.value !== chosen) select.value = chosen;
    if (select.value !== chosen) {
      select.value = "all";
      chosenFy[cfg.key] = "all";
    }
    const active = select.value;
    const week =
      cfg.weekFilter && sels.weekSelect
        ? syncGalleryWeekOptions(cfg, sels.weekSelect, active)
        : "all";

    const cards = container.querySelectorAll(
      ".receipt-card[data-receipt-card], .receipt-card[data-receipt-id]"
    );
    let total = 0;
    let shown = 0;
    cards.forEach((card) => {
      total += 1;
      const id = card.dataset.receiptCard || card.dataset.receiptId;
      const receipt = findReceipt(id);
      const fy = receiptFy(receipt);
      let match = active === "all" || fy === active;
      if (match && week !== "all") {
        const date = receiptDate(receipt);
        match = Boolean(date) && weekStartMonday(date) === week;
      }
      card.style.display = match ? "" : "none";
      if (match) shown += 1;
    });

    const panel = container.closest(".panel");
    const note = panel && panel.querySelector(".gallery-fy-empty");
    if (note) {
      if (total > 0 && shown === 0) {
        const kind = cfg.purpose === "income" ? "income documents" : "expense receipts";
        let where = active === "all" ? "any financial year" : `FY ${active.replace("-", "–")}`;
        if (week !== "all") {
          const end = weekEndSunday(week);
          where += `, week ${weekLabel(week, end)}`;
        }
        note.textContent = `No ${kind} for ${where}. Switch the week or financial year above to see others.`;
        note.classList.remove("hidden");
      } else {
        note.classList.add("hidden");
      }
    }
  }

  function start() {
    let bound = false;
    for (const cfg of GALLERIES) {
      const container = document.getElementById(cfg.containerId);
      if (!container) continue;
      bound = true;
      const mo = new MutationObserver(() => applyFilter(cfg));
      mo.observe(container, { childList: true });
      applyFilter(cfg);
    }
    // The top FY picker re-renders the galleries, but a light poll lets the
    // selectors also settle once initial data has loaded.
    if (bound) {
      let ticks = 0;
      const iv = setInterval(() => {
        ticks += 1;
        for (const cfg of GALLERIES) applyFilter(cfg);
        if (ticks >= 10) clearInterval(iv);
      }, 400);
    }

    // Monday rollover: jump expense gallery to the new week entry.
    window.addEventListener("haulage:new-week", (ev) => {
      const startIso = ev.detail && ev.detail.weekStart;
      if (!startIso) return;
      chosenWeek.expense = startIso;
      setStoredWeek("expense", startIso);
      applyFilter(GALLERIES[0]);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Ledger refresh, FY/month filters, and row edit ----------------------
 * Layered on app.js (kept verbatim) by post-processing the rendered tables:
 * refresh invoice dates, FY picker, month dropdown (to shorten long lists),
 * hide outside-period tags, and Edit next to Delete (PUT /expenses|/income).
 */
(function () {
  "use strict";
  /* global API, toast, refreshAll, applyFinancialYear, buildCategorySelectOptions */

  const LEDGERS = [
    { listId: "income-list", tableSel: "table.income-ledger", idAttr: "data-income-id", type: "income" },
    { listId: "expense-list", tableSel: "table.expense-ledger", idAttr: "data-expense-id", type: "expense" },
  ];

  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const fmtCurrency = (n) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function apiBase() {
    return typeof API !== "undefined" && API ? API : `${window.location.origin}/api/haulage`;
  }

  /** Australian FY for a date (1 Jul – 30 Jun), mirroring the server. */
  function fyForDate(dateStr) {
    const raw = String(dateStr || "").trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    let year;
    let month;
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]) - 1;
    } else {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return null;
      year = d.getFullYear();
      month = d.getMonth();
    }
    const startYear = month >= 6 ? year : year - 1;
    return `${startYear}-${String(startYear + 1).slice(-2)}`;
  }

  function currentFy() {
    try {
      if (state && state.financialYear) return state.financialYear;
    } catch {
      /* ignore */
    }
    const top = document.getElementById("fy-select");
    return top ? top.value : null;
  }

  function findEntry(type, id) {
    try {
      const arr = type === "income" ? state.records.income : state.records.expenses;
      return (arr || []).find((e) => e.id === id) || null;
    } catch {
      return null;
    }
  }

  function periodStorageKey(type) {
    return `haulage-ledger-month-${type}`;
  }

  function weekLedgerStorageKey(type) {
    return `haulage-ledger-week-${type}`;
  }

  function getMonthFilter(type) {
    try {
      return localStorage.getItem(periodStorageKey(type)) || "all";
    } catch {
      return "all";
    }
  }

  function setMonthFilter(type, value) {
    try {
      localStorage.setItem(periodStorageKey(type), value || "all");
    } catch {
      /* ignore */
    }
  }

  function getWeekFilter(type) {
    try {
      return localStorage.getItem(weekLedgerStorageKey(type)) || null;
    } catch {
      return null;
    }
  }

  function setWeekFilter(type, value) {
    try {
      if (!value || value === "all") localStorage.removeItem(weekLedgerStorageKey(type));
      else localStorage.setItem(weekLedgerStorageKey(type), value);
    } catch {
      /* ignore */
    }
  }

  const {
    toIsoLocal,
    weekStartMonday,
    weekEndSunday,
    weekLabel,
    listStartedWeeks,
    registerStartedWeek,
  } = HaulageWeeks;

  /** Jul–Jun month options for an Australian financial year id like 2025-26. */
  function monthsForFy(fy) {
    const startYear = Number(String(fy || "").slice(0, 4));
    if (!Number.isFinite(startYear)) return [];
    const out = [];
    for (let m = 7; m <= 12; m += 1) {
      out.push({
        value: `${startYear}-${String(m).padStart(2, "0")}`,
        label: `${MONTH_NAMES[m - 1]} ${startYear}`,
      });
    }
    for (let m = 1; m <= 6; m += 1) {
      const y = startYear + 1;
      out.push({
        value: `${y}-${String(m).padStart(2, "0")}`,
        label: `${MONTH_NAMES[m - 1]} ${y}`,
      });
    }
    return out;
  }

  function entryMonthKey(dateStr) {
    const m = String(dateStr || "").match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : null;
  }

  /** Shared top-right actions container in a ledger panel header. */
  function ledgerActions(header) {
    let box = header.querySelector(".ledger-header-actions");
    if (!box) {
      box = document.createElement("div");
      box.className = "ledger-header-actions";
      header.appendChild(box);
    }
    return box;
  }

  function ensureRefreshButton(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const panel = list.closest(".panel");
    const header = panel && panel.querySelector(".panel-header");
    if (!header || header.querySelector(".refresh-invoice-dates-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn secondary small refresh-invoice-dates-btn";
    btn.textContent = "Refresh invoice dates";
    btn.title =
      "Re-scan uploaded documents and set each row's date to the invoice date, not the upload date.";
    btn.addEventListener("click", () => runRefresh(btn));
    ledgerActions(header).appendChild(btn);
  }

  // FY dropdown (same style as the photo galleries) that drives the app's
  // financial year, so the ledger, its totals and the dashboard all move
  // together when it changes.
  function ensureFyPicker(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const panel = list.closest(".panel");
    const header = panel && panel.querySelector(".panel-header");
    if (!header) return;
    const box = ledgerActions(header);
    if (box.querySelector(".ledger-fy-picker")) return;

    const picker = document.createElement("div");
    picker.className = "fy-picker gallery-fy-picker ledger-fy-picker";
    picker.innerHTML =
      `<label for="ledger-fy-${cfg.type}">Financial year</label>` +
      `<select id="ledger-fy-${cfg.type}" class="ledger-fy-select" aria-label="Show ledger for financial year"></select>`;
    box.appendChild(picker);
    const select = picker.querySelector("select");
    select.addEventListener("change", () => {
      const fy = select.value;
      if (typeof applyFinancialYear === "function") {
        applyFinancialYear(fy);
      } else {
        try {
          state.financialYear = fy;
        } catch {
          /* ignore */
        }
        applyLedgerFilters(cfg);
      }
    });
  }

  /** Month dropdown for income ledger (expense uses week-by-week instead). */
  function ensureMonthPicker(cfg) {
    if (cfg.type === "expense") return;
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const panel = list.closest(".panel");
    const header = panel && panel.querySelector(".panel-header");
    if (!header) return;
    const box = ledgerActions(header);
    if (box.querySelector(".ledger-month-picker")) return;

    const picker = document.createElement("div");
    picker.className = "fy-picker gallery-fy-picker ledger-month-picker";
    picker.innerHTML =
      `<label for="ledger-month-${cfg.type}">Show</label>` +
      `<select id="ledger-month-${cfg.type}" class="ledger-month-select" aria-label="Filter ledger by month"></select>`;
    box.appendChild(picker);
    const select = picker.querySelector("select");
    select.addEventListener("change", () => {
      setMonthFilter(cfg.type, select.value);
      applyLedgerFilters(cfg);
    });
  }

  /** Mon–Sun week dropdown for the expense ledger (e.g. 27/07 – 02/08). */
  function ensureWeekPicker(cfg) {
    if (cfg.type !== "expense") return;
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const panel = list.closest(".panel");
    const header = panel && panel.querySelector(".panel-header");
    if (!header) return;
    const box = ledgerActions(header);
    // Prefer week over the older month picker on expenses.
    const oldMonth = box.querySelector(".ledger-month-picker");
    if (oldMonth) oldMonth.remove();
    if (box.querySelector(".ledger-week-picker")) return;

    const picker = document.createElement("div");
    picker.className = "fy-picker gallery-fy-picker ledger-week-picker";
    picker.innerHTML =
      `<label for="ledger-week-${cfg.type}">Week</label>` +
      `<select id="ledger-week-${cfg.type}" class="ledger-week-select" aria-label="Filter expense ledger by week"></select>`;
    box.appendChild(picker);
    picker.querySelector("select").addEventListener("change", (e) => {
      setWeekFilter(cfg.type, e.target.value);
      if (e.target.value && e.target.value !== "all") {
        registerStartedWeek(e.target.value);
      }
      applyLedgerFilters(cfg);
    });
  }

  function collectLedgerWeeks(fy) {
    const map = new Map();
    let expenses = [];
    try {
      expenses = (state.records && state.records.expenses) || [];
    } catch {
      expenses = [];
    }
    for (const e of expenses) {
      const date = String(e.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (fy && fyForDate(date) !== fy) continue;
      const start = weekStartMonday(date);
      if (!start) continue;
      if (!map.has(start)) map.set(start, { start, end: weekEndSunday(start) });
    }
    for (const start of listStartedWeeks()) {
      if (fy && fyForDate(start) !== fy && fyForDate(weekEndSunday(start)) !== fy) continue;
      if (!map.has(start)) map.set(start, { start, end: weekEndSunday(start) });
    }
    const todayStart = weekStartMonday(toIsoLocal(new Date()));
    if (
      todayStart &&
      (!fy || fyForDate(todayStart) === fy || fyForDate(weekEndSunday(todayStart)) === fy)
    ) {
      if (!map.has(todayStart)) {
        map.set(todayStart, { start: todayStart, end: weekEndSunday(todayStart) });
      }
      registerStartedWeek(todayStart);
    }
    return [...map.values()].sort((a, b) => b.start.localeCompare(a.start));
  }

  function syncWeekOptions(cfg, select) {
    if (!select) return "all";
    const fy = currentFy();
    const weeks = collectLedgerWeeks(fy);
    const todayStart = weekStartMonday(toIsoLocal(new Date()));
    let chosen = getWeekFilter(cfg.type);
    if (chosen == null) {
      chosen = weeks.some((w) => w.start === todayStart) ? todayStart : "all";
      setWeekFilter(cfg.type, chosen);
    }
    if (chosen !== "all" && !weeks.some((w) => w.start === chosen)) {
      chosen = weeks.some((w) => w.start === todayStart) ? todayStart : "all";
      setWeekFilter(cfg.type, chosen);
    }

    const opts = [`<option value="all">All weeks</option>`].concat(
      weeks.map((w) => {
        const label = weekLabel(w.start, w.end);
        const isCurrent = w.start === todayStart ? " (this week)" : "";
        return `<option value="${esc(w.start)}">${esc(label)}${esc(isCurrent)}</option>`;
      })
    );
    const html = opts.join("");
    if (select.innerHTML !== html) select.innerHTML = html;
    if (select.value !== chosen) select.value = chosen;
    return select.value || "all";
  }

  function syncMonthOptions(cfg, select) {
    if (!select) return;
    const fy = currentFy();
    const months = monthsForFy(fy);
    const prev = getMonthFilter(cfg.type);
    const valid = prev === "all" || months.some((m) => m.value === prev);
    const chosen = valid ? prev : "all";
    if (!valid) setMonthFilter(cfg.type, "all");

    const opts = [`<option value="all">All year</option>`].concat(
      months.map((m) => `<option value="${esc(m.value)}">${esc(m.label)}</option>`)
    );
    const html = opts.join("");
    if (select.innerHTML !== html) select.innerHTML = html;
    if (select.value !== chosen) select.value = chosen;
  }

  /** Mirror the top FY picker's options and select the active year. */
  function syncFyOptions(select) {
    const top = document.getElementById("fy-select");
    if (top && top.innerHTML && select.innerHTML !== top.innerHTML) {
      select.innerHTML = top.innerHTML;
    }
    const fy = currentFy();
    if (fy && select.value !== fy) {
      select.value = fy;
      if (select.value !== fy) {
        requestAnimationFrame(() => {
          select.value = fy;
        });
      }
    }
  }

  /** Show only the selected FY (+ week for expenses / month for income). */
  function applyLedgerFilters(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const table = list.querySelector(cfg.tableSel);
    if (!table) return;
    const panel = list.closest(".panel");
    const fySelect = panel && panel.querySelector(".ledger-fy-select");
    const monthSelect = panel && panel.querySelector(".ledger-month-select");
    const weekSelect = panel && panel.querySelector(".ledger-week-select");
    if (fySelect) syncFyOptions(fySelect);

    const fy = currentFy();
    if (!fy) return;

    let period = "all";
    let periodKind = "all";
    if (cfg.type === "expense") {
      period = syncWeekOptions(cfg, weekSelect);
      periodKind = "week";
    } else if (monthSelect) {
      syncMonthOptions(cfg, monthSelect);
      period = getMonthFilter(cfg.type);
      periodKind = "month";
    }

    let sum = 0;
    let shown = 0;
    let total = 0;
    table.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
      total += 1;
      const id = tr.getAttribute(cfg.idAttr);
      const isDraft = id === "__draft__" || tr.classList.contains("draft-row");
      const entry = findEntry(cfg.type, id);
      let match = isDraft || (entry && fyForDate(entry.date) === fy);
      if (match && !isDraft && period !== "all" && entry) {
        if (periodKind === "week") {
          match = weekStartMonday(entry.date) === period;
        } else {
          match = entryMonthKey(entry.date) === period;
        }
      }
      tr.style.display = match ? "" : "none";
      if (match) {
        shown += 1;
        if (entry) sum += Number(entry.amount) || 0;
      }
    });

    updateLedgerTotal(cfg, table, fy, period, periodKind, sum);
    updateEmptyNote(cfg, panel, fy, period, periodKind, shown, total);
  }

  function periodTotalLabel(fy, period, periodKind) {
    if (!period || period === "all") {
      return `Financial year total (FY ${String(fy).replace("-", "–")})`;
    }
    if (periodKind === "week") {
      return `${weekLabel(period, weekEndSunday(period))} total`;
    }
    const hit = monthsForFy(fy).find((m) => m.value === period);
    return hit ? `${hit.label} total` : `Month total (${period})`;
  }

  function updateLedgerTotal(cfg, table, fy, period, periodKind, sum) {
    const label = periodTotalLabel(fy, period, periodKind);
    if (cfg.type === "expense") {
      const row = table.querySelector("tfoot tr.running-total-row");
      if (!row) return;
      const labelCell = row.querySelector("td");
      const amountCell = row.querySelector("td.amount");
      if (labelCell) labelCell.innerHTML = `<strong>${esc(label)}</strong>`;
      if (amountCell) amountCell.innerHTML = `<strong>${fmtCurrency(sum)}</strong>`;
      return;
    }
    let tfoot = table.querySelector("tfoot.ledger-fy-foot");
    if (!tfoot) {
      const cols = table.querySelectorAll("thead th").length || 6;
      const labelSpan = Math.max(1, cols - 2);
      tfoot = document.createElement("tfoot");
      tfoot.className = "ledger-fy-foot";
      tfoot.innerHTML = `<tr><td colspan="${labelSpan}"><strong></strong></td><td class="amount"><strong></strong></td><td></td></tr>`;
      table.appendChild(tfoot);
    }
    const tr = tfoot.querySelector("tr");
    tr.querySelector("td").innerHTML = `<strong>${esc(label)}</strong>`;
    tr.querySelector("td.amount").innerHTML = `<strong>${fmtCurrency(sum)}</strong>`;
  }

  function updateEmptyNote(cfg, panel, fy, period, periodKind, shown, total) {
    if (!panel) return;
    let note = panel.querySelector(".ledger-fy-empty");
    if (total > 0 && shown === 0) {
      if (!note) {
        note = document.createElement("p");
        note.className = "muted ledger-fy-empty";
        const list = panel.querySelector(`#${cfg.listId}`);
        (list || panel).insertAdjacentElement("afterend", note);
      }
      const kind = cfg.type === "income" ? "income" : "expenses";
      if (period && period !== "all" && periodKind === "week") {
        note.textContent = `No ${kind} for week ${weekLabel(period, weekEndSunday(period))}. Choose “All weeks” or another week.`;
      } else if (period && period !== "all") {
        const hit = monthsForFy(fy).find((m) => m.value === period);
        note.textContent = `No ${kind} for ${hit ? hit.label : period}. Choose “All year” or another month.`;
      } else {
        note.textContent = `No ${kind} recorded for FY ${String(fy).replace("-", "–")}. Switch the financial year above to see other years.`;
      }
      note.hidden = false;
    } else if (note) {
      note.hidden = true;
    }
  }

  async function runRefresh(btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Refreshing…";
    try {
      const res = await fetch(`${apiBase()}/maintenance/refresh-invoice-dates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not refresh invoice dates.");
      const msg = data.updated
        ? `Invoice dates refreshed — ${data.updated} row(s) updated${data.scanned ? ` (${data.scanned} re-scanned)` : ""}.`
        : "All rows already use the invoice date — nothing to change.";
      if (typeof toast === "function") toast(msg);
      if (typeof refreshAll === "function") await refreshAll();
    } catch (err) {
      if (typeof toast === "function") toast(err.message);
      else window.alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  /**
   * app.js still marks out-of-range expense rows (`out-of-period` class) and
   * excludes them from period totals. Hide the visual "outside period" tag for
   * a cleaner ledger — the period rule itself is unchanged.
   */
  function hideOutsidePeriodTags(cfg) {
    if (cfg.type !== "expense") return;
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    list.querySelectorAll("table.expense-ledger span.tag").forEach((tag) => {
      if (/outside\s+(selected\s+)?period/i.test(tag.textContent || "")) {
        tag.remove();
      }
    });
  }

  /** Show Cash / No receipt tags on expense ledger rows. */
  function injectCashTags(cfg) {
    if (cfg.type !== "expense") return;
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const expenses =
      (typeof state !== "undefined" && state.records && state.records.expenses) || [];
    list.querySelectorAll("tbody tr[data-expense-id]").forEach((tr) => {
      const id = tr.getAttribute("data-expense-id");
      if (!id || id === "__draft__") return;
      const entry = expenses.find((e) => e && e.id === id);
      if (!entry) return;
      const detailCell = tr.querySelector("td:nth-child(3)");
      if (!detailCell) return;
      if (entry.cashTransaction && !detailCell.querySelector(".tag-cash")) {
        const tag = document.createElement("span");
        tag.className = "tag tag-cash";
        tag.textContent = "Cash";
        tag.title = "Cash transaction (Paid cash check for claim)";
        detailCell.appendChild(document.createTextNode(" "));
        detailCell.appendChild(tag);
      }
      if (entry.noReceipt && !detailCell.querySelector(".tag-no-receipt")) {
        const tag = document.createElement("span");
        tag.className = "tag tag-no-receipt";
        tag.textContent = "No receipt";
        tag.title = "No receipt kept for this expense";
        detailCell.appendChild(document.createTextNode(" "));
        detailCell.appendChild(tag);
      }
    });
  }

  /** Inject Edit beside Delete on each saved ledger row. */
  function injectEditButtons(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const attr = `data-edit-${cfg.type}`;
    list.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
      const id = tr.getAttribute(cfg.idAttr);
      if (!id || id === "__draft__" || tr.classList.contains("draft-row")) return;
      const actions = tr.querySelector(".row-actions");
      if (!actions || actions.querySelector(`[${attr}]`)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn secondary small";
      btn.textContent = "Edit";
      btn.setAttribute(attr, id);
      btn.title = `Edit this ${cfg.type} entry`;
      const del = actions.querySelector(`[data-del-${cfg.type}]`);
      if (del) actions.insertBefore(btn, del);
      else actions.appendChild(btn);
    });
  }

  function categoryOptionsHtml(selected) {
    try {
      // Ledger edit uses the full expense menu — not the car-only claims list.
      const cats = (state.standards && state.standards.categories) || [];
      const groups = (state.standards && state.standards.categoryGroups) || [];
      if (typeof buildCategorySelectOptions === "function" && cats.length) {
        let html = buildCategorySelectOptions(cats, groups);
        if (selected) {
          html = html.replace(
            `value="${selected}"`,
            `value="${selected}" selected`
          );
        }
        return html;
      }
    } catch {
      /* fall through */
    }
    return `<option value="${esc(selected || "")}">${esc(selected || "Choose…")}</option>`;
  }

  function incomeTypeOptionsHtml(selected) {
    let types = [];
    try {
      types = (state.standards && state.standards.incomeTypes) || [];
    } catch {
      types = [];
    }
    if (!types.length) {
      return `<option value="${esc(selected || "")}">${esc(selected || "Choose…")}</option>`;
    }
    return types
      .map((t) => {
        const id = t.id || t;
        const label = t.label || String(id).replace(/_/g, " ");
        const sel = id === selected ? " selected" : "";
        return `<option value="${esc(id)}"${sel}>${esc(label)}</option>`;
      })
      .join("");
  }

  function closeEditModal() {
    document.getElementById("enh-ledger-edit-modal")?.remove();
  }

  function openEditModal(type, id) {
    const entry = findEntry(type, id);
    if (!entry) {
      if (typeof toast === "function") toast("Entry not found — refresh and try again.");
      return;
    }
    closeEditModal();

    const modal = document.createElement("div");
    modal.id = "enh-ledger-edit-modal";
    modal.className = "enh-dup-modal enh-ledger-edit-modal";

    const isExpense = type === "expense";
    const title = isExpense ? "Edit expense" : "Edit income";
    const fields = isExpense
      ? `
        <label>Date<input name="date" type="date" required value="${esc(entry.date || "")}"></label>
        <label>Category<select name="category" required>${categoryOptionsHtml(entry.category)}</select></label>
        <label>Amount (AUD)<input name="amount" type="number" step="0.01" min="0" required value="${esc(entry.amount)}"></label>
        <label>Vendor / business<input name="vendor" type="text" value="${esc(entry.vendor || "")}"></label>
        <label>ABN<input name="vendorAbn" type="text" inputmode="numeric" value="${esc(entry.vendorAbn || "")}"></label>
        <label>Description<input name="description" type="text" value="${esc(entry.description || "")}"></label>
        <label>Work-use %<input name="workUsePercent" type="number" min="0" max="100" step="1" value="${esc(entry.workUsePercent ?? 100)}"></label>
        <label class="enh-edit-check"><input name="reimbursed" type="checkbox"${entry.reimbursed ? " checked" : ""}> Reimbursed</label>
        <label class="enh-edit-check"><input name="cashTransaction" type="checkbox"${entry.cashTransaction ? " checked" : ""}> Cash transaction (Paid cash check for claim)</label>
        <label class="enh-edit-check"><input name="noReceipt" type="checkbox"${entry.noReceipt ? " checked" : ""}> No receipt</label>
        <label>Notes<textarea name="notes" rows="2">${esc(entry.notes || "")}</textarea></label>
      `
      : `
        <label>Date<input name="date" type="date" required value="${esc(entry.date || "")}"></label>
        <label>Type<select name="type" required>${incomeTypeOptionsHtml(entry.type)}</select></label>
        <label>Amount (AUD)<input name="amount" type="number" step="0.01" min="0" required value="${esc(entry.amount)}"></label>
        <label>Entity / payer<input name="entity" type="text" value="${esc(entry.entity || entry.payer || "")}"></label>
        <label>Gross total<input name="grossTotal" type="number" step="0.01" min="0" value="${esc(entry.grossTotal ?? entry.amount ?? "")}"></label>
        <label>Taxable income<input name="taxableIncome" type="number" step="0.01" min="0" value="${esc(entry.taxableIncome ?? entry.amount ?? "")}"></label>
        <label>GST<input name="gstAmount" type="number" step="0.01" min="0" value="${esc(entry.gstAmount ?? 0)}"></label>
        <label>Net pay<input name="netPay" type="number" step="0.01" min="0" value="${esc(entry.netPay ?? "")}"></label>
        <label>Pay period<input name="payPeriod" type="text" value="${esc(entry.payPeriod || "")}"></label>
        <label>Description<input name="description" type="text" value="${esc(entry.description || "")}"></label>
        <label>Notes<textarea name="summaryNotes" rows="2">${esc(entry.summaryNotes || "")}</textarea></label>
      `;

    modal.innerHTML = `
      <div class="enh-dup-backdrop" data-edit-close></div>
      <div class="enh-dup-card enh-ledger-edit-card" role="dialog" aria-modal="true" aria-labelledby="enh-ledger-edit-title">
        <h3 id="enh-ledger-edit-title">${esc(title)}</h3>
        <p class="muted">Change scanned or manual fields, then save. Photo links stay attached.</p>
        <form id="enh-ledger-edit-form" class="enh-ledger-edit-form">${fields}
          <div class="enh-dup-actions">
            <button type="button" class="btn secondary" data-edit-close>Cancel</button>
            <button type="submit" class="btn">Save changes</button>
          </div>
        </form>
        <p class="enh-edit-error muted" hidden></p>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-edit-close]").forEach((el) => {
      el.addEventListener("click", closeEditModal);
    });

    const form = modal.querySelector("#enh-ledger-edit-form");
    const errEl = modal.querySelector(".enh-edit-error");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const payload = {};
      for (const [key, value] of fd.entries()) payload[key] = value;
      if (isExpense) {
        payload.reimbursed = Boolean(form.querySelector('[name="reimbursed"]')?.checked);
        payload.cashTransaction = Boolean(
          form.querySelector('[name="cashTransaction"]')?.checked
        );
        payload.noReceipt = Boolean(form.querySelector('[name="noReceipt"]')?.checked);
        payload.workUsePercent = Number(payload.workUsePercent);
        payload.amount = Number(payload.amount);
      } else {
        payload.amount = Number(payload.amount);
        payload.grossTotal = payload.grossTotal === "" ? null : Number(payload.grossTotal);
        payload.taxableIncome = payload.taxableIncome === "" ? null : Number(payload.taxableIncome);
        payload.gstAmount = payload.gstAmount === "" ? 0 : Number(payload.gstAmount);
        payload.netPay = payload.netPay === "" ? null : Number(payload.netPay);
        payload.payer = payload.entity;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = "";
      }
      try {
        const res = await fetch(`${apiBase()}/${isExpense ? "expenses" : "income"}/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not save changes.");
        closeEditModal();
        if (typeof toast === "function") toast(isExpense ? "Expense updated" : "Income updated");
        if (typeof refreshAll === "function") await refreshAll();
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || "Save failed.";
          errEl.hidden = false;
        } else if (typeof toast === "function") toast(err.message);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  function enhance(cfg) {
    ensureRefreshButton(cfg);
    ensureFyPicker(cfg);
    ensureMonthPicker(cfg);
    ensureWeekPicker(cfg);
    applyLedgerFilters(cfg);
    hideOutsidePeriodTags(cfg);
    injectCashTags(cfg);
    injectEditButtons(cfg);
  }

  function start() {
    let bound = false;
    for (const cfg of LEDGERS) {
      const list = document.getElementById(cfg.listId);
      if (!list) continue;
      bound = true;
      const mo = new MutationObserver(() => enhance(cfg));
      mo.observe(list, { childList: true });
      enhance(cfg);
    }
    if (bound) {
      let ticks = 0;
      const iv = setInterval(() => {
        ticks += 1;
        for (const cfg of LEDGERS) enhance(cfg);
        if (ticks >= 10) clearInterval(iv);
      }, 400);
    }

    document.addEventListener("click", (e) => {
      const exp = e.target.closest("[data-edit-expense]");
      if (exp) {
        e.preventDefault();
        openEditModal("expense", exp.getAttribute("data-edit-expense"));
        return;
      }
      const inc = e.target.closest("[data-edit-income]");
      if (inc) {
        e.preventDefault();
        openEditModal("income", inc.getAttribute("data-edit-income"));
      }
    });

    // Monday rollover: switch expense ledger onto the new week entry.
    window.addEventListener("haulage:new-week", (ev) => {
      const startIso = ev.detail && ev.detail.weekStart;
      if (!startIso) return;
      setWeekFilter("expense", startIso);
      const expenseCfg = LEDGERS.find((c) => c.type === "expense");
      if (expenseCfg) enhance(expenseCfg);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Monday week rollover -------------------------------------------------
 * When the local calendar advances to a new Monday, open an empty week slot
 * (haulage-started-weeks) and point expense ledger + gallery filters there.
 * Does not invent blank expense rows — the "entry" is the week dropdown slot.
 */
(function () {
  "use strict";

  const weeks = globalThis.HaulageWeeks;
  if (!weeks) return;

  const {
    currentWeekStart,
    weekEndSunday,
    weekLabel,
    registerStartedWeek,
    getActiveWeekStart,
    setActiveWeekStart,
  } = weeks;

  function announce(startIso) {
    const label = weekLabel(startIso, weekEndSunday(startIso));
    const msg = `New week started (${label}). Expense views are set to this week — add your first entry when ready.`;
    if (typeof window.toast === "function") window.toast(msg);
  }

  function checkRollover() {
    const thisMon = currentWeekStart();
    if (!thisMon) return;
    const prev = getActiveWeekStart();
    registerStartedWeek(thisMon);
    if (prev === thisMon) return;

    const rolledFromPriorWeek = Boolean(prev);
    setActiveWeekStart(thisMon);

    try {
      localStorage.setItem("haulage-ledger-week-expense", thisMon);
      localStorage.setItem("haulage-gallery-week-expense", thisMon);
    } catch {
      /* ignore */
    }

    window.dispatchEvent(
      new CustomEvent("haulage:new-week", { detail: { weekStart: thisMon } })
    );

    if (rolledFromPriorWeek) announce(thisMon);
  }

  function start() {
    checkRollover();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkRollover();
    });
    window.addEventListener("focus", () => checkRollover());
    setInterval(checkRollover, 60_000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Allowance caps: segmented ATO tallies + day/week/month (AEST) ---------
 * Replaces the static list in #allowance-caps. Band-1 daily stack is
 * $328.90 = meals $128 + overtime meal $38.65 + accommodation $138 +
 * incidentals $24.25 (TD 2025/4). Shows roaming spend per segment under the
 * grand total, with day / week / month period views and per-day breakdowns.
 * Logic: lib/allowance-tally.js (loaded via /api when unavailable in browser —
 * duplicated thin client helpers below call the same shapes).
 */
(function () {
  "use strict";

  const AEST_TZ = "Australia/Sydney";
  const PERIOD_KEY = "haulage-allowance-period";
  const DAY_KEY = "haulage-allowance-day";
  const WEEK_KEY = "haulage-allowance-week";
  const MONTH_KEY = "haulage-allowance-month";

  // In-browser copy of lib/allowance-tally.js (no bundler). Keep in sync.
  function num(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }
  function round2(n) {
    return Math.round(num(n) * 100) / 100;
  }
  function buildSegments(allowances) {
    const meals = (allowances && allowances.truckDriverMealsDaily) || {};
    const travel = (allowances && allowances.domesticTravelCaps) || {};
    const breakfast = num(meals.breakfast && meals.breakfast.cap);
    const lunch = num(meals.lunch && meals.lunch.cap);
    const dinner = num(meals.dinner && meals.dinner.cap);
    const mealsCombined = round2(breakfast + lunch + dinner);
    return [
      { id: "breakfast", label: "Breakfast", group: "meals", cap: breakfast, spendIds: ["meals_breakfast"] },
      { id: "lunch", label: "Lunch", group: "meals", cap: lunch, spendIds: ["meals_lunch"] },
      { id: "dinner", label: "Dinner", group: "meals", cap: dinner, spendIds: ["meals_dinner"] },
      {
        id: "meals_combined",
        label: "Food/meals (combined)",
        group: "meals",
        cap: mealsCombined,
        spendIds: ["meals"],
        sharesMealPool: true,
      },
      {
        id: "overtime_meals",
        label: "Overtime meal",
        group: "other",
        cap: num(allowances && allowances.overtimeMealCap),
        spendIds: ["overtime_meals"],
      },
      {
        id: "accommodation",
        label: "Accommodation",
        group: "other",
        cap: num(travel.accommodation),
        spendIds: ["accommodation"],
      },
      {
        id: "incidentals",
        label: "Incidentals",
        group: "other",
        cap: num(travel.incidentals),
        spendIds: ["incidentals"],
      },
    ];
  }
  function dailyAllowanceTotal(allowances) {
    const segments = buildSegments(allowances);
    const mealsCap = (segments.find((s) => s.id === "meals_combined") || {}).cap || 0;
    const other = segments
      .filter((s) => s.group === "other")
      .reduce((sum, s) => sum + num(s.cap), 0);
    return round2(mealsCap + other);
  }
  function spendForIds(expenses, spendIds, dateIso) {
    const ids = new Set(spendIds);
    return round2(
      (expenses || [])
        .filter((e) => ids.has(e.category) && String(e.date || "").slice(0, 10) === dateIso)
        .reduce((sum, e) => sum + num(e.amount), 0)
    );
  }
  function tallyDay(expenses, allowances, dateIso) {
    const segments = buildSegments(allowances);
    const dailyAllow = dailyAllowanceTotal(allowances);
    const mealPoolCap = (segments.find((s) => s.id === "meals_combined") || {}).cap || 0;
    const rows = segments.map((seg) => {
      const spend = spendForIds(expenses, seg.spendIds, dateIso);
      return {
        id: seg.id,
        label: seg.label,
        group: seg.group,
        sharesMealPool: Boolean(seg.sharesMealPool),
        cap: seg.cap,
        spend,
        remaining: round2(seg.cap - spend),
        over: spend > seg.cap && seg.cap > 0,
      };
    });
    const mealPoolSpend = round2(
      rows.filter((r) => r.group === "meals").reduce((s, r) => s + r.spend, 0)
    );
    const spend = round2(rows.reduce((s, r) => s + r.spend, 0));
    return {
      date: dateIso,
      dailyAllow,
      spend,
      remaining: round2(dailyAllow - spend),
      over: spend > dailyAllow,
      mealPoolCap,
      mealPoolSpend,
      mealPoolOver: mealPoolSpend > mealPoolCap && mealPoolCap > 0,
      segments: rows,
    };
  }
  function eachIsoDate(startIso, endIso) {
    const out = [];
    if (!startIso || !endIso) return out;
    const [ys, ms, ds] = startIso.split("-").map(Number);
    const [ye, me, de] = endIso.split("-").map(Number);
    const cur = new Date(Date.UTC(ys, ms - 1, ds));
    const end = new Date(Date.UTC(ye, me - 1, de));
    while (cur <= end) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }
  function monthBounds(yearMonth) {
    const [y, m] = String(yearMonth || "")
      .split("-")
      .map(Number);
    if (!y || !m) return null;
    const start = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    return { start, end };
  }
  function tallyPeriod(expenses, allowances, dates) {
    const days = (dates || []).map((d) => tallyDay(expenses, allowances, d));
    const dailyAllow = days[0] ? days[0].dailyAllow : dailyAllowanceTotal(allowances);
    const periodAllow = round2(dailyAllow * days.length);
    const spend = round2(days.reduce((s, d) => s + d.spend, 0));
    const segmentMap = new Map();
    for (const day of days) {
      for (const seg of day.segments) {
        const prev = segmentMap.get(seg.id) || {
          id: seg.id,
          label: seg.label,
          group: seg.group,
          sharesMealPool: seg.sharesMealPool,
          dailyCap: seg.cap,
          spend: 0,
        };
        prev.spend = round2(prev.spend + seg.spend);
        segmentMap.set(seg.id, prev);
      }
    }
    return {
      dates,
      dayCount: days.length,
      dailyAllow,
      periodAllow,
      spend,
      remaining: round2(periodAllow - spend),
      over: spend > periodAllow,
      segments: [...segmentMap.values()],
      days,
    };
  }

  let midnightTimer = null;
  let lastSignature = "";
  let ui = {
    period: localStorage.getItem(PERIOD_KEY) || "day",
    day: localStorage.getItem(DAY_KEY) || "",
    week: localStorage.getItem(WEEK_KEY) || "",
    month: localStorage.getItem(MONTH_KEY) || "",
  };

  const money = (n) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);

  function aestParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat("en-AU", {
      timeZone: AEST_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const out = {};
    for (const p of fmt.formatToParts(date)) {
      if (p.type !== "literal") out[p.type] = p.value;
    }
    return out;
  }

  function aestIsoOf(date = new Date()) {
    const p = aestParts(date);
    return `${p.year}-${p.month}-${p.day}`;
  }

  function msUntilNextAestMidnight() {
    const today = aestIsoOf();
    let lo = 0;
    let hi = 26 * 60 * 60 * 1000;
    const now = Date.now();
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (aestIsoOf(new Date(now + mid)) === today) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(lo, 1000);
  }

  function fmtDayLabel(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "UTC",
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(dt);
  }

  function weekStartMonday(iso) {
    if (globalThis.HaulageWeeks && typeof globalThis.HaulageWeeks.weekStartMonday === "function") {
      return globalThis.HaulageWeeks.weekStartMonday(iso);
    }
    const [y, m, d] = String(iso).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = dt.getUTCDay(); // 0 Sun
    const diff = day === 0 ? -6 : 1 - day;
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt.toISOString().slice(0, 10);
  }

  function addDaysIso(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  function records() {
    try {
      return {
        expenses: (state.records && state.records.expenses) || [],
        allowances: (state.summary && state.summary.allowances) || {},
      };
    } catch {
      return { expenses: [], allowances: {} };
    }
  }

  function dataSignature() {
    const { expenses, allowances } = records();
    return JSON.stringify({
      period: ui.period,
      day: ui.day,
      week: ui.week,
      month: ui.month,
      today: aestIsoOf(),
      n: expenses.length,
      last: expenses[0] && (expenses[0].id || expenses[0].amount || expenses[0].date),
      allow: dailyAllowanceTotal(allowances),
    });
  }

  function recentDays(n = 45) {
    const today = aestIsoOf();
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(addDaysIso(today, -i));
    return out;
  }

  function recentWeeks(n = 16) {
    const today = aestIsoOf();
    let start = weekStartMonday(today);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push(start);
      start = addDaysIso(start, -7);
    }
    return out;
  }

  function recentMonths(n = 12) {
    const today = aestIsoOf();
    let [y, m] = today.split("-").map(Number);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
      m -= 1;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
    }
    return out;
  }

  function selectedDates() {
    const today = aestIsoOf();
    if (ui.period === "week") {
      const start = ui.week || weekStartMonday(today);
      return eachIsoDate(start, addDaysIso(start, 6));
    }
    if (ui.period === "month") {
      const ym = ui.month || today.slice(0, 7);
      const bounds = monthBounds(ym);
      return bounds ? eachIsoDate(bounds.start, bounds.end) : [today];
    }
    return [ui.day || today];
  }

  function statusTag(over, spend) {
    if (over) return ' <span class="tag amber">over</span>';
    if (spend > 0) return ' <span class="tag green">within</span>';
    return "";
  }

  function segmentRowsHtml(segments) {
    return segments
      .map((seg) => {
        const over = Boolean(seg.over);
        return `<div class="cap-row allowance-segment${over ? " is-over" : ""}">
          <span>${esc(seg.label)}</span>
          <span class="${over ? "amount-over" : ""}">${money(seg.spend)} <small class="muted">/ ${money(seg.cap)}</small></span>
        </div>`;
      })
      .join("");
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dayBreakdownHtml(days) {
    const withSpend = days.filter((d) => d.spend > 0);
    const list = withSpend.length ? withSpend : days.slice(0, 1);
    return list
      .map((day) => {
        const tag = statusTag(day.over, day.spend);
        const segs = day.segments
          .filter((s) => s.spend > 0)
          .map(
            (s) =>
              `<div class="cap-row allowance-segment nested">
                <span>${esc(s.label)}</span>
                <span>${money(s.spend)} <small class="muted">/ ${money(s.cap)}</small></span>
              </div>`
          )
          .join("");
        return `<details class="allowance-day" ${day.spend > 0 ? "open" : ""}>
          <summary>
            <span>${esc(fmtDayLabel(day.date))} <small class="muted">${esc(day.date)}</small></span>
            <span>${money(day.spend)} / ${money(day.dailyAllow)}${tag}</span>
          </summary>
          <div class="allowance-day-body">
            ${segs || `<p class="muted">No allowance-category spend this day.</p>`}
            <div class="cap-row">
              <span>${day.over ? "Over" : "Remaining"}</span>
              <span class="${day.over ? "amount-over" : "amount-under"}">${money(Math.abs(day.remaining))}</span>
            </div>
          </div>
        </details>`;
      })
      .join("");
  }

  function controlsHtml(today) {
    const period = ui.period || "day";
    const dayOpts = recentDays()
      .map((d) => {
        const sel = (ui.day || today) === d ? " selected" : "";
        const label = d === today ? `${fmtDayLabel(d)} (today)` : fmtDayLabel(d);
        return `<option value="${esc(d)}"${sel}>${esc(label)}</option>`;
      })
      .join("");
    const weekOpts = recentWeeks()
      .map((w) => {
        const end = addDaysIso(w, 6);
        const sel = (ui.week || weekStartMonday(today)) === w ? " selected" : "";
        return `<option value="${esc(w)}"${sel}>${esc(fmtDayLabel(w))} – ${esc(fmtDayLabel(end))}</option>`;
      })
      .join("");
    const monthOpts = recentMonths()
      .map((ym) => {
        const sel = (ui.month || today.slice(0, 7)) === ym ? " selected" : "";
        const [y, m] = ym.split("-");
        const label = new Intl.DateTimeFormat("en-AU", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(Number(y), Number(m) - 1, 1)));
        return `<option value="${esc(ym)}"${sel}>${esc(label)}</option>`;
      })
      .join("");

    const second =
      period === "week"
        ? `<label class="allowance-scope">Week
            <select id="allowance-week-select" aria-label="Allowance week">${weekOpts}</select>
          </label>`
        : period === "month"
          ? `<label class="allowance-scope">Month
              <select id="allowance-month-select" aria-label="Allowance month">${monthOpts}</select>
            </label>`
          : `<label class="allowance-scope">Day
              <select id="allowance-day-select" aria-label="Allowance day">${dayOpts}</select>
            </label>`;

    return `<div class="allowance-period-row">
      <label class="allowance-scope">Show
        <select id="allowance-period-select" aria-label="Allowance period">
          <option value="day"${period === "day" ? " selected" : ""}>Day</option>
          <option value="week"${period === "week" ? " selected" : ""}>Week</option>
          <option value="month"${period === "month" ? " selected" : ""}>Month</option>
        </select>
      </label>
      ${second}
    </div>`;
  }

  function scheduleMidnightReset(container) {
    if (midnightTimer) {
      clearTimeout(midnightTimer);
      midnightTimer = null;
    }
    midnightTimer = setTimeout(() => {
      midnightTimer = null;
      if (container.isConnected) {
        lastSignature = "";
        render(container, true);
        scheduleMidnightReset(container);
      }
    }, msUntilNextAestMidnight());
  }

  function wireControls(container) {
    const periodEl = container.querySelector("#allowance-period-select");
    const dayEl = container.querySelector("#allowance-day-select");
    const weekEl = container.querySelector("#allowance-week-select");
    const monthEl = container.querySelector("#allowance-month-select");
    periodEl?.addEventListener("change", () => {
      ui.period = periodEl.value || "day";
      localStorage.setItem(PERIOD_KEY, ui.period);
      lastSignature = "";
      render(container, true);
    });
    dayEl?.addEventListener("change", () => {
      ui.day = dayEl.value || "";
      localStorage.setItem(DAY_KEY, ui.day);
      lastSignature = "";
      render(container, true);
    });
    weekEl?.addEventListener("change", () => {
      ui.week = weekEl.value || "";
      localStorage.setItem(WEEK_KEY, ui.week);
      lastSignature = "";
      render(container, true);
    });
    monthEl?.addEventListener("change", () => {
      ui.month = monthEl.value || "";
      localStorage.setItem(MONTH_KEY, ui.month);
      lastSignature = "";
      render(container, true);
    });
  }

  function render(container, force) {
    const sig = dataSignature();
    if (!force && sig === lastSignature && container.querySelector(".allowance-vs-spend")) return;
    lastSignature = sig;

    const today = aestIsoOf();
    if (!ui.day) ui.day = today;
    if (!ui.week) ui.week = weekStartMonday(today);
    if (!ui.month) ui.month = today.slice(0, 7);

    const { expenses, allowances } = records();
    const dates = selectedDates();
    const period = tallyPeriod(expenses, allowances, dates);
    const isDay = ui.period === "day";
    const day = isDay ? period.days[0] : null;

    const allowLabel = isDay ? "Daily allowance" : ui.period === "week" ? "Week allowance" : "Month allowance";
    const spendLabel = isDay ? "Spend" : "Total spend";
    const allowAmt = isDay ? period.dailyAllow : period.periodAllow;
    const remainLabel = period.over ? "Over allowance" : isDay ? "Remaining" : "Remaining in period";
    const tag = statusTag(period.over, period.spend);

    const segmentsHtml = isDay
      ? segmentRowsHtml(day.segments)
      : period.segments
          .map((seg) => {
            const periodCap = round2(num(seg.dailyCap) * period.dayCount);
            const over = seg.spend > periodCap && periodCap > 0;
            return `<div class="cap-row allowance-segment${over ? " is-over" : ""}">
              <span>${esc(seg.label)}</span>
              <span class="${over ? "amount-over" : ""}">${money(seg.spend)} <small class="muted">/ ${money(periodCap)}</small></span>
            </div>`;
          })
          .join("");

    const mealNote =
      day && day.mealPoolOver
        ? `<p class="muted allowance-warn">Meal claims (${money(day.mealPoolSpend)}) exceed the combined ATO meal cap (${money(day.mealPoolCap)}) for this day.</p>`
        : "";

    const perDayHtml =
      isDay
        ? ""
        : `<div class="allowance-day-list">
            <h4 class="allowance-subhead">Per day</h4>
            ${dayBreakdownHtml(period.days)}
          </div>`;

    container.innerHTML = `
      <div class="allowance-vs-spend cap-list">
        ${controlsHtml(today)}
        <div class="cap-row allowance-total">
          <span><strong>${esc(allowLabel)}</strong> <small class="muted">ATO TD 2025/4 · AEST</small></span>
          <span><strong>${money(allowAmt)}</strong></span>
        </div>
        <div class="cap-row allowance-total">
          <span><strong>${esc(spendLabel)}</strong>${isDay ? ' <small class="muted">resets 00:00 AEST</small>' : ` <small class="muted">${period.dayCount} days</small>`}</span>
          <span><strong>${money(period.spend)}</strong>${tag}</span>
        </div>
        <div class="cap-row allowance-total">
          <span>${esc(remainLabel)}</span>
          <span class="${period.over ? "amount-over" : "amount-under"}">${money(Math.abs(period.remaining))}</span>
        </div>
        <div class="allowance-divider"></div>
        <h4 class="allowance-subhead">Segments</h4>
        ${segmentsHtml}
        ${mealNote}
        ${perDayHtml}
        <p class="muted allowance-hint">
          Daily stack (salary band) = food/meals (breakfast + lunch + dinner) + overtime meal + accommodation + incidentals
          — e.g. band 1 <strong>${money(328.9)}</strong>/day. Breakfast/lunch/dinner and combined food/meals share the one meal pot;
          accommodation and other segments tally separately. Spend uses matching expense categories; daily figures reset at midnight AEST.
        </p>
      </div>
    `;
    wireControls(container);
    scheduleMidnightReset(container);
  }

  function maybeRender(force) {
    const container = document.getElementById("allowance-caps");
    if (!container) return;
    if (!force && container.querySelector(".allowance-vs-spend") && dataSignature() === lastSignature) {
      return;
    }
    // Wait until app.js has written something (or we already own the panel).
    if (!container.children.length && !force) return;
    render(container, Boolean(force));
  }

  function start() {
    const container = document.getElementById("allowance-caps");
    if (!container) return;
    new MutationObserver(() => maybeRender(false)).observe(container, { childList: true });
    maybeRender(false);
    let ticks = 0;
    const iv = setInterval(() => {
      ticks += 1;
      maybeRender(true);
      if (ticks >= 15) clearInterval(iv);
    }, 400);
    // Refresh when ledgers/expenses change (refreshAll / saves).
    document.addEventListener("haulage:new-week", () => maybeRender(true));
    setInterval(() => maybeRender(false), 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Living Away from Home allowance boxes (dashboard + income) ------------
 * Shows ATO truck-driver overnight meal rate ($128/day) using the driver's
 * salary band (profile annual salary or estimated from payslips), plus any
 * Travel / LAFHA amounts recorded on income / scanned payslips.
 */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  const BOX_IDS = ["dashboard-lafha-box", "income-lafha-box"];

  const money = (n) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function salarySourceLabel(source) {
    if (source === "profile") return "from profile annual salary";
    if (source === "payslips") return "estimated from scanned / saved payslips";
    return "add annual salary on Profile, or scan a payslip";
  }

  function renderBox(el, data) {
    if (!el || !data) return;
    const b = data.reasonableBreakdown || {};
    const paid = data.paid || {};
    const salaryAmt = data.salary && data.salary.amount ? money(data.salary.amount) : "—";
    const paidPerDay =
      paid.avgPerDay != null
        ? `${money(paid.avgPerDay)}/day avg`
        : paid.entryCount
          ? "per-day unknown"
          : "none recorded yet";

    const paidRows = (paid.rows || [])
      .slice(0, 5)
      .map(
        (r) =>
          `<li><span>${esc(r.date || "—")} · ${esc(r.label)}</span><span>${money(r.amount)}${
            r.perDay != null ? ` <small class="muted">(${money(r.perDay)}/day)</small>` : ""
          }</span></li>`
      )
      .join("");

    el.innerHTML = `
      <div class="lafha-card">
        <div class="lafha-row lafha-hero">
          <div>
            <div class="lafha-label">ATO reasonable (per day)</div>
            <div class="lafha-value">${money(data.reasonablePerDay)}</div>
            <div class="muted lafha-sub">Truck driver meals · breakfast ${money(b.breakfast)} + lunch ${money(b.lunch)} + dinner ${money(b.dinner)}</div>
          </div>
          <div>
            <div class="lafha-label">Your salary band</div>
            <div class="lafha-value lafha-band">${esc((data.salaryBand || "band1").replace("band", "Band "))}</div>
            <div class="muted lafha-sub">${esc(salaryAmt)} · ${esc(salarySourceLabel(data.salary && data.salary.source))}</div>
          </div>
        </div>
        <div class="lafha-row">
          <span>Paid on payslips / income <small class="muted">(Travel / LAFHA lines)</small></span>
          <span><strong>${money(paid.totalPaid || 0)}</strong> · ${esc(paidPerDay)}</span>
        </div>
        ${
          paidRows
            ? `<ul class="lafha-paid-list">${paidRows}</ul>`
            : `<p class="muted lafha-empty">No Living Away from Home / Travel allowance lines found yet. Scan a payslip that lists Travel Allowance, or add income type “Living Away from Home / Travel allowance”.</p>`
        }
        <p class="muted lafha-hint">${esc(data.note || "")}</p>
      </div>
    `;
  }

  async function refresh() {
    let data = null;
    try {
      const res = await fetch(`${API}/lafha`, { credentials: "same-origin" });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load LAFHA");
    } catch (err) {
      for (const id of BOX_IDS) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<p class="muted">${esc(err.message || "Could not load LAFHA rates.")}</p>`;
      }
      return;
    }
    for (const id of BOX_IDS) {
      renderBox(document.getElementById(id), data);
    }
  }

  function start() {
    if (!BOX_IDS.some((id) => document.getElementById(id))) return;
    void refresh();
    let ticks = 0;
    const iv = setInterval(() => {
      ticks += 1;
      void refresh();
      if (ticks >= 8) clearInterval(iv);
    }, 1500);
    document.addEventListener("haulage:new-week", () => void refresh());
    // After income saves, app.js reloads lists — poll lightly while on income/dashboard.
    setInterval(() => {
      const dash = document.getElementById("view-dashboard");
      const inc = document.getElementById("view-income");
      if ((dash && dash.classList.contains("active")) || (inc && inc.classList.contains("active"))) {
        void refresh();
      }
    }, 8000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Title-case a few dynamic headings rendered by app.js ------------------
 * app.js is kept verbatim, so the page title (#page-title) and the EOFY report
 * section headings are corrected here after each render.
 */
(function () {
  "use strict";

  const TITLE_MAP = {
    "Income & remittances": "Income & Remittances",
    "Driver profile": "Driver Profile",
    support: "Support",
    Support: "Support",
  };
  const REPORT_MAP = {
    "Income & remittances": "Income & Remittances",
    "Expense deductions (ATO schedules)": "Expense Deductions (ATO schedules)",
    "Tax estimate": "Tax Estimate",
  };

  function fixPageTitle() {
    const el = document.getElementById("page-title");
    if (!el) return;
    const next = TITLE_MAP[el.textContent.trim()];
    if (next && el.textContent !== next) el.textContent = next;
  }

  function fixReportHeadings() {
    const el = document.getElementById("report-content");
    if (!el) return;
    el.querySelectorAll("h3").forEach((h) => {
      const next = REPORT_MAP[h.textContent.trim()];
      if (next && h.textContent !== next) h.textContent = next;
    });
  }

  function start() {
    const title = document.getElementById("page-title");
    if (title) {
      new MutationObserver(fixPageTitle).observe(title, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      fixPageTitle();
    }
    const report = document.getElementById("report-content");
    if (report) {
      new MutationObserver(fixReportHeadings).observe(report, { childList: true, subtree: true });
      fixReportHeadings();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Category menus: car claims vs general expense / profile --------------
 * app.js fills selects from state.standards.categories (including on every
 * setView("expenses")). This layer re-applies afterwards:
 *   - #expense-category (Car Expenses/Claims) → specialClaimCategories (ATO car)
 *   - manual receipt + Profile default → filtered general expense menu
 */
(function () {
  "use strict";
  /* global populateCategorySelects, populateSelects, setView, categoryLabel */

  // Keep in sync with lib/expense-menu.js CAR_CLAIM_CATEGORY_IDS.
  const CAR_CLAIM_IDS = [
    "vehicle_car",
    "fuel",
    "repairs_maintenance",
    "tyres",
    "registration_insurance",
    "parking_tolls",
  ];

  function fillSelect(sel, html, { allowEmptyLabel } = {}) {
    if (!sel) return;
    const prev = sel.value;
    const body = allowEmptyLabel
      ? html.replace(/^<option value="">Choose category…<\/option>/, '<option value="">None</option>')
      : html;
    if (sel.innerHTML === body) {
      if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
      return;
    }
    sel.innerHTML = body;
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function carClaimCategories() {
    // `state` is a top-level const in app.js (global lexical) — not on window.
    const fromApi = (state && state.standards && state.standards.specialClaimCategories) || [];
    const allow = new Set(CAR_CLAIM_IDS);
    const filtered = fromApi.filter((c) => allow.has(c.id));
    if (filtered.length) return filtered;
    const all = (state && state.standards && state.standards.categories) || [];
    return CAR_CLAIM_IDS.map((id) => {
      const hit = all.find((c) => c.id === id) || {
        id,
        label: id.replace(/_/g, " "),
        group: "Car expenses",
      };
      return { ...hit, id, group: "Car expenses (ATO work-related)" };
    });
  }

  /** True when #expense-category still has the general (non-car) menu. */
  function expenseSelectNeedsCarFilter() {
    const sel = document.getElementById("expense-category");
    if (!sel) return false;
    const allow = new Set(CAR_CLAIM_IDS);
    return [...sel.options].some((o) => o.value && !allow.has(o.value));
  }

  function applyFilteredCategoryMenus() {
    if (!state || !state.standards || typeof buildCategorySelectOptions !== "function") return;

    const menuCats = state.standards.categories || [];
    if (!menuCats.length) return;

    const menuHtml = buildCategorySelectOptions(menuCats, state.standards.categoryGroups);
    const carHtml = buildCategorySelectOptions(carClaimCategories(), []);

    // Car Expenses/Claims — always the ATO car allowlist (never the full menu).
    fillSelect(document.getElementById("expense-category"), carHtml);

    // Manual expense entry (general work expenses)
    fillSelect(document.getElementById("manual-receipt-category"), menuHtml);

    // Profile default category
    fillSelect(document.getElementById("preset-category"), menuHtml, { allowEmptyLabel: true });
  }

  function afterPopulate(fn) {
    if (typeof fn !== "function") return fn;
    return function patchedPopulate() {
      const result = fn.apply(this, arguments);
      applyFilteredCategoryMenus();
      return result;
    };
  }

  function patchPopulate() {
    // Patch window bindings used by nav/refresh. Also patch setView so a visit
    // to Expenses re-applies the car allowlist after app.js re-fills selects.
    if (typeof populateCategorySelects === "function") {
      globalThis.populateCategorySelects = afterPopulate(populateCategorySelects);
    }
    if (typeof populateSelects === "function") {
      globalThis.populateSelects = afterPopulate(populateSelects);
    }
    if (typeof setView === "function") {
      const origSetView = setView;
      globalThis.setView = function patchedSetView() {
        const result = origSetView.apply(this, arguments);
        applyFilteredCategoryMenus();
        return result;
      };
    }
  }

  /** Ledger / totals: resolve labels for car-claim ids hidden from the general menu. */
  function patchCategoryLabel() {
    if (typeof categoryLabel !== "function") return;
    const orig = categoryLabel;
    globalThis.categoryLabel = function patchedCategoryLabel(id) {
      try {
        const car =
          state &&
          state.standards &&
          state.standards.specialClaimCategories &&
          state.standards.specialClaimCategories.find((c) => c.id === id);
        if (car && car.label) return car.label;
      } catch {
        /* fall through */
      }
      return orig.apply(this, arguments);
    };
  }

  function start() {
    patchPopulate();
    patchCategoryLabel();
    applyFilteredCategoryMenus();

    document.addEventListener(
      "mousedown",
      (e) => {
        if (e.target && e.target.id === "expense-category" && expenseSelectNeedsCarFilter()) {
          applyFilteredCategoryMenus();
        }
      },
      true
    );

    const sel = document.getElementById("expense-category");
    if (sel) {
      const mo = new MutationObserver(() => {
        if (expenseSelectNeedsCarFilter()) applyFilteredCategoryMenus();
      });
      mo.observe(sel, { childList: true });
    }
    setInterval(() => {
      if (expenseSelectNeedsCarFilter()) applyFilteredCategoryMenus();
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Profile licence class from annual salary -----------------------------
 * Replaces Band 1/2/3 with LR/MR → HR → HC → MC. When the driver enters
 * annual salary (especially on first use), the licence class select follows
 * progressive dollar floors. ATO travel "salary bands" stay separate (derived
 * in the tax calculator from salary, not this UI field).
 */
(function () {
  "use strict";

  const FLOORS = [
    { id: "mc", min: 110000, label: "MC" },
    { id: "hc", min: 79000, label: "HC" },
    { id: "hr", min: 70000, label: "HR" },
    { id: "lr_mr", min: 0, label: "LR/MR" },
  ];

  const HINTS = {
    lr_mr: "LR/MR — typically $58k–$75k (local couriers, light distribution).",
    hr: "HR — typically $70k–$88k (local freight, bus, waste).",
    hc: "HC — typically $79k–$110k (semi-trailers / B-doubles).",
    mc: "MC — typically $110k–$160k+ (road trains, interstate linehaul).",
  };

  function licenceFromSalary(salary) {
    const n = Number(salary);
    const amount = Number.isFinite(n) && n > 0 ? n : 0;
    for (const row of FLOORS) {
      if (amount >= row.min) return row.id;
    }
    return "lr_mr";
  }

  function setHint(id) {
    const hint = document.getElementById("licence-class-hint");
    if (!hint) return;
    hint.textContent =
      HINTS[id] ||
      "Licence class updates from annual salary (LR/MR → HR → HC → MC).";
  }

  function syncLicenceFromSalary() {
    const salaryInput =
      document.getElementById("profile-annual-salary") ||
      document.querySelector('#profile-form input[name="annualSalary"]');
    const select = document.getElementById("profile-licence-class");
    if (!salaryInput || !select) return;
    const next = licenceFromSalary(salaryInput.value);
    if (select.value !== next) select.value = next;
    setHint(next);
  }

  function start() {
    const salaryInput =
      document.getElementById("profile-annual-salary") ||
      document.querySelector('#profile-form input[name="annualSalary"]');
    const select = document.getElementById("profile-licence-class");
    if (!salaryInput || !select) return;

    // Salary drives the class (first use and later edits). Manual tweaks are
    // allowed, but typing a new salary re-applies the threshold rule.
    salaryInput.addEventListener("input", syncLicenceFromSalary);
    salaryInput.addEventListener("change", syncLicenceFromSalary);
    select.addEventListener("change", () => setHint(select.value));

    // After app.js populates the form from saved profile, align class to salary.
    syncLicenceFromSalary();
    let ticks = 0;
    let lastSalary = salaryInput.value;
    const iv = setInterval(() => {
      ticks += 1;
      if (salaryInput.value !== lastSalary || ticks <= 3) {
        lastSalary = salaryInput.value;
        syncLicenceFromSalary();
      }
      if (ticks >= 20) clearInterval(iv);
    }, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Support tab: contact form + how-to blurbs for each main tab --------- */
(function () {
  "use strict";

  const HELP = {
    dashboard: {
      title: "Dashboard",
      body: [
        "The Dashboard is your home screen for the selected financial year. The top stats summarise income, deductions and a rough tax picture from what you’ve already entered. Snapshot and Recent activity show what’s changed lately so you can spot gaps without digging through every ledger line.",
        "Allowance caps track common work allowances (meals, overtime meals, and similar ATO bands) against what you’ve claimed so far for the day, week or month. Use this to stay under the published rates before EOFY.",
        "Living Away from Home (LAFHA) shows the relevant food and accommodation rates for your situation. It doesn’t lodge anything with the ATO — it helps you see the headroom you still have when you’re away for work. Change the financial year in the top bar and the whole dashboard refreshes for that year.",
      ],
    },
    expenses: {
      title: "Expenses",
      body: [
        "Upload a photo or PDF of a work receipt with Upload file (or drag and drop). You must be signed in — scans save to your own profile. The scanner reads the page with on-device OCR (and cloud OCR when configured), then suggests date, vendor, amount and a category. Approve the overall total before it’s saved; other line amounts are informational only.",
        "If the file looks like one you’ve already saved (same date, vendor and amount), you’ll be asked whether to continue. Pick a category from the expense menu, or use Car Expenses/Claims for ATO car-related items. Manual entry covers cash claims and “no receipt” ticks when you don’t have a photo.",
        "Special claims (cents-per-km, laundry) and the expense ledger sit below the upload area. The gallery lists labelled receipts for this year so you can open, download or delete them later.",
      ],
    },
    income: {
      title: "Income & remittances",
      body: [
        "Use Income to record payslips, remittances and other earnings for the selected financial year. Upload a payslip or invoice (image or PDF) the same way as expenses — OCR pulls gross, net and related fields when it can, then you approve before save. Manual entry is available when you prefer to type amounts yourself.",
        "Choose an income type from the menu, keep descriptions clear, and use the ledger to edit or remove rows. LAFHA guidance appears with your income view so you can cross-check living-away amounts against what you’ve been paid.",
        "The income gallery only shows documents saved as income, so expense receipts won’t block a payslip upload. Sign in before uploading so everything lands in your profile, not the shared guest store.",
      ],
    },
    report: {
      title: "EOFY report",
      body: [
        "The EOFY performance statement rolls up the selected financial year’s income, expense deductions (by ATO-style schedules) and a tax estimate from your saved profile and ledgers. It updates as you add or change records — use it as a live working paper for you or your accountant, not as a lodged return.",
        "Download FY report builds a PDF of the current statement; Export JSON is for backups or importing elsewhere. Check that your Profile salary, driver type and TFN flag look right before you share the report, and switch financial year in the top bar if you’re reviewing a prior year.",
      ],
    },
    forecast: {
      title: "Forecast",
      body: [
        "Forecast projects where the year is heading from what you’ve already logged. Real-time mode uses your current income and deductions and extrapolates toward EOFY; Manual mode lets you type projected income and deductions and recalculate on demand.",
        "Projected totals can be viewed monthly, quarterly or yearly so you can plan cash flow and tax set-asides. Scenario cards show alternate paths (for example higher deductions or different income) without changing your ledgers — useful before you commit to a claim pattern for the rest of the year.",
      ],
    },
    profile: {
      title: "Profile",
      body: [
        "Profile is where you create or sign into a driver account, set your display name, employer, annual salary, licence class and financial year, and tick whether your TFN is with your employer. Salary suggests a licence class band; you can still adjust it if needed.",
        "Account tools cover email on file, password changes, and optional presets (default category and similar) so new expenses start closer to how you work. After login or logout the app reloads so every tab shows your data only.",
        "Primary mod accounts also see the admin panel to create or review driver profiles. Guests can browse read-only; uploads and ledger changes need a signed-in profile.",
      ],
    },
  };

  function renderHelp(topic) {
    const entry = HELP[topic] || HELP.dashboard;
    const titleEl = document.getElementById("support-help-title");
    const bodyEl = document.getElementById("support-help-body");
    if (titleEl) titleEl.textContent = entry.title;
    if (bodyEl) {
      bodyEl.innerHTML = entry.body.map((p) => `<p>${p}</p>`).join("");
    }
    document.querySelectorAll(".support-help-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.helpTopic === topic);
    });
  }

  function setStatus(msg, { isError, isSuccess } = {}) {
    const el = document.getElementById("support-contact-status");
    if (!el) return;
    el.textContent = "";
    el.classList.remove("banner", "support-status-success", "support-status-error");
    if (isError) el.classList.add("banner", "support-status-error");
    if (isSuccess) el.classList.add("support-status-success");
    if (!msg) return;
    if (typeof msg === "string") {
      el.textContent = msg;
      return;
    }
    el.appendChild(msg);
  }

  function showDeliveryConfirmation({
    supportEmail,
    userEmail,
    confirmationSent,
    mailto,
  }) {
    const wrap = document.createElement("div");
    wrap.className = "support-confirm-notice";

    const title = document.createElement("p");
    title.className = "support-confirm-title";
    title.textContent = "Support request sent";
    wrap.appendChild(title);

    const line1 = document.createElement("p");
    line1.textContent = `Your message has been sent to the developer (${supportEmail || "hilljj1990@gmail.com"}).`;
    wrap.appendChild(line1);

    const line2 = document.createElement("p");
    if (confirmationSent) {
      line2.textContent = `A confirmation notice was also sent to ${userEmail}. Check your inbox (and spam) for “we received your support request”.`;
    } else {
      line2.textContent = `We’ll reply to ${userEmail}. If you don’t hear back, follow up at ${supportEmail || "hilljj1990@gmail.com"}.`;
    }
    wrap.appendChild(line2);

    if (mailto) {
      const line3 = document.createElement("p");
      line3.className = "muted";
      const a = document.createElement("a");
      a.href = mailto;
      a.textContent = "Open a copy in your email app";
      line3.appendChild(a);
      wrap.appendChild(line3);
    }

    setStatus(wrap, { isSuccess: true });
  }

  /**
   * Browser-side delivery when the server has no SMTP/Resend credentials.
   * FormSubmit emails the developer and can autorespond to the user.
   * First use for an inbox may require the owner to click an activation email.
   */
  async function deliverViaFormSubmit({
    name,
    email,
    phone,
    message,
    username,
    supportEmail,
    confirmationText,
  }) {
    const inbox = supportEmail || "hilljj1990@gmail.com";
    const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(inbox)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        "Driver name": name,
        "Reply email": email,
        Phone: phone || "Not provided",
        Username: username || "(guest / not signed in)",
        Message: message,
        _replyto: email,
        _subject: `Haulage Finance support — from ${name}`,
        _template: "table",
        _autoresponse:
          confirmationText ||
          `Hi ${name},\n\nThanks for contacting Haulage Finance support. Your request has been sent to the developer (${inbox}). We’ll reply to this email as soon as we can.\n\n— Haulage Finance`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    // FormSubmit returns { success: "true"|"false", message } or similar.
    const ok =
      res.ok &&
      data &&
      data.success !== false &&
      data.success !== "false" &&
      !/activate|confirm your email/i.test(String(data.message || ""));
    return {
      sent: Boolean(ok),
      confirmationSent: Boolean(ok),
      activationRequired: /activate|confirm your email/i.test(String(data.message || "")),
      raw: data,
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();
    const message = form.message.value.trim();
    const btn = document.getElementById("support-send");
    if (btn) btn.disabled = true;
    setStatus("Sending your support request…");

    try {
      // API is declared in app.js (same page) and listed for ESLint earlier in this file.
      const base = API || `${window.location.origin}/api/haulage`;
      const res = await fetch(`${base}/support/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, email, phone, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Could not send your message.", { isError: true });
        return;
      }

      let emailed = Boolean(data.emailed);
      let confirmationSent = Boolean(data.confirmationSent);
      const supportEmail = data.supportEmail || "hilljj1990@gmail.com";

      // If the server could not reach an SMTP/Resend channel, deliver from the
      // browser so the developer inbox still receives the enquiry.
      if (!emailed || data.needsClientDelivery) {
        setStatus("Connecting to the support inbox…");
        try {
          const client = await deliverViaFormSubmit({
            name,
            email,
            phone,
            message,
            username: data.username || null,
            supportEmail,
            confirmationText: data.confirmationText,
          });
          if (client.sent) {
            emailed = true;
            confirmationSent = Boolean(client.confirmationSent);
          } else if (client.activationRequired) {
            const wrap = document.createElement("div");
            const p1 = document.createElement("p");
            const strong = document.createElement("strong");
            strong.textContent = "Almost there. ";
            p1.appendChild(strong);
            p1.appendChild(
              document.createTextNode("The support inbox needs a one-time activation.")
            );
            wrap.appendChild(p1);
            const p2 = document.createElement("p");
            p2.className = "muted";
            p2.textContent = `The developer (${supportEmail}) should check their email for a FormSubmit confirmation link, then try again. You can also email them directly:`;
            wrap.appendChild(p2);
            if (data.mailto) {
              const a = document.createElement("a");
              a.href = data.mailto;
              a.textContent = supportEmail;
              wrap.appendChild(a);
            }
            setStatus(wrap, { isError: true });
            return;
          }
        } catch (clientErr) {
          console.warn("Client support delivery failed", clientErr);
        }
      }

      if (emailed) {
        showDeliveryConfirmation({
          supportEmail,
          userEmail: email,
          confirmationSent,
          mailto: data.mailto,
        });
        form.reset();
        return;
      }

      const wrap = document.createElement("div");
      const p = document.createElement("p");
      p.textContent =
        "We couldn’t reach the support inbox automatically. Your message was saved on the server — please email the developer directly:";
      wrap.appendChild(p);
      if (data.mailto) {
        const a = document.createElement("a");
        a.href = data.mailto;
        a.textContent = supportEmail;
        wrap.appendChild(a);
      } else {
        const a = document.createElement("a");
        a.href = `mailto:${supportEmail}`;
        a.textContent = supportEmail;
        wrap.appendChild(a);
      }
      setStatus(wrap, { isError: true });
    } catch {
      setStatus("Network error — please try again or email hilljj1990@gmail.com.", {
        isError: true,
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wrapSetView() {
    if (typeof globalThis.setView !== "function") return;
    if (globalThis.setView.__haulageSupportWrapped) return;
    const prev = globalThis.setView;
    function supportAwareSetView(name) {
      const result = prev.apply(this, arguments);
      if (name === "support") {
        const title = document.getElementById("page-title");
        if (title) title.textContent = "Support";
      }
      return result;
    }
    supportAwareSetView.__haulageSupportWrapped = true;
    globalThis.setView = supportAwareSetView;
  }

  function start() {
    const form = document.getElementById("support-contact-form");
    if (form) form.addEventListener("submit", onSubmit);

    document.querySelectorAll(".support-help-btn").forEach((btn) => {
      btn.addEventListener("click", () => renderHelp(btn.dataset.helpTopic));
    });
    renderHelp("dashboard");

    // Wrap after other enhancement patches (category menus) have run.
    wrapSetView();
    setTimeout(wrapSetView, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Narrow FY picker (app.js still builds ±15/20 by default) ------------ */
(function () {
  "use strict";

  /** Keep in sync with lib/fy-window.js */
  const FY_YEARS_BACK = 6;
  const FY_YEARS_FORWARD = 3;

  function globalFn(name) {
    try {
      const fn = globalThis[name];
      return typeof fn === "function" ? fn : null;
    } catch {
      return null;
    }
  }

  function formatFy(startYear) {
    const fn = globalFn("formatFinancialYearValue");
    if (fn) return fn(startYear);
    const y = Math.floor(Number(startYear));
    return `${y}-${String(y + 1).slice(-2)}`;
  }

  function formatFyLabel(fy) {
    const fn = globalFn("formatFinancialYearLabel");
    if (fn) return fn(fy);
    return `FY ${String(fy).replace("-", "–")}`;
  }

  function currentFy() {
    const fn = globalFn("getCurrentFinancialYear");
    if (fn) return fn();
    const now = new Date();
    const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    return formatFy(startYear);
  }

  function buildWindow(yearsBack, yearsForward) {
    const currentStart = Number(currentFy().split("-")[0]);
    const years = [];
    for (let y = currentStart + yearsForward; y >= currentStart - yearsBack; y -= 1) {
      years.push(formatFy(y));
    }
    return years;
  }

  /**
   * Replacement for app.js populateFinancialYearSelect — same DOM contract,
   * 6 past + 3 future. Slides automatically each 1 July via currentFy().
   */
  function populateFinancialYearSelectNarrow(selectedFy) {
    const sel = document.getElementById("fy-select");
    const profileSel = document.getElementById("profile-financial-year");
    const targets = [sel, profileSel].filter(Boolean);
    if (!targets.length) return;

    const current = currentFy();
    const currentStart = Number(current.split("-")[0]);
    const years = buildWindow(FY_YEARS_BACK, FY_YEARS_FORWARD);
    let fy = selectedFy;
    try {
      const appState = globalThis.state;
      if (!fy && appState && appState.financialYear) fy = appState.financialYear;
    } catch {
      /* ignore */
    }
    fy = fy || current;

    if (!years.includes(fy)) {
      years.push(fy);
      years.sort((a, b) => Number(b.split("-")[0]) - Number(a.split("-")[0]));
    }

    const future = years.filter((y) => Number(y.split("-")[0]) > currentStart);
    const present = years.filter((y) => y === current || Number(y.split("-")[0]) === currentStart);
    const past = years.filter((y) => Number(y.split("-")[0]) < currentStart);

    const optionHtml = (list) =>
      list.map((y) => `<option value="${y}">${formatFyLabel(y)}</option>`).join("");

    const html = [
      future.length
        ? `<optgroup label="Future (up to +${FY_YEARS_FORWARD} years)">${optionHtml(future)}</optgroup>`
        : "",
      present.length ? `<optgroup label="Current">${optionHtml(present)}</optgroup>` : "",
      past.length ? `<optgroup label="Past">${optionHtml(past)}</optgroup>` : "",
    ].join("");

    for (const target of targets) {
      target.innerHTML = html;
      target.value = fy;
      if (target.value !== fy) {
        requestAnimationFrame(() => {
          target.value = fy;
        });
      }
    }

    try {
      const appState = globalThis.state;
      if (appState) appState.financialYear = fy;
    } catch {
      /* ignore */
    }
    const fyLabelEl = document.getElementById("fy-label");
    if (fyLabelEl) fyLabelEl.textContent = String(fy).replace("-", "–");
  }

  // Override the verbatim app.js function so refreshAll / align / init re-use this window.
  globalThis.populateFinancialYearSelect = populateFinancialYearSelectNarrow;

  function clampNow() {
    let selected = null;
    try {
      const appState = globalThis.state;
      if (appState && appState.financialYear) selected = appState.financialYear;
    } catch {
      /* ignore */
    }
    const top = document.getElementById("fy-select");
    if (!selected && top && top.value) selected = top.value;
    populateFinancialYearSelectNarrow(selected || currentFy());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", clampNow);
  } else {
    clampNow();
  }
})();

/* --- App version label (PR-count based; shown under Support) ------------- */
(function () {
  "use strict";

  async function refreshVersion() {
    const nodes = document.querySelectorAll("[data-app-version]");
    if (!nodes.length) return;
    try {
      const base =
        typeof API !== "undefined" && API
          ? API
          : `${window.location.origin}/api/haulage`;
      const res = await fetch(`${base}/version`, { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.label) return;
      nodes.forEach((el) => {
        el.textContent = data.label;
        if (data.prNumber != null) el.title = `PR #${data.prNumber}`;
      });
    } catch {
      /* keep static fallback in HTML */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void refreshVersion();
    });
  } else {
    void refreshVersion();
  }
})();
