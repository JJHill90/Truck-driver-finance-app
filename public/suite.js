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
    if (title.textContent === "Work travel nights" || title.textContent === "Work-related claims") {
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

  function setFlagInput(form, name, checked) {
    let hidden = form.querySelector(`input[name="${name}"][type="hidden"]`);
    if (!hidden) {
      hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = name;
      form.appendChild(hidden);
    }
    hidden.value = checked ? "true" : "false";
  }

  function syncTravelFields() {
    const travel = byId("profile-travels-for-work");
    const wrap = byId("profile-overnight-wrap");
    const nights = byId("profile-overnight-allowance");
    const on = Boolean(travel && travel.checked);
    if (wrap) wrap.hidden = !on;
    if (!on && nights) nights.checked = false;
  }

  function occupationHint(occ) {
    const el = byId("suite-occupation-travel-hint");
    if (!el) return;
    if (!occ) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = occ.typicalOvernight
      ? `${occ.label || occ.name} commonly involves overnight work travel. ${occ.travelHint || ""} Tick the boxes below if that matches you.`
      : `${occ.label || occ.name} does not usually involve an overnight travel allowance. ${occ.travelHint || ""}`;
  }

  function wireOccupationTypeahead() {
    const input = byId("profile-occupation");
    const list = byId("profile-occupation-suggestions");
    const idEl = byId("profile-occupation-id");
    if (!input || !list) return;
    let timer = null;

    const hide = () => {
      list.hidden = true;
      list.innerHTML = "";
    };

    const pick = (occ) => {
      input.value = occ.name || "";
      if (idEl) idEl.value = occ.id || "";
      occupationHint(occ);
      hide();
    };

    input.addEventListener("input", () => {
      if (idEl) idEl.value = "";
      clearTimeout(timer);
      const q = input.value.trim();
      timer = setTimeout(async () => {
        try {
          const res = await fetch(
            `${window.location.origin}/api/haulage/occupations?q=${encodeURIComponent(q)}&limit=20`,
            { credentials: "same-origin" }
          );
          const data = await res.json().catch(() => ({}));
          const rows = Array.isArray(data.occupations) ? data.occupations : [];
          if (!rows.length) {
            hide();
            occupationHint(null);
            return;
          }
          list.innerHTML = rows
            .map(
              (o) =>
                `<li role="option"><button type="button" data-occ-id="${o.id}">${o.label || o.name}</button></li>`
            )
            .join("");
          list.hidden = false;
          list.querySelectorAll("button[data-occ-id]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const occ = rows.find((r) => r.id === btn.getAttribute("data-occ-id"));
              if (occ) pick(occ);
            });
          });
        } catch {
          hide();
        }
      }, 180);
    });

    input.addEventListener("blur", () => setTimeout(hide, 200));
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
        setFlagInput(form, "travelsForWork", Boolean(byId("profile-travels-for-work")?.checked));
        setFlagInput(form, "overnightAllowance", Boolean(byId("profile-overnight-allowance")?.checked));
      },
      true
    );
    let userEditedTravel = false;
    byId("profile-travels-for-work")?.addEventListener("change", () => {
      userEditedTravel = true;
      syncTravelFields();
    });
    byId("profile-overnight-allowance")?.addEventListener("change", () => {
      userEditedTravel = true;
    });
    syncTravelFields();
    wireOccupationTypeahead();
    const fillTravel = () => {
      if (userEditedTravel) return;
      try {
        const p = typeof globalThis.state !== "undefined" && globalThis.state.records && globalThis.state.records.profile;
        if (!p) return;
        const travel = byId("profile-travels-for-work");
        const nights = byId("profile-overnight-allowance");
        if (travel) travel.checked = Boolean(p.travelsForWork);
        if (nights) nights.checked = Boolean(p.overnightAllowance);
        if (byId("profile-occupation-id") && p.occupationId) {
          byId("profile-occupation-id").value = p.occupationId;
        }
        syncTravelFields();
      } catch {
        /* ignore */
      }
    };
    fillTravel();
    setTimeout(fillTravel, 600);
    setTimeout(fillTravel, 1800);

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

    wireExtraEntity();
    wirePartnershipSeat();
  }

  function api(path, opts) {
    return fetch(`${window.location.origin}/api/haulage${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    });
  }

  function currentProfile() {
    try {
      return (
        (typeof globalThis.state !== "undefined" &&
          globalThis.state.records &&
          globalThis.state.records.profile) ||
        {}
      );
    } catch {
      return {};
    }
  }

  function renderExtraEntity(profile) {
    const extras = Array.isArray(profile.extraEntities) ? profile.extraEntities : [];
    const extra = extras[0] || null;
    const typeEl = byId("extra-entity-type");
    const nameEl = byId("extra-entity-name");
    const abnEl = byId("extra-entity-abn");
    const salaryEl = byId("extra-entity-salary");
    const gstEl = byId("extra-entity-gst");
    const status = byId("extra-entity-status");
    const active = byId("extra-entity-active");
    const remove = byId("extra-entity-remove");
    if (extra) {
      if (typeEl) typeEl.value = extra.entityType || "sole_trader";
      if (nameEl) nameEl.value = extra.tradingName || "";
      if (abnEl) abnEl.value = extra.abn || "";
      if (salaryEl) salaryEl.value = extra.annualSalary || "";
      if (gstEl) gstEl.checked = Boolean(extra.gstRegistered);
      if (remove) remove.classList.remove("hidden");
    } else if (remove) {
      remove.classList.add("hidden");
    }
    if (status) {
      status.textContent = extra
        ? `Saved extra entity: ${extra.tradingName || extra.entityType}.`
        : "Pro+ unlocks one extra entity on this login.";
    }
    if (active) {
      const id = profile.activeEntityId || "primary";
      active.textContent =
        id === "primary" || !extra
          ? "Active records: primary taxpayer profile."
          : `Active records: extra entity (${extra.tradingName || extra.entityType}).`;
    }
  }

  function wireExtraEntity() {
    const form = byId("extra-entity-form");
    if (!form || form.dataset.wired === "1") return;
    form.dataset.wired = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const existing = (currentProfile().extraEntities || [])[0] || {};
        await api("/profile/extra-entity", {
          method: "POST",
          body: JSON.stringify({
            id: existing.id,
            entityType: byId("extra-entity-type")?.value || "sole_trader",
            tradingName: byId("extra-entity-name")?.value || "",
            abn: byId("extra-entity-abn")?.value || "",
            annualSalary: byId("extra-entity-salary")?.value || 0,
            gstRegistered: Boolean(byId("extra-entity-gst")?.checked),
          }),
        });
        if (window.toast) window.toast("Extra entity saved");
        if (typeof globalThis.loadRecords === "function") globalThis.loadRecords();
      } catch (err) {
        if (window.toast) window.toast(err.message || "Could not save extra entity");
      }
    });
    byId("extra-entity-switch")?.addEventListener("click", async () => {
      const extra = (currentProfile().extraEntities || [])[0];
      const next =
        currentProfile().activeEntityId && currentProfile().activeEntityId !== "primary"
          ? "primary"
          : extra && extra.id;
      if (!next) {
        if (window.toast) window.toast("Save an extra entity first");
        return;
      }
      try {
        await api("/profile", {
          method: "PUT",
          body: JSON.stringify({ activeEntityId: next }),
        });
        if (window.toast) window.toast("Active entity updated");
        if (typeof globalThis.loadRecords === "function") globalThis.loadRecords();
      } catch (err) {
        if (window.toast) window.toast(err.message || "Could not switch entity");
      }
    });
    byId("extra-entity-remove")?.addEventListener("click", async () => {
      const extra = (currentProfile().extraEntities || [])[0];
      if (!extra) return;
      try {
        await api(`/profile/extra-entity/${encodeURIComponent(extra.id)}`, { method: "DELETE" });
        if (window.toast) window.toast("Extra entity removed");
        if (typeof globalThis.loadRecords === "function") globalThis.loadRecords();
      } catch (err) {
        if (window.toast) window.toast(err.message || "Could not remove extra entity");
      }
    });
    const fill = () => renderExtraEntity(currentProfile());
    fill();
    setTimeout(fill, 800);
    setTimeout(fill, 2000);
  }

  function renderPartnership(data) {
    const status = byId("partnership-seat-status");
    const revoke = byId("partner-seat-revoke");
    if (!status) return;
    if (data && data.isPartner) {
      status.textContent = `You are seated on ${data.owner || "a partner"}'s partnership ledger.`;
      if (revoke) revoke.classList.add("hidden");
      return;
    }
    if (data && data.partner) {
      status.textContent = `Second seat: ${data.partner}`;
      if (revoke) revoke.classList.remove("hidden");
    } else {
      status.textContent = "No partner seated yet.";
      if (revoke) revoke.classList.add("hidden");
    }
  }

  function wirePartnershipSeat() {
    const form = byId("partnership-seat-form");
    if (!form || form.dataset.wired === "1") return;
    form.dataset.wired = "1";
    const refresh = async () => {
      try {
        renderPartnership(await api("/suite/partnership"));
      } catch {
        /* ignore */
      }
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const seat = await api("/suite/partnership/invite", {
          method: "POST",
          body: JSON.stringify({ username: byId("partner-seat-username")?.value || "" }),
        });
        renderPartnership(seat);
        if (window.toast) window.toast("Partner seated");
      } catch (err) {
        if (window.toast) window.toast(err.message || "Could not invite partner");
      }
    });
    byId("partner-seat-revoke")?.addEventListener("click", async () => {
      try {
        renderPartnership(await api("/suite/partnership/revoke", { method: "POST", body: "{}" }));
        if (window.toast) window.toast("Partner seat removed");
      } catch (err) {
        if (window.toast) window.toast(err.message || "Could not remove seat");
      }
    });
    refresh();
    setTimeout(refresh, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
