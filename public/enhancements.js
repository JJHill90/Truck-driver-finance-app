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
    wirePdfDownload();
    try {
      const me = await apiGet("/auth/me");
      showAuthState(me.user);
      if (me.user && me.user.isAdmin) await loadAdminUsers();
      // Only fetch/show the review banner the first time this session — once on
      // login — so it does not keep reappearing as uploads are added/updated.
      if (!reviewAlreadyShown()) {
        const alertData = await apiGet("/alerts");
        renderAlerts(alertData.alerts, alertData.user);
        markReviewShown();
      }
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

/* --- Per-financial-year selector on the document photo galleries ---------
 * Segments "Expense receipt photos" and "Income document photos" by Australian
 * financial year, with a dropdown (same style as the top-of-screen FY picker)
 * pinned to the top-right of each gallery panel header. Layered on app.js
 * without editing it: the selector is injected into the panel header (a sibling
 * of the gallery container, so app.js re-renders don't wipe it) and matching is
 * done by hiding cards whose FY differs from the selected one.
 */
(function () {
  "use strict";
  /* global getReceiptsWithImages, receiptSummary, formatFinancialYearLabel, getCurrentFinancialYear */

  const GALLERIES = [
    { containerId: "receipt-gallery", purpose: "expense", key: "expense" },
    { containerId: "income-gallery", purpose: "income", key: "income" },
  ];

  // Remembers each gallery's chosen FY ("all" or e.g. "2025-26"); null = not set.
  const chosenFy = { expense: null, income: null };

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

  /** FY of a receipt, using the same date app.js shows on the card. */
  function receiptFy(receipt) {
    if (!receipt) return null;
    let date = null;
    try {
      if (typeof receiptSummary === "function") date = receiptSummary(receipt).date;
    } catch {
      date = null;
    }
    if (!date) date = (receipt.ocrResult && receipt.ocrResult.date) || receipt.createdAt || null;
    return fyForDate(date);
  }

  function fyLabel(fy) {
    try {
      if (typeof formatFinancialYearLabel === "function") return formatFinancialYearLabel(fy);
    } catch {
      /* fall through */
    }
    return `FY ${fy}`;
  }

  /** Options: "All", then every FY present in this gallery + current + top FY. */
  function optionsHtml(purpose, selected) {
    const set = new Set();
    let list = [];
    try {
      if (typeof getReceiptsWithImages === "function") list = getReceiptsWithImages(purpose) || [];
    } catch {
      list = [];
    }
    for (const r of list) {
      const fy = receiptFy(r);
      if (fy) set.add(fy);
    }
    try {
      if (typeof getCurrentFinancialYear === "function") set.add(getCurrentFinancialYear());
    } catch {
      /* ignore */
    }
    if (state && state.financialYear) set.add(state.financialYear);
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

    let picker = header.querySelector(".gallery-fy-picker");
    if (!picker) {
      picker = document.createElement("div");
      picker.className = "fy-picker gallery-fy-picker";
      picker.innerHTML =
        `<label for="gallery-fy-${cfg.key}">Financial year</label>` +
        `<select id="gallery-fy-${cfg.key}" class="gallery-fy-select" aria-label="Filter document photos by financial year"></select>`;
      header.appendChild(picker);
      const select = picker.querySelector("select");
      select.addEventListener("change", () => {
        chosenFy[cfg.key] = select.value;
        applyFilter(cfg);
      });
    }

    if (!panel.querySelector(".gallery-fy-empty")) {
      const note = document.createElement("p");
      note.className = "muted gallery-fy-empty hidden";
      container.insertAdjacentElement("afterend", note);
    }
    return picker.querySelector("select");
  }

  function applyFilter(cfg) {
    const container = document.getElementById(cfg.containerId);
    if (!container) return;
    const select = ensureSelector(cfg);
    if (!select) return;

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

    const cards = container.querySelectorAll(
      ".receipt-card[data-receipt-card], .receipt-card[data-receipt-id]"
    );
    let total = 0;
    let shown = 0;
    cards.forEach((card) => {
      total += 1;
      const id = card.dataset.receiptCard || card.dataset.receiptId;
      const fy = receiptFy(findReceipt(id));
      const match = active === "all" || fy === active;
      card.style.display = match ? "" : "none";
      if (match) shown += 1;
    });

    const panel = container.closest(".panel");
    const note = panel && panel.querySelector(".gallery-fy-empty");
    if (note) {
      if (total > 0 && shown === 0) {
        const kind = cfg.purpose === "income" ? "income documents" : "expense receipts";
        const where = active === "all" ? "any financial year" : `FY ${active.replace("-", "–")}`;
        note.textContent = `No ${kind} for ${where}. Switch the financial year above to see others.`;
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

  /** Month dropdown within the selected FY — shortens long ledgers. */
  function ensureMonthPicker(cfg) {
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

  /** Show only the selected FY (+ optional month) rows and recompute totals. */
  function applyLedgerFilters(cfg) {
    const list = document.getElementById(cfg.listId);
    if (!list) return;
    const table = list.querySelector(cfg.tableSel);
    if (!table) return;
    const panel = list.closest(".panel");
    const fySelect = panel && panel.querySelector(".ledger-fy-select");
    const monthSelect = panel && panel.querySelector(".ledger-month-select");
    if (fySelect) syncFyOptions(fySelect);
    if (monthSelect) syncMonthOptions(cfg, monthSelect);

    const fy = currentFy();
    if (!fy) return;
    const month = getMonthFilter(cfg.type);

    let sum = 0;
    let shown = 0;
    let total = 0;
    table.querySelectorAll(`tbody tr[${cfg.idAttr}]`).forEach((tr) => {
      total += 1;
      const id = tr.getAttribute(cfg.idAttr);
      const isDraft = id === "__draft__" || tr.classList.contains("draft-row");
      const entry = findEntry(cfg.type, id);
      let match = isDraft || (entry && fyForDate(entry.date) === fy);
      if (match && !isDraft && month !== "all" && entry) {
        match = entryMonthKey(entry.date) === month;
      }
      tr.style.display = match ? "" : "none";
      if (match) {
        shown += 1;
        if (entry) sum += Number(entry.amount) || 0;
      }
    });

    updateLedgerTotal(cfg, table, fy, month, sum);
    updateEmptyNote(cfg, panel, fy, month, shown, total);
  }

  function monthLabel(fy, month) {
    if (!month || month === "all") {
      return `Financial year total (FY ${String(fy).replace("-", "–")})`;
    }
    const hit = monthsForFy(fy).find((m) => m.value === month);
    return hit ? `${hit.label} total` : `Month total (${month})`;
  }

  function updateLedgerTotal(cfg, table, fy, month, sum) {
    const label = monthLabel(fy, month);
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

  function updateEmptyNote(cfg, panel, fy, month, shown, total) {
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
      if (month && month !== "all") {
        const hit = monthsForFy(fy).find((m) => m.value === month);
        note.textContent = `No ${kind} for ${hit ? hit.label : month}. Choose “All year” or another month.`;
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
      const cats =
        (state.standards &&
          (state.standards.specialClaimCategories || state.standards.categories)) ||
        [];
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
    applyLedgerFilters(cfg);
    hideOutsidePeriodTags(cfg);
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* --- Allowance caps: one daily lump sum (AEST) -----------------------------
 * Replaces the static daily-cap list in #allowance-caps with a single combined
 * "daily allowance vs today's spend" readout. All ATO meal/travel category
 * daily caps are summed into one lump; spend is the sum of matching receipts
 * dated today in Australia/Sydney. Totals reset at 00:00 AEST each day.
 * Layered over app.js (kept verbatim) by taking over #allowance-caps.
 */
(function () {
  "use strict";

  const AEST_TZ = "Australia/Sydney";

  // Allowance categories → how to read their daily cap from summary.allowances.
  // Meals are one combined daily cap (breakfast+lunch+dinner); spend uses `meals`
  // plus any legacy breakfast/lunch/dinner rows still on file.
  const CATS = [
    {
      id: "meals",
      spendIds: ["meals", "meals_breakfast", "meals_lunch", "meals_dinner"],
      cap: (a) => {
        const m = a && a.truckDriverMealsDaily;
        if (!m) return 0;
        return (
          (Number(m.breakfast && m.breakfast.cap) || 0) +
          (Number(m.lunch && m.lunch.cap) || 0) +
          (Number(m.dinner && m.dinner.cap) || 0)
        );
      },
    },
    { id: "overtime_meals", spendIds: ["overtime_meals"], cap: (a) => a && a.overtimeMealCap },
    { id: "accommodation", spendIds: ["accommodation"], cap: (a) => a && a.domesticTravelCaps && a.domesticTravelCaps.accommodation },
    { id: "incidentals", spendIds: ["incidentals"], cap: (a) => a && a.domesticTravelCaps && a.domesticTravelCaps.incidentals },
  ];
  const SPEND_IDS = new Set(CATS.flatMap((c) => c.spendIds));

  let midnightTimer = null;
  let renderedAestDay = null;

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

  /** Milliseconds until the next calendar day starts in Australia/Sydney. */
  function msUntilNextAestMidnight() {
    const today = aestIsoOf();
    let lo = 0;
    let hi = 26 * 60 * 60 * 1000; // cover DST 25h days
    const now = Date.now();
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (aestIsoOf(new Date(now + mid)) === today) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(lo, 1000);
  }

  function computeDaily() {
    let expenses = [];
    let allowances = {};
    try {
      expenses = (state.records && state.records.expenses) || [];
      allowances = (state.summary && state.summary.allowances) || {};
    } catch {
      expenses = [];
    }
    const today = aestIsoOf();
    const dailyAllow = CATS.reduce((s, c) => s + (Number(c.cap(allowances)) || 0), 0);
    const spend = expenses
      .filter((e) => SPEND_IDS.has(e.category) && String(e.date || "").slice(0, 10) === today)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return { today, dailyAllow, spend };
  }

  function scheduleMidnightReset(container) {
    if (midnightTimer) {
      clearTimeout(midnightTimer);
      midnightTimer = null;
    }
    midnightTimer = setTimeout(() => {
      midnightTimer = null;
      if (container.isConnected) {
        render(container);
        scheduleMidnightReset(container);
      }
    }, msUntilNextAestMidnight());
  }

  function render(container) {
    const { today, dailyAllow, spend } = computeDaily();
    renderedAestDay = today;
    const remaining = dailyAllow - spend;
    const over = spend > dailyAllow;
    const tag = over
      ? ' <span class="tag amber">over</span>'
      : spend > 0
        ? ' <span class="tag green">within</span>'
        : "";

    container.innerHTML = `
      <div class="allowance-vs-spend cap-list">
        <div class="cap-row allowance-total">
          <span><strong>Daily allowance</strong> <small class="muted">combined ATO caps · ${today} AEST</small></span>
          <span><strong>${money(dailyAllow)}</strong></span>
        </div>
        <div class="cap-row allowance-total">
          <span><strong>Today's spend</strong> <small class="muted">resets 00:00 AEST</small></span>
          <span><strong>${money(spend)}</strong>${tag}</span>
        </div>
        <div class="cap-row allowance-total">
          <span>${over ? "Over allowance" : "Remaining today"}</span>
          <span class="${over ? "amount-over" : "amount-under"}">${money(Math.abs(remaining))}</span>
        </div>
        <p class="muted allowance-hint">One daily lump sum: food/meals (combined), overtime meal, accommodation and incidentals caps. Spend counts receipts in those categories dated today (Australia/Sydney); the total resets at midnight AEST.</p>
      </div>
    `;
    scheduleMidnightReset(container);
  }

  function maybeRender() {
    const container = document.getElementById("allowance-caps");
    if (!container) return;
    const today = aestIsoOf();
    // Take over once app.js has populated the panel; also re-render after AEST day rollover.
    if (container.querySelector(".allowance-vs-spend") && renderedAestDay === today) return;
    if (!container.children.length) return;
    render(container);
  }

  function start() {
    const container = document.getElementById("allowance-caps");
    if (!container) return;
    new MutationObserver(maybeRender).observe(container, { childList: true });
    maybeRender();
    let ticks = 0;
    const iv = setInterval(() => {
      ticks += 1;
      maybeRender();
      if (ticks >= 10) clearInterval(iv);
    }, 400);
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

/* --- Keep Special claims (+ Profile preset) on the filtered category menu --
 * app.js fills #expense-category from state.standards.categories already; this
 * layer re-applies the same filtered/renamed list (preferring
 * specialClaimCategories from /standards) and keeps the Profile default
 * category select in sync.
 */
(function () {
  "use strict";

  function fillSelect(sel, html, { allowEmptyLabel } = {}) {
    if (!sel) return;
    const prev = sel.value;
    const body = allowEmptyLabel
      ? html.replace(/^<option value="">Choose category…<\/option>/, '<option value="">None</option>')
      : html;
    sel.innerHTML = body;
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function applyFilteredCategoryMenus() {
    const appState = globalThis.state;
    const buildOpts = globalThis.buildCategorySelectOptions;
    if (!appState || !appState.standards || typeof buildOpts !== "function") return;

    const cats =
      (appState.standards.specialClaimCategories && appState.standards.specialClaimCategories.length
        ? appState.standards.specialClaimCategories
        : appState.standards.categories) || [];
    if (!cats.length) return;

    const html = buildOpts(cats, appState.standards.categoryGroups);

    // Special claims (km / laundry) — same filtered menu as manual expenses
    fillSelect(document.getElementById("expense-category"), html);

    // Manual expense entry (keep in sync if standards were refreshed)
    fillSelect(document.getElementById("manual-receipt-category"), html);

    // Profile default category
    fillSelect(document.getElementById("preset-category"), html, { allowEmptyLabel: true });
  }

  function patchPopulate() {
    const orig = globalThis.populateCategorySelects;
    if (typeof orig !== "function") return;
    globalThis.populateCategorySelects = function patchedPopulateCategorySelects() {
      orig.apply(this, arguments);
      applyFilteredCategoryMenus();
    };
  }

  function start() {
    patchPopulate();
    applyFilteredCategoryMenus();
    let ticks = 0;
    const iv = setInterval(() => {
      ticks += 1;
      applyFilteredCategoryMenus();
      if (ticks >= 15) clearInterval(iv);
    }, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
