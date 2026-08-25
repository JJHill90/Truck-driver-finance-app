/*
 * Fuel Hub UI — second Driver Hub app (loaded after enhancements.js).
 */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  let state = null;
  let view = "plan";
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

  function setView(next) {
    view = next;
    const titles = {
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

  function renderPlan() {
    const el = byId("fuel-view-plan");
    if (!el) return;
    const plan = lastPlan;
    const eff = (state && state.efficiency) || {};
    el.innerHTML = `
      <div class="fuelhub-stats">
        <div class="fuelhub-stat"><strong>${eff.consumptionLPer100km || "—"}</strong><span>L / 100 km</span></div>
        <div class="fuelhub-stat"><strong>${eff.litresPerKm || "—"}</strong><span>L / km</span></div>
        <div class="fuelhub-stat"><strong>${eff.rangeKm || "—"} km</strong><span>Range before reserve</span></div>
        <div class="fuelhub-stat"><strong>${eff.fuelMassKg || "—"} kg</strong><span>Diesel mass in tanks</span></div>
      </div>
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
    el.innerHTML = `
      <div class="fuelhub-grid">
        <form id="fuel-truck-form" class="fuelhub-card">
          <h2>Combination &amp; tanks</h2>
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
    el.innerHTML = `
      <div class="fuelhub-grid">
        <form id="fuel-card-form" class="fuelhub-card">
          <h2>Add fuel card / agreement</h2>
          <p class="fuelhub-muted">BP, Mobil, Shell, Ampol, Liberty, 7-Eleven and Pearl are the main barometers. Company cents-off stacks on top of the card.</p>
          <label>Name<input name="name" required placeholder="e.g. BP Plus" /></label>
          <label>Retailer<select name="retailerId">${retailerOptions("bp")}</select></label>
          <label>Card cents off (¢/L)<input name="cplOff" type="number" min="0" max="40" step="0.1" value="6" /></label>
          <label>Percent off<input name="percentOff" type="number" min="0" max="25" step="0.1" value="0" /></label>
          <label>Company / industry extra ¢/L<input name="companyCplOff" type="number" min="0" max="20" step="0.1" value="0" /></label>
          <label>Company name<input name="company" placeholder="Fleet or employer" /></label>
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
    if (view === "plan") renderPlan();
    else if (view === "track") renderTrack();
    else if (view === "truck") renderTruck();
    else if (view === "cards") renderCards();
    else renderPrices();
  }

  async function load() {
    state = await api("/fuelhub");
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
    renderPlan();
    toast("Fuel plan ready");
  }

  async function onSaveTrip() {
    if (!lastPlan) {
      toast("Plan a run first");
      return;
    }
    await api("/fuelhub/trips", {
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
    toast("Trip saved");
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

  async function open() {
    document.body.classList.add("fuelhub-open");
    try {
      await load();
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
