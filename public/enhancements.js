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

  // --- Capture enriched scan responses by wrapping fetch ------------------
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (url && /\/receipts\/scan(\?|$)/.test(url)) {
        let purpose = "expense";
        try {
          const body = args[1] && args[1].body;
          if (body) purpose = JSON.parse(body).purpose === "income" ? "income" : "expense";
        } catch {
          /* ignore body parse */
        }
        const data = await res.clone().json();
        const mimeType = (data.receipt && data.receipt.mimeType) || "";
        latest = {
          breakdown: data.componentBreakdown || [],
          compliance: data.compliance || null,
          payPeriod: data.payPeriod || null,
          purpose,
          receiptId: data.receipt && data.receipt.id,
          isPdf: /pdf/i.test(mimeType),
          token: `${Date.now()}-${Math.random()}`,
        };
      }
    } catch {
      /* non-fatal */
    }
    return res;
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
    wrap.innerHTML = `${payPeriodHtml}${breakdownHtml}${complianceHtml}
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
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function apiGet(path) {
    const res = await fetch(`${API}${path}`, { credentials: "same-origin" });
    return res.json().catch(() => ({}));
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

  function showAuthState(user) {
    const outEl = byId("auth-logged-out");
    const inEl = byId("auth-logged-in");
    if (!outEl || !inEl) return;
    if (user && user.username) {
      outEl.classList.add("hidden");
      inEl.classList.remove("hidden");
      const nameEl = byId("auth-current-user");
      if (nameEl) nameEl.textContent = user.username;
      const presets = user.presets || {};
      if (byId("preset-workuse")) byId("preset-workuse").value = presets.defaultWorkUsePercent ?? "";
      if (byId("preset-category")) byId("preset-category").value = presets.defaultCategory ?? "";
    } else {
      outEl.classList.remove("hidden");
      inEl.classList.add("hidden");
    }
  }

  function renderAlerts(alerts, user) {
    const main = document.querySelector(".main");
    if (!main) return;
    let bar = byId("enh-alerts");
    if (bar) bar.remove();
    if (!alerts || !alerts.length) return;
    bar = document.createElement("div");
    bar.id = "enh-alerts";
    bar.className = "enh-alerts";
    const items = alerts
      .map(
        (a) =>
          `<li class="enh-alert enh-alert-${esc(a.level || "info")}">${esc(a.message)}</li>`
      )
      .join("");
    const who = user ? `Signed in as ${esc(user)}` : "Guest (create a profile to save your data)";
    bar.innerHTML = `
      <div class="enh-alerts-head">
        <strong>Review needed</strong>
        <span class="muted">${who}</span>
        <button type="button" class="enh-alerts-close" aria-label="Dismiss">×</button>
      </div>
      <ul class="enh-alerts-list">${items}</ul>`;
    bar.querySelector(".enh-alerts-close").addEventListener("click", () => bar.remove());
    const topbar = main.querySelector(".topbar");
    if (topbar && topbar.nextSibling) main.insertBefore(bar, topbar.nextSibling);
    else main.insertBefore(bar, main.firstChild);
  }

  function readCreds() {
    return {
      username: (byId("auth-username") || {}).value || "",
      password: (byId("auth-password") || {}).value || "",
    };
  }

  function wire() {
    const register = byId("auth-register");
    const login = byId("auth-login");
    const logout = byId("auth-logout");
    const savePresets = byId("auth-save-presets");

    if (register) {
      register.addEventListener("click", async () => {
        setMessage("Creating profile…");
        try {
          await apiPost("/auth/register", readCreds());
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
        window.location.reload();
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

  async function start() {
    wire();
    wirePdfDownload();
    try {
      const me = await apiGet("/auth/me");
      showAuthState(me.user);
      const alertData = await apiGet("/alerts");
      renderAlerts(alertData.alerts, alertData.user);
    } catch {
      /* non-fatal */
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

    // Preserve the substantiation message + any warnings app.js just wrote.
    const msg = (host.querySelector("p.muted") && host.querySelector("p.muted").textContent) || "";
    const warn = (host.querySelector(".warning-list") && host.querySelector(".warning-list").outerHTML) || "";
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
