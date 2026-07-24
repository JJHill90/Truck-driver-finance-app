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
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
    const options = args[1] || {};

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
      return res;
    }

    return origFetch.apply(this, args);
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

  function showAuthState(user) {
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
              <div class="admin-user-meta">${esc(u.profileName || "No driver name")} · ${counts.expenses || 0} expenses · ${counts.income || 0} income · ${counts.receipts || 0} receipts · joined ${fmtDate(u.createdAt)}</div>
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
        setAdminCreateMessage("Creating profile…");
        try {
          const data = await apiPost("/admin/users", { username, password });
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

  async function start() {
    wire();
    wirePdfDownload();
    try {
      const me = await apiGet("/auth/me");
      showAuthState(me.user);
      if (me.user && me.user.isAdmin) await loadAdminUsers();
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
