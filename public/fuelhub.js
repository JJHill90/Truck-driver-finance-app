/*
 * Fuel Hub UI — second Driver Hub app (loaded after enhancements.js).
 */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  let state = null;
  let view = "dashboard";
  let lastPlan = null;
  let watchId = null;
  let gpsBusy = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
    return data;
  }

  function toast(msg) {
    if (typeof window.toast === "function") window.toast(msg);
  }

  function profileBanner() {
    const p = state && state.hubProfile;
    if (!p || !p.linked) {
      return `<p class="fuelhub-profile-banner">Sign in on Driver Hub to use the same profile as Taxation Hub.</p>`;
    }
    const bits = [
      p.displayName,
      p.employer,
      p.licenceLabel,
      p.driverTypeLabel,
      p.workCombinationLabel,
    ].filter(Boolean);
    const seed = p.truckSeeded
      ? ` Fuel Hub follows Profile work vehicle and ${esc(p.driverTypeLabel || "linehaul")} duty cycle for L/100 km — save Truck &amp; load only if you need different tanks or payload.`
      : ` Tanks were saved in Fuel Hub; Profile driver type (${esc(p.driverTypeLabel || "linehaul")}) still scales planned L/100 km.`;
    return `<div class="fuelhub-profile-banner">Driver Hub profile · ${bits.map(esc).join(" · ")}.${seed}</div>`;
  }

  function setView(next) {
    view = next;
    const titles = {
      dashboard: "Dashboard",
      profile: "Profile",
      plan: "Plan fills",
      track: "GPS track",
      truck: "Truck & load",
      cards: "Fuel cards",
      prices: "Prices & tables",
    };
    const title = byId("fuelhub-page-title");
    if (title) title.textContent = titles[next] || "Fuel Hub";
    document.querySelectorAll("#fuelhub-shell [data-fuel-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-fuel-view") === next);
    });
    document.querySelectorAll("#fuelhub-shell .fuelhub-view").forEach((el) => {
      el.classList.toggle("active", el.id === `fuel-view-${next}`);
    });
    render();
    if (next === "dashboard") locateForDeals();
  }

  function comboOptions(selected) {
    return (state.combinations || [])
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`
      )
      .join("");
  }

  function schemeOptions(selected) {
    return (state.massSchemes || [])
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`
      )
      .join("");
  }

  function retailerOptions(selected) {
    const rows = [{ id: "any", name: "Any / company-wide" }, ...(state.retailers || [])];
    return rows
      .map(
        (r) =>
          `<option value="${esc(r.id)}" ${r.id === selected ? "selected" : ""}>${esc(r.name)}</option>`
      )
      .join("");
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  }

  function dash() {
    return (state && state.dashboard) || {};
  }

  function renderDashboard() {
    const el = byId("fuel-view-dashboard");
    if (!el) return;
    const d = dash();
    const current = d.currentJourney || {};
    const plan = current.plan || lastPlan;
    const track = current.track || state.activeTrack;
    const trips = d.previousJourneys || state.trips || [];
    const stats = d.journeyStats || {};
    const deals = (d.areaDeals && d.areaDeals.deals) || [];
    const area = d.areaDeals || {};
    const hub = (state && state.hubProfile) || {};

    const journeyCard = plan
      ? `<p><strong>${esc(plan.origin)}</strong> → <strong>${esc(plan.destination)}</strong>
         · ${plan.distanceKm || "—"} km
         ${plan.corridor && plan.corridor.name ? ` on ${esc(plan.corridor.name)}` : ""}</p>
         <p>${plan.consumptionLPer100km || "—"} L/100 km
         · ${money((plan.totals && plan.totals.costAud) || 0)} for ${(plan.totals && plan.totals.fillL) || 0} L</p>
         ${(plan.stops || [])
           .slice(0, 3)
           .map((s) => `<p class="fuelhub-muted">${esc(s.name)} · ${s.fillL} L · ${s.effectiveCpl} ¢/L</p>`)
           .join("")}
         <p class="fuelhub-muted">${plan.plannedAt ? `Planned ${esc(fmtWhen(plan.plannedAt))}` : "Latest planned run."}</p>`
      : `<p class="fuelhub-muted">No planned run yet. Open Plan fills for a depot-to-gate corridor (NHVR, not Apple/Google).</p>`;

    const gpsCard = track
      ? `<p class="fuelhub-live">${track.km || 0} km</p>
         <p class="fuelhub-muted">${track.pointCount || 0} GPS points · about ${current.remainingKm || "—"} km of usable diesel left.
         ${track.updatedAt ? `Updated ${esc(fmtWhen(track.updatedAt))}.` : ""}</p>`
      : `<p class="fuelhub-muted">GPS is idle. Start a track to score nearby diesel against your position.</p>`;

    const tripRows = trips.length
      ? `<table class="fuelhub-table"><thead><tr><th>When</th><th>Run</th><th>Km</th><th>Fill</th><th>Cost</th></tr></thead><tbody>${trips
          .map(
            (t) => `<tr>
              <td>${esc(fmtWhen(t.createdAt))}</td>
              <td>${esc(t.origin)} → ${esc(t.destination)}${t.corridor ? ` <span class="fuelhub-muted">(${esc(t.corridor)})</span>` : ""}</td>
              <td>${t.distanceKm || "—"}</td>
              <td>${t.fillL != null ? `${t.fillL} L` : "—"}</td>
              <td>${t.costAud != null ? money(t.costAud) : "—"}</td>
            </tr>`
          )
          .join("")}</tbody></table>
         <p class="fuelhub-muted">${stats.tripCount || trips.length} saved · ${stats.totalKm || 0} km · ${stats.totalFillL || 0} L · ${money(stats.totalCostAud || 0)}</p>`
      : `<p class="fuelhub-muted">No saved trips yet. Plan a run, then Save trip to build this list.</p>`;

    const dealRows = deals.length
      ? `<table class="fuelhub-table"><thead><tr><th>Site</th><th>Band</th><th>¢/L</th><th>Km</th><th>Source</th></tr></thead><tbody>${deals
          .map(
            (s) => `<tr>
              <td>${esc(s.name)}${s.truckAccess ? "" : " <span class='fuelhub-muted'>car</span>"}</td>
              <td>${esc(s.band)}</td>
              <td><strong>${s.effectiveCpl}</strong>${s.discount && s.discount.cardCplOff ? ` <span class="fuelhub-muted">(-${s.discount.cardCplOff}¢ card)</span>` : ""}</td>
              <td>${s.distanceKm != null ? s.distanceKm : s.km != null ? `${s.km} along` : "—"}</td>
              <td>${s.source === "bowser" ? "Bowser" : "Gov table"}</td>
            </tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="fuelhub-muted">No truck-access sites matched this combination in the current area.</p>`;

    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-stats">
        <div class="fuelhub-stat"><strong>${current.consumptionLPer100km || "—"}</strong><span>L / 100 km now</span></div>
        <div class="fuelhub-stat"><strong>${current.remainingKm || "—"} km</strong><span>Range before reserve</span></div>
        <div class="fuelhub-stat"><strong>${esc(current.combinationLabel || hub.workCombinationLabel || "—")}</strong><span>${esc(current.driverTypeLabel || hub.driverTypeLabel || "Duty cycle")}</span></div>
        <div class="fuelhub-stat"><strong>${deals[0] ? `${deals[0].effectiveCpl} ¢` : "—"}</strong><span>Best nearby diesel</span></div>
      </div>
      <div class="fuelhub-dash-grid">
        <div class="fuelhub-card">
          <h2>Current journey</h2>
          ${journeyCard}
          <h3 class="fuelhub-subhead">Live GPS</h3>
          ${gpsCard}
          <div class="fuelhub-actions">
            <button type="button" class="btn primary" data-fuel-jump="plan">Plan fills</button>
            <button type="button" class="btn secondary" data-fuel-jump="track">GPS track</button>
          </div>
        </div>
        <div class="fuelhub-card">
          <h2>Previous journeys</h2>
          ${tripRows}
        </div>
      </div>
      <div class="fuelhub-card fuelhub-deals">
        <h2>Best fuel deals in this area</h2>
        <p class="fuelhub-muted">${esc(area.areaLabel || "Government-style diesel on NHVR freight sites.")}</p>
        ${dealRows}
        <p class="fuelhub-muted">${esc(area.nhvrNote || "")}
        ${area.nhvrPlannerUrl ? ` <a href="${esc(area.nhvrPlannerUrl)}" target="_blank" rel="noopener">NHVR Route Planner</a>.` : ""}
        Sources: ${((area.sources || []).map((s) => s.name) || []).map(esc).join(" · ")}</p>
      </div>
    `;
    el.querySelectorAll("[data-fuel-jump]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-fuel-jump")));
    });
  }

  function driverTypeOptions(selected) {
    const types = (state && state.driverTypes) || {};
    return Object.entries(types)
      .map(
        ([id, meta]) =>
          `<option value="${esc(id)}" ${id === selected ? "selected" : ""}>${esc((meta && meta.label) || id)}</option>`
      )
      .join("");
  }

  function licenceOptions(selected) {
    return ((state && state.licenceClasses) || [])
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)} (${esc(c.typicalRange || "")})</option>`
      )
      .join("");
  }

  function workVehicleOptions(selected) {
    const rows = (state && state.workCombinations) || state.combinations || [];
    return rows
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`
      )
      .join("");
  }

  function combinationFromProfile(licence, driverType) {
    const duty = String(driverType || "long_haul");
    if (licence === "lr_mr" || licence === "hr") return "rigid";
    if (licence === "mc") return duty === "local" ? "semi" : "b_double";
    if (licence === "hc" && (duty === "long_haul" || duty === "owner_driver")) return "b_double";
    return "semi";
  }

  function licenceFromSalary(salary) {
    const n = Number(salary);
    const amount = Number.isFinite(n) && n > 0 ? n : 0;
    if (amount >= 110000) return "mc";
    if (amount >= 79000) return "hc";
    if (amount >= 70000) return "hr";
    return "lr_mr";
  }

  function renderProfile() {
    const el = byId("fuel-view-profile");
    if (!el) return;
    const hub = (state && state.hubProfile) || {};
    const recordsProfile = hub;
    el.innerHTML = `
      <div class="fuelhub-card fuelhub-profile-form-card">
        <h2>Driver Hub profile</h2>
        <p class="fuelhub-muted">Same login and profile as Taxation Hub — name, driver type and work vehicle set Fuel Hub L/100 km. Saving here updates both apps.</p>
        <form id="fuelhub-profile-form" class="fuelhub-profile-form">
          <label>Name<input name="name" value="${esc(recordsProfile.name || "")}" placeholder="Full name" /></label>
          <label>Driver type<select name="driverType" id="fuel-profile-driver-type">${driverTypeOptions(hub.driverType || "long_haul")}</select></label>
          <label>Employer<input name="employer" value="${esc(hub.employer || "")}" placeholder="Fleet or company" /></label>
          <label>Annual salary ($)<input name="annualSalary" id="fuel-profile-salary" type="number" min="0" step="0.01" value="${esc(hub.annualSalary != null ? hub.annualSalary : "")}" /></label>
          <label>Licence class<select name="licenceClass" id="fuel-profile-licence">${licenceOptions(hub.licenceClass || "hc")}</select></label>
          <label>Work vehicle<select name="workCombination" id="fuel-profile-work-combination">${workVehicleOptions(hub.workCombination || "semi")}</select></label>
          <p class="fuelhub-muted span-2" id="fuel-work-combination-hint">Fuel Hub uses this vehicle plus your driver type for diesel L/100 km on planned runs.</p>
          <label>Financial year<input name="financialYear" value="${esc(hub.financialYear || "")}" placeholder="2025-26" /></label>
          <label class="fuelhub-check"><input type="checkbox" name="tfnSupplied" ${hub.tfnSupplied ? "checked" : ""} /> TFN supplied to employer</label>
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Save profile</button>
          </div>
        </form>
      </div>
    `;
    const form = el.querySelector("#fuelhub-profile-form");
    const typeSelect = el.querySelector("#fuel-profile-driver-type");
    const licenceSelect = el.querySelector("#fuel-profile-licence");
    const comboSelect = el.querySelector("#fuel-profile-work-combination");
    const salaryInput = el.querySelector("#fuel-profile-salary");
    const hint = el.querySelector("#fuel-work-combination-hint");

    function syncCombo() {
      if (!comboSelect || comboSelect.dataset.userSet === "1") return;
      const next = combinationFromProfile(licenceSelect && licenceSelect.value, typeSelect && typeSelect.value);
      if (comboSelect.value !== next) comboSelect.value = next;
      if (hint) {
        const label = comboSelect.options[comboSelect.selectedIndex]
          ? comboSelect.options[comboSelect.selectedIndex].text
          : next;
        hint.textContent = `Fuel Hub uses ${label} with your driver type to set L/100 km. Save to apply.`;
      }
    }
    typeSelect?.addEventListener("change", syncCombo);
    licenceSelect?.addEventListener("change", syncCombo);
    comboSelect?.addEventListener("change", () => {
      comboSelect.dataset.userSet = "1";
    });
    salaryInput?.addEventListener("input", () => {
      if (!licenceSelect) return;
      licenceSelect.value = licenceFromSalary(salaryInput.value);
      syncCombo();
    });
    form?.addEventListener("submit", onSaveProfile);
  }

  async function onSaveProfile(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get("name"),
      driverType: fd.get("driverType"),
      employer: fd.get("employer"),
      annualSalary: fd.get("annualSalary"),
      licenceClass: fd.get("licenceClass"),
      workCombination: fd.get("workCombination"),
      financialYear: fd.get("financialYear"),
      tfnSupplied: fd.get("tfnSupplied") === "on",
    };
    await api("/profile", { method: "PUT", body });
    const taxForm = document.getElementById("profile-form");
    if (taxForm) {
      Object.entries(body).forEach(([k, v]) => {
        const input = taxForm.elements[k];
        if (!input) return;
        if (input.type === "checkbox") input.checked = Boolean(v);
        else input.value = v ?? "";
      });
    }
    toast("Profile saved — Fuel Hub rates will follow this vehicle and driver type");
    await load();
    setView("profile");
  }

  function renderPlan() {
    const el = byId("fuel-view-plan");
    if (!el) return;
    const plan = lastPlan;
    const eff = (state && state.efficiency) || {};
    const hub = (state && state.hubProfile) || {};
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-stats">
        <div class="fuelhub-stat"><strong>${eff.consumptionLPer100km || "—"}</strong><span>L / 100 km</span></div>
        <div class="fuelhub-stat"><strong>${eff.litresPerKm || "—"}</strong><span>L / km</span></div>
        <div class="fuelhub-stat"><strong>${eff.rangeKm || "—"} km</strong><span>Range before reserve</span></div>
        <div class="fuelhub-stat"><strong>${eff.fuelMassKg || "—"} kg</strong><span>Diesel mass in tanks</span></div>
      </div>
      <p class="fuelhub-muted">${esc(hub.workCombinationLabel || "Work vehicle")} · ${esc(
        hub.driverTypeLabel || "linehaul"
      )} duty cycle sets these rates. Change driver type or work vehicle on Taxation Hub Profile, then Save profile.</p>
      <div class="fuelhub-grid">
        <form id="fuel-plan-form" class="fuelhub-card">
          <h2>Route</h2>
          <p class="fuelhub-muted">Type towns or a depot-to-gate run. Fuel Hub matches NHVR freight corridors (Hume, Pacific, Newell, Warrego, Stuart, Eyre…) instead of Apple/Google car shortcuts.</p>
          <label>Origin<input name="origin" required placeholder="e.g. Sydney" /></label>
          <label>Destination<input name="destination" required placeholder="e.g. Melbourne" /></label>
          <label>Via (optional)<input name="via" placeholder="e.g. Dubbo" /></label>
          <label>Distance override (km)<input name="distanceKm" type="number" min="1" step="1" placeholder="Leave blank to use corridor length" /></label>
          <div class="fuelhub-actions">
            <button type="submit" class="btn primary">Plan fuel stops</button>
            <button type="button" class="btn secondary" id="fuel-plan-save">Save trip</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>Recommended fills</h2>
          ${
            plan
              ? renderPlanResult(plan)
              : `<p class="fuelhub-muted">Enter a run to rank truck-access diesel stops by effective ¢/L (table or bowser, minus cards), then rest/refresh windows on NHVR-style hours.</p>`
          }
        </div>
      </div>
    `;
    el.querySelector("#fuel-plan-form")?.addEventListener("submit", onPlan);
    el.querySelector("#fuel-plan-save")?.addEventListener("click", onSaveTrip);
  }

  function renderPlanResult(plan) {
    const warnings = (plan.warnings || []).map((w) => `<p class="fuelhub-warn">${esc(w)}</p>`).join("");
    const stops = (plan.stops || [])
      .map(
        (s) => `
        <article class="fuelhub-stop">
          <h3>${esc(s.name)}</h3>
          <p class="fuelhub-muted">${esc(s.reason)} · ${s.km} km · ${esc(s.band)} · ${s.effectiveCpl} ¢/L after cards</p>
          <p>Fill <strong>${s.fillL} L</strong> · ${money(s.costAud)} · depart with ${s.fuelOnDepartureL} L (~${s.rangeAfterKm} km)</p>
          ${s.refresh ? `<p class="fuelhub-muted">Refresh: food / parking / shower on site.</p>` : ""}
        </article>`
      )
      .join("");
    const refresh = (plan.refreshStops || [])
      .map((r) => `<li><strong>${esc(r.name)}</strong> at ${r.km} km — ${esc(r.note)}</li>`)
      .join("");
    return `
      ${warnings}
      <p><strong>${esc(plan.origin)}</strong> → <strong>${esc(plan.destination)}</strong>
      · ${plan.distanceKm} km on ${esc(plan.corridor.name)}
      · ${plan.consumptionLPer100km} L/100 km
      · ${money(plan.totals.costAud)} for ${plan.totals.fillL} L
      ${plan.totals.averageEffectiveCpl != null ? ` · avg ${plan.totals.averageEffectiveCpl} ¢/L` : ""}</p>
      ${stops || `<p class="fuelhub-muted">No fill required on this hop with current fuel.</p>`}
      ${refresh ? `<h2>Refuel &amp; refresh</h2><ul class="fuelhub-muted">${refresh}</ul>` : ""}
      <p class="fuelhub-muted">${esc(plan.sourcesNote)}</p>
    `;
  }

  function renderTrack() {
    const el = byId("fuel-view-track");
    if (!el) return;
    const track = state.activeTrack;
    const eff = state.efficiency || {};
    const km = track ? track.km : 0;
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-card">
        <h2>Live GPS</h2>
        <p class="fuelhub-muted">Uses this device’s location to accumulate kilometres. Offline you can still type a route on Plan fills. Remaining range uses current tank, load and fuel mass.</p>
        <p class="fuelhub-live">${km} km</p>
        <p class="fuelhub-muted">${track ? `${track.pointCount || 0} points` : "Not tracking"} · about ${eff.rangeKm || "—"} km of usable diesel from the saved tank.</p>
        <div class="fuelhub-actions">
          <button type="button" class="btn primary" id="fuel-gps-start">${watchId ? "GPS running" : "Start GPS"}</button>
          <button type="button" class="btn secondary" id="fuel-gps-stop">Stop</button>
          <button type="button" class="btn danger" id="fuel-gps-reset">Reset track</button>
        </div>
        <p id="fuel-gps-msg" class="fuelhub-muted"></p>
      </div>
    `;
    el.querySelector("#fuel-gps-start")?.addEventListener("click", startGps);
    el.querySelector("#fuel-gps-stop")?.addEventListener("click", stopGps);
    el.querySelector("#fuel-gps-reset")?.addEventListener("click", resetGps);
  }

  function readTruckForm(form) {
    const fd = new FormData(form);
    return {
      combinationId: fd.get("combinationId"),
      massSchemeId: fd.get("massSchemeId"),
      trailers: fd.get("trailers"),
      payloadT: fd.get("payloadT"),
      gcmT: fd.get("gcmT"),
      tareT: fd.get("tareT"),
      tankCapacityL: fd.get("tankCapacityL"),
      currentFuelL: fd.get("currentFuelL"),
      lengthM: fd.get("lengthM"),
      heightM: fd.get("heightM"),
    };
  }

  function renderTruck() {
    const el = byId("fuel-view-truck");
    if (!el) return;
    const t = (state && state.truck) || {};
    const eff = (state && state.efficiency) || {};
    const hub = (state && state.hubProfile) || {};
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-grid">
        <form id="fuel-truck-form" class="fuelhub-card">
          <h2>Combination &amp; tanks</h2>
          <p class="fuelhub-muted">${
            hub.linked
              ? `Profile: ${esc(hub.licenceLabel || hub.licenceClass)} · ${esc(hub.driverTypeLabel || "")} · ${esc(hub.workCombinationLabel || hub.workCombination || "")}. Fuel Hub uses that work vehicle and driver type for L/100 km until you save this form (tanks / payload). Work cars on Profile stay on Car Expenses.`
              : "Save a Driver Hub profile on Taxation Hub (driver type + work vehicle) to prefill combination and duty-cycle rates."
          }</p>
          <label>Combination<select name="combinationId">${comboOptions(t.combinationId)}</select></label>
          <label>Mass scheme<select name="massSchemeId">${schemeOptions(t.massSchemeId)}</select></label>
          <label>Trailers<input name="trailers" type="number" min="0" max="4" value="${esc(t.trailers)}" /></label>
          <label>Payload / load (t)<input name="payloadT" type="number" min="0" step="0.1" value="${esc(t.payloadT)}" /></label>
          <label>GCM (t)<input name="gcmT" type="number" min="4" step="0.1" value="${esc(t.gcmT)}" /></label>
          <label>Tare (t)<input name="tareT" type="number" min="2" step="0.1" value="${esc(t.tareT)}" /></label>
          <label>Total tank capacity (L)<input name="tankCapacityL" type="number" min="80" step="1" value="${esc(t.tankCapacityL)}" /></label>
          <label>Fuel on board (L)<input name="currentFuelL" type="number" min="0" step="1" value="${esc(t.currentFuelL)}" /></label>
          <label>Length (m)<input name="lengthM" type="number" min="4" step="0.1" value="${esc(t.lengthM)}" /></label>
          <label>Height (m)<input name="heightM" type="number" min="2" step="0.01" value="${esc(t.heightM)}" /></label>
          <div class="fuelhub-actions">
            <button type="submit" class="btn primary">Save truck spec</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>Efficiency snapshot</h2>
          <p>Operating mass <strong>${eff.operatingMassT || "—"} t</strong> (payload + diesel at ${eff.dieselKgPerLitre || 0.84} kg/L).</p>
          <p>${(eff.notes || []).map((n) => esc(n)).join("<br>")}</p>
          <p class="fuelhub-muted">Heavier loads, extra trailers and a full tank all lift L/100 km. Out-west / remote bands add a terrain factor so you do not plan a Hume-style range into the Nullarbor.</p>
        </div>
      </div>
    `;
    el.querySelector("#fuel-truck-form")?.addEventListener("submit", onSaveTruck);
  }

  function renderCards() {
    const el = byId("fuel-view-cards");
    if (!el) return;
    const cards = (state && state.cards) || [];
    const hub = (state && state.hubProfile) || {};
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-grid">
        <form id="fuel-card-form" class="fuelhub-card">
          <h2>Add fuel card / agreement</h2>
          <p class="fuelhub-muted">BP, Mobil, Shell, Ampol, Liberty, 7-Eleven and Pearl are the main barometers. Company cents-off stacks on top of the card.</p>
          <label>Name<input name="name" required placeholder="e.g. BP Plus" /></label>
          <label>Retailer<select name="retailerId">${retailerOptions("bp")}</select></label>
          <label>Card cents off (¢/L)<input name="cplOff" type="number" min="0" max="40" step="0.1" value="6" /></label>
          <label>Percent off<input name="percentOff" type="number" min="0" max="25" step="0.1" value="0" /></label>
          <label>Company / industry extra ¢/L<input name="companyCplOff" type="number" min="0" max="20" step="0.1" value="0" /></label>
          <label>Company name<input name="company" placeholder="Fleet or employer" value="${esc(hub.employer || "")}" /></label>
          <div class="fuelhub-actions">
            <button type="submit" class="btn primary">Save card</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>On this profile</h2>
          ${
            cards.length
              ? cards
                  .map(
                    (c) => `
            <div class="fuelhub-card-row">
              <div>
                <strong>${esc(c.name)}</strong>
                <div class="fuelhub-muted">${esc(c.retailerId)} · ${c.cplOff} ¢/L${c.companyCplOff ? ` + ${c.companyCplOff} ¢ company` : ""} ${c.company ? `· ${esc(c.company)}` : ""}</div>
              </div>
              <button type="button" class="btn danger" data-del-card="${esc(c.id)}">Remove</button>
            </div>`
                  )
                  .join("")
              : `<p class="fuelhub-muted">No cards yet — fills will use table diesel only.</p>`
          }
        </div>
      </div>
    `;
    el.querySelector("#fuel-card-form")?.addEventListener("submit", onSaveCard);
    el.querySelectorAll("[data-del-card]").forEach((btn) => {
      btn.addEventListener("click", () => onDeleteCard(btn.getAttribute("data-del-card")));
    });
  }

  function renderPrices() {
    const el = byId("fuel-view-prices");
    if (!el) return;
    const tables = (state && state.tables) || { cities: [], loadings: [], sources: [] };
    const stations = ((state && state.stations) || [])
      .slice()
      .sort((a, b) => a.pumpCpl - b.pumpCpl)
      .slice(0, 12);
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-card" style="margin-bottom:16px">
        <h2>Government-style diesel bands</h2>
        <p class="fuelhub-muted">${esc(tables.asOfNote || "")}</p>
        <table class="fuelhub-table">
          <thead><tr><th>Capital</th><th>Metro diesel ¢/L</th></tr></thead>
          <tbody>
            ${(tables.cities || [])
              .map((c) => `<tr><td>${esc(c.city)}</td><td>${c.dieselCpl}</td></tr>`)
              .join("")}
          </tbody>
        </table>
        <table class="fuelhub-table">
          <thead><tr><th>Band</th><th>Loading ¢/L</th><th>Sydney example</th></tr></thead>
          <tbody>
            ${(tables.loadings || [])
              .map(
                (r) =>
                  `<tr><td>${esc(r.band)}</td><td>+${r.loadingCpl}</td><td>${r.exampleSydneyCpl}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
        <p class="fuelhub-muted">Sources: ${(tables.sources || []).map((s) => esc(s.name)).join(" · ")}</p>
      </div>
      <div class="fuelhub-grid">
        <form id="fuel-price-form" class="fuelhub-card">
          <h2>Log a bowser price</h2>
          <label>Station
            <select name="stationId">
              ${((state && state.stations) || [])
                .map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${s.pumpCpl} ¢)</option>`)
                .join("")}
            </select>
          </label>
          <label>Diesel ¢/L<input name="cpl" type="number" min="80" max="400" step="0.1" required /></label>
          <div class="fuelhub-actions">
            <button type="submit" class="btn primary">Save observed price</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>Cheapest table / bowser sites</h2>
          <table class="fuelhub-table">
            <thead><tr><th>Site</th><th>Band</th><th>¢/L</th><th>Truck</th></tr></thead>
            <tbody>
              ${stations
                .map(
                  (s) =>
                    `<tr><td>${esc(s.name)}</td><td>${esc(s.band)}</td><td>${s.pumpCpl}${s.observedCpl != null ? " *" : ""}</td><td>${s.truckAccess ? "Yes" : "No"}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <p class="fuelhub-muted">* overlay from a driver-logged bowser. Out-west / remote sites sit higher on purpose.</p>
        </div>
      </div>
    `;
    el.querySelector("#fuel-price-form")?.addEventListener("submit", onSavePrice);
  }

  function render() {
    if (!state) return;
    if (view === "dashboard") renderDashboard();
    else if (view === "profile") renderProfile();
    else if (view === "plan") renderPlan();
    else if (view === "track") renderTrack();
    else if (view === "truck") renderTruck();
    else if (view === "cards") renderCards();
    else renderPrices();
  }

  async function load() {
    state = await api("/fuelhub");
    if (!lastPlan && state.lastPlan) lastPlan = state.lastPlan;
    render();
  }

  async function onPlan(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const viaRaw = String(fd.get("via") || "").trim();
    const data = await api("/fuelhub/plan", {
      method: "POST",
      body: {
        origin: fd.get("origin"),
        destination: fd.get("destination"),
        via: viaRaw ? [viaRaw] : [],
        distanceKm: fd.get("distanceKm") || undefined,
      },
    });
    lastPlan = data.plan;
    if (data.lastPlan) state.lastPlan = data.lastPlan;
    renderPlan();
    toast("Fuel plan ready");
    void refreshDashboard();
  }

  async function onSaveTrip() {
    if (!lastPlan) {
      toast("Plan a run first");
      return;
    }
    const data = await api("/fuelhub/trips", {
      method: "POST",
      body: {
        origin: lastPlan.origin,
        destination: lastPlan.destination,
        distanceKm: lastPlan.distanceKm,
        mode: "offline",
        planSummary: {
          fillL: lastPlan.totals.fillL,
          costAud: lastPlan.totals.costAud,
          corridor: lastPlan.corridor.id,
        },
      },
    });
    if (data.trips) state.trips = data.trips;
    toast("Trip saved");
    void refreshDashboard();
  }

  async function onSaveTruck(e) {
    e.preventDefault();
    const data = await api("/fuelhub/truck", { method: "PUT", body: readTruckForm(e.target) });
    state.truck = data.truck;
    state.efficiency = data.efficiency;
    toast("Truck spec saved");
    renderTruck();
  }

  async function onSaveCard(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = await api("/fuelhub/cards", {
      method: "POST",
      body: {
        name: fd.get("name"),
        retailerId: fd.get("retailerId"),
        cplOff: fd.get("cplOff"),
        percentOff: fd.get("percentOff"),
        companyCplOff: fd.get("companyCplOff"),
        company: fd.get("company"),
        companyWide: Number(fd.get("companyCplOff")) > 0,
      },
    });
    state.cards = data.cards;
    toast("Fuel card saved");
    renderCards();
  }

  async function onDeleteCard(id) {
    const data = await api(`/fuelhub/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.cards = data.cards;
    renderCards();
  }

  async function onSavePrice(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = await api("/fuelhub/prices/observed", {
      method: "POST",
      body: { stationId: fd.get("stationId"), cpl: fd.get("cpl") },
    });
    state.stations = data.stations;
    toast("Bowser price saved");
    renderPrices();
  }

  function gpsMessage(text) {
    const el = byId("fuel-gps-msg");
    if (el) el.textContent = text;
  }

  function startGps() {
    if (!navigator.geolocation) {
      gpsMessage("This device has no geolocation API — use an offline route on Plan fills.");
      return;
    }
    if (watchId != null) return;
    gpsMessage("Waiting for GPS…");
    watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        if (gpsBusy) return;
        gpsBusy = true;
        try {
          const data = await api("/fuelhub/track", {
            method: "POST",
            body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          state.activeTrack = data.track;
          state.efficiency = data.efficiency;
          if (view === "track") renderTrack();
          if (view === "dashboard") void refreshDashboard();
          gpsMessage(`Range remaining ~${data.remainingKm} km after this track.`);
        } catch (err) {
          gpsMessage(err.message || "Could not save GPS point.");
        } finally {
          gpsBusy = false;
        }
      },
      (err) => {
        gpsMessage(err.message || "GPS denied.");
        watchId = null;
      },
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
    );
  }

  function stopGps() {
    if (watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
    gpsMessage("GPS stopped.");
    if (view === "track") renderTrack();
  }

  async function resetGps() {
    stopGps();
    await api("/fuelhub/track", { method: "DELETE" });
    state.activeTrack = null;
    renderTrack();
    toast("Track reset");
  }

  function wire() {
    document.querySelectorAll("#fuelhub-shell [data-fuel-view]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-fuel-view")));
    });
    byId("fuelhub-nav-driverhub")?.addEventListener("click", () => {
      stopGps();
      byId("nav-driverhub")?.click();
    });
  }

  async function refreshDashboard(point) {
    try {
      const qs =
        point && Number.isFinite(point.lat)
          ? `?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`
          : "";
      const dash = await api(`/fuelhub/dashboard${qs}`);
      if (state) state.dashboard = dash;
      if (view === "dashboard") renderDashboard();
    } catch {
      /* keep last dashboard */
    }
  }

  function locateForDeals() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void refreshDashboard({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 120000, timeout: 8000 }
    );
  }

  async function open() {
    document.body.classList.add("fuelhub-open");
    try {
      await load();
      setView("dashboard");
    } catch (err) {
      toast(err.message || "Could not open Fuel Hub.");
    }
  }

  function close() {
    stopGps();
    document.body.classList.remove("fuelhub-open");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  window.FuelHub = { open, close, refresh: load };
})();
