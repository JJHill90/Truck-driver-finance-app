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
    if (!root) return;
    root.querySelectorAll(".overnight-title").forEach((el) => {
      el.textContent = "Work travel nights";
    });
    root.querySelectorAll(".overnight-stat").forEach((el) => {
      el.innerHTML = el.innerHTML
        .replace(/Travel \/ LAFHA days claimed YTD/g, "Work travel nights claimed YTD")
        .replace(/projected EOFY Travel \/ LAFHA days/g, "projected EOFY work travel nights");
    });
    root.querySelectorAll(".overnight-hint, .overnight-meta, summary").forEach((el) => {
      el.textContent = String(el.textContent || "")
        .replace(/Travel \/ Living Away from Home \(LAFHA\)/g, "work travel")
        .replace(/Living Away from Home days/g, "Work travel nights")
        .replace(/LAFHA/g, "travel")
        .replace(/truck-driver meal rate/g, "ATO reasonable travel meal rate")
        .replace(/Travel\/LAFHA/g, "work travel");
    });
  }

  function watchOvernight() {
    const ids = ["dashboard-overnight-box", "forecast-overnight-box"];
    ids.forEach((id) => {
      const el = byId(id);
      if (!el) return;
      relabelOvernight(el);
      new MutationObserver(() => relabelOvernight(el)).observe(el, { childList: true, subtree: true });
    });
  }

  function relabelScanCopy() {
    document.body.addEventListener(
      "DOMNodeInserted",
      () => {
        /* deprecated; observer below */
      },
      false
    );
    new MutationObserver(() => {
      document.querySelectorAll("label, p, h3, h4, summary").forEach((el) => {
        const t = el.textContent || "";
        if (/Living Away from Home|LAFHA/.test(t) && !el.dataset.gotaxRelabelled) {
          el.dataset.gotaxRelabelled = "1";
          el.innerHTML = el.innerHTML
            .replace(/Living Away from Home days \(LAFHA\)/g, "Work travel nights")
            .replace(/Living Away from Home \/ Travel allowance/g, "Travel allowance")
            .replace(/Travel \/ LAFHA allowance/g, "Travel allowance")
            .replace(/LAFHA/g, "travel");
        }
      });
    }).observe(document.body, { childList: true, subtree: true });
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
    const TITLE_MAP = {
      "Driver profile": "Taxpayer profile",
      "Driver Profile": "Taxpayer profile",
    };
    const title = byId("page-title");
    if (title && TITLE_MAP[title.textContent]) title.textContent = TITLE_MAP[title.textContent];
    document.querySelectorAll("#view-report h3").forEach((h) => {
      if (/Line ?[Hh]aul|Driver/.test(h.textContent || "")) {
        h.textContent = (h.textContent || "")
          .replace(/Linehaul Driver – Performance & Tax Summary/g, "Go Taxation Suite – Performance & Tax Summary")
          .replace(/Line Haulage Driver/g, "Taxpayer");
      }
    });
  }

  function start() {
    watchOvernight();
    relabelScanCopy();
    injectHomeOfficeHours();
    byId("driver-type")?.addEventListener("change", syncEntityFields);
    syncEntityFields();
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
    setInterval(patchTitles, 1500);
    patchTitles();

    // If enhancements shows the hub picker, continue into the shell.
    const picker = byId("title-hub-picker");
    if (picker) {
      new MutationObserver(() => {
        if (!picker.classList.contains("hidden") && document.body.classList.contains("auth-locked")) {
          byId("hub-open-taxationhub")?.click();
        }
      }).observe(picker, { attributes: true, attributeFilter: ["class"] });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
