/**
 * Go Taxation Suite overlay. Loads after app.js + enhancements.js.
 * Keeps the same tabs and DOM contract; relabels truck-specific chrome and
 * injects general taxpayer fields. Sets gotax_product so /api/haulage uses
 * the general ATO engine.
 */
(function () {
  "use strict";

  document.cookie = "gotax_product=1; path=/; SameSite=Lax; Max-Age=31536000";
  document.body.classList.add("gotax-suite");
  try {
    localStorage.setItem("driverhub-selected-app", "taxationhub");
  } catch {
    /* ignore */
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function relabelOvernight(root) {
    if (!root || root.dataset.gotaxOvernight === "1") return;
    const title = root.querySelector(".overnight-title");
    if (!title) return;
    if (title.textContent === "Work travel nights") {
      root.dataset.gotaxOvernight = "1";
      return;
    }
    title.textContent = "Work travel nights";
    root.querySelectorAll(".overnight-stat, .overnight-hint, .overnight-meta, summary").forEach((el) => {
      const next = String(el.textContent || "")
        .replace(/Travel \/ Living Away from Home \(LAFHA\)/g, "work travel")
        .replace(/Living Away from Home days/g, "Work travel nights")
        .replace(/LAFHA/g, "travel")
        .replace(/truck-driver meal rate/g, "ATO reasonable travel meal rate")
        .replace(/Travel\/LAFHA/g, "work travel")
        .replace(/Travel \/ LAFHA days claimed YTD/g, "Work travel nights claimed YTD")
        .replace(/projected EOFY Travel \/ LAFHA days/g, "projected EOFY work travel nights");
      if (next !== el.textContent) el.textContent = next;
    });
    root.dataset.gotaxOvernight = "1";
  }

  function watchOvernight() {
    ["dashboard-overnight-box", "forecast-overnight-box"].forEach((id) => {
      const el = byId(id);
      if (!el) return;
      relabelOvernight(el);
      new MutationObserver(() => {
        el.dataset.gotaxOvernight = "";
        relabelOvernight(el);
      }).observe(el, { childList: true });
    });
  }

  function relabelScanCopy(root) {
    (root || document).querySelectorAll("label, p, h3, h4, summary").forEach((el) => {
      if (el.dataset.gotaxRelabelled) return;
      const t = el.textContent || "";
      if (!/Living Away from Home|LAFHA/.test(t)) return;
      el.dataset.gotaxRelabelled = "1";
      el.innerHTML = el.innerHTML
        .replace(/Living Away from Home days \(LAFHA\)/g, "Work travel nights")
        .replace(/Living Away from Home \/ Travel allowance/g, "Travel allowance")
        .replace(/Travel \/ LAFHA allowance/g, "Travel allowance")
        .replace(/LAFHA/g, "travel");
    });
  }

  function syncEntityFields() {
    const select = byId("driver-type");
    const hint = byId("suite-entity-hint");
    const entity = select && select.value ? select.value : "employee";
    document.body.classList.toggle("gotax-entity-business", entity !== "employee");
    if (hint) {
      if (entity === "sole_trader") {
        hint.textContent =
          "Sole trader: record business sales/fees as income and business costs as expenses. GST-registered traders should tick GST and keep activity-statement amounts.";
      } else if (entity === "partnership") {
        hint.textContent =
          "Partnership: record your share of partnership net income (and any partner salary). The partnership itself is not taxed.";
      } else {
        hint.textContent =
          "Employee (PAYG): salary and allowances are assessable. Claim only work-related deductions with a sufficient connection to your job. Super Guarantee is paid by the employer.";
      }
    }
  }

  function injectHomeOfficeHours() {
    const form = byId("expense-form") || document.querySelector("#view-expenses form");
    if (!form || byId("suite-home-office-hours")) return;
    const wrap = document.createElement("label");
    wrap.id = "suite-home-office-hours-wrap";
    wrap.className = "gotax-hidden";
    wrap.innerHTML =
      'Hours worked from home<input type="number" name="homeOfficeHours" id="suite-home-office-hours" min="0" step="0.5" placeholder="e.g. 800" />';
    form.appendChild(wrap);
    const toggle = () => {
      const sel = form.querySelector("select[name='category'], #expense-category");
      const id = sel && sel.value;
      wrap.classList.toggle("gotax-hidden", id !== "home_office_hours");
    };
    form.addEventListener("change", toggle);
    setTimeout(toggle, 500);
  }

  function patchTitles() {
    const title = byId("page-title");
    if (title && /driver profile/i.test(title.textContent || "")) {
      title.textContent = "Taxpayer profile";
    }
    document.querySelectorAll("#view-report h3").forEach((h) => {
      const t = h.textContent || "";
      if (/Linehaul|Line Haulage/i.test(t) && !h.dataset.gotaxTitle) {
        h.dataset.gotaxTitle = "1";
        h.textContent = t
          .replace(/Linehaul Driver – Performance & Tax Summary/g, "Go Taxation Suite – Performance & Tax Summary")
          .replace(/Line Haulage Driver/g, "Taxpayer");
      }
    });
  }

  function start() {
    watchOvernight();
    relabelScanCopy(document);
    injectHomeOfficeHours();
    byId("driver-type")?.addEventListener("change", syncEntityFields);
    syncEntityFields();
    setInterval(patchTitles, 2000);
    patchTitles();

    const form = byId("profile-form");
    form?.addEventListener(
      "submit",
      () => {
        let hidden = form.querySelector('input[name="gstRegistered"][type="hidden"]');
        if (!hidden) {
          hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = "gstRegistered";
          form.appendChild(hidden);
        }
        hidden.value = byId("profile-gst-registered")?.checked ? "true" : "false";
      },
      true
    );

    const picker = byId("title-hub-picker");
    let opened = false;
    if (picker) {
      const tryOpen = () => {
        if (opened) return;
        if (!picker.classList.contains("hidden") && document.body.classList.contains("auth-locked")) {
          opened = true;
          byId("hub-open-taxationhub")?.click();
        }
      };
      tryOpen();
      new MutationObserver(tryOpen).observe(picker, { attributes: true, attributeFilter: ["class"] });
    }

    new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 1) relabelScanCopy(node);
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
