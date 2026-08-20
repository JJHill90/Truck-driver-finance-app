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
    // Also ensure Profile presets land on expense saves when forms still have
    // HTML defaults (work-use 100 / weak category).
    if (
      url &&
      (/\/receipts\/manual(\?|$)/.test(url) ||
        /\/receipts\/[^/]+\/confirm(\?|$)/.test(url) ||
        /\/expenses(\?|$)/.test(url)) &&
      String(options.method || "GET").toUpperCase() === "POST" &&
      typeof options.body === "string"
    ) {
      try {
        const bodyObj = JSON.parse(options.body);
        const isIncomeConfirm =
          /\/confirm(\?|$)/.test(url) && bodyObj.purpose === "income";
        if (!isIncomeConfirm) {
          const cashEl = document.querySelector(
            "#manual-receipt-form [name=cashTransaction], #manual-cash-transaction"
          );
          const noReceiptEl = document.querySelector(
            "#manual-receipt-form [name=noReceipt], #manual-no-receipt"
          );
          if (/\/receipts\/manual(\?|$)/.test(url)) {
            if (cashEl) bodyObj.cashTransaction = Boolean(cashEl.checked);
            if (noReceiptEl) bodyObj.noReceipt = Boolean(noReceiptEl.checked);
          }

          const presets = (window.__haulageUser && window.__haulageUser.presets) || {};
          const presetWork = Number(presets.defaultWorkUsePercent);
          const presetCat = String(presets.defaultCategory || "").trim();
          const carIds = new Set([
            "vehicle_car",
            "fuel",
            "repairs_maintenance",
            "tyres",
            "registration_insurance",
            "parking_tolls",
          ]);
          const cat = String(bodyObj.category || "").trim();
          if (!carIds.has(cat)) {
            const formWork =
              document.querySelector("#scan-confirm-work") ||
              document.querySelector("#manual-receipt-form [name=workUsePercent]");
            const fromPreset =
              formWork && formWork.dataset && formWork.dataset.fromProfilePreset === "1";
            if (
              Number.isFinite(presetWork) &&
              presetWork >= 0 &&
              presetWork <= 100 &&
              (fromPreset ||
                bodyObj.workUsePercent == null ||
                bodyObj.workUsePercent === "")
            ) {
              bodyObj.workUsePercent = Math.round(presetWork);
            }
            const weak = !cat || cat === "other_work" || cat === "other";
            if (weak && presetCat) {
              bodyObj.category = presetCat;
            }
          }
        }
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
          // After a successful upload, refresh entitlements so the halfway Pro prompt can fire once.
          if (typeof window.haulageRefreshBilling === "function") {
            void window.haulageRefreshBilling();
          }
        }

        // Soft freemium gate: upload quota (402) — toast + upgrade hint, do not brick mid-OCR review.
        if (res.status === 402 && data && data.code === "UPLOAD_LIMIT") {
          const rem =
            data.entitlements && data.entitlements.uploadsRemaining != null
              ? data.entitlements.uploadsRemaining
              : 0;
          const msg =
            data.error ||
            `Free plan upload limit reached (${rem} left this month). Upgrade to Pro ($5/month or $60/year) for unlimited scans.`;
          if (typeof window.toast === "function") window.toast(msg);
          if (typeof window.haulagePromptUpgrade === "function") {
            window.haulagePromptUpgrade(data);
          }
        }
        return res;
      }

      // Soft gate for manual uploads and other haulage POSTs that return 402.
      const res = await origFetch.apply(this, args);
      try {
        if (res.status === 402 && isHaulageApiUrl(url)) {
          const data = await res.clone().json();
          if (data && (data.code === "UPLOAD_LIMIT" || data.code === "PRO_REQUIRED")) {
            if (typeof window.toast === "function") {
              window.toast(data.error || "Upgrade to Pro to continue.");
            }
            if (typeof window.haulagePromptUpgrade === "function") {
              window.haulagePromptUpgrade(data);
            }
          }
        }
      } catch {
        /* ignore */
      }
      return res;
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
      } else if (data.categorySource === "user_preset") {
        matchBits.push("Category from your Profile default expense category");
      } else if (data.categorySource === "vendor_content") {
        matchBits.push("Category from receipt line items");
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

  /** Inject ABN into income confirm (app.js has no income ABN field). */
  function ensureIncomeAbnField(box) {
    if (!box || latest?.purpose !== "income") return;
    const form = box.querySelector(".scan-confirm-form");
    const entityInput = box.querySelector("#income-confirm-entity");
    if (!form || !entityInput) return;

    let abnInput = box.querySelector("#income-confirm-abn");
    if (!abnInput) {
      const label = document.createElement("label");
      label.className = "enh-income-abn-label";
      label.innerHTML = `ABN (optional)<input type="text" id="income-confirm-abn" inputmode="numeric" placeholder="12 345 678 901" />`;
      const entityLabel = entityInput.closest("label");
      if (entityLabel && entityLabel.parentNode) {
        entityLabel.insertAdjacentElement("afterend", label);
      } else {
        form.insertBefore(label, form.firstChild);
      }
      abnInput = label.querySelector("input");
    }
    if (abnInput && !abnInput.value && latest.vendorAbn) {
      abnInput.value = latest.vendorAbn;
    }
    // Keep entity prefilled from ABN pairing when the confirm form is empty/junk.
    if (entityInput && latest.vendor && (!entityInput.value || /tax\s*invoice|invoice|receipt/i.test(entityInput.value))) {
      entityInput.value = latest.vendor;
    }
  }

  /** Keep expense confirm vendor/ABN in sync with tighter ABN pairing. */
  function syncExpenseAbnFields(box) {
    if (!box || latest?.purpose !== "expense") return;
    const abn = box.querySelector("#scan-confirm-abn");
    const vendor = box.querySelector("#scan-confirm-vendor");
    if (abn && latest.vendorAbn && !abn.value) abn.value = latest.vendorAbn;
    if (vendor && latest.vendor) {
      if (!vendor.value || /tax\s*invoice|invoice|receipt/i.test(vendor.value)) {
        vendor.value = latest.vendor;
      }
    }
    const manualAbn = document.querySelector("#manual-receipt-form [name=vendorAbn]");
    const manualVendor = document.querySelector("#manual-receipt-form [name=vendor]");
    if (manualAbn && latest.vendorAbn && !manualAbn.value) manualAbn.value = latest.vendorAbn;
    if (manualVendor && latest.vendor && (!manualVendor.value || /tax\s*invoice|invoice|receipt/i.test(manualVendor.value))) {
      manualVendor.value = latest.vendor;
    }
  }

  function enhanceBox(box) {
    if (!latest || !box) return;
    if (!box.querySelector(".scan-confirm")) return;
    ensureIncomeAbnField(box);
    syncExpenseAbnFields(box);
    if (latest.purpose === "expense" && typeof window.haulageApplyProfilePresets === "function") {
      window.haulageApplyProfilePresets({ forceWorkUse: false });
    }
    if (box.__enhToken === latest.token) return;
    box.__enhToken = latest.token;
    const existing = box.querySelector("#enh-panel");
    if (existing) existing.remove();
    box.appendChild(buildPanel(latest));
  }

  // Fold income confirm ABN into the approve payload (app.js omits it).
  function patchIncomeConfirmPayload() {
    const orig = window.readIncomeScanConfirmPayload;
    if (typeof orig !== "function" || orig.__enhAbnPatched) return;
    function wrapped() {
      const payload = orig.apply(this, arguments) || {};
      const abnEl = document.getElementById("income-confirm-abn");
      const abn = (abnEl && abnEl.value) || (latest && latest.purpose === "income" && latest.vendorAbn) || "";
      if (abn) {
        payload.vendorAbn = abn;
        payload.abn = abn;
      }
      return payload;
    }
    wrapped.__enhAbnPatched = true;
    window.readIncomeScanConfirmPayload = wrapped;
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
    patchIncomeConfirmPayload();
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

  async function apiPut(path, body) {
    const res = await fetch(`${API}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body || {}),
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

  const HUB_APP_KEY = "driverhub-selected-app";

  function getSelectedHubApp() {
    try {
      let app = localStorage.getItem(HUB_APP_KEY) || "";
      // Migrate pre-rename Finance Hub selection
      if (app === "financehub") {
        app = "taxationhub";
        localStorage.setItem(HUB_APP_KEY, app);
      }
      return app;
    } catch {
      return "";
    }
  }

  function setSelectedHubApp(appId) {
    try {
      if (appId) localStorage.setItem(HUB_APP_KEY, appId);
      else localStorage.removeItem(HUB_APP_KEY);
    } catch {
      /* ignore */
    }
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

  /** Show Driver Hub login forms (signed out). */
  function showDriverHubLogin() {
    lockApp();
    byId("title-auth-panel")?.classList.remove("hidden");
    byId("title-hub-picker")?.classList.add("hidden");
    setSelectedHubApp("");
  }

  /** Show app picker after Driver Hub login (Taxation Hub still gated). */
  function showDriverHubPicker(username) {
    lockApp();
    byId("title-auth-panel")?.classList.add("hidden");
    const picker = byId("title-hub-picker");
    if (picker) picker.classList.remove("hidden");
    const nameEl = byId("title-hub-username");
    if (nameEl) nameEl.textContent = username || "—";
    const hubMsg = byId("title-hub-message");
    if (hubMsg) hubMsg.textContent = "";
    // Refresh plan badge on Driver Hub (Free / Pro / Pro+).
    void refreshBillingPanel();
  }

  function openTaxationHub(user) {
    setSelectedHubApp("taxationhub");
    unlockApp();
    showAuthState(user || null);
  }

  function returnToDriverHub(user) {
    setSelectedHubApp("");
    showDriverHubPicker(user && user.username ? user.username : byId("title-hub-username")?.textContent);
    if (typeof window.toast === "function") {
      window.toast("Back at Driver Hub — pick an app to open");
    }
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
    const loginBtn = byId("title-auth-login");
    const registerBtn = byId("title-auth-register");
    const backLogin = byId("title-auth-back-login");
    const headline = document.querySelector("#title-auth-panel .title-screen-headline");
    const sub = document.querySelector("#title-auth-panel .title-screen-sub");
    if (emailWrap) emailWrap.classList.toggle("hidden", !isRegister);
    if (hint) hint.classList.toggle("hidden", !isRegister);
    if (strength) strength.classList.toggle("hidden", !isRegister);
    if (pwd) {
      pwd.autocomplete = isRegister ? "new-password" : "current-password";
      pwd.placeholder = isRegister ? "Strong password (8+ chars)" : "Your password";
    }
    // Creating a profile: hide Log in and highlight Create so new users are not confused.
    if (loginBtn) {
      loginBtn.classList.toggle("hidden", Boolean(isRegister));
      loginBtn.classList.toggle("primary", !isRegister);
      loginBtn.classList.toggle("secondary", Boolean(isRegister));
    }
    if (registerBtn) {
      registerBtn.classList.toggle("primary", Boolean(isRegister));
      registerBtn.classList.toggle("secondary", !isRegister);
    }
    if (backLogin) backLogin.classList.toggle("hidden", !isRegister);
    if (headline) {
      headline.textContent = isRegister
        ? "Create your Driver Hub profile."
        : "One login for every driver app.";
    }
    if (sub) {
      sub.textContent = isRegister
        ? "Choose a username, email and strong password. You’ll use this same login for Taxation Hub and future Driver Hub apps."
        : "Sign in with your Driver Hub account, then open Taxation Hub or another app from your hub.";
    }
    const form = byId("title-auth-form");
    if (form) form.classList.toggle("title-register-mode", Boolean(isRegister));
    void refreshTrialHints({ highlightRegister: isRegister });
  }

  function trialHintText(offer, { highlightRegister } = {}) {
    if (!offer) return "";
    const months = offer.trialMonths || 3;
    const label = offer.trialLabel || "Pro+";
    const price = offer.priceLabel || "$5/month";
    const base = `Every new profile includes ${months} months of ${label} (full Pro access).`;
    if (highlightRegister) {
      return `${base} Create your profile to start — or subscribe to Pro (${price}) from day one.`;
    }
    return `${base} Subscribe to Pro (${price}) anytime, including from day one.`;
  }

  async function refreshTrialHints(opts = {}) {
    try {
      let offer;
      try {
        offer = await apiGet("/billing/trial");
      } catch {
        offer = await apiGet("/billing/founding");
      }
      const text = trialHintText(offer, opts);
      for (const id of ["title-trial-hint", "auth-trial-hint", "title-founding-hint", "auth-founding-hint"]) {
        const el = byId(id);
        if (!el) continue;
        if (!text) {
          el.hidden = true;
          el.textContent = "";
          continue;
        }
        el.hidden = false;
        el.textContent = text;
        el.classList.add("trial-open");
        el.classList.remove("trial-closed", "founding-closed");
      }
    } catch {
      /* non-fatal */
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
      setTitleMessage("Logging in to Driver Hub…");
      try {
        await apiPost("/auth/login", readTitleCreds());
        resetReviewShown();
        setSelectedHubApp(""); // land on app picker after reload
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
          "Choose a strong password and add your email so you can recover this Driver Hub profile later.",
          false
        );
        byId("title-auth-email")?.focus();
        return;
      }
      setTitleMessage("Creating Driver Hub profile…");
      try {
        const creds = readTitleCreds();
        if (!creds.email) {
          setTitleMessage("Email is required when creating a profile.", true);
          return;
        }
        await apiPost("/auth/register", creds);
        resetReviewShown();
        setSelectedHubApp("");
        window.location.reload();
      } catch (e) {
        setTitleMessage(e.message, true);
      }
    }

    byId("hub-open-taxationhub")?.addEventListener("click", async () => {
      try {
        const me = await apiGet("/auth/me");
        if (!(me.user && me.user.username)) {
          showDriverHubLogin();
          setTitleMessage("Sign in to Driver Hub first.", true);
          return;
        }
        openTaxationHub(me.user);
        if (me.user.isAdmin) await loadAdminUsers();
        if (!reviewAlreadyShown()) {
          const alertData = await apiGet("/alerts");
          renderAlerts(alertData.alerts, alertData.user);
          markReviewShown();
        }
      } catch (err) {
        const hubMsg = byId("title-hub-message");
        if (hubMsg) {
          hubMsg.textContent = err.message || "Could not open Taxation Hub.";
          hubMsg.classList.add("is-error");
        }
      }
    });

    byId("title-hub-logout")?.addEventListener("click", async () => {
      try {
        await apiPost("/auth/logout", {});
      } catch {
        /* ignore */
      }
      resetReviewShown();
      setSelectedHubApp("");
      window.location.reload();
    });

    byId("nav-driverhub")?.addEventListener("click", async () => {
      try {
        const me = await apiGet("/auth/me");
        if (me.user && me.user.username) returnToDriverHub(me.user);
        else showDriverHubLogin();
      } catch {
        showDriverHubLogin();
      }
    });

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
      if (registerMode) void doRegister();
      else void doLogin();
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
    byId("title-auth-back-login")?.addEventListener("click", (e) => {
      e.preventDefault();
      registerMode = false;
      showTitleRegisterMode(false);
      setTitleMessage("");
      byId("title-auth-username")?.focus();
    });
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
    window.__haulageUser = user && user.username ? user : null;
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
      applyProfilePresetsToExpenseForms({ forceWorkUse: true });
      void refreshBillingPanel();
    } else {
      outEl.classList.remove("hidden");
      inEl.classList.add("hidden");
      clearBillingPanel();
    }
    const adminPanel = byId("admin-panel");
    if (adminPanel) {
      if (user && user.isAdmin) adminPanel.classList.remove("hidden");
      else adminPanel.classList.add("hidden");
    }
  }

  /** Profile presets used by expense forms / scan confirm (not income; not car claims). */
  function readProfilePresets() {
    const presets = (window.__haulageUser && window.__haulageUser.presets) || {};
    const workRaw = Number(presets.defaultWorkUsePercent);
    const workUse =
      Number.isFinite(workRaw) && workRaw >= 0 && workRaw <= 100 ? Math.round(workRaw) : null;
    const category = String(presets.defaultCategory || "").trim() || null;
    return { workUse, category };
  }

  function isWeakExpenseCategory(id) {
    const v = String(id || "")
      .trim()
      .toLowerCase();
    return !v || v === "other_work" || v === "other";
  }

  function setSelectValueIfPresent(selectEl, value) {
    if (!selectEl || value == null || value === "") return false;
    const ok = [...selectEl.options].some((o) => o.value === value);
    if (!ok) return false;
    selectEl.value = value;
    return true;
  }

  /**
   * Prefill general expense work-use % and category from Profile → Presets.
   * Does not touch Car Expenses claim forms (those use the active vehicle %).
   */
  function applyProfilePresetsToExpenseForms(opts = {}) {
    const { workUse, category } = readProfilePresets();
    const forceWorkUse = Boolean(opts.forceWorkUse);

    const markWorkField = (workField) => {
      if (!workField || workUse == null) return;
      const cur = Number(workField.value);
      if (forceWorkUse || !Number.isFinite(cur) || workField.value === "" || cur === 100) {
        workField.value = String(workUse);
        workField.dataset.fromProfilePreset = "1";
        workField.title = `From Profile presets (${workUse}% work use)`;
        if (!workField.__presetInputHook) {
          workField.__presetInputHook = true;
          workField.addEventListener("input", () => {
            delete workField.dataset.fromProfilePreset;
            workField.title = "";
          });
        }
      }
    };

    const manualForm = byId("manual-receipt-form");
    if (manualForm && manualForm.elements) {
      markWorkField(manualForm.elements.workUsePercent);
      const catField =
        byId("manual-receipt-category") || (manualForm.elements && manualForm.elements.category);
      if (catField && category && (forceWorkUse || isWeakExpenseCategory(catField.value))) {
        setSelectValueIfPresent(catField, category);
      }
    }

    markWorkField(byId("scan-confirm-work"));
    const scanCat = byId("scan-confirm-category");
    if (scanCat && category && (forceWorkUse || isWeakExpenseCategory(scanCat.value))) {
      setSelectValueIfPresent(scanCat, category);
    }

    // Keep awaiting-approve modal category in sync when still weak.
    const awaitCat = byId("enh-await-category");
    if (awaitCat && category && isWeakExpenseCategory(awaitCat.value)) {
      awaitCat.value = category;
    }
  }
  window.haulageApplyProfilePresets = applyProfilePresetsToExpenseForms;

  let cachedEntitlements = null;

  function clearBillingPanel() {
    cachedEntitlements = null;
    const status = byId("billing-status");
    const uploads = byId("billing-uploads");
    const msg = byId("billing-message");
    if (status) status.textContent = "Sign in to see your plan.";
    if (uploads) uploads.textContent = "";
    if (msg) msg.textContent = "";
    byId("billing-upgrade")?.classList.add("hidden");
    byId("billing-cancel")?.classList.add("hidden");
    byId("billing-resume")?.classList.add("hidden");
    byId("billing-manage")?.classList.add("hidden");
    byId("billing-price-hint")?.classList.add("hidden");
    updatePlanBadges(null);
  }

  function setBillingMessage(text, isError) {
    const el = byId("billing-message");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "var(--red)" : "";
  }

  function formatTrialEnd(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return String(iso);
    }
  }

  /** Free | Pro | Pro+ for hub badges. */
  function planBadgeLabel(ent) {
    if (!ent) return "";
    if (ent.displayPlan) return String(ent.displayPlan);
    if (ent.isAdmin) return "Pro";
    if (ent.planGrant === "pro_plus" || ent.status === "pro_plus") return ent.trialLabel || "Pro+";
    if (ent.status === "trialing") return ent.trialLabel || "Pro+";
    if (ent.isPro) return "Pro";
    return "Free";
  }

  function planBadgeClass(label) {
    const t = String(label || "").toLowerCase().replace(/\+/g, "-plus").replace(/\s+/g, "-");
    if (t === "pro-plus" || t === "pro+") return "plan-pro-plus";
    if (t === "pro") return "plan-pro";
    return "plan-free";
  }

  function setPlanBadgeEl(el, ent) {
    if (!el) return;
    const label = planBadgeLabel(ent);
    if (!label) {
      el.classList.add("hidden");
      el.textContent = "";
      el.classList.remove("plan-free", "plan-pro", "plan-pro-plus");
      return;
    }
    el.textContent = label;
    el.classList.remove("hidden", "plan-free", "plan-pro", "plan-pro-plus");
    el.classList.add(planBadgeClass(label));
    el.title = `Your account plan: ${label}`;
  }

  function updatePlanBadges(ent) {
    setPlanBadgeEl(byId("sidebar-plan-badge"), ent);
    setPlanBadgeEl(byId("title-hub-plan-badge"), ent);
  }

  function hasCancelablePaidSub(ent) {
    if (!ent || ent.isAdmin) return false;
    if (!ent.hasStripeSubscription && !ent.hasStripeCustomer) return false;
    const st = String(ent.subscriptionStatus || "").toLowerCase();
    if (!["active", "trialing", "past_due"].includes(st)) return false;
    // Signup trial (no Stripe sub id) is not cancelable via Stripe.
    if (ent.status === "trialing" && !ent.hasStripeSubscription) return false;
    return !ent.cancelAtPeriodEnd;
  }

  function hasScheduledCancel(ent) {
    if (!ent || ent.isAdmin) return false;
    return Boolean(ent.cancelAtPeriodEnd && ent.hasStripeSubscription);
  }

  function renderBillingPanel(ent, stripeConfigured) {
    cachedEntitlements = ent || null;
    const statusEl = byId("billing-status");
    const uploadsEl = byId("billing-uploads");
    const upgradeBtn = byId("billing-upgrade");
    const cancelBtn = byId("billing-cancel");
    const resumeBtn = byId("billing-resume");
    const manageBtn = byId("billing-manage");
    if (!statusEl) return;

    if (!ent) {
      statusEl.textContent = "Could not load plan details.";
      updatePlanBadges(null);
      return;
    }

    updatePlanBadges(ent);

    const price = ent.priceLabel || "$5/month";
    const trialLabel = ent.trialLabel || "Pro+";
    let statusText = "Free plan";
    if (ent.isAdmin) statusText = "Primary mod — Pro access";
    else if (ent.planGrant === "pro_plus" || ent.status === "pro_plus") {
      statusText = `${trialLabel} (admin grant)`;
    } else if (ent.status === "trialing" && !ent.hasStripeSubscription) {
      statusText = `${trialLabel} trial · ends ${formatTrialEnd(ent.trialEndsAt)}`;
    } else if (ent.isPro) {
      statusText = `Pro (${price})`;
      if (ent.cancelAtPeriodEnd && ent.currentPeriodEnd) {
        statusText += ` · cancels ${formatTrialEnd(ent.currentPeriodEnd)} (benefits stay until then)`;
      } else if (ent.currentPeriodEnd) {
        statusText += ` · renews ${formatTrialEnd(ent.currentPeriodEnd)}`;
      }
    } else if (ent.planGrant === "free") {
      statusText = `Free plan (set by admin) · ${ent.freeUploadsPerMonth || 15} uploads/month + ${ent.freeOnscreenReports || 1} on-screen report`;
    } else if (ent.trialExpired) {
      statusText = `Free plan · ${trialLabel} trial ended — ${ent.freeUploadsPerMonth || 15} uploads/month + ${ent.freeOnscreenReports || 1} on-screen report; upgrade to Pro (${price}) for unlimited + PDF`;
    } else {
      statusText = `Free plan · ${ent.freeUploadsPerMonth || 15} uploads/month + ${ent.freeOnscreenReports || 1} on-screen report · Pro (${price}) unlocks unlimited + PDF & forecast`;
    }
    statusEl.textContent = statusText;

    if (uploadsEl) {
      if (ent.isPro) {
        uploadsEl.textContent = "Uploads this month: unlimited";
      } else {
        const used = ent.uploadsUsed ?? 0;
        const limit = ent.uploadsLimit ?? 15;
        const left = ent.uploadsRemaining ?? Math.max(0, limit - used);
        uploadsEl.textContent = `Uploads this month: ${used} of ${limit} used · ${left} left`;
        if (ent.softWarning) {
          uploadsEl.textContent += " — halfway through free uploads this month";
        }
      }
    }

    const priceHint = byId("billing-price-hint");
    const yearly = ent.priceYearlyLabel || "$60/year";
    if (priceHint) {
      priceHint.textContent = `Pro is ${price} or ${yearly} (same full access as ${trialLabel}).`;
      priceHint.classList.toggle(
        "hidden",
        Boolean(ent.isAdmin || (ent.isPro && ent.status !== "trialing" && ent.planGrant !== "pro_plus" && !ent.cancelAtPeriodEnd))
      );
    }

    if (upgradeBtn) {
      // Paid Pro checkout — available on Free and during Pro+ signup trial.
      const paidLive =
        ent.hasStripeSubscription &&
        ["active", "trialing", "past_due"].includes(String(ent.subscriptionStatus || ""));
      const hideUpgrade = ent.isAdmin || ent.planGrant === "pro_plus" || paidLive;
      if (hideUpgrade) {
        upgradeBtn.classList.add("hidden");
      } else {
        upgradeBtn.classList.remove("hidden");
        upgradeBtn.textContent = "Upgrade to Pro";
      }
    }

    if (cancelBtn) {
      cancelBtn.classList.toggle("hidden", !hasCancelablePaidSub(ent));
    }
    if (resumeBtn) {
      resumeBtn.classList.toggle("hidden", !hasScheduledCancel(ent));
    }

    if (manageBtn) {
      if (stripeConfigured === false && !ent.isPro) {
        setBillingMessage(
          "Card payments are not configured on this server yet — trials and free quotas still apply.",
          false
        );
      }
      const likelyCustomer =
        ent.hasStripeCustomer ||
        ["active", "past_due", "canceled", "trialing"].includes(String(ent.subscriptionStatus || ""));
      if (likelyCustomer && !ent.isAdmin && ent.hasStripeCustomer) manageBtn.classList.remove("hidden");
      else manageBtn.classList.add("hidden");
    }

    applyProExportGates(ent);
    maybeSoftWarnUploads(ent);
  }

  function applyProExportGates(ent) {
    const pdfBtn = byId("download-report-pdf");
    const jsonBtn = byId("export-report");
    const pro = ent && ent.isPro;
    if (pdfBtn) {
      pdfBtn.disabled = !pro;
      pdfBtn.title = pro
        ? "Download accountant-ready PDF"
        : "Pro feature — upgrade for $5/month or $60/year";
      pdfBtn.classList.toggle("billing-locked", !pro);
    }
    if (jsonBtn) {
      jsonBtn.disabled = !pro;
      jsonBtn.title = pro
        ? "Export JSON for your accountant"
        : "Pro feature — upgrade for $5/month or $60/year";
      jsonBtn.classList.toggle("billing-locked", !pro);
    }
    document.querySelectorAll('.nav-btn[data-view="forecast"]').forEach((btn) => {
      btn.classList.toggle("billing-locked", !pro);
      btn.title = pro ? "" : "Forecast is included with Pro ($5/month or $60/year)";
    });
  }

  function softWarnStorageKey(ent) {
    const month =
      (typeof ent.uploadsMonthKey === "string" && ent.uploadsMonthKey) ||
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const who = (window.__haulageUser && window.__haulageUser.username) || "guest";
    return `haulage-upload-soft-warn:${who}:${month}`;
  }

  function hasShownSoftWarn(ent) {
    try {
      return localStorage.getItem(softWarnStorageKey(ent)) === "1";
    } catch {
      return false;
    }
  }

  function markSoftWarnShown(ent) {
    try {
      localStorage.setItem(softWarnStorageKey(ent), "1");
    } catch {
      /* ignore */
    }
  }

  /** One Pro upgrade prompt per calendar month, only after halfway free uploads. */
  function maybeSoftWarnUploads(ent) {
    if (!ent || ent.isPro || !ent.softWarning) return;
    if (hasShownSoftWarn(ent)) return;
    markSoftWarnShown(ent);
    const left = ent.uploadsRemaining;
    const used = ent.uploadsUsed;
    const limit = ent.freeUploadsPerMonth || 15;
    promptUpgrade({
      error: `You’ve used ${used} of ${limit} free uploads this month (${left} left). Upgrade to Pro for unlimited scans, PDF export and forecast.`,
      code: "SOFT_UPLOAD_WARN",
      entitlements: ent,
    });
  }

  async function refreshBillingPanel() {
    try {
      const data = await apiGet("/billing/entitlements");
      renderBillingPanel(data.entitlements, data.stripeConfigured);
      // Attach hasStripeCustomer from /auth/me if needed for manage button
      const me = await apiGet("/auth/me");
      if (me.user && me.user.username) window.__haulageUser = me.user;
      if (me.entitlements) {
        cachedEntitlements = { ...data.entitlements, ...me.entitlements };
        updatePlanBadges(cachedEntitlements);
      }
      const manageBtn = byId("billing-manage");
      if (manageBtn && me.user && me.user.hasStripeCustomer && !me.user.isAdmin) {
        manageBtn.classList.remove("hidden");
      }
    } catch {
      clearBillingPanel();
      const status = byId("billing-status");
      if (status) status.textContent = "Sign in to see your plan.";
    }
  }
  window.haulageRefreshBilling = refreshBillingPanel;

  function promptUpgrade(data) {
    const existing = document.getElementById("enh-billing-modal");
    if (existing) existing.remove();
    const ent = (data && data.entitlements) || cachedEntitlements || {};
    const price = ent.priceLabel || "$5/month";
    const yearly = ent.priceYearlyLabel || "$60/year";
    const trialLabel = ent.trialLabel || "Pro+";
    const modal = document.createElement("div");
    modal.id = "enh-billing-modal";
    modal.className = "enh-dup-modal";
    modal.innerHTML = `
      <div class="enh-dup-backdrop" data-billing-dismiss></div>
      <div class="enh-dup-card" role="dialog" aria-modal="true" aria-labelledby="enh-billing-title">
        <h3 id="enh-billing-title">Upgrade to Pro</h3>
        <p>${esc(
          (data && data.error) ||
            `Pro unlocks unlimited uploads, PDF export and forecast — ${price} or ${yearly} (same full access as ${trialLabel}).`
        )}</p>
        <p class="muted">Free plan includes ${ent.freeUploadsPerMonth || 15} uploads per month and ${ent.freeOnscreenReports || 1} on-screen EOFY report. You’ll go to secure card payment to activate Pro.</p>
        <div class="enh-dup-actions enh-billing-plan-actions">
          <button type="button" class="btn secondary" data-billing-dismiss>Not now</button>
          <button type="button" class="btn secondary" data-billing-upgrade="month">Pro — ${esc(price)}</button>
          <button type="button" class="btn primary" data-billing-upgrade="year">Pro — ${esc(yearly)}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelectorAll("[data-billing-dismiss]").forEach((el) => {
      el.addEventListener("click", close);
    });
    modal.querySelectorAll("[data-billing-upgrade]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const interval = btn.getAttribute("data-billing-upgrade") || "month";
        close();
        void startCheckout(interval);
      });
    });
  }
  window.haulagePromptUpgrade = promptUpgrade;

  async function startCheckout(interval = "month") {
    const period = interval === "year" ? "year" : "month";
    setBillingMessage(
      period === "year" ? "Opening yearly checkout…" : "Opening monthly checkout…"
    );
    try {
      const data = await apiPost("/billing/checkout", { interval: period });
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setBillingMessage("Checkout did not return a URL.", true);
    } catch (err) {
      setBillingMessage(err.message || "Checkout failed.", true);
      if (window.toast) window.toast(err.message || "Checkout failed");
    }
  }

  async function openBillingPortal() {
    setBillingMessage("Opening billing portal…");
    try {
      const data = await apiPost("/billing/portal", {});
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setBillingMessage("Portal did not return a URL.", true);
    } catch (err) {
      setBillingMessage(err.message || "Could not open billing portal.", true);
    }
  }

  async function cancelSubscription() {
    const ent = cachedEntitlements || {};
    const until = ent.currentPeriodEnd ? formatTrialEnd(ent.currentPeriodEnd) : "the end of your billing period";
    const ok = window.confirm(
      `Cancel Pro auto-renewal?\n\nYou’ll keep Pro benefits until ${until}. After that you’ll return to the Free plan. You can resume renewals any time before then.`
    );
    if (!ok) return;
    setBillingMessage("Cancelling auto-renewal…");
    try {
      const data = await apiPost("/billing/cancel", {});
      if (data.entitlements) renderBillingPanel(data.entitlements, true);
      setBillingMessage(data.message || "Subscription will not renew.");
      if (window.toast) window.toast(data.message || "Pro stays active until period end");
    } catch (err) {
      setBillingMessage(err.message || "Could not cancel subscription.", true);
      if (window.toast) window.toast(err.message || "Cancel failed");
    }
  }

  async function resumeSubscription() {
    setBillingMessage("Resuming auto-renewal…");
    try {
      const data = await apiPost("/billing/resume", {});
      if (data.entitlements) renderBillingPanel(data.entitlements, true);
      setBillingMessage(data.message || "Auto-renewal is back on.");
      if (window.toast) window.toast(data.message || "Pro will renew as usual");
    } catch (err) {
      setBillingMessage(err.message || "Could not resume subscription.", true);
      if (window.toast) window.toast(err.message || "Resume failed");
    }
  }

  function wireBilling() {
    byId("billing-upgrade")?.addEventListener("click", () => {
      promptUpgrade({ entitlements: cachedEntitlements });
    });
    byId("billing-manage")?.addEventListener("click", () => void openBillingPortal());
    byId("billing-cancel")?.addEventListener("click", () => void cancelSubscription());
    byId("billing-resume")?.addEventListener("click", () => void resumeSubscription());

    // Soft-gate Forecast nav: intercept before app.js switches view when free.
    document.querySelectorAll('.nav-btn[data-view="forecast"]').forEach((btn) => {
      if (btn.dataset.billingWired) return;
      btn.dataset.billingWired = "1";
      btn.addEventListener(
        "click",
        (e) => {
          if (cachedEntitlements && cachedEntitlements.isPro) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          promptUpgrade({
            error: "Forecast is included with Pro ($5/month or $60/year). You’re on the free plan — upgrade to unlock.",
            code: "PRO_REQUIRED",
            entitlements: cachedEntitlements,
          });
        },
        true
      );
    });

    // Soft-gate JSON export (client-side blob from free /report).
    const jsonBtn = byId("export-report");
    if (jsonBtn && !jsonBtn.dataset.billingWired) {
      jsonBtn.dataset.billingWired = "1";
      jsonBtn.addEventListener(
        "click",
        (e) => {
          if (cachedEntitlements && cachedEntitlements.isPro) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          promptUpgrade({
            error: "JSON accountant export is included with Pro ($5/month or $60/year).",
            code: "PRO_REQUIRED",
            entitlements: cachedEntitlements,
          });
        },
        true
      );
    }
  }

  function handleBillingReturnQuery() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const billing = params.get("billing");
      if (!billing) return;
      if (billing === "success" && window.toast) {
        window.toast("Welcome to Pro — unlimited uploads, PDF and forecast are unlocked.");
      } else if (billing === "cancel" && window.toast) {
        window.toast("Checkout cancelled — you can upgrade any time from Profile.");
      }
      params.delete("billing");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, "", next);
    } catch {
      /* ignore */
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
        ? `${others.length} driver profile${others.length === 1 ? "" : "s"} · open a row to assist (login recovery, overrides, history restore).`
        : "No other driver profiles yet. Create one above when someone requests access.";
    }

    // Show drivers first, then the admin account.
    const ordered = [...others, ...all.filter((u) => u.isAdmin)];
    list.innerHTML = ordered
      .map((u) => {
        const totals = u.totals || {};
        const counts = u.counts || {};
        const badge = u.isAdmin ? `<span class="admin-badge">primary mod</span>` : "";
        const planBadge = u.isAdmin
          ? ""
          : u.planGrant === "pro_plus" || u.isPro
            ? `<span class="admin-badge admin-plan-pro">${u.planGrant === "pro_plus" ? "Pro+" : "Pro"}</span>`
            : `<span class="admin-badge admin-plan-free">Free</span>`;
        const active = adminSelected === u.username ? " active" : "";
        const deleteBtn = u.isAdmin
          ? ""
          : `<button type="button" class="btn danger small" data-admin-del="${esc(u.username)}">Delete</button>`;
        return `<div class="admin-user-row${active}">
          <button type="button" class="admin-user-row-main" data-admin-user="${esc(u.username)}">
            <div>
              <div class="admin-user-name">${esc(u.username)}${badge}${planBadge}</div>
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

  function adminLedgerRow(entry, kind) {
    const deleted = Boolean(entry.deletedAt);
    const reconciled = Boolean(entry.reconciled) && !deleted;
    const status = deleted
      ? `<span class="tag tag-deleted">Deleted</span>`
      : reconciled
        ? `<span class="tag tag-reconciled">Reconciled</span>`
        : `<span class="muted">Open</span>`;
    const label =
      kind === "expense"
        ? esc(entry.vendor || entry.description || "—")
        : esc(entry.entity || entry.payer || "—");
    const meta =
      kind === "expense" ? esc(entry.category || "") : esc(entry.type || "");
    const amount = kind === "expense" ? entry.amount : entry.grossTotal ?? entry.amount;
    return `<tr data-admin-entry="${esc(entry.id)}" data-admin-kind="${esc(kind)}" class="${deleted ? "admin-deleted-row" : ""} ${reconciled ? "admin-reconciled-row" : ""}">
      <td><input type="checkbox" class="admin-entry-check" data-admin-kind="${esc(kind)}" value="${esc(entry.id)}" aria-label="Select entry"></td>
      <td>${esc(fmtDate(entry.date))}</td>
      <td>${label}</td>
      <td>${meta}</td>
      <td class="amount">${fmt(amount)}</td>
      <td>${status}</td>
    </tr>`;
  }

  async function adminLedgerAction(username, kind, action, ids) {
    if (!ids.length) {
      if (window.toast) window.toast("Select one or more entries first");
      return null;
    }
    const type = kind === "income" ? "income" : "expenses";
    try {
      return await apiPost(
        `/admin/users/${encodeURIComponent(username)}/${type}/${action}`,
        { ids }
      );
    } catch (err) {
      if (window.toast) window.toast(err.message || "Admin action failed");
      return null;
    }
  }

  function selectedAdminIds(root, kind) {
    if (!root) return [];
    return [...root.querySelectorAll(`.admin-entry-check[data-admin-kind="${kind}"]:checked`)].map(
      (el) => el.value
    );
  }

  function fmtDateTime(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString("en-AU");
    } catch {
      return String(d);
    }
  }

  async function adminAssistPost(username, action, body) {
    try {
      return await apiPost(
        `/admin/users/${encodeURIComponent(username)}/${action}`,
        body || {}
      );
    } catch (err) {
      if (window.toast) window.toast(err.message || "Admin assist failed");
      return null;
    }
  }

  function wireAdminAssistForms(detail, username, data) {
    const profile = data.profile || {};

    byId("admin-save-email")?.addEventListener("click", async () => {
      const email = byId("admin-assist-email")?.value || "";
      const result = await adminAssistPost(username, "email", { email });
      if (!result) return;
      if (window.toast) window.toast(`Email updated for ${username}`);
      await openAdminUser(username);
    });

    byId("admin-reset-password")?.addEventListener("click", async () => {
      const password = byId("admin-assist-password")?.value || "";
      if (!password) {
        if (window.toast) window.toast("Enter a temporary password first");
        return;
      }
      const ok = window.confirm(
        `Reset password for ${username}?\n\nThey will be signed out everywhere and must use the new password.`
      );
      if (!ok) return;
      const result = await adminAssistPost(username, "password", { password });
      if (!result) return;
      if (byId("admin-assist-password")) byId("admin-assist-password").value = "";
      if (window.toast) window.toast(`Password reset for ${username}`);
      await openAdminUser(username);
    });

    byId("admin-clear-failed")?.addEventListener("click", async () => {
      const result = await adminAssistPost(username, "clear-failed-logins", {});
      if (!result) return;
      if (window.toast) window.toast(`Cleared failed logins for ${username}`);
      await openAdminUser(username);
    });

    byId("admin-recover-link")?.addEventListener("click", async () => {
      const result = await adminAssistPost(username, "recover-link", {});
      if (!result) return;
      const box = byId("admin-recover-result");
      if (box) {
        box.classList.remove("hidden");
        box.innerHTML = `
          <p><strong>Username:</strong> ${esc(result.username)}</p>
          <p><strong>Email:</strong> ${esc(result.email || "—")} ${
            result.emailed ? "(recovery email sent)" : "(link below — SMTP not configured)"
          }</p>
          <p class="admin-recover-url"><a href="${esc(result.recoveryUrl)}" target="_blank" rel="noopener">${esc(
            result.recoveryUrl
          )}</a></p>
          <button type="button" class="btn secondary small" id="admin-copy-recover">Copy link</button>
        `;
        byId("admin-copy-recover")?.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(result.recoveryUrl);
            if (window.toast) window.toast("Recovery link copied");
          } catch {
            if (window.toast) window.toast("Copy failed — select the link manually");
          }
        });
      }
      if (window.toast) {
        window.toast(result.emailed ? "Recovery email sent" : "Recovery link ready to copy");
      }
    });

    byId("admin-save-profile")?.addEventListener("click", async () => {
      const body = {
        name: byId("admin-profile-name")?.value || "",
        employer: byId("admin-profile-employer")?.value || "",
        driverType: byId("admin-profile-driver-type")?.value || profile.driverType,
        annualSalary: byId("admin-profile-salary")?.value || "",
        licenceClass: byId("admin-profile-licence")?.value || "",
        financialYear: byId("admin-profile-fy")?.value || profile.financialYear,
        tfnSupplied: Boolean(byId("admin-profile-tfn")?.checked),
      };
      try {
        await apiPut(`/admin/users/${encodeURIComponent(username)}/profile`, body);
        if (window.toast) window.toast(`Profile updated for ${username}`);
        await openAdminUser(username);
      } catch (err) {
        if (window.toast) window.toast(err.message || "Profile update failed");
      }
    });

    detail.querySelectorAll("[data-history-restore]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-history-restore");
        const when = btn.getAttribute("data-history-when") || id;
        const ok = window.confirm(
          `Restore ${username}'s full records to the snapshot from ${when}?\n\nA safety snapshot of the current data is kept first.`
        );
        if (!ok) return;
        try {
          const result = await apiPost(
            `/admin/users/${encodeURIComponent(username)}/history/${encodeURIComponent(id)}/restore`,
            {}
          );
          if (window.toast) {
            window.toast(
              `Restored ${username} · ${result.counts?.expenses || 0} expenses · ${
                result.counts?.income || 0
              } income`
            );
          }
          await openAdminUser(username);
        } catch (err) {
          if (window.toast) window.toast(err.message || "History restore failed");
        }
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
    const account = data.account || data.user || {};
    const activeExpenses = (data.expenses || []).filter((e) => !e.deletedAt);
    const activeIncome = (data.income || []).filter((i) => !i.deletedAt);
    const expenses = activeExpenses.slice(0, 60);
    const income = activeIncome.slice(0, 60);
    const deletedExpenses = (data.deletedExpenses || []).slice(0, 40);
    const deletedIncome = (data.deletedIncome || []).slice(0, 40);
    const receipts = data.receipts || [];
    const history = data.history || [];
    const username = data.user.username;

    const expenseRows = expenses.map((e) => adminLedgerRow(e, "expense")).join("");
    const incomeRows = income.map((i) => adminLedgerRow(i, "income")).join("");
    const deletedExpenseRows = deletedExpenses.map((e) => adminLedgerRow(e, "expense")).join("");
    const deletedIncomeRows = deletedIncome.map((i) => adminLedgerRow(i, "income")).join("");
    const receiptRows = receipts
      .map((r) => {
        const link = r.hasImage
          ? `<a href="${API}/admin/users/${encodeURIComponent(username)}/receipts/${r.id}/file?download=1" target="_blank" rel="noopener">Download</a>`
          : "—";
        return `<tr><td>${esc(r.filename || r.id)}</td><td>${esc(r.mimeType || "")}</td><td>${esc(fmtDate(r.createdAt))}</td><td>${link}</td></tr>`;
      })
      .join("");

    const historyRows = history
      .map((h) => {
        const counts = h.counts || {};
        return `<tr>
          <td>${esc(fmtDateTime(h.savedAt))}</td>
          <td>${esc(h.reason || "auto")}</td>
          <td>${esc(h.actor || "—")}</td>
          <td>${counts.expenses || 0} exp · ${counts.income || 0} inc · ${counts.receipts || 0} rx</td>
          <td><button type="button" class="btn secondary small" data-history-restore="${esc(
            h.id
          )}" data-history-when="${esc(fmtDateTime(h.savedAt))}">Restore</button></td>
        </tr>`;
      })
      .join("");

    const lockBadge = account.needsRecovery
      ? `<span class="tag tag-deleted">Login locked (${account.failedLoginCount || 0} fails)</span>`
      : account.failedLoginCount
        ? `<span class="muted">${account.failedLoginCount} failed login(s)</span>`
        : `<span class="muted">Login OK</span>`;

    const canDelete = data.user && !data.user.isAdmin;
    const ent = data.entitlements || {};
    const planGrant = data.user.planGrant || ent.planGrant || null;
    let planLabel = "Free";
    if (data.user.isAdmin) planLabel = "Primary mod (always Pro)";
    else if (planGrant === "pro_plus") planLabel = "Pro+ (admin grant)";
    else if (ent.status === "trialing") planLabel = `Pro+ trial · ends ${formatTrialEnd(ent.trialEndsAt)}`;
    else if (ent.isPro) planLabel = "Pro (paid / active)";
    else if (planGrant === "free") planLabel = "Free (set by admin)";
    const planActions = data.user.isAdmin
      ? ""
      : `<div class="span-2 form-actions">
            <button type="button" class="btn primary" id="admin-plan-pro-plus"${
              planGrant === "pro_plus" ? " disabled" : ""
            }>Upgrade to Pro+</button>
            <button type="button" class="btn secondary" id="admin-plan-free"${
              planGrant === "free" && !ent.isPro ? " disabled" : ""
            }>Downgrade to Free</button>
          </div>
          <p class="muted span-2">Pro+ is complimentary full Pro access (unlimited uploads, PDF, forecast). Free restores the 15 uploads/month + 1 on-screen report limits. You can switch either way at any time.</p>`;

    detail.classList.remove("hidden");
    detail.innerHTML = `
      <div class="admin-detail-head">
        <h3>${esc(username)}${data.user.isAdmin ? ' <span class="admin-badge">primary mod</span>' : ""}</h3>
        ${canDelete ? `<button type="button" class="btn danger" id="admin-detail-delete">Delete profile</button>` : ""}
        <button type="button" class="btn secondary" id="admin-detail-close">Close</button>
      </div>
      <p class="muted">${esc(profile.name || "Unnamed driver")} · ${esc(profile.driverType || "—")} · ${esc(profile.employer || "No employer")} · FY ${esc(profile.financialYear || "—")}</p>
      <p class="muted">Username (tell the driver if forgotten): <strong>${esc(username)}</strong> · ${lockBadge}</p>
      <p class="muted admin-override-hint">Primary mod assist: reset login, edit profile/ledger mistakes, unlock/reconcile rows, move entries between expenses and income, and restore earlier full-page snapshots.</p>

      <div class="admin-section admin-assist-section">
        <h4>Plan (Free / Pro+)</h4>
        <div class="form-grid admin-assist-form">
          <p class="span-2"><strong id="admin-plan-status">${esc(planLabel)}</strong></p>
          ${planActions}
        </div>
      </div>

      <div class="admin-section admin-assist-section">
        <h4>Login &amp; account recovery</h4>
        <div class="form-grid admin-assist-form">
          <label>Account email
            <input type="email" id="admin-assist-email" value="${esc(account.email || "")}" placeholder="driver@example.com" autocomplete="off" />
          </label>
          <div class="form-actions">
            <button type="button" class="btn secondary" id="admin-save-email">Save email</button>
            <button type="button" class="btn secondary" id="admin-clear-failed">Clear failed logins</button>
            <button type="button" class="btn" id="admin-recover-link">Create recovery link</button>
          </div>
          <label class="span-2">Temporary password
            <input type="text" id="admin-assist-password" autocomplete="new-password" placeholder="Strong temp password (8+ chars)" />
          </label>
          <div class="span-2 form-actions">
            <button type="button" class="btn primary" id="admin-reset-password">Reset password</button>
          </div>
        </div>
        <div id="admin-recover-result" class="admin-recover-result hidden"></div>
      </div>

      <div class="admin-section admin-assist-section">
        <h4>Override driver profile</h4>
        <div class="form-grid admin-assist-form">
          <label>Name<input type="text" id="admin-profile-name" value="${esc(profile.name || "")}" /></label>
          <label>Employer<input type="text" id="admin-profile-employer" value="${esc(profile.employer || "")}" /></label>
          <label>Driver type
            <select id="admin-profile-driver-type">
              <option value="local" ${profile.driverType === "local" ? "selected" : ""}>Local driver</option>
              <option value="short_haul" ${profile.driverType === "short_haul" ? "selected" : ""}>Short-haul driver</option>
              <option value="long_haul" ${profile.driverType === "long_haul" || !profile.driverType ? "selected" : ""}>Linehaul driver</option>
              <option value="owner_driver" ${profile.driverType === "owner_driver" ? "selected" : ""}>Owner-driver / contractor</option>
            </select>
          </label>
          <label>Annual salary ($)<input type="number" id="admin-profile-salary" min="0" step="0.01" value="${esc(
            profile.annualSalary ?? ""
          )}" /></label>
          <label>Licence class
            <select id="admin-profile-licence">
              <option value="lr_mr" ${profile.licenceClass === "lr_mr" ? "selected" : ""}>LR/MR</option>
              <option value="hr" ${profile.licenceClass === "hr" ? "selected" : ""}>HR</option>
              <option value="hc" ${profile.licenceClass === "hc" || !profile.licenceClass ? "selected" : ""}>HC</option>
              <option value="mc" ${profile.licenceClass === "mc" ? "selected" : ""}>MC</option>
            </select>
          </label>
          <label>Financial year<input type="text" id="admin-profile-fy" value="${esc(
            profile.financialYear || ""
          )}" placeholder="2025-26" /></label>
          <label class="checkbox span-2"><input type="checkbox" id="admin-profile-tfn" ${
            profile.tfnSupplied ? "checked" : ""
          } /> TFN supplied to employer</label>
          <div class="span-2 form-actions">
            <button type="button" class="btn primary" id="admin-save-profile">Save profile override</button>
          </div>
        </div>
      </div>

      <div class="admin-stat-row">
        <div class="admin-stat"><div class="label">Net income (income in hand)</div><div class="value">${fmt(s.income && s.income.assessableTotal)}</div></div>
        <div class="admin-stat"><div class="label">Deductible expenses</div><div class="value">${fmt(s.expenses && s.expenses.deductibleTotal)}</div></div>
        <div class="admin-stat"><div class="label">Net taxable income minus expenses</div><div class="value">${fmt(s.taxEstimate && s.taxEstimate.taxableIncome)}</div></div>
        <div class="admin-stat"><div class="label">Est. tax</div><div class="value">${fmt(s.taxEstimate && s.taxEstimate.totalTax)}</div></div>
      </div>

      <div class="admin-section">
        <div class="admin-section-head">
          <h4>Data history / restore points (${history.length})</h4>
        </div>
        <p class="muted small">Automatic snapshots are kept when data changes (last ${history.length || 0} shown). Restoring replaces the driver’s current expenses, income, receipts metadata and profile with that earlier version.</p>
        <div class="admin-table-wrap">${
          historyRows
            ? `<table class="admin-table"><thead><tr><th>When</th><th>Reason</th><th>By</th><th>Counts</th><th></th></tr></thead><tbody>${historyRows}</tbody></table>`
            : `<p class="admin-empty">No snapshots yet — they appear after this driver (or you) saves changes.</p>`
        }</div>
      </div>

      <div class="admin-section" data-admin-ledger="income">
        <div class="admin-section-head">
          <h4>Income (${income.length}${activeIncome.length > income.length ? "+" : ""})</h4>
          <div class="admin-ledger-actions">
            <button type="button" class="btn secondary small" data-admin-action="reconcile" data-admin-kind="income">Reconcile selected</button>
            <button type="button" class="btn secondary small" data-admin-action="unreconcile" data-admin-kind="income">Unlock selected</button>
            <button type="button" class="btn secondary small" data-admin-action="move" data-admin-kind="income">Move to expenses</button>
            <button type="button" class="btn danger small" data-admin-action="soft-delete" data-admin-kind="income">Force remove</button>
          </div>
        </div>
        <div class="admin-table-wrap">${
          incomeRows
            ? `<table class="admin-table"><thead><tr><th></th><th>Date</th><th>Entity</th><th>Type</th><th>Gross</th><th>Status</th></tr></thead><tbody>${incomeRows}</tbody></table>`
            : `<p class="admin-empty">No income entries.</p>`
        }</div>
      </div>
      <div class="admin-section" data-admin-ledger="expense">
        <div class="admin-section-head">
          <h4>Expenses (${expenses.length}${activeExpenses.length > expenses.length ? "+" : ""})</h4>
          <div class="admin-ledger-actions">
            <button type="button" class="btn secondary small" data-admin-action="reconcile" data-admin-kind="expense">Reconcile selected</button>
            <button type="button" class="btn secondary small" data-admin-action="unreconcile" data-admin-kind="expense">Unlock selected</button>
            <button type="button" class="btn secondary small" data-admin-action="move" data-admin-kind="expense">Move to income</button>
            <button type="button" class="btn danger small" data-admin-action="soft-delete" data-admin-kind="expense">Force remove</button>
          </div>
        </div>
        <div class="admin-table-wrap">${
          expenseRows
            ? `<table class="admin-table"><thead><tr><th></th><th>Date</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead><tbody>${expenseRows}</tbody></table>`
            : `<p class="admin-empty">No expense entries.</p>`
        }</div>
      </div>
      <div class="admin-section" data-admin-ledger="deleted">
        <div class="admin-section-head">
          <h4>Soft-deleted (${deletedExpenses.length + deletedIncome.length})</h4>
          <div class="admin-ledger-actions">
            <button type="button" class="btn small" data-admin-action="restore" data-admin-kind="expense">Restore expenses</button>
            <button type="button" class="btn small" data-admin-action="restore" data-admin-kind="income">Restore income</button>
          </div>
        </div>
        <div class="admin-table-wrap">${
          deletedExpenseRows || deletedIncomeRows
            ? `<table class="admin-table"><thead><tr><th></th><th>Date</th><th>Detail</th><th>Type / category</th><th>Amount</th><th>Status</th></tr></thead><tbody>${deletedIncomeRows}${deletedExpenseRows}</tbody></table>`
            : `<p class="admin-empty">No soft-deleted ledger entries.</p>`
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
      void deleteAdminUser(username);
    });

    const setAdminPlan = async (plan) => {
      const label = plan === "pro_plus" ? "Pro+" : "Free";
      const ok = window.confirm(
        plan === "pro_plus"
          ? `Upgrade ${username} to Pro+ now? They get full Pro access until you downgrade them.`
          : `Downgrade ${username} to Free now? Upload quotas and Pro feature gates will apply immediately.`
      );
      if (!ok) return;
      try {
        const result = await apiPost(`/admin/users/${encodeURIComponent(username)}/plan`, { plan });
        if (window.toast) window.toast(result.message || `Plan set to ${label}`);
        await loadAdminUsers();
        await openAdminUser(username);
      } catch (err) {
        if (window.toast) window.toast(err.message || "Could not update plan");
      }
    };
    byId("admin-plan-pro-plus")?.addEventListener("click", () => void setAdminPlan("pro_plus"));
    byId("admin-plan-free")?.addEventListener("click", () => void setAdminPlan("free"));

    wireAdminAssistForms(detail, username, data);

    detail.querySelectorAll("[data-admin-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-admin-action");
        const kind = btn.getAttribute("data-admin-kind");
        const ids = selectedAdminIds(detail, kind);
        if (action === "soft-delete") {
          const ok = window.confirm(
            `Force-remove ${ids.length} ${kind} entr${ids.length === 1 ? "y" : "ies"} for ${username}? They can be restored from Soft-deleted.`
          );
          if (!ok) return;
        }
        if (action === "move") {
          const dest = kind === "expense" ? "income" : "expenses";
          const ok = window.confirm(
            `Move ${ids.length} ${kind} entr${ids.length === 1 ? "y" : "ies"} to ${dest} for ${username}?\n\nThe original row is soft-deleted (restorable). Linked receipts switch purpose.`
          );
          if (!ok) return;
        }
        const result = await adminLedgerAction(username, kind, action, ids);
        if (!result) return;
        if (window.toast) {
          if (action === "unreconcile") {
            window.toast(`Unlocked ${result.updated || 0} ${kind} entr${(result.updated || 0) === 1 ? "y" : "ies"}`);
          } else if (action === "reconcile") {
            window.toast(`Reconciled ${result.updated || 0} ${kind} entr${(result.updated || 0) === 1 ? "y" : "ies"}`);
          } else if (action === "restore") {
            window.toast(`Restored ${result.restored || 0} ${kind} entr${(result.restored || 0) === 1 ? "y" : "ies"}`);
          } else if (action === "soft-delete") {
            window.toast(`Removed ${result.deleted || 0} ${kind} entr${(result.deleted || 0) === 1 ? "y" : "ies"}`);
          } else if (action === "move") {
            const n = result.moved || 0;
            const dest = result.toType === "income" ? "income" : "expenses";
            window.toast(`Moved ${n} entr${n === 1 ? "y" : "ies"} to ${dest}`);
          }
        }
        await openAdminUser(username);
      });
    });
  }

  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  }

  function setAdminBackupMessage(msg, isError) {
    const el = byId("admin-backup-message");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "var(--red)" : "";
  }

  const BACKUP_AUTO_DL_KEY = "haulage-backup-autodownload-id";
  let adminBackupPollTimer = null;

  function maybeAutoDownloadDailyBackup(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    const latest = rows[0];
    if (!latest || !latest.id) return;
    let seen = "";
    try {
      seen = localStorage.getItem(BACKUP_AUTO_DL_KEY) || "";
    } catch {
      seen = "";
    }
    if (seen === latest.id) return;
    const created = new Date(latest.createdAt);
    if (Number.isNaN(created.getTime())) return;
    // Only auto-pull today's archive (so opening the panel after 5pm syncs it).
    if (created.toDateString() !== new Date().toDateString()) return;
    const ageMs = Date.now() - created.getTime();
    if (ageMs < 0 || ageMs > 36 * 60 * 60 * 1000) return;
    try {
      localStorage.setItem(BACKUP_AUTO_DL_KEY, latest.id);
    } catch {
      /* ignore */
    }
    const href = `${API}/admin/backups/${encodeURIComponent(latest.id)}/download`;
    const a = document.createElement("a");
    a.href = href;
    a.download = latest.filename || `${latest.id}.tar.gz`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setAdminBackupMessage(`Daily backup downloaded: ${latest.id}`);
    if (window.toast) window.toast("Daily backup downloaded to this device");
  }

  function renderAdminBackups(payload) {
    const statusEl = byId("admin-backup-status");
    const listEl = byId("admin-backup-list");
    if (!listEl) return;
    const status = (payload && payload.status) || {};
    if (statusEl) {
      const bits = [
        status.enabled === false
          ? "Scheduler off"
          : `Daily ${status.scheduleAt || "17:00"} ${status.timezone || "Australia/Sydney"}`,
        status.nextRunLabel ? `next: ${status.nextRunLabel}` : null,
        `keep ${status.keep || 7}`,
        status.s3Bucket ? `S3: ${status.s3Bucket}` : "S3 not set",
        status.offsiteDir ? "off-site dir set" : null,
      ].filter(Boolean);
      statusEl.textContent = bits.join(" · ");
    }
    const rows = (payload && payload.backups) || [];
    if (!rows.length) {
      listEl.innerHTML = `<p class="muted small">No backups yet — click “Back up now” or wait for the 5pm daily run.</p>`;
      return;
    }
    listEl.innerHTML = rows
      .map((b) => {
        const when = fmtDate(b.createdAt);
        const href = `${API}/admin/backups/${encodeURIComponent(b.id)}/download`;
        return `<div class="admin-backup-row" data-backup-id="${esc(b.id)}">
          <div>
            <strong>${esc(when)}</strong>
            <span class="muted small"> · ${esc(fmtBytes(b.bytes))}</span>
            <div class="muted small">${esc(b.id)}</div>
          </div>
          <div class="admin-backup-actions">
            <a class="btn secondary" href="${href}">Download</a>
            <button type="button" class="btn danger admin-backup-restore" data-backup-id="${esc(b.id)}">Restore</button>
          </div>
        </div>`;
      })
      .join("");
    listEl.querySelectorAll(".admin-backup-restore").forEach((btn) => {
      btn.addEventListener("click", () => {
        void restoreAdminBackup(btn.getAttribute("data-backup-id"));
      });
    });
    maybeAutoDownloadDailyBackup(rows);
  }

  async function loadAdminBackups() {
    const panel = byId("admin-panel");
    if (!panel || panel.classList.contains("hidden")) return;
    if (!byId("admin-backup-list")) return;
    try {
      const data = await apiGet("/admin/backups");
      if (data.error) {
        setAdminBackupMessage(data.error, true);
        return;
      }
      renderAdminBackups(data);
    } catch (err) {
      setAdminBackupMessage(err.message || "Could not load backups", true);
    }
  }

  function startAdminBackupPoll() {
    if (adminBackupPollTimer) return;
    adminBackupPollTimer = setInterval(() => {
      const panel = byId("admin-panel");
      if (!panel || panel.classList.contains("hidden")) return;
      void loadAdminBackups();
    }, 60_000);
  }

  async function runAdminBackupNow() {
    setAdminBackupMessage("Creating backup…");
    try {
      const data = await apiPost("/admin/backups", {});
      if (data.error) throw new Error(data.error);
      setAdminBackupMessage(`Backup saved: ${data.backup && data.backup.id}`);
      if (window.toast) window.toast("Backup created");
      await loadAdminBackups();
    } catch (err) {
      setAdminBackupMessage(err.message || "Backup failed", true);
      if (window.toast) window.toast(err.message);
    }
  }

  async function restoreAdminBackup(id) {
    if (!id) return;
    const ok = window.confirm(
      `Restore backup "${id}"?\n\nThis overwrites all live accounts, ledgers and receipt files with that snapshot. A safety backup is taken first. Everyone may need to sign in again.`
    );
    if (!ok) return;
    const typed = window.prompt('Type RESTORE to confirm full data restore:');
    if (typed !== "RESTORE") {
      if (window.toast) window.toast("Restore cancelled");
      return;
    }
    setAdminBackupMessage("Restoring backup…");
    try {
      const data = await apiPost(`/admin/backups/${encodeURIComponent(id)}/restore`, {
        confirm: "RESTORE",
      });
      if (data.error) throw new Error(data.error);
      setAdminBackupMessage(
        `Restored ${data.restored}. Safety backup: ${data.safetyBackupId || "—"}. Reloading…`
      );
      if (window.toast) window.toast("Backup restored — reloading");
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setAdminBackupMessage(err.message || "Restore failed", true);
      if (window.toast) window.toast(err.message);
    }
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
    await loadAdminBackups();
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
    const data = await apiGet(
      `/admin/users/${encodeURIComponent(username)}?includeDeleted=1`
    );
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
          code === "missing_email" ||
          code === "password_age" ||
          code === "trial_ended" ||
          code === "trial_ending"
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
        setSelectedHubApp("");
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
          const data = await apiPost("/auth/presets", presets);
          if (data && data.user) {
            window.__haulageUser = data.user;
            showAuthState(data.user);
          } else if (window.__haulageUser) {
            window.__haulageUser.presets = {
              ...(window.__haulageUser.presets || {}),
              ...presets,
            };
            applyProfilePresetsToExpenseForms({ forceWorkUse: true });
          }
          if (window.toast) window.toast("Presets saved — applied to expense forms");
        } catch (e) {
          if (window.toast) window.toast(e.message);
        }
      });
    }

    // After app.js clears manual/expense forms (work-use → 100, category empty), re-apply presets.
    const reapplyPresetsSoon = () => {
      setTimeout(() => applyProfilePresetsToExpenseForms({ forceWorkUse: true }), 0);
    };
    byId("manual-receipt-form")?.addEventListener("submit", reapplyPresetsSoon);
    // Scan confirm "Edit details" injects #scan-confirm-work — watch scan-result for it.
    const scanBox = byId("scan-result");
    if (scanBox && !scanBox.__presetMo) {
      scanBox.__presetMo = new MutationObserver(() => {
        if (byId("scan-confirm-work") || byId("scan-confirm-category")) {
          applyProfilePresetsToExpenseForms({ forceWorkUse: false });
        }
      });
      scanBox.__presetMo.observe(scanBox, { childList: true, subtree: true });
    }

    const adminRefresh = byId("admin-refresh");
    if (adminRefresh) {
      adminRefresh.addEventListener("click", () => {
        void loadAdminUsers();
      });
    }

    const backupNow = byId("admin-backup-now");
    if (backupNow && !backupNow.dataset.wired) {
      backupNow.dataset.wired = "1";
      backupNow.addEventListener("click", () => {
        void runAdminBackupNow();
      });
    }
    startAdminBackupPoll();

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
    btn.addEventListener("click", async (e) => {
      if (cachedEntitlements && !cachedEntitlements.isPro) {
        e.preventDefault();
        promptUpgrade({
          error: "PDF export is included with Pro ($5/month).",
          code: "PRO_REQUIRED",
          entitlements: cachedEntitlements,
        });
        return;
      }
      const fySel = byId("fy-select");
      const fy = fySel && fySel.value ? fySel.value : "";
      const url = `${API}/report.pdf${fy ? `?financialYear=${encodeURIComponent(fy)}` : ""}`;
      if (window.toast) window.toast("Preparing EOFY PDF…");
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (res.status === 402) {
          const data = await res.json().catch(() => ({}));
          promptUpgrade(data);
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (window.toast) window.toast(data.error || "PDF download failed");
          return;
        }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `haulage-eofy-${fy || "report"}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      } catch (err) {
        if (window.toast) window.toast(err.message || "PDF download failed");
      }
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
    wireBilling();
    wirePdfDownload();
    handleBillingReturnQuery();
    void refreshTrialHints();
    try {
      const me = await apiGet("/auth/me");
      if (me.user && me.user.username) {
        showAuthState(me.user);
        if (me.entitlements) {
          cachedEntitlements = me.entitlements;
          applyProExportGates(me.entitlements);
        }
        // Driver Hub: signed-in users pick an app unless Taxation Hub is already open.
        if (getSelectedHubApp() === "taxationhub") {
          openTaxationHub(me.user);
          if (me.user.isAdmin) await loadAdminUsers();
          // Only fetch/show the review banner the first time this session — once on
          // opening Taxation Hub — so it does not keep reappearing as uploads change.
          if (!reviewAlreadyShown()) {
            const alertData = await apiGet("/alerts");
            renderAlerts(alertData.alerts, alertData.user);
            markReviewShown();
          }
        } else {
          showDriverHubPicker(me.user.username);
        }
      } else {
        showDriverHubLogin();
        showAuthState(null);
        byId("title-auth-username")?.focus();
      }
    } catch {
      showDriverHubLogin();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/*
 * Dashboard charts:
 *  1) Snapshot pie — Net income (income in hand) / Deductible expenses /
 *     Net taxable income minus expenses, with colour legend + live totals
 *     from /summary.
 *  2) Total Spend vs Net Income pie — blue income, red spend; centre % =
 *     spend as a share of net income. Also replaces the 4th stat card
 *     (“Est. tax…”) with the same percentage readout.
 * Charts sit side-by-side and scale larger for visual impact.
 */
(function () {
  "use strict";

  let latest = null;

  const LABEL_NET_IN_HAND = "Net income (income in hand)";
  const LABEL_NET_TAXABLE_MINUS = "Net taxable income minus expenses";

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (url && /\/summary(\?|$)/.test(url)) {
        const data = await res.clone().json();
        if (data && data.income && data.expenses) {
          latest = data;
          renderAll({ force: true });
        }
      }
    } catch {
      /* non-fatal */
    }
    return res;
  };

  const fmt = (n) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);

  const fmtPct = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`;
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function numbersFromSummary(s) {
    const grossIncome = Number(s.income && s.income.assessableTotal) || 0;
    const deductible = Number(s.expenses && s.expenses.deductibleTotal) || 0;
    const grossSpend = Number(s.expenses && s.expenses.grossTotal) || 0;
    const netTaxable =
      s.taxEstimate && s.taxEstimate.taxableIncome != null
        ? Number(s.taxEstimate.taxableIncome) || 0
        : Math.max(0, grossIncome - deductible);
    const netIncome = grossIncome;
    return { grossIncome, deductible, grossSpend, netTaxable, netIncome };
  }

  /** Build a conic-gradient from [{color, value}, ...] (skips non-positive). */
  function conicFromSlices(slices) {
    const positive = slices.filter((x) => Number(x.value) > 0);
    const sum = positive.reduce((a, x) => a + Number(x.value), 0);
    if (sum <= 0) return null;
    let cursor = 0;
    const stops = [];
    positive.forEach((x, i) => {
      const start = cursor;
      const end = i === positive.length - 1 ? 100 : cursor + (Number(x.value) / sum) * 100;
      cursor = end;
      stops.push(`${x.color} ${start}% ${end}%`);
    });
    return `conic-gradient(${stops.join(", ")})`;
  }

  function spendOfIncomePct(spend, income) {
    if (!(income > 0)) return income === 0 && spend > 0 ? 100 : null;
    return Math.round((spend / income) * 1000) / 10;
  }

  /**
   * app.js writes Gross Income / Net Taxable Income verbatim — rewrite the
   * visible labels without editing app.js.
   */
  function relabelIncomeStatCards() {
    const grid = document.getElementById("stat-grid");
    if (!grid) return;
    grid.querySelectorAll(".stat-card .label").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (/^gross income$/i.test(t)) el.textContent = LABEL_NET_IN_HAND;
      else if (/^net taxable income$/i.test(t)) el.textContent = LABEL_NET_TAXABLE_MINUS;
    });
  }

  function renderSpendStatCard(nums) {
    const grid = document.getElementById("stat-grid");
    if (!grid) return;
    const cards = grid.querySelectorAll(".stat-card");
    // app.js writes 4 cards; replace the last (Est. tax) with spend-vs-income %.
    if (cards.length < 4) return;
    const pct = spendOfIncomePct(nums.grossSpend, nums.netIncome);
    const card = cards[3];
    card.className = "stat-card tax enh-spend-vs-income-stat";
    card.innerHTML = `
      <div class="label">Total Spend vs Net Income</div>
      <div class="value">${pct == null ? "—" : fmtPct(pct)}</div>
      <div class="sub">Spend ${fmt(nums.grossSpend)} · Net income ${fmt(nums.netIncome)}</div>`;
    relabelIncomeStatCards();
  }

  function renderSnapshot(nums, host, extras) {
    if (!host) return;
    const slices = [
      { color: "var(--green)", value: nums.grossIncome, label: LABEL_NET_IN_HAND, cls: "enh-dot-green" },
      { color: "var(--accent)", value: nums.deductible, label: "Deductible expenses", cls: "enh-dot-accent" },
      { color: "var(--blue)", value: nums.netTaxable, label: LABEL_NET_TAXABLE_MINUS, cls: "enh-dot-blue" },
    ];
    const gradient = conicFromSlices(slices);
    const legend = slices
      .map(
        (s) =>
          `<li><span class="enh-dot ${s.cls}"></span><span class="enh-pie-legend-text">${esc(s.label)}</span> <strong>${fmt(s.value)}</strong></li>`
      )
      .join("");

    let chart;
    if (!gradient) {
      chart = `<div class="enh-snapshot enh-snapshot-empty">
          <div class="enh-pie-wrap enh-pie-lg"><div class="enh-pie enh-pie-empty"></div>
            <div class="enh-pie-center"><span class="enh-pie-net-label">Snapshot</span><span class="enh-pie-net">${fmt(0)}</span></div>
          </div>
          <div class="enh-pie-side">
            <ul class="enh-pie-legend">${legend}</ul>
            <p class="muted">Add income or expenses to fill the chart.</p>
          </div>
        </div>`;
    } else {
      chart = `<div class="enh-snapshot">
          <div class="enh-pie-wrap enh-pie-lg">
            <div class="enh-pie" style="background: ${gradient}"></div>
            <div class="enh-pie-center">
              <span class="enh-pie-net-label"><span class="enh-pie-net-label-line">After</span><span class="enh-pie-net-label-line">expenses</span></span>
              <span class="enh-pie-net">${fmt(nums.netTaxable)}</span>
            </div>
          </div>
          <div class="enh-pie-side">
            <ul class="enh-pie-legend">${legend}</ul>
          </div>
        </div>`;
    }

    host.innerHTML = `${chart}${extras.msg ? `<p class="muted">${esc(extras.msg)}</p>` : ""}${extras.warn || ""}`;
  }

  function renderSpendIncome(nums, host) {
    if (!host) return;
    const income = nums.netIncome;
    const spend = nums.grossSpend;
    const pct = spendOfIncomePct(spend, income);
    const slices = [
      { color: "var(--blue)", value: income, label: "Net income", cls: "enh-dot-blue" },
      { color: "var(--red)", value: spend, label: "Total spend", cls: "enh-dot-red" },
    ];
    const gradient = conicFromSlices(slices);
    const legend = slices
      .map(
        (s) =>
          `<li><span class="enh-dot ${s.cls}"></span><span class="enh-pie-legend-text">${esc(s.label)}</span> <strong>${fmt(s.value)}</strong></li>`
      )
      .join("");

    let chart;
    if (!gradient) {
      chart = `<div class="enh-snapshot enh-snapshot-empty">
          <div class="enh-pie-wrap enh-pie-lg"><div class="enh-pie enh-pie-empty"></div>
            <div class="enh-pie-center"><span class="enh-pie-net-label">Spend / income</span><span class="enh-pie-net">—</span></div>
          </div>
          <div class="enh-pie-side">
            <ul class="enh-pie-legend">${legend}</ul>
            <p class="muted">Log income and spending to compare.</p>
          </div>
        </div>`;
    } else {
      chart = `<div class="enh-snapshot">
          <div class="enh-pie-wrap enh-pie-lg">
            <div class="enh-pie" style="background: ${gradient}"></div>
            <div class="enh-pie-center">
              <span class="enh-pie-net-label">Spend of income</span>
              <span class="enh-pie-net ${pct != null && pct > 100 ? "neg" : "pos"}">${pct == null ? "—" : fmtPct(pct)}</span>
            </div>
          </div>
          <div class="enh-pie-side">
            <ul class="enh-pie-legend">
              ${legend}
              <li class="enh-pie-net-row">Total Spend vs Net Income <strong>${pct == null ? "—" : fmtPct(pct)}</strong></li>
            </ul>
          </div>
        </div>`;
    }
    host.innerHTML = chart;
  }

  function extractSnapshotExtras(host) {
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
    return { msg, warn };
  }

  function renderAll(opts) {
    if (!latest) return;
    const force = Boolean(opts && opts.force);
    const nums = numbersFromSummary(latest);
    renderSpendStatCard(nums);
    relabelIncomeStatCards();

    const snapHost = document.getElementById("snapshot-content");
    const spendHost = document.getElementById("spend-income-chart");
    if (snapHost && (force || !snapHost.querySelector(".enh-snapshot"))) {
      renderSnapshot(nums, snapHost, extractSnapshotExtras(snapHost));
    }
    if (spendHost && (force || !spendHost.querySelector(".enh-snapshot"))) {
      renderSpendIncome(nums, spendHost);
    }
  }

  const observer = new MutationObserver(() => {
    relabelIncomeStatCards();
    if (!latest) return;
    const snapHost = document.getElementById("snapshot-content");
    const grid = document.getElementById("stat-grid");
    const needsSnap = snapHost && !snapHost.querySelector(".enh-snapshot");
    const needsStat =
      grid &&
      grid.querySelectorAll(".stat-card").length >= 4 &&
      !grid.querySelector(".enh-spend-vs-income-stat");
    const needsSpend =
      document.getElementById("spend-income-chart") &&
      !document.getElementById("spend-income-chart").querySelector(".enh-snapshot");
    if (needsSnap || needsStat || needsSpend) renderAll();
  });

  function start() {
    const snapHost = document.getElementById("snapshot-content");
    const grid = document.getElementById("stat-grid");
    const spendHost = document.getElementById("spend-income-chart");
    if (snapHost) observer.observe(snapHost, { childList: true });
    if (grid) observer.observe(grid, { childList: true });
    if (spendHost) observer.observe(spendHost, { childList: true });
    renderAll({ force: true });
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

  // Keep in sync with lib/expense-menu.js CAR_CLAIM_CATEGORY_IDS.
  const CAR_CLAIM_IDS = new Set([
    "vehicle_car",
    "fuel",
    "repairs_maintenance",
    "tyres",
    "registration_insurance",
    "parking_tolls",
  ]);

  const GALLERIES = [
    {
      containerId: "receipt-gallery",
      purpose: "expense",
      key: "expense",
      weekFilter: true,
      categoryScope: "general",
    },
    {
      containerId: "car-receipt-gallery",
      purpose: "expense",
      key: "car-expense",
      weekFilter: true,
      categoryScope: "car",
    },
    { containerId: "income-gallery", purpose: "income", key: "income", weekFilter: false },
  ];

  // Remembers each gallery's chosen FY ("all" or e.g. "2025-26"); null = not set.
  const chosenFy = { expense: null, "car-expense": null, income: null };
  const chosenWeek = { expense: null, "car-expense": null, income: null };

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
      // null = never chosen (default to this week). Persist "all" so All weeks sticks.
      return localStorage.getItem(weekStorageKey(key));
    } catch {
      return null;
    }
  }

  function setStoredWeek(key, value) {
    try {
      if (!value) localStorage.removeItem(weekStorageKey(key));
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

  function linkedExpenseCategory(receipt) {
    if (!receipt) return null;
    try {
      const expenses = (state.records && state.records.expenses) || [];
      const hit =
        expenses.find((e) => e.id && e.id === receipt.linkedExpenseId) ||
        expenses.find((e) => e.receiptId && e.receiptId === receipt.id);
      return hit && hit.category ? hit.category : null;
    } catch {
      return null;
    }
  }

  function receiptMatchesCategoryScope(receipt, scope) {
    if (!scope || scope === "all") return true;
    const cat = linkedExpenseCategory(receipt);
    const isCar = Boolean(cat && CAR_CLAIM_IDS.has(cat));
    // Receipts with no linked expense stay on the general gallery.
    if (scope === "car") return isCar;
    if (scope === "general") return !isCar;
    return true;
  }

  /** Options: "All", then FYs in the 6-past/3-future window in this gallery. */
  function optionsHtml(purpose, selected, categoryScope) {
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
      if (!receiptMatchesCategoryScope(r, categoryScope)) continue;
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

  function collectExpenseWeeks(fy, categoryScope) {
    const map = new Map();
    let list = [];
    try {
      if (typeof getReceiptsWithImages === "function") list = getReceiptsWithImages("expense") || [];
    } catch {
      list = [];
    }
    for (const r of list) {
      if (!receiptMatchesCategoryScope(r, categoryScope)) continue;
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
    const weeks = collectExpenseWeeks(fy, cfg.categoryScope);
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
    const nextOptions = optionsHtml(cfg.purpose, chosen, cfg.categoryScope);
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
      const id = card.dataset.receiptCard || card.dataset.receiptId;
      const receipt = findReceipt(id);
      if (!receiptMatchesCategoryScope(receipt, cfg.categoryScope)) {
        card.style.display = "none";
        return;
      }
      total += 1;
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
        const kind =
          cfg.purpose === "income"
            ? "income documents"
            : cfg.categoryScope === "car"
              ? "car receipt photos"
              : "expense receipts";
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

  /** Mirror car-linked receipt cards into the Car Expenses gallery. */
  function syncCarReceiptGallery() {
    const source = document.getElementById("receipt-gallery");
    const host = document.getElementById("car-receipt-gallery");
    if (!source || !host) return;
    const cards = [
      ...source.querySelectorAll(".receipt-card[data-receipt-card], .receipt-card[data-receipt-id]"),
    ].filter((card) => {
      const id = card.dataset.receiptCard || card.dataset.receiptId;
      return receiptMatchesCategoryScope(findReceipt(id), "car");
    });
    if (!cards.length) {
      if (!host.querySelector(".muted") || host.querySelector(".receipt-card")) {
        host.innerHTML = `<p class="muted">No car receipt photos yet — save a car claim with a linked receipt, or upload a receipt and categorise it as a car expense.</p>`;
      }
      return;
    }
    const html = cards.map((c) => c.outerHTML).join("");
    if (host.dataset.syncHtml === html) return;
    host.dataset.syncHtml = html;
    host.innerHTML = html;
    // Re-bind open/delete using the shared gallery binder when available.
    const binder = globalThis.bindReceiptViewer || globalThis.bindReceiptGallery;
    if (typeof binder === "function") {
      try {
        binder(host);
        return;
      } catch {
        /* fall through to manual bind */
      }
    }
    host.querySelectorAll("[data-del-receipt]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const base =
            typeof API !== "undefined" && API ? API : `${window.location.origin}/api/haulage`;
          await fetch(`${base}/receipts/${btn.dataset.delReceipt}`, {
            method: "DELETE",
            credentials: "same-origin",
          });
          if (typeof refreshAll === "function") await refreshAll();
        } catch (err) {
          if (typeof toast === "function") toast(err.message || "Delete failed");
        }
      });
    });
    host.querySelectorAll("[data-receipt-card], [data-receipt-id]").forEach((card) => {
      const id = card.dataset.receiptCard || card.dataset.receiptId;
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-del-receipt]")) return;
        const open = globalThis.openReceiptViewer;
        if (typeof open === "function") open(id);
      });
    });
  }

  function start() {
    let bound = false;
    for (const cfg of GALLERIES) {
      const container = document.getElementById(cfg.containerId);
      if (!container) continue;
      bound = true;
      const mo = new MutationObserver(() => {
        if (cfg.key === "expense") syncCarReceiptGallery();
        applyFilter(cfg);
        if (cfg.key === "expense") {
          const carCfg = GALLERIES.find((g) => g.key === "car-expense");
          if (carCfg) applyFilter(carCfg);
        }
      });
      mo.observe(container, { childList: true });
      if (cfg.key === "expense") syncCarReceiptGallery();
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

  // Keep in sync with lib/expense-menu.js CAR_CLAIM_CATEGORY_IDS.
  const CAR_CLAIM_IDS = new Set([
    "vehicle_car",
    "fuel",
    "repairs_maintenance",
    "tyres",
    "registration_insurance",
    "parking_tolls",
  ]);

  const LEDGERS = [
    {
      listId: "income-list",
      tableSel: "table.income-ledger",
      idAttr: "data-income-id",
      type: "income",
      key: "income",
    },
    {
      listId: "expense-list",
      tableSel: "table.expense-ledger",
      idAttr: "data-expense-id",
      type: "expense",
      key: "expense",
      categoryScope: "general",
    },
    {
      listId: "car-expense-list",
      tableSel: "table.expense-ledger",
      idAttr: "data-expense-id",
      type: "expense",
      key: "car-expense",
      categoryScope: "car",
    },
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

  function ledgerKey(cfgOrKey) {
    if (cfgOrKey && typeof cfgOrKey === "object") {
      return cfgOrKey.key || cfgOrKey.type || "expense";
    }
    return cfgOrKey || "expense";
  }

  function periodStorageKey(cfgOrKey) {
    return `haulage-ledger-month-${ledgerKey(cfgOrKey)}`;
  }

  function weekLedgerStorageKey(cfgOrKey) {
    return `haulage-ledger-week-${ledgerKey(cfgOrKey)}`;
  }

  function getMonthFilter(cfgOrKey) {
    try {
      return localStorage.getItem(periodStorageKey(cfgOrKey)) || "all";
    } catch {
      return "all";
    }
  }

  function setMonthFilter(cfgOrKey, value) {
    try {
      localStorage.setItem(periodStorageKey(cfgOrKey), value || "all");
    } catch {
      /* ignore */
    }
  }

  function getWeekFilter(cfgOrKey) {
    try {
      // null = never chosen (default to this week). Persist "all" so All weeks sticks
      // across re-renders — previously removing the key made sync snap back to this week.
      return localStorage.getItem(weekLedgerStorageKey(cfgOrKey));
    } catch {
      return null;
    }
  }

  function setWeekFilter(cfgOrKey, value) {
    try {
      if (!value) localStorage.removeItem(weekLedgerStorageKey(cfgOrKey));
      else localStorage.setItem(weekLedgerStorageKey(cfgOrKey), value);
    } catch {
      /* ignore */
    }
  }

  function entryMatchesCategoryScope(entry, scope) {
    if (!scope || scope === "all") return true;
    const cat = entry && entry.category;
    const isCar = Boolean(cat && CAR_CLAIM_IDS.has(cat));
    if (scope === "car") return isCar;
    if (scope === "general") return !isCar;
    return true;
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
    const key = ledgerKey(cfg);
    picker.innerHTML =
      `<label for="ledger-fy-${key}">Financial year</label>` +
      `<select id="ledger-fy-${key}" class="ledger-fy-select" aria-label="Show ledger for financial year"></select>`;
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

    const key = ledgerKey(cfg);
    const picker = document.createElement("div");
    picker.className = "fy-picker gallery-fy-picker ledger-month-picker";
    picker.innerHTML =
      `<label for="ledger-month-${key}">Show</label>` +
      `<select id="ledger-month-${key}" class="ledger-month-select" aria-label="Filter ledger by month"></select>`;
    box.appendChild(picker);
    const select = picker.querySelector("select");
    select.addEventListener("change", () => {
      setMonthFilter(cfg, select.value);
      applyLedgerFilters(cfg);
      updateReconcileButton(cfg);
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

    const key = ledgerKey(cfg);
    const picker = document.createElement("div");
    picker.className = "fy-picker gallery-fy-picker ledger-week-picker";
    picker.innerHTML =
      `<label for="ledger-week-${key}">Week</label>` +
      `<select id="ledger-week-${key}" class="ledger-week-select" aria-label="Filter expense ledger by week"></select>`;
    box.appendChild(picker);
    picker.querySelector("select").addEventListener("change", (e) => {
      setWeekFilter(cfg, e.target.value);
      if (e.target.value && e.target.value !== "all") {
        registerStartedWeek(e.target.value);
      }
      applyLedgerFilters(cfg);
      updateReconcileButton(cfg);
    });
  }

  function collectLedgerWeeks(fy, categoryScope) {
    const map = new Map();
    let expenses = [];
    try {
      expenses = (state.records && state.records.expenses) || [];
    } catch {
      expenses = [];
    }
    for (const e of expenses) {
      if (!entryMatchesCategoryScope(e, categoryScope)) continue;
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
    const weeks = collectLedgerWeeks(fy, cfg.categoryScope);
    const todayStart = weekStartMonday(toIsoLocal(new Date()));
    let chosen = getWeekFilter(cfg);
    if (chosen == null) {
      chosen = weeks.some((w) => w.start === todayStart) ? todayStart : "all";
      setWeekFilter(cfg, chosen);
    }
    if (chosen !== "all" && !weeks.some((w) => w.start === chosen)) {
      chosen = weeks.some((w) => w.start === todayStart) ? todayStart : "all";
      setWeekFilter(cfg, chosen);
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
    const prev = getMonthFilter(cfg);
    const valid = prev === "all" || months.some((m) => m.value === prev);
    const chosen = valid ? prev : "all";
    if (!valid) setMonthFilter(cfg, "all");

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
      period = getMonthFilter(cfg);
      periodKind = "month";
    }

    let sum = 0;
    let shown = 0;
    let total = 0;
    table.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
      const id = tr.getAttribute(cfg.idAttr);
      const isDraft = id === "__draft__" || tr.classList.contains("draft-row");
      const entry = findEntry(cfg.type, id);
      let categoryOk = true;
      if (cfg.categoryScope) {
        if (isDraft) {
          // Draft rows inherit the active form category when present.
          let draftCat = null;
          try {
            draftCat =
              (document.getElementById("expense-category") || {}).value ||
              (document.querySelector("#manual-receipt-form [name=category]") || {}).value ||
              null;
          } catch {
            draftCat = null;
          }
          categoryOk = entryMatchesCategoryScope({ category: draftCat }, cfg.categoryScope);
        } else {
          categoryOk = entryMatchesCategoryScope(entry, cfg.categoryScope);
        }
      }
      if (!categoryOk) {
        tr.style.display = "none";
        return;
      }
      total += 1;
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
      const kind =
        cfg.type === "income"
          ? "income"
          : cfg.categoryScope === "car"
            ? "car expenses"
            : "expenses";
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

  function reconcileApiPath(cfg) {
    return cfg.type === "income" ? "/income/reconcile" : "/expenses/reconcile";
  }

  function selectedLedgerIds(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return [];
    const ids = [];
    list.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
      if (tr.style.display === "none") return;
      const cb = tr.querySelector(".ledger-row-check");
      if (!cb || !cb.checked || cb.disabled) return;
      const id = tr.getAttribute(cfg.idAttr);
      if (id && id !== "__draft__") ids.push(id);
    });
    return ids;
  }

  function syncSelectAllState(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const all = list.querySelector(".ledger-select-all");
    if (!all) return;
    const boxes = [];
    list.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
      if (tr.style.display === "none") return;
      const cb = tr.querySelector(".ledger-row-check");
      if (cb && !cb.disabled) boxes.push(cb);
    });
    if (!boxes.length) {
      all.checked = false;
      all.indeterminate = false;
      all.disabled = true;
      return;
    }
    all.disabled = false;
    const checked = boxes.filter((b) => b.checked).length;
    all.checked = checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }

  function updateReconcileButton(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const panel = list.closest(".panel");
    const header = panel && panel.querySelector(".panel-header");
    if (!header) return;
    const btn = ledgerActions(header).querySelector(".ledger-reconcile-btn");
    if (!btn) return;
    const n = selectedLedgerIds(cfg).length;
    btn.hidden = n === 0;
    btn.textContent = n === 1 ? "Reconcile entries (1)" : `Reconcile entries (${n})`;
    syncSelectAllState(cfg);
  }

  function ensureReconcileButton(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const panel = list.closest(".panel");
    const header = panel && panel.querySelector(".panel-header");
    if (!header) return;
    const box = ledgerActions(header);
    if (box.querySelector(".ledger-reconcile-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ledger-reconcile-btn";
    btn.hidden = true;
    btn.textContent = "Reconcile entries";
    btn.title = "Lock selected ledger rows so they cannot be edited or deleted";
    btn.addEventListener("click", () => {
      void runReconcile(cfg, btn);
    });
    box.insertBefore(btn, box.firstChild);
  }

  async function runReconcile(cfg, btn) {
    const ids = selectedLedgerIds(cfg);
    if (!ids.length) return;
    const noun = cfg.type === "income" ? "income" : "expense";
    const ok = window.confirm(
      `Reconcile ${ids.length} ${noun} entr${ids.length === 1 ? "y" : "ies"}?\n\n` +
        "Reconciled rows are locked — they cannot be edited or deleted. " +
        "Ask Haulage_Admin if you need one unlocked later."
    );
    if (!ok) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Reconciling…";
    try {
      const res = await fetch(`${apiBase()}${reconcileApiPath(cfg)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not reconcile entries.");
      const n = data.updated || 0;
      if (typeof toast === "function") {
        toast(n ? `Reconciled ${n} ${noun} entr${n === 1 ? "y" : "ies"}` : "No entries updated");
      }
      if (typeof refreshAll === "function") await refreshAll();
    } catch (err) {
      if (typeof toast === "function") toast(err.message || "Reconcile failed");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
      updateReconcileButton(cfg);
    }
  }

  /** First-column select-all / per-row checkboxes for reconciliation. */
  function injectReconcileColumn(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const table = list.querySelector(cfg.tableSel);
    if (!table) return;

    const theadRow = table.querySelector("thead tr");
    if (theadRow && !theadRow.querySelector(".ledger-check-col")) {
      const th = document.createElement("th");
      th.className = "ledger-check-col";
      th.innerHTML =
        `<input type="checkbox" class="ledger-select-all" aria-label="Select all entries" title="Select all">`;
      theadRow.insertBefore(th, theadRow.firstChild);
      table.querySelectorAll("tfoot td[colspan]").forEach((td) => {
        const n = Number(td.getAttribute("colspan") || 1);
        if (Number.isFinite(n)) td.setAttribute("colspan", String(n + 1));
      });
    }

    table.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
      if (tr.querySelector("td.ledger-check-col")) return;
      const id = tr.getAttribute(cfg.idAttr);
      const isDraft = id === "__draft__" || tr.classList.contains("draft-row");
      const entry = isDraft ? null : findEntry(cfg.type, id);
      const locked = Boolean(entry && entry.reconciled);
      const td = document.createElement("td");
      td.className = "ledger-check-col";
      if (isDraft || locked) {
        td.innerHTML = `<input type="checkbox" class="ledger-row-check" disabled aria-label="Not selectable">`;
      } else {
        td.innerHTML = `<input type="checkbox" class="ledger-row-check" aria-label="Select entry for reconcile">`;
      }
      tr.insertBefore(td, tr.firstChild);
    });
  }

  function bindReconcileEvents(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list || list.dataset.reconcileBound === "1") return;
    list.dataset.reconcileBound = "1";
    list.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.classList.contains("ledger-select-all")) {
        const checked = t.checked;
        list.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
          if (tr.style.display === "none") return;
          const cb = tr.querySelector(".ledger-row-check");
          if (cb && !cb.disabled) cb.checked = checked;
        });
        updateReconcileButton(cfg);
        return;
      }
      if (t.classList.contains("ledger-row-check")) {
        updateReconcileButton(cfg);
      }
    });
  }

  /** Badge + lock Edit/Delete on reconciled rows. */
  function decorateReconciledRows(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    list.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
      const id = tr.getAttribute(cfg.idAttr);
      if (!id || id === "__draft__") return;
      const entry = findEntry(cfg.type, id);
      const locked = Boolean(entry && entry.reconciled);
      tr.classList.toggle("reconciled-row", locked);
      if (!locked) return;

      const detailCell =
        tr.querySelector("td:nth-child(4)") ||
        tr.querySelector("td:nth-child(3)") ||
        tr.children[2];
      if (detailCell && !detailCell.querySelector(".tag-reconciled")) {
        const tag = document.createElement("span");
        tag.className = "tag tag-reconciled";
        tag.textContent = "Reconciled";
        tag.title = entry.reconciledAt
          ? `Reconciled ${entry.reconciledAt}${entry.reconciledBy ? ` by ${entry.reconciledBy}` : ""}`
          : "Reconciled — locked";
        detailCell.appendChild(document.createTextNode(" "));
        detailCell.appendChild(tag);
      }

      const actions = tr.querySelector(".row-actions");
      if (actions) {
        actions.querySelectorAll(`[data-del-${cfg.type}], [data-edit-${cfg.type}]`).forEach((btn) => {
          btn.disabled = true;
          btn.setAttribute("aria-disabled", "true");
          btn.classList.add("is-locked");
          btn.title = "Reconciled — ask Haulage_Admin to unlock if this was a mistake";
        });
      }
      const cb = tr.querySelector(".ledger-row-check");
      if (cb) {
        cb.checked = false;
        cb.disabled = true;
      }
    });
  }

  function categoryOptionsHtml(selected) {
    try {
      const isCar = selected && CAR_CLAIM_IDS.has(selected);
      let cats;
      let groups;
      if (isCar) {
        // Car claim edit: ATO car allowlist (same as Car Expenses form).
        cats = (state.standards && state.standards.specialClaimCategories) || [];
        groups = [];
        if (!cats.length) {
          cats = CAR_CLAIM_IDS
            ? [...CAR_CLAIM_IDS].map((id) => ({ id, label: id.replace(/_/g, " "), group: "Car" }))
            : [];
        }
      } else {
        cats = (state.standards && state.standards.categories) || [];
        groups = (state.standards && state.standards.categoryGroups) || [];
      }
      if (typeof buildCategorySelectOptions === "function" && cats.length) {
        let html = buildCategorySelectOptions(cats, groups);
        if (selected) {
          html = html.replace(`value="${selected}"`, `value="${selected}" selected`);
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
    if (entry.reconciled) {
      if (typeof toast === "function") {
        toast("This entry is reconciled and locked. Ask Haulage_Admin to unlock it first.");
      }
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

  function syncCarExpenseLedgerFromMain() {
    const source = document.getElementById("expense-list");
    const host = document.getElementById("car-expense-list");
    const summary = document.getElementById("car-expense-list-summary");
    if (!source || !host) return;

    const table = source.querySelector("table.expense-ledger");
    if (!table) {
      const empty = `<p class="muted">No car expenses yet — save a car claim above.</p>`;
      if (host.innerHTML !== empty) host.innerHTML = empty;
      if (summary) summary.textContent = "0 car claims";
      return;
    }

    const clone = table.cloneNode(true);
    let carCount = 0;
    let carSum = 0;
    let carDeductible = 0;
    clone.querySelectorAll("tbody tr[data-expense-id]").forEach((tr) => {
      const id = tr.getAttribute("data-expense-id");
      const isDraft = id === "__draft__" || tr.classList.contains("draft-row");
      if (isDraft) {
        const draftCat = (document.getElementById("expense-category") || {}).value || "";
        if (!CAR_CLAIM_IDS.has(draftCat)) tr.remove();
        return;
      }
      const entry = findEntry("expense", id);
      if (!entryMatchesCategoryScope(entry, "car")) {
        tr.remove();
        return;
      }
      carCount += 1;
      const amount = Number(entry.amount) || 0;
      carSum += amount;
      if (entry.category === "vehicle_car" && entry.method === "cents_per_km") {
        carDeductible += amount;
      } else {
        const pct =
          entry.workUsePercent != null
            ? Math.min(100, Math.max(0, Number(entry.workUsePercent)))
            : 100;
        carDeductible += amount * (pct / 100);
      }
    });

    // Drop the period-total row; FY/week filter updates the running-total row.
    const periodRow = clone.querySelector("tfoot tr:not(.running-total-row)");
    if (periodRow) periodRow.remove();

    if (!clone.querySelector("tbody tr[data-expense-id]")) {
      const empty = `<p class="muted">No car expenses yet — save a car claim above.</p>`;
      if (host.innerHTML !== empty) host.innerHTML = empty;
      if (summary) summary.textContent = "0 car claims";
      return;
    }

    const html = clone.outerHTML;
    if (host.dataset.syncHtml !== html) {
      host.dataset.syncHtml = html;
      host.innerHTML = html;
      host.querySelectorAll("[data-del-expense]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            const res = await fetch(`${apiBase()}/expenses/${btn.dataset.delExpense}`, {
              method: "DELETE",
              credentials: "same-origin",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Could not delete expense.");
            if (typeof toast === "function") toast("Expense deleted");
            if (typeof refreshAll === "function") await refreshAll();
          } catch (err) {
            if (typeof toast === "function") toast(err.message || "Delete failed");
          }
        });
      });
      host.querySelectorAll("[data-view-receipt]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const open = globalThis.openReceiptViewer;
          if (typeof open === "function") open(btn.dataset.viewReceipt);
        });
      });
    }
    if (summary) {
      const dedLabel = fmtCurrency(Math.round(carDeductible * 100) / 100);
      summary.textContent =
        carCount === 0
          ? "0 car claims"
          : `${carCount} car claim${carCount === 1 ? "" : "s"} · ${fmtCurrency(carSum)} gross · ~${dedLabel} deductible (work use)`;
    }
  }

  function enhance(cfg) {
    if (cfg.key === "car-expense") syncCarExpenseLedgerFromMain();
    bindReconcileEvents(cfg);
    injectReconcileColumn(cfg);
    ensureReconcileButton(cfg);
    ensureRefreshButton(cfg);
    ensureFyPicker(cfg);
    ensureMonthPicker(cfg);
    ensureWeekPicker(cfg);
    applyLedgerFilters(cfg);
    hideOutsidePeriodTags(cfg);
    injectCashTags(cfg);
    injectEditButtons(cfg);
    decorateReconciledRows(cfg);
    updateReconcileButton(cfg);
  }

  function start() {
    let bound = false;
    for (const cfg of LEDGERS) {
      const list = document.getElementById(cfg.listId);
      if (!list) continue;
      bound = true;
      const mo = new MutationObserver(() => {
        if (cfg.key === "expense") {
          syncCarExpenseLedgerFromMain();
          const car = LEDGERS.find((c) => c.key === "car-expense");
          if (car) enhance(car);
        }
        enhance(cfg);
      });
      mo.observe(list, { childList: true });
      enhance(cfg);
    }
    if (bound) {
      let ticks = 0;
      const iv = setInterval(() => {
        ticks += 1;
        syncCarExpenseLedgerFromMain();
        for (const cfg of LEDGERS) enhance(cfg);
        if (ticks >= 10) clearInterval(iv);
      }, 400);
    }

    document.addEventListener("click", (e) => {
      const locked = e.target.closest(".is-locked[data-edit-expense], .is-locked[data-edit-income], .is-locked[data-del-expense], .is-locked[data-del-income]");
      if (locked) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof toast === "function") {
          toast("This entry is reconciled and locked. Ask Haulage_Admin to unlock it first.");
        }
        return;
      }
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

    // Soft-delete / reconcile errors from app.js delete handlers (no try/catch there).
    document.addEventListener(
      "click",
      (e) => {
        const del = e.target.closest("[data-del-expense], [data-del-income]");
        if (!del || del.classList.contains("is-locked") || del.disabled) return;
        const isExpense = del.hasAttribute("data-del-expense");
        const id = isExpense ? del.getAttribute("data-del-expense") : del.getAttribute("data-del-income");
        if (!id) return;
        const entry = findEntry(isExpense ? "expense" : "income", id);
        if (entry && entry.reconciled) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (typeof toast === "function") {
            toast("This entry is reconciled and cannot be deleted. Ask Haulage_Admin to unlock it first.");
          }
        }
      },
      true
    );

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
 * Band-1 example (TD 2025/4): meals $128 + overtime meal $38.65 +
 * accommodation $138 + incidentals $24.25 = $328.90. Caps follow the selected
 * FY via summary.allowances (TD 2025/4 / TD 2026/4…). Shows roaming spend per
 * segment under the
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
        label: "Food/meals (Daily)",
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
          <span><strong>${esc(allowLabel)}</strong> <small class="muted">ATO ${(state.summary && state.summary.allowances && state.summary.allowances.determination) || "TD"} · AEST</small></span>
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
          — currently <strong>${money(allowAmt)}</strong>/day for this band and FY. Breakfast/lunch/dinner and daily food/meals share the one meal pot;
          accommodation and other segments tally separately. Spend uses matching expense categories; daily figures reset at midnight AEST.
          ATO reasonable amounts update each income year (Taxation Determination), not every January/July.
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

/* --- Living Away from Home allowance box (dashboard) ---------------------
 * Shows ATO truck-driver overnight meal rates for the selected financial year
 * (TD 2025/4 → $128/day; TD 2026/4 → ~$132.50/day), salary band, plus any
 * Travel / LAFHA amounts recorded on income / scanned payslips.
 */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  const BOX_IDS = ["dashboard-lafha-box"];

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

  function selectedFy() {
    try {
      const sel = document.getElementById("fy-select");
      if (sel && sel.value) return sel.value;
      if (typeof state !== "undefined" && state.financialYear) return state.financialYear;
    } catch {
      /* ignore */
    }
    return "";
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
    const det = data.determination || "ATO TD";
    const fy = data.financialYear || "—";

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
            <div class="muted lafha-sub">${esc(det)} · FY ${esc(fy)}</div>
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
      const fy = selectedFy();
      const q = fy ? `?financialYear=${encodeURIComponent(fy)}` : "";
      const res = await fetch(`${API}/lafha${q}`, { credentials: "same-origin" });
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
    document.getElementById("fy-select")?.addEventListener("change", () => void refresh());
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
    // Re-apply saved defaults after menus are rebuilt (options were wiped).
    if (typeof window.haulageApplyProfilePresets === "function") {
      window.haulageApplyProfilePresets({ forceWorkUse: true });
    }
    try {
      const presetCat = document.getElementById("preset-category");
      const saved =
        window.__haulageUser &&
        window.__haulageUser.presets &&
        window.__haulageUser.presets.defaultCategory;
      if (presetCat && saved) presetCat.value = saved;
    } catch {
      /* ignore */
    }
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
        "The Dashboard is your home screen for the selected financial year. Top stats show Net income (income in hand), Deductible expenses, Net taxable income minus expenses, and Total Spend vs Net Income as a percentage. Two large pie charts sit underneath: Snapshot (net income in hand / deductible / net taxable minus expenses with colour legend totals) and Total Spend vs Net Income (blue income, red spend).",
        "Allowance caps track common work allowances (meals, overtime meals, and similar ATO bands) against what you’ve claimed so far for the day, week or month. Use this to stay under the published rates before EOFY.",
        "Living Away from Home (LAFHA) shows the ATO truck-driver overnight meal reasonable amounts for the selected financial year (for example TD 2025/4 at $128/day, TD 2026/4 at about $132.50/day). It doesn’t lodge anything with the ATO — it helps you see the headroom you still have when you’re away for work. Change the financial year in the top bar and LAFHA plus allowance caps refresh for that year’s Taxation Determination.",
      ],
    },
    expenses: {
      title: "Expenses",
      body: [
        "Expenses is for general work receipts (meals, accommodation, tools, and similar). Before uploading, open Recommended best way to scan your receipts, or tap Scan with camera for a live amber frame so you can fit the top of the slip and the date. Upload a photo or PDF with Upload file — you must be signed in. Approve the overall total before it’s saved; other line amounts are informational only.",
        "Manual entry covers cash claims and “no receipt” ticks. The expense ledger and receipt gallery filter by financial year and week so large lists stay scannable. Vehicle & fuel / ATO car claims live under the separate Car Expenses item in the sidebar (under Income).",
      ],
    },
    income: {
      title: "Income & remittances",
      body: [
        "Use Income to record payslips, remittances and other earnings for the selected financial year. Upload a payslip or invoice (image or PDF) the same way as expenses — OCR pulls gross, net and related fields when it can, then you approve before save. Manual entry is available when you prefer to type amounts yourself.",
        "Choose an income type from the menu, keep descriptions clear, and use the ledger to edit or remove rows. LAFHA guidance for overnight meal rates sits on the Dashboard so you can cross-check living-away amounts against what you’ve been paid.",
        "The income gallery only shows documents saved as income, so expense receipts won’t block a payslip upload. After a scan, tap Approve & save — photos can sit in the gallery before they appear in the ledger; if a photo says Needs approval, use Finish approval. When you scan a remittance or invoice, the approve amount prefers net income / net pay when that wording appears; otherwise it uses the largest pay figure (not GST or PAYG). Sign in before uploading so everything lands in your profile, not the shared guest store.",
      ],
    },
    "car-expenses": {
      title: "Car Expenses and Claims",
      body: [
        "Car Expenses is a sidebar item under Income for ATO work-related car claims (cents per km, logbook, or actual running costs). Save work vehicle presets (make, model, registration, engine size, speedometer/odometer and estimated work-use %) and mark them Active — the compiled box lists active cars for your records.",
        "The work-use slider starts near the ATO D1 public logbook example (~63%) and prefills claim work-use so deductible previews for fuel/servicing follow your profile. This view has its own car receipt photos gallery and car expenses ledger so you can review car claims separately from general expenses.",
      ],
    },
    report: {
      title: "EOFY Report",
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
        "You sign in once on Driver Hub, then open Taxation Hub from the app picker. Profile is where you set your display name, employer, annual salary, licence class and financial year, and tick whether your TFN is with your employer. Start typing an employer (e.g. “Lindsay”) to pick from known transport fleets — we’ll then ask your driver type and fill a standard salary and licence class you can still edit before saving.",
        "Account tools cover email on file, password changes, and optional presets so new expenses start closer to how you work. Plan shows Free (15 uploads/month + 1 on-screen EOFY report) or Pro ($5/month) with unlimited scans, PDF/JSON export and forecast — every new profile includes three months of Pro+ (full Pro access), then those Free limits apply again unless you subscribe; you can start paying from day one. Use Driver Hub Apps in the sidebar to switch apps or return to the hub. After login or logout the page reloads so every tab shows your data only.",
        "Primary mod (Haulage_Admin) can open any driver to reset passwords, set email, clear login lockouts, upgrade/downgrade Free ↔ Pro+ at any time, override profile/ledger mistakes, and restore earlier data snapshots. Guests can browse read-only; uploads and ledger changes need a signed-in Driver Hub profile.",
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
    line1.textContent = `Your message has been sent to the developer (${supportEmail || "support@godriverhub.com"}).`;
    wrap.appendChild(line1);

    const line2 = document.createElement("p");
    if (confirmationSent) {
      line2.textContent = `A confirmation notice was also sent to ${userEmail}. Check your inbox (and spam) for “we received your support request”.`;
    } else {
      line2.textContent = `We’ll reply to ${userEmail}. If you don’t hear back, follow up at ${supportEmail || "support@godriverhub.com"}.`;
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
    const inbox = supportEmail || "support@godriverhub.com";
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
        _subject: `Driver Hub / Taxation Hub support — from ${name}`,
        _template: "table",
        _autoresponse:
          confirmationText ||
          `Hi ${name},\n\nThanks for contacting Driver Hub support. Your request has been sent to the developer (${inbox}). We’ll reply to this email as soon as we can.\n\n— Driver Hub`,
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
      const supportEmail = data.supportEmail || "support@godriverhub.com";

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
      setStatus("Network error — please try again or email support@godriverhub.com.", {
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

/* --- Car Expenses: work-vehicle presets on profile ----------------------- */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  let cars = [];
  let editingId = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function byId(id) {
    return document.getElementById(id);
  }

  const ATO_EXAMPLE_WORK_USE = 63;
  const CAR_CLAIM_CATEGORIES = new Set([
    "vehicle_car",
    "fuel",
    "repairs_maintenance",
    "tyres",
    "registration_insurance",
    "parking_tolls",
  ]);

  function formatCarLine(car) {
    if (!car) return "";
    const bits = [];
    if (car.make || car.model) bits.push([car.make, car.model].filter(Boolean).join(" "));
    if (car.registration) bits.push(`Rego ${car.registration}`);
    if (car.engineSize) bits.push(`Engine ${car.engineSize}`);
    if (car.odometerReading) bits.push(`Odometer ${car.odometerReading}`);
    if (car.estimatedWorkUsePercent != null) bits.push(`Work use ${car.estimatedWorkUsePercent}%`);
    return bits.join(" · ");
  }

  function compileActiveText(list) {
    const active = (list || []).filter((c) => c.active);
    if (!active.length) {
      return "No active work cars on file. Add a vehicle below and mark it Active for ATO work-use claims.";
    }
    return [
      "Active work vehicle(s) for ATO car expense claims:",
      ...active.map((c, i) => `${i + 1}. ${formatCarLine(c)}`),
    ].join("\n");
  }

  function primaryActiveCar() {
    return cars.find((c) => c.active) || null;
  }

  function syncWorkUseSliderDisplay() {
    const slider = byId("car-vehicle-workuse");
    const display = byId("car-vehicle-workuse-display");
    if (!slider || !display) return;
    display.textContent = String(slider.value);
    slider.setAttribute("aria-valuenow", slider.value);
  }

  /** Prefill Car Expenses claim form work-use % from the active vehicle. */
  function applyActiveCarWorkUseToClaimForm() {
    const form = byId("expense-form");
    const field = form && form.elements && form.elements.workUsePercent;
    if (!field) return;
    const car = primaryActiveCar();
    if (!car || car.estimatedWorkUsePercent == null) return;
    const pct = Math.min(100, Math.max(0, Number(car.estimatedWorkUsePercent) || 0));
    field.value = String(pct);
    field.dataset.fromCarProfile = "1";
    field.title = `From active work vehicle (${formatCarLine(car)})`;
    // Nudge the live deduction preview used by app.js.
    try {
      field.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {
      /* ignore */
    }
  }
  window.haulageApplyCarWorkUse = applyActiveCarWorkUseToClaimForm;

  function setMessage(msg, isError) {
    const el = byId("car-vehicles-message");
    if (!el) return;
    el.textContent = msg || "";
    el.dataset.error = isError ? "1" : "";
  }

  function readCarsFromState() {
    try {
      if (typeof state !== "undefined" && state.records && state.records.profile) {
        return Array.isArray(state.records.profile.cars)
          ? state.records.profile.cars.map((c) => ({ ...c }))
          : [];
      }
    } catch {
      /* ignore */
    }
    return cars.slice();
  }

  function writeCarsToState(next) {
    cars = next.map((c) => ({ ...c }));
    try {
      if (typeof state !== "undefined" && state.records) {
        state.records.profile = state.records.profile || {};
        state.records.profile.cars = cars.map((c) => ({ ...c }));
      }
    } catch {
      /* ignore */
    }
  }

  function render() {
    const listEl = byId("car-vehicles-list");
    const compiled = byId("car-vehicles-compiled");
    const status = byId("car-vehicles-status");
    if (!listEl) return;

    const list = cars;
    const activeCount = list.filter((c) => c.active).length;
    if (compiled) compiled.value = compileActiveText(list);
    if (status) {
      if (!list.length) {
        status.textContent = "No vehicles saved";
        status.classList.remove("has-active");
      } else if (activeCount) {
        status.textContent = `${activeCount} active · ${list.length} on file`;
        status.classList.add("has-active");
      } else {
        status.textContent = `${list.length} on file · none active`;
        status.classList.remove("has-active");
      }
    }

    if (!list.length) {
      listEl.innerHTML = `<p class="muted small">No work vehicles yet — add one below (make, model, rego, engine size, odometer and work use).</p>`;
      return;
    }

    listEl.innerHTML = list
      .map((car) => {
        const title = [car.make, car.model].filter(Boolean).join(" ") || "Work vehicle";
        const detail = [
          car.registration ? `Rego ${esc(car.registration)}` : "",
          car.engineSize ? `Engine ${esc(car.engineSize)}` : "",
          car.odometerReading ? `Odo ${esc(car.odometerReading)}` : "",
          car.estimatedWorkUsePercent != null ? `${esc(car.estimatedWorkUsePercent)}% work use` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const activeClass = car.active ? " is-active" : "";
        const badge = car.active ? `<span class="car-vehicle-badge">Active</span>` : "";
        return `<article class="car-vehicle-card${activeClass}" data-car-id="${esc(car.id)}">
          <span class="car-vehicle-light" aria-hidden="true" title="${car.active ? "Active" : "Inactive"}"></span>
          <div class="car-vehicle-meta">
            <strong>${esc(title)}</strong>
            <p class="muted">${detail || "—"}</p>
            ${badge}
          </div>
          <div class="car-vehicle-actions">
            <button type="button" class="btn secondary small" data-car-toggle="${esc(car.id)}">${
              car.active ? "Deactivate" : "Activate"
            }</button>
            <button type="button" class="btn secondary small" data-car-edit="${esc(car.id)}">Edit</button>
            <button type="button" class="btn danger small" data-car-remove="${esc(car.id)}">Remove</button>
          </div>
        </article>`;
      })
      .join("");

    applyActiveCarWorkUseToClaimForm();
  }

  function resetForm() {
    editingId = null;
    const form = byId("car-vehicle-form");
    if (form) form.reset();
    if (byId("car-vehicle-id")) byId("car-vehicle-id").value = "";
    if (byId("car-vehicle-active")) byId("car-vehicle-active").checked = true;
    if (byId("car-vehicle-workuse")) byId("car-vehicle-workuse").value = String(ATO_EXAMPLE_WORK_USE);
    if (byId("car-vehicle-odometer")) byId("car-vehicle-odometer").value = "";
    syncWorkUseSliderDisplay();
    const cancel = byId("car-vehicle-cancel");
    if (cancel) cancel.hidden = true;
    const save = byId("car-vehicle-save");
    if (save) save.textContent = "Save vehicle to profile";
  }

  function fillForm(car) {
    editingId = car.id;
    byId("car-vehicle-id").value = car.id || "";
    byId("car-vehicle-make").value = car.make || "";
    byId("car-vehicle-model").value = car.model || "";
    byId("car-vehicle-rego").value = car.registration || "";
    byId("car-vehicle-engine").value = car.engineSize || "";
    if (byId("car-vehicle-odometer")) {
      byId("car-vehicle-odometer").value = car.odometerReading || "";
    }
    if (byId("car-vehicle-workuse")) {
      byId("car-vehicle-workuse").value = String(
        car.estimatedWorkUsePercent != null ? car.estimatedWorkUsePercent : ATO_EXAMPLE_WORK_USE
      );
      syncWorkUseSliderDisplay();
    }
    byId("car-vehicle-active").checked = Boolean(car.active);
    const cancel = byId("car-vehicle-cancel");
    if (cancel) cancel.hidden = false;
    const save = byId("car-vehicle-save");
    if (save) save.textContent = "Update vehicle";
    byId("car-vehicle-make")?.focus();
  }

  async function persistCars(next, okMsg) {
    const res = await fetch(`${API}/profile`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cars: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Could not save vehicles.");
    }
    writeCarsToState(Array.isArray(data.profile && data.profile.cars) ? data.profile.cars : next);
    render();
    setMessage(okMsg || "Vehicles saved to your profile.");
    if (typeof window.toast === "function") window.toast(okMsg || "Work vehicles saved");
  }

  function syncFromRecords() {
    writeCarsToState(readCarsFromState());
    render();
  }

  function wire() {
    const box = byId("car-vehicles-box");
    if (!box || box.dataset.wired) return;
    box.dataset.wired = "1";

    const form = byId("car-vehicle-form");
    byId("car-vehicle-workuse")?.addEventListener("input", syncWorkUseSliderDisplay);

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const make = (byId("car-vehicle-make")?.value || "").trim();
      const model = (byId("car-vehicle-model")?.value || "").trim();
      const registration = (byId("car-vehicle-rego")?.value || "").trim();
      const engineSize = (byId("car-vehicle-engine")?.value || "").trim();
      const odometerReading = (byId("car-vehicle-odometer")?.value || "").trim();
      const estimatedWorkUsePercent = Number(byId("car-vehicle-workuse")?.value ?? ATO_EXAMPLE_WORK_USE);
      const active = Boolean(byId("car-vehicle-active")?.checked);
      if (!make && !model && !registration) {
        setMessage("Enter at least a make, model or registration.", true);
        return;
      }
      const now = new Date().toISOString();
      const id = editingId || (byId("car-vehicle-id")?.value || "") || null;
      const patch = {
        make,
        model,
        registration,
        engineSize,
        odometerReading,
        estimatedWorkUsePercent,
        active,
        updatedAt: now,
      };
      let next = cars.map((c) => ({ ...c }));
      if (id && next.some((c) => c.id === id)) {
        next = next.map((c) => (c.id === id ? { ...c, ...patch } : c));
      } else {
        if (next.length >= 10) {
          setMessage("You can save up to 10 work vehicles.", true);
          return;
        }
        next.push({
          id:
            (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
            `car-${Date.now()}`,
          ...patch,
          createdAt: now,
        });
      }
      setMessage("Saving…");
      try {
        await persistCars(next, active ? "Vehicle saved and marked Active" : "Vehicle saved");
        resetForm();
      } catch (err) {
        setMessage(err.message || "Save failed — sign in on Profile first.", true);
      }
    });

    byId("car-vehicle-cancel")?.addEventListener("click", () => {
      resetForm();
      setMessage("");
    });

    byId("car-vehicles-list")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-car-toggle], [data-car-edit], [data-car-remove]");
      if (!btn) return;
      const toggleId = btn.getAttribute("data-car-toggle");
      const editId = btn.getAttribute("data-car-edit");
      const removeId = btn.getAttribute("data-car-remove");
      if (editId) {
        const car = cars.find((c) => c.id === editId);
        if (car) fillForm(car);
        return;
      }
      if (toggleId) {
        const next = cars.map((c) =>
          c.id === toggleId
            ? { ...c, active: !c.active, updatedAt: new Date().toISOString() }
            : c
        );
        try {
          await persistCars(
            next,
            next.find((c) => c.id === toggleId)?.active
              ? "Vehicle activated"
              : "Vehicle deactivated"
          );
        } catch (err) {
          setMessage(err.message || "Could not update vehicle.", true);
        }
        return;
      }
      if (removeId) {
        const car = cars.find((c) => c.id === removeId);
        const label = car ? formatCarLine(car) || "this vehicle" : "this vehicle";
        if (!window.confirm(`Remove ${label} from your profile?`)) return;
        const next = cars.filter((c) => c.id !== removeId);
        try {
          await persistCars(next, "Vehicle removed");
          if (editingId === removeId) resetForm();
        } catch (err) {
          setMessage(err.message || "Could not remove vehicle.", true);
        }
      }
    });
  }

  function enrichCarPreviewNote(body) {
    const box = byId("expense-preview");
    if (!box || box.classList.contains("hidden")) return;
    const pct = Number(body.workUsePercent);
    if (!Number.isFinite(pct)) return;
    let note = box.querySelector(".car-workuse-preview-note");
    if (!note) {
      note = document.createElement("p");
      note.className = "muted small car-workuse-preview-note";
      box.appendChild(note);
    }
    const active = primaryActiveCar();
    const fromProfile =
      body.workUseFromCarProfile ||
      (active && pct === Number(active.estimatedWorkUsePercent));
    note.textContent =
      body.category === "vehicle_car" && body.method === "cents_per_km"
        ? `Work kilometres should already be work-only (cents/km). Active vehicle estimate on file: ${pct}%.`
        : `Deductible uses ${pct}% work use${
            fromProfile ? " from your active vehicle profile" : ""
          }.`;
  }

  // Refresh when app.js reloads /records; enrich car deduction previews.
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      const options = args[1] || {};
      if (url && /\/records(\?|$)/.test(String(url))) {
        res
          .clone()
          .json()
          .then((data) => {
            if (data && data.profile) {
              writeCarsToState(Array.isArray(data.profile.cars) ? data.profile.cars : []);
              render();
            }
          })
          .catch(() => {});
      }
      if (
        url &&
        /\/expenses\/preview(\?|$)/.test(String(url)) &&
        String(options.method || "GET").toUpperCase() === "POST"
      ) {
        let body = {};
        try {
          body = options.body ? JSON.parse(options.body) : {};
        } catch {
          body = {};
        }
        if (CAR_CLAIM_CATEGORIES.has(body.category)) {
          // Wait a tick so app.js can paint #expense-preview first.
          setTimeout(() => enrichCarPreviewNote(body), 0);
        }
      }
    } catch {
      /* ignore */
    }
    return res;
  };

  // After app.js resets work-use to 100 on save, restore the active car %.
  const expenseForm = byId("expense-form");
  if (expenseForm && !expenseForm.dataset.carWorkUseWired) {
    expenseForm.dataset.carWorkUseWired = "1";
    expenseForm.addEventListener("submit", () => {
      setTimeout(() => applyActiveCarWorkUseToClaimForm(), 0);
    });
    expenseForm.addEventListener("change", (e) => {
      if (e.target && e.target.name === "category" && CAR_CLAIM_CATEGORIES.has(e.target.value)) {
        applyActiveCarWorkUseToClaimForm();
      }
    });
  }

  function start() {
    wire();
    syncFromRecords();
    syncWorkUseSliderDisplay();
    applyActiveCarWorkUseToClaimForm();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Car Expenses sidebar view (under Income) ----------------------------
 * Formerly an Expenses sub-tab. Own nav item + #view-car-expenses; setView
 * title + work-use prefill live here. Car claim saves return to this view.
 */
(function () {
  "use strict";

  const CAR_CLAIM_IDS = new Set([
    "vehicle_car",
    "fuel",
    "repairs_maintenance",
    "tyres",
    "registration_insurance",
    "parking_tolls",
  ]);

  const TITLE = "Car Expenses and Claims";

  function onCarExpensesView() {
    const title = document.getElementById("page-title");
    if (title) title.textContent = TITLE;
    if (typeof window.haulageApplyCarWorkUse === "function") {
      window.haulageApplyCarWorkUse();
    }
  }

  function wrapSetView() {
    if (typeof globalThis.setView !== "function") return;
    if (globalThis.setView.__haulageCarExpensesWrapped) return;
    const prev = globalThis.setView;
    function carExpensesSetView(name) {
      const result = prev.apply(this, arguments);
      if (name === "car-expenses") onCarExpensesView();
      return result;
    }
    carExpensesSetView.__haulageCarExpensesWrapped = true;
    if (prev.__haulageSupportWrapped) carExpensesSetView.__haulageSupportWrapped = true;
    if (prev.__haulageExpensesPaneWrapped) carExpensesSetView.__haulageExpensesPaneWrapped = true;
    if (prev.__haulageAwaitingWrapped) carExpensesSetView.__haulageAwaitingWrapped = true;
    globalThis.setView = carExpensesSetView;
  }

  function wrapAfterExpenseSaved() {
    if (typeof globalThis.afterExpenseSaved !== "function") return;
    if (globalThis.afterExpenseSaved.__haulageCarExpensesWrapped) return;
    const prev = globalThis.afterExpenseSaved;
    async function wrapped(entry, _message) {
      await prev.apply(this, arguments);
      if (entry && CAR_CLAIM_IDS.has(entry.category) && typeof globalThis.setView === "function") {
        globalThis.setView("car-expenses");
      }
    }
    wrapped.__haulageCarExpensesWrapped = true;
    globalThis.afterExpenseSaved = wrapped;
  }

  function start() {
    wrapSetView();
    wrapAfterExpenseSaved();
    setTimeout(wrapSetView, 0);
    setTimeout(wrapAfterExpenseSaved, 0);
    setTimeout(wrapSetView, 500);
    setTimeout(wrapAfterExpenseSaved, 500);
    // One-time migrate: users who last left Expenses on the car sub-tab.
    try {
      if (localStorage.getItem("haulage-expenses-pane") === "car") {
        localStorage.removeItem("haulage-expenses-pane");
      }
    } catch {
      /* ignore */
    }
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

/* --- Profile employer predictive text + driver-type salary defaults ------
 * Typeahead against GET /employers. Picking a known fleet asks for driver
 * type, then fills annual salary + licence class from market defaults.
 */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  let debounceTimer = null;
  let activeIndex = -1;
  let latestQuery = "";
  let defaultsCache = null;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function employerInput() {
    return (
      document.getElementById("profile-employer") ||
      document.querySelector('#profile-form input[name="employer"]')
    );
  }

  function suggestionsEl() {
    return document.getElementById("profile-employer-suggestions");
  }

  function hideSuggestions() {
    const list = suggestionsEl();
    if (!list) return;
    list.hidden = true;
    list.innerHTML = "";
    activeIndex = -1;
  }

  function setActive(list, index) {
    const buttons = [...list.querySelectorAll("button[data-employer]")];
    activeIndex = index;
    buttons.forEach((btn, i) => {
      btn.setAttribute("aria-selected", i === index ? "true" : "false");
    });
    buttons[index]?.scrollIntoView({ block: "nearest" });
  }

  async function loadDefaults() {
    if (defaultsCache) return defaultsCache;
    try {
      const res = await fetch(`${API}/driver-role-defaults`, {
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.defaults)) {
        defaultsCache = data.defaults;
        return defaultsCache;
      }
    } catch {
      /* fall through */
    }
    defaultsCache = [];
    return defaultsCache;
  }

  function applyRoleDefaults(role) {
    if (!role) return;
    const form = document.getElementById("profile-form");
    const typeSelect =
      document.getElementById("driver-type") ||
      form?.elements?.driverType;
    const salaryInput =
      document.getElementById("profile-annual-salary") ||
      form?.elements?.annualSalary;
    const licenceSelect = document.getElementById("profile-licence-class");

    if (typeSelect && role.driverType) {
      typeSelect.value = role.driverType;
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (salaryInput && role.annualSalary != null) {
      salaryInput.value = String(role.annualSalary);
      salaryInput.dispatchEvent(new Event("input", { bubbles: true }));
      salaryInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (licenceSelect && role.licenceClass) {
      licenceSelect.value = role.licenceClass;
      licenceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const label = role.label || role.driverType;
    const money = Number(role.annualSalary).toLocaleString("en-AU");
    if (typeof window.toast === "function") {
      window.toast(
        `${label}: salary set to $${money} (${role.licenceClass || "licence"}). Review and Save profile.`
      );
    }
  }

  async function askDriverType(employerName) {
    const defaults = await loadDefaults();
    if (!defaults.length) return;

    document.getElementById("enh-driver-type-modal")?.remove();

    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.id = "enh-driver-type-modal";
      modal.className = "enh-dup-modal";
      const options = defaults
        .map(
          (d) => `
          <button type="button" data-role="${esc(d.id)}">
            <strong>${esc(d.label)}</strong>
            <span>${esc(d.description || "")}</span>
            <span>Guide salary $${Number(d.annualSalary).toLocaleString("en-AU")} · ${esc(
              d.licenceLabel || d.licenceClass || ""
            )}</span>
          </button>`
        )
        .join("");
      modal.innerHTML = `
        <div class="enh-dup-backdrop" data-role-close></div>
        <div class="enh-dup-card" role="dialog" aria-modal="true" aria-labelledby="enh-driver-type-title">
          <h3 id="enh-driver-type-title">Driver type at ${esc(employerName)}</h3>
          <p>Pick the role that best matches your work so we can set a standard annual salary and licence class. You can still edit either before saving.</p>
          <div class="enh-driver-type-options">${options}</div>
          <div class="enh-dup-actions">
            <button type="button" class="btn" data-role-close>Skip</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const finish = (roleId) => {
        modal.remove();
        resolve(roleId || null);
      };
      modal.querySelectorAll("[data-role-close]").forEach((el) => {
        el.addEventListener("click", () => finish(null));
      });
      modal.querySelectorAll("button[data-role]").forEach((btn) => {
        btn.addEventListener("click", () => finish(btn.getAttribute("data-role")));
      });
    });
  }

  async function onEmployerPicked(name) {
    const input = employerInput();
    if (!input || !name) return;
    input.value = name;
    hideSuggestions();
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const roleId = await askDriverType(name);
    if (!roleId) return;
    try {
      const res = await fetch(
        `${API}/driver-role-defaults?driverType=${encodeURIComponent(roleId)}`,
        { credentials: "same-origin" }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.default) applyRoleDefaults(data.default);
    } catch {
      const defaults = await loadDefaults();
      const row = defaults.find((d) => d.id === roleId);
      if (row) {
        applyRoleDefaults({
          driverType: row.id,
          label: row.label,
          annualSalary: row.annualSalary,
          licenceClass: row.licenceClass,
        });
      }
    }
  }

  async function fetchSuggestions(q) {
    latestQuery = q;
    if (q.trim().length < 2) {
      hideSuggestions();
      return;
    }
    try {
      const res = await fetch(
        `${API}/employers?q=${encodeURIComponent(q.trim())}&limit=10`,
        { credentials: "same-origin" }
      );
      const data = await res.json().catch(() => ({}));
      if (q !== latestQuery) return;
      const list = suggestionsEl();
      const input = employerInput();
      if (!list || !input) return;
      const rows = Array.isArray(data.employers) ? data.employers : [];
      if (!rows.length) {
        hideSuggestions();
        return;
      }
      list.innerHTML = rows
        .map(
          (e) =>
            `<li role="option"><button type="button" data-employer="${esc(e.name)}">${esc(
              e.name
            )}</button></li>`
        )
        .join("");
      list.hidden = false;
      activeIndex = -1;
      list.querySelectorAll("button[data-employer]").forEach((btn) => {
        btn.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          void onEmployerPicked(btn.getAttribute("data-employer"));
        });
      });
    } catch {
      hideSuggestions();
    }
  }

  function start() {
    const input = employerInput();
    const list = suggestionsEl();
    if (!input || !list) return;

    // Keep the suggestions list under an input wrap for absolute positioning.
    if (!input.parentElement?.classList?.contains("profile-employer-input-wrap")) {
      const wrap = document.createElement("span");
      wrap.className = "profile-employer-input-wrap";
      input.replaceWith(wrap);
      wrap.appendChild(input);
      wrap.appendChild(list);
    } else if (list.parentElement !== input.parentElement) {
      input.parentElement.appendChild(list);
    }

    input.setAttribute("autocomplete", "organization");
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const q = input.value;
      debounceTimer = setTimeout(() => {
        void fetchSuggestions(q);
      }, 180);
    });
    input.addEventListener("keydown", (ev) => {
      if (list.hidden) return;
      const buttons = [...list.querySelectorAll("button[data-employer]")];
      if (!buttons.length) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        setActive(list, Math.min(buttons.length - 1, activeIndex + 1));
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        setActive(list, Math.max(0, activeIndex - 1));
      } else if (ev.key === "Enter" && activeIndex >= 0) {
        ev.preventDefault();
        void onEmployerPicked(buttons[activeIndex].getAttribute("data-employer"));
      } else if (ev.key === "Escape") {
        hideSuggestions();
      }
    });
    input.addEventListener("blur", () => {
      setTimeout(hideSuggestions, 150);
    });

    void loadDefaults();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Unconfirmed income/expense scans (gallery photo, no ledger row) -----
 * /receipts/scan saves the image immediately; the ledger row is only created
 * when the user clicks Approve. Navigating away leaves orphans in the gallery.
 * Soft-deleted ledger rows can leave the same symptom (linked id, no active row).
 */
(function () {
  "use strict";
  /* global findReceipt, getDetectedTotalsClient */

  const fmt = (n) =>
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

  function notify(msg) {
    if (typeof toast === "function") toast(msg);
  }

  function receipts() {
    return (typeof state !== "undefined" && state && state.records && state.records.receipts) || [];
  }

  function activeIncome() {
    return (typeof state !== "undefined" && state && state.records && state.records.income) || [];
  }

  function activeExpenses() {
    return (typeof state !== "undefined" && state && state.records && state.records.expenses) || [];
  }

  function purposeOf(r) {
    if (!r) return null;
    if (r.purpose === "income" || r.purpose === "expense") return r.purpose;
    if (r.linkedIncomeId) return "income";
    if (r.linkedExpenseId) return "expense";
    if (r.ocrResult && r.ocrResult.documentType === "income") return "income";
    return "expense";
  }

  function isAwaiting(r, purpose) {
    if (!r || !(r.hasImage || r.imagePath)) return false;
    if (r.linkedIncomeId || r.linkedExpenseId) return false;
    if (r.awaitingConfirm === true) return !purpose || purposeOf(r) === purpose;
    if (r.awaitingConfirm === false) return false;
    const p = purposeOf(r);
    if (purpose && p !== purpose) return false;
    return p === "income" || p === "expense";
  }

  function isMissingLink(r, purpose) {
    if (!r || !(r.hasImage || r.imagePath)) return false;
    // Honour server flag when present — including false, so a stale banner
    // clears after restore / refresh even if local income/expense arrays lag.
    if (r.missingLinkedLedger === true) return !purpose || purposeOf(r) === purpose;
    if (r.missingLinkedLedger === false) return false;
    if (r.linkedIncomeId) {
      const found = activeIncome().some(
        (i) => i && (i.id === r.linkedIncomeId || i.receiptId === r.id)
      );
      if (!found) return !purpose || purpose === "income";
    }
    if (r.linkedExpenseId) {
      const found = activeExpenses().some(
        (e) => e && (e.id === r.linkedExpenseId || e.receiptId === r.id)
      );
      if (!found) return !purpose || purpose === "expense";
    }
    return false;
  }

  function listAwaiting(purpose) {
    return receipts().filter((r) => isAwaiting(r, purpose));
  }

  function listMissing(purpose) {
    return receipts().filter((r) => isMissingLink(r, purpose));
  }

  function ensureBanner(viewId, bannerId) {
    const view = document.getElementById(viewId);
    if (!view) return null;
    let banner = document.getElementById(bannerId);
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = bannerId;
    banner.className = "enh-awaiting-banner hidden";
    banner.setAttribute("role", "status");
    view.insertBefore(banner, view.firstChild);
    return banner;
  }

  function rebuildDetectedTotals(ocr) {
    if (typeof getDetectedTotalsClient === "function") {
      try {
        const t = getDetectedTotalsClient(ocr || {});
        if (Array.isArray(t)) return t;
      } catch {
        /* fall through */
      }
    }
    const amount = Number(ocr && (ocr.grossTotal ?? ocr.amount));
    if (Number.isFinite(amount) && amount > 0) {
      return [{ label: "Amount", amount, primary: true }];
    }
    return [];
  }

  function primaryAmount(ocr, totals) {
    const fromTotals = (totals || []).find((t) => t.primary)?.amount ?? (totals || [])[0]?.amount;
    const n = Number(fromTotals ?? ocr?.grossTotal ?? ocr?.amount ?? ocr?.netPay);
    return Number.isFinite(n) && n > 0 ? n : "";
  }

  function todayIso() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  async function postConfirm(receiptId, purpose, payload) {
    const res = await fetch(`${apiBase()}/receipts/${encodeURIComponent(receiptId)}/confirm`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, purpose, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save to ledger");
    return data;
  }

  /** Self-contained approve modal — does not rely on app.js pendingReceiptConfirm. */
  function openApproveModal(receipt, purpose) {
    document.getElementById("enh-awaiting-modal")?.remove();
    const o = receipt.ocrResult || {};
    const totals = rebuildDetectedTotals(o);
    const amount = primaryAmount(o, totals);
    const entity = o.entity || o.vendor || o.payer || "";
    const date = o.date || todayIso();

    const modal = document.createElement("div");
    modal.id = "enh-awaiting-modal";
    modal.className = "enh-dup-modal";
    const incomeFields =
      purpose === "income"
        ? `
          <label>Entity / company<input type="text" id="enh-await-entity" value="${esc(entity)}" /></label>
          <label>Gross ($)<input type="number" id="enh-await-gross" step="0.01" min="0" value="${esc(
            o.grossTotal ?? amount
          )}" /></label>
          <label>Taxable ($)<input type="number" id="enh-await-taxable" step="0.01" min="0" value="${esc(
            o.taxableIncome ?? o.grossTotal ?? amount
          )}" /></label>
          <label>GST ($)<input type="number" id="enh-await-gst" step="0.01" min="0" value="${esc(
            o.gstAmount ?? o.gst ?? 0
          )}" /></label>`
        : `
          <label>Vendor<input type="text" id="enh-await-entity" value="${esc(entity)}" /></label>
          <label>Category<input type="text" id="enh-await-category" value="${esc(
            o.suggestedCategory || "other_work"
          )}" /></label>`;

    modal.innerHTML = `
      <div class="enh-dup-backdrop" data-enh-await-cancel></div>
      <div class="enh-dup-card" role="dialog" aria-modal="true" aria-labelledby="enh-await-title">
        <h3 id="enh-await-title">Approve &amp; add to ${purpose === "income" ? "income" : "expense"} ledger</h3>
        <p class="muted"><strong>${esc(receipt.filename || "Document")}</strong> was scanned but never approved — that is why the photo shows in the gallery with no ledger row.</p>
        <div class="form-grid scan-confirm-form">
          <label>Date<input type="date" id="enh-await-date" value="${esc(date)}" /></label>
          ${incomeFields}
          <label>Amount ($)<input type="number" id="enh-await-amount" step="0.01" min="0" value="${esc(
            amount
          )}" required /></label>
          <label class="span-2">Description<input type="text" id="enh-await-desc" value="${esc(
            o.description || ""
          )}" /></label>
        </div>
        <div class="enh-dup-actions">
          <button type="button" class="btn secondary" data-enh-await-cancel>Cancel</button>
          <button type="button" class="btn primary" data-enh-await-save>Approve &amp; save</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelectorAll("[data-enh-await-cancel]").forEach((el) => {
      el.addEventListener("click", close);
    });
    modal.querySelector("[data-enh-await-save]")?.addEventListener("click", () => {
      void (async () => {
        const amt = Number(document.getElementById("enh-await-amount")?.value);
        if (!Number.isFinite(amt) || amt <= 0) {
          notify("Enter a valid total amount from the document");
          document.getElementById("enh-await-amount")?.focus();
          return;
        }
        const payload =
          purpose === "income"
            ? {
                date: document.getElementById("enh-await-date")?.value || date,
                entity: document.getElementById("enh-await-entity")?.value || entity,
                payer: document.getElementById("enh-await-entity")?.value || entity,
                amount: amt,
                grossTotal: Number(document.getElementById("enh-await-gross")?.value) || amt,
                taxableIncome: Number(document.getElementById("enh-await-taxable")?.value) || amt,
                gstAmount: Number(document.getElementById("enh-await-gst")?.value) || 0,
                netPay: amt,
                type: o.suggestedIncomeType || o.type || "salary_wages",
                description: document.getElementById("enh-await-desc")?.value || o.description || "",
              }
            : {
                date: document.getElementById("enh-await-date")?.value || date,
                vendor: document.getElementById("enh-await-entity")?.value || entity,
                category: document.getElementById("enh-await-category")?.value || "other_work",
                amount: amt,
                description: document.getElementById("enh-await-desc")?.value || o.description || "",
                workUsePercent: 100,
              };
        try {
          const btn = modal.querySelector("[data-enh-await-save]");
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Saving…";
          }
          await postConfirm(receipt.id, purpose, payload);
          close();
          notify(
            purpose === "income"
              ? `${fmt(amt)} added to Income`
              : `${fmt(amt)} added to Expenses`
          );
          if (typeof setView === "function") setView(purpose === "income" ? "income" : "expenses");
          if (typeof refreshAll === "function") await refreshAll();
          else scheduleRefreshUi();
        } catch (err) {
          notify(err.message || "Save failed");
          const btn = modal.querySelector("[data-enh-await-save]");
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Approve & save";
          }
        }
      })();
    });

    if (typeof setView === "function") setView(purpose === "income" ? "income" : "expenses");
  }

  function resumeApproval(receipt, purpose) {
    openApproveModal(receipt, purpose);
  }

  async function discardReceipt(receiptId) {
    const res = await fetch(`${apiBase()}/receipts/${encodeURIComponent(receiptId)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not discard upload");
    return data;
  }

  async function restoreLedger(purpose, entryId) {
    const path = purpose === "income" ? "income" : "expenses";
    const res = await fetch(`${apiBase()}/${path}/${encodeURIComponent(entryId)}/restore`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not restore ledger entry");
    return data;
  }

  function renderBanner(purpose) {
    const viewId = purpose === "income" ? "view-income" : "view-expenses";
    const bannerId = purpose === "income" ? "enh-income-awaiting" : "enh-expense-awaiting";
    const banner = ensureBanner(viewId, bannerId);
    if (!banner) return;

    const awaiting = listAwaiting(purpose);
    const missing = listMissing(purpose);
    if (!awaiting.length && !missing.length) {
      banner.classList.add("hidden");
      banner.innerHTML = "";
      return;
    }

    const noun = purpose === "income" ? "income" : "expense";
    const parts = [];
    if (awaiting.length) {
      parts.push(
        `<strong>${awaiting.length}</strong> scanned ${noun} document${
          awaiting.length === 1 ? "" : "s"
        } still need approval before ${
          awaiting.length === 1 ? "it appears" : "they appear"
        } in the ledger.`
      );
    }
    if (missing.length) {
      parts.push(
        `<strong>${missing.length}</strong> ${noun} photo${
          missing.length === 1 ? "" : "s"
        } link to ${noun} removed from the ledger — restore to bring ${
          missing.length === 1 ? "it" : "them"
        } back.`
      );
    }

    const firstAwait = awaiting[0];
    const firstMissing = missing[0];
    const actions = [];
    if (firstAwait) {
      actions.push(
        `<button type="button" class="btn primary" data-enh-resume="${esc(
          firstAwait.id
        )}" data-purpose="${purpose}">Finish approval</button>`
      );
      actions.push(
        `<button type="button" class="btn secondary" data-enh-discard="${esc(
          firstAwait.id
        )}">Discard scan</button>`
      );
    }
    if (firstMissing) {
      const linkId =
        purpose === "income" ? firstMissing.linkedIncomeId : firstMissing.linkedExpenseId;
      if (linkId) {
        actions.push(
          `<button type="button" class="btn primary" data-enh-restore="${esc(
            linkId
          )}" data-purpose="${purpose}">Restore to ledger</button>`
        );
      }
    }

    banner.classList.remove("hidden");
    banner.innerHTML = `
      <div class="enh-awaiting-copy">
        <p>${parts.join(" ")}</p>
        <p class="muted">Photos can appear in the gallery as soon as you upload — the ledger only updates after you approve (or restore).</p>
      </div>
      <div class="enh-awaiting-actions">${actions.join("")}</div>`;
  }

  let refreshScheduled = false;
  function scheduleRefreshUi() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      refreshUi();
    });
  }

  function decorateGalleryCards(purpose) {
    const galleryId = purpose === "income" ? "income-gallery" : "receipt-gallery";
    const gallery = document.getElementById(galleryId);
    if (!gallery) return;
    const awaitingIds = new Set(listAwaiting(purpose).map((r) => r.id));
    const missingIds = new Set(listMissing(purpose).map((r) => r.id));

    gallery.querySelectorAll(".receipt-card[data-receipt-card]").forEach((card) => {
      const id = card.getAttribute("data-receipt-card");
      if (!id) return;
      let badge = card.querySelector(".enh-awaiting-badge");
      const needsApprove = awaitingIds.has(id);
      const needsRestore = missingIds.has(id);
      if (!needsApprove && !needsRestore) {
        if (badge) badge.remove();
        card.querySelector(".enh-awaiting-card-actions")?.remove();
        return;
      }
      const badgeText = needsApprove ? "Needs approval" : "Not in ledger";
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "enh-awaiting-badge";
        card.appendChild(badge);
      }
      if (badge.textContent !== badgeText) badge.textContent = badgeText;

      let actions = card.querySelector(".enh-awaiting-card-actions");
      let desiredHtml = "";
      if (needsApprove) {
        desiredHtml = `
            <button type="button" class="btn primary small" data-enh-resume="${esc(
              id
            )}" data-purpose="${purpose}">Finish approval</button>
            <button type="button" class="btn secondary small" data-enh-discard="${esc(
              id
            )}">Discard</button>`;
      } else if (needsRestore) {
        const r = receipts().find((x) => x.id === id);
        const linkId = purpose === "income" ? r?.linkedIncomeId : r?.linkedExpenseId;
        desiredHtml = linkId
          ? `<button type="button" class="btn primary small" data-enh-restore="${esc(
              linkId
            )}" data-purpose="${purpose}">Restore</button>`
          : "";
      }
      if (!desiredHtml) {
        if (actions) actions.remove();
        return;
      }
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "enh-awaiting-card-actions";
        card.appendChild(actions);
      }
      if (actions.dataset.enhHtml !== desiredHtml) {
        actions.innerHTML = desiredHtml;
        actions.dataset.enhHtml = desiredHtml;
      }
    });
  }

  function refreshUi() {
    renderBanner("income");
    renderBanner("expense");
    decorateGalleryCards("income");
    decorateGalleryCards("expense");
  }

  async function onClick(e) {
    const resume = e.target.closest("[data-enh-resume]");
    if (resume) {
      e.preventDefault();
      e.stopPropagation();
      const id = resume.getAttribute("data-enh-resume");
      const purpose = resume.getAttribute("data-purpose") || "income";
      const receipt =
        (typeof findReceipt === "function" && findReceipt(id)) ||
        receipts().find((r) => r.id === id);
      if (!receipt) {
        notify("Could not find that scan");
        return;
      }
      resumeApproval(receipt, purpose);
      return;
    }

    const discardBtn = e.target.closest("[data-enh-discard]");
    if (discardBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = discardBtn.getAttribute("data-enh-discard");
      if (!id) return;
      if (!window.confirm("Discard this scanned upload? The photo will be removed.")) return;
      try {
        await discardReceipt(id);
        notify("Upload discarded");
        if (typeof refreshAll === "function") await refreshAll();
        else scheduleRefreshUi();
      } catch (err) {
        notify(err.message || "Discard failed");
      }
      return;
    }

    const restoreBtn = e.target.closest("[data-enh-restore]");
    if (restoreBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = restoreBtn.getAttribute("data-enh-restore");
      const purpose = restoreBtn.getAttribute("data-purpose") || "income";
      if (!id) return;
      try {
        restoreBtn.disabled = true;
        await restoreLedger(purpose, id);
        notify("Restored to ledger");
      } catch (err) {
        notify(err.message || "Restore failed");
      } finally {
        // Always refresh — clears a stale banner when the row was already active.
        try {
          if (typeof refreshAll === "function") await refreshAll();
          else scheduleRefreshUi();
        } catch {
          scheduleRefreshUi();
        }
        restoreBtn.disabled = false;
      }
    }
  }

  function wrapRefreshAll() {
    if (typeof globalThis.refreshAll !== "function") return;
    if (globalThis.refreshAll.__haulageAwaitingWrapped) return;
    const prevRefresh = globalThis.refreshAll;
    async function wrappedRefresh() {
      const result = await prevRefresh.apply(this, arguments);
      refreshUi();
      return result;
    }
    wrappedRefresh.__haulageAwaitingWrapped = true;
    globalThis.refreshAll = wrappedRefresh;
  }

  function start() {
    document.addEventListener("click", onClick, true);

    const observe = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      new MutationObserver(() => scheduleRefreshUi()).observe(el, { childList: true, subtree: true });
    };
    observe("income-gallery");
    observe("receipt-gallery");
    observe("income-list");
    observe("expense-list");
    observe("car-expense-list");
    observe("car-receipt-gallery");

    const wrapSetView = () => {
      if (typeof globalThis.setView !== "function") return;
      if (globalThis.setView.__haulageAwaitingWrapped) return;
      const prev = globalThis.setView;
      function awaitingAwareSetView(name) {
        const result = prev.apply(this, arguments);
        if (name === "income" || name === "expenses" || name === "receipts") {
          requestAnimationFrame(scheduleRefreshUi);
        }
        return result;
      }
      awaitingAwareSetView.__haulageAwaitingWrapped = true;
      if (prev.__haulageSupportWrapped) awaitingAwareSetView.__haulageSupportWrapped = true;
      globalThis.setView = awaitingAwareSetView;
    };
    wrapSetView();
    wrapRefreshAll();
    setTimeout(wrapSetView, 0);
    setTimeout(wrapRefreshAll, 0);
    setTimeout(wrapSetView, 500);
    setTimeout(wrapRefreshAll, 500);

    scheduleRefreshUi();
    let ticks = 0;
    const iv = setInterval(() => {
      ticks += 1;
      wrapSetView();
      wrapRefreshAll();
      scheduleRefreshUi();
      if (ticks >= 15) clearInterval(iv);
    }, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Live expense receipt camera with scan-frame guide -------------------
 * Opens rear camera, shows a tall receipt frame overlay (safeguard), captures
 * the framed region, then hands a File to app.js uploadReceiptFile.
 */
(function () {
  "use strict";
  /* global uploadReceiptFile */

  let stream = null;
  let modal = null;

  function notify(msg) {
    if (typeof toast === "function") toast(msg);
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "receipt-camera-modal";
    modal.className = "receipt-camera-modal";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Scan receipt with camera");
    modal.innerHTML = `
      <div class="receipt-camera-stage">
        <video class="receipt-camera-video" id="receipt-camera-video" playsinline muted autoplay></video>
        <div class="receipt-camera-overlay" aria-hidden="true">
          <div class="receipt-camera-frame" id="receipt-camera-frame">
            <span class="receipt-camera-corner tl"></span>
            <span class="receipt-camera-corner tr"></span>
            <span class="receipt-camera-corner bl"></span>
            <span class="receipt-camera-corner br"></span>
          </div>
          <p class="receipt-camera-hint">
            Line the receipt up inside the amber frame — include the
            <strong>top of the slip</strong> and the <strong>date</strong>.
          </p>
        </div>
        <div class="receipt-camera-status" id="receipt-camera-status">Align receipt in frame</div>
        <div class="receipt-camera-toolbar">
          <button type="button" class="btn secondary" id="receipt-camera-cancel">Cancel</button>
          <button type="button" class="receipt-camera-capture" id="receipt-camera-shutter" aria-label="Capture receipt"></button>
          <button type="button" class="btn secondary" id="receipt-camera-flip" hidden>Flip</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#receipt-camera-cancel")?.addEventListener("click", () => closeCamera());
    modal.querySelector("#receipt-camera-shutter")?.addEventListener("click", () => {
      void captureAndUpload();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && !modal.hidden) closeCamera();
    });
    return modal;
  }

  function stopStream() {
    if (!stream) return;
    stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    stream = null;
  }

  function closeCamera() {
    stopStream();
    const video = document.getElementById("receipt-camera-video");
    if (video) video.srcObject = null;
    if (modal) modal.hidden = true;
    document.body.style.overflow = "";
  }

  /**
   * Map the on-screen frame rect into video source pixels (object-fit: cover).
   */
  function frameCropInVideo(video, frameEl) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!(vw > 0 && vh > 0)) return null;

    const stage = video.parentElement;
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frameEl.getBoundingClientRect();

    const stageW = stageRect.width;
    const stageH = stageRect.height;
    const videoAspect = vw / vh;
    const stageAspect = stageW / stageH;

    let drawnW;
    let drawnH;
    let offsetX;
    let offsetY;
    if (videoAspect > stageAspect) {
      // video wider — cropped on sides
      drawnH = stageH;
      drawnW = stageH * videoAspect;
      offsetX = (stageW - drawnW) / 2;
      offsetY = 0;
    } else {
      drawnW = stageW;
      drawnH = stageW / videoAspect;
      offsetX = 0;
      offsetY = (stageH - drawnH) / 2;
    }

    const scaleX = vw / drawnW;
    const scaleY = vh / drawnH;

    const left = (frameRect.left - stageRect.left - offsetX) * scaleX;
    const top = (frameRect.top - stageRect.top - offsetY) * scaleY;
    const width = frameRect.width * scaleX;
    const height = frameRect.height * scaleY;

    const sx = Math.max(0, Math.min(vw, Math.round(left)));
    const sy = Math.max(0, Math.min(vh, Math.round(top)));
    const sw = Math.max(1, Math.min(vw - sx, Math.round(width)));
    const sh = Math.max(1, Math.min(vh - sy, Math.round(height)));
    return { sx, sy, sw, sh };
  }

  async function captureAndUpload() {
    const video = document.getElementById("receipt-camera-video");
    const frame = document.getElementById("receipt-camera-frame");
    const shutter = document.getElementById("receipt-camera-shutter");
    const status = document.getElementById("receipt-camera-status");
    if (!video || !frame || !(video.videoWidth > 0)) {
      notify("Camera is still starting — try again in a moment");
      return;
    }
    if (shutter) shutter.disabled = true;
    if (status) status.textContent = "Capturing…";

    try {
      const crop = frameCropInVideo(video, frame);
      const canvas = document.createElement("canvas");
      if (crop) {
        canvas.width = crop.sw;
        canvas.height = crop.sh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
      } else {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
      }

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not capture photo"))), "image/jpeg", 0.92);
      });
      const file = new File([blob], `receipt-scan-${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });

      closeCamera();
      if (typeof uploadReceiptFile === "function") {
        await uploadReceiptFile(file);
      } else {
        notify("Could not start upload — refresh and try again");
      }
    } catch (err) {
      notify(err.message || "Capture failed");
      if (status) status.textContent = "Align receipt in frame";
      if (shutter) shutter.disabled = false;
    }
  }

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notify("Camera not available in this browser — use Upload file instead");
      document.getElementById("receipt-file")?.click();
      return;
    }

    ensureModal();
    const video = document.getElementById("receipt-camera-video");
    const shutter = document.getElementById("receipt-camera-shutter");
    const status = document.getElementById("receipt-camera-status");
    if (shutter) shutter.disabled = true;
    if (status) status.textContent = "Starting camera…";
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    stopStream();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (status) status.textContent = "Align receipt in frame";
      if (shutter) shutter.disabled = false;
    } catch (err) {
      closeCamera();
      const denied = /NotAllowed|Permission|denied/i.test(String(err && err.name) + err.message);
      notify(
        denied
          ? "Camera permission blocked — allow camera access, or use Upload file"
          : "Could not open camera — use Upload file instead"
      );
      document.getElementById("receipt-file")?.click();
    }
  }

  function start() {
    const btn = document.getElementById("pick-receipt-camera");
    if (!btn) return;
    btn.addEventListener("click", () => {
      void openCamera();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Highlight selected detected-total on multi-total scan confirm -------
 * app.js updates pending.detectedTotals.primary and the amount field on
 * click, but leaves the old .detected-total-primary class on the first row.
 * Re-apply highlight + "Selected" tag so the choice is obvious.
 */
(function () {
  "use strict";

  function ensureSelectedTag(btn) {
    if (!btn || btn.querySelector(".detected-total-selected-tag")) return;
    const tag = document.createElement("span");
    tag.className = "detected-total-selected-tag";
    tag.textContent = "Selected";
    // Place before the amount <strong> when present.
    const amount = btn.querySelector("strong");
    if (amount) btn.insertBefore(tag, amount);
    else btn.appendChild(tag);
  }

  function highlightSelected(list, selectedBtn) {
    if (!list) return;
    list.querySelectorAll("[data-total-idx]").forEach((btn) => {
      ensureSelectedTag(btn);
      const on = btn === selectedBtn;
      btn.classList.toggle("detected-total-primary", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncList(list) {
    if (!list) return;
    const buttons = [...list.querySelectorAll("[data-total-idx]")];
    if (!buttons.length) return;
    buttons.forEach(ensureSelectedTag);
    let selected =
      list.querySelector("[data-total-idx].detected-total-primary") ||
      list.querySelector('[data-total-idx][aria-pressed="true"]');
    if (!selected) selected = buttons[0];
    highlightSelected(list, selected);
  }

  function onClick(e) {
    const btn = e.target.closest("[data-total-idx]");
    if (!btn) return;
    const list = btn.closest(".detected-totals");
    if (!list) return;
    // Run after app.js's own click handler updates pending + amount.
    requestAnimationFrame(() => highlightSelected(list, btn));
  }

  function start() {
    document.addEventListener("click", onClick, false);

    ["income-scan-result", "scan-result"].forEach((id) => {
      const box = document.getElementById(id);
      if (!box) return;
      const mo = new MutationObserver(() => {
        box.querySelectorAll("ul.detected-totals").forEach(syncList);
      });
      mo.observe(box, { childList: true, subtree: true });
      box.querySelectorAll("ul.detected-totals").forEach(syncList);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Dashboard recent activity: newest 10 only ---------------------------
 * app.js already slices, but it samples the first N expenses/income before
 * a global sort — older array order can leave the feed feeling stale/long.
 * Replace with a true newest-10 across all ledger rows (date, then createdAt).
 */
(function () {
  "use strict";
  /* global fmtDate, fmt */

  const LIMIT = 10;

  function moneyAbs(n) {
    if (typeof fmt === "function") return fmt(Math.abs(Number(n) || 0));
    return `$${Math.abs(Number(n) || 0).toFixed(2)}`;
  }

  function dateLabel(d) {
    if (typeof fmtDate === "function") return fmtDate(d);
    return String(d || "—");
  }

  function buildRows() {
    const expenses = (state && state.records && state.records.expenses) || [];
    const income = (state && state.records && state.records.income) || [];
    const rows = [];
    for (const e of expenses) {
      if (!e || e.deletedAt) continue;
      rows.push({
        date: e.date || "",
        createdAt: e.createdAt || e.updatedAt || "",
        type: "Expense",
        desc: e.description || e.vendor || e.category || "Expense",
        amount: -(Number(e.amount) || 0),
      });
    }
    for (const i of income) {
      if (!i || i.deletedAt) continue;
      rows.push({
        date: i.date || "",
        createdAt: i.createdAt || i.updatedAt || "",
        type: "Income",
        desc: i.description || i.entity || i.payer || i.type || "Income",
        amount: Number(i.grossTotal ?? i.amount) || 0,
      });
    }
    rows.sort((a, b) => {
      const byCreated = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      if (byCreated) return byCreated;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    return rows.slice(0, LIMIT);
  }

  function renderLimitedRecentActivity() {
    const el = document.getElementById("recent-activity");
    if (!el) return;
    const rows = buildRows();
    if (!rows.length) {
      el.innerHTML =
        `<p class="muted">No transactions yet — add an expense or scan a receipt.</p>`;
      return;
    }
    el.innerHTML = `
      <p class="muted recent-activity-note">Showing the ${rows.length} most recent upload${rows.length === 1 ? "" : "s"}.</p>
      <table class="data recent-activity-table">
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>${rows
          .map(
            (r) =>
              `<tr><td>${dateLabel(r.date)}</td><td><span class="tag ${
                r.type === "Income" ? "green" : ""
              }">${r.type}</span></td><td>${String(r.desc || "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}</td><td class="amount">${moneyAbs(r.amount)}${
                r.amount < 0 ? " DR" : " CR"
              }</td></tr>`
          )
          .join("")}</tbody>
      </table>`;
  }

  function patch() {
    globalThis.renderRecentActivity = renderLimitedRecentActivity;
    globalThis.renderRecentActivity.__haulageRecent10 = true;
  }

  function start() {
    patch();
    setTimeout(patch, 0);
    setTimeout(patch, 400);
    // Keep the list capped if app.js re-renders the full table first.
    const el = document.getElementById("recent-activity");
    if (el) {
      const mo = new MutationObserver(() => {
        if (el.querySelectorAll("tbody tr").length > LIMIT) {
          renderLimitedRecentActivity();
        }
      });
      mo.observe(el, { childList: true, subtree: true });
    }
    if (typeof globalThis.refreshAll === "function" && !globalThis.refreshAll.__haulageRecent10) {
      const prev = globalThis.refreshAll;
      async function wrapped() {
        const result = await prev.apply(this, arguments);
        patch();
        renderLimitedRecentActivity();
        return result;
      }
      wrapped.__haulageRecent10 = true;
      globalThis.refreshAll = wrapped;
    }
    renderLimitedRecentActivity();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
