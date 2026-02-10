// app.js (FULL, cleaned, with temp pin + GPS button)
document.addEventListener("DOMContentLoaded", () => {
  /* ---------------- CONFIG ---------------- */
  const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbzwaED1ncgYe5hJ0nH9VBJkKiPP6CBNd1jup9GhlJUgXn8wraoTW6FmqYI-Pl07_eilbQ/exec";

  const UPDATES_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTqaGnxOFnazRsFkP-J3tx0cMtjDi2a8-jLHR44XnjbUMIRudAtprAmulLVCD8nDxS-LbZghRA5TFrk/pub?gid=436844958&single=true&output=csv";

  const BASELINE_CSV_URL = "data/restrooms_baseline_public.csv";

  /* ---------------- HELPERS ---------------- */
  const $ = (id) => document.getElementById(id);
  const toBool = (v) => ["true", "yes", "1"].includes(String(v).toLowerCase());
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));

  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

  function fmtDate(s) {
    const v = String(s ?? "").trim();
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /* ---------------- MAP INIT ---------------- */
  const leafletMap = L.map("map").setView([32.7157, -117.1611], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(leafletMap);

  const leafletMarkers = L.layerGroup().addTo(leafletMap);

  /* ---------------- CSV ---------------- */
  async function loadCsv(url) {
    const res = await fetch(url);
    const t = await res.text();
    return Papa.parse(t, { header: true, skipEmptyLines: true }).data;
  }

  /* ---------------- POPUPS ---------------- */
  function popupHtml(r) {
    const val = (x) => String(x ?? "").trim();
    const has = (x) => !!val(x);

    const hasUpdate = has(r.timestamp);

    const name = val(r.restroom_name || r.name || "Restroom");
    const address = val(r.address);

    const openStatus = val(r.open_when_visited || r.restroom_open_status);
    const hours = val(r.advertised_hours);

    const showers = val(r.showers_available || r.showers);
    const ada = val(r.ada_accessible);
    const genderNeutral = val(r.gender_neutral);
    const menstrual = val(r.menstrual_products);

    const updatedOn = hasUpdate ? fmtDate(r.timestamp) : "";
    const assessedOn = !hasUpdate && has(r.restroom_assessment_date)
      ? fmtDate(r.restroom_assessment_date)
      : "";

    const chip = (label, value) =>
      has(value)
        ? `
          <span class="chip">
            <span class="chipLabel">${esc(label)}</span>
            <span class="chipValue">${esc(value)}</span>
          </span>`
        : "";

    const row = (label, value) =>
      has(value)
        ? `
          <div class="kv">
            <div class="k">${esc(label)}</div>
            <div class="v">${esc(value)}</div>
          </div>`
        : "";

    return `
      <div class="popup">
        <div class="popupTitle">${esc(name)}</div>
        ${address ? `<div class="popupAddr">${esc(address)}</div>` : ""}

        ${updatedOn ? `<div class="popupMeta">Updated (approved): ${esc(updatedOn)}</div>` : ""}
        ${assessedOn ? `<div class="popupMeta">Baseline assessed: ${esc(assessedOn)}</div>` : ""}

        <div class="chipRow">
          ${chip("Open", openStatus)}
          ${chip("Hours", hours)}
          ${chip("ADA", ada)}
          ${chip("Gender-neutral", genderNeutral)}
          ${chip("Menstrual", menstrual)}
          ${chip("Showers", showers)}
        </div>

        <details class="popupDetails">
          <summary>More details</summary>

          <div class="section">
            <div class="sectionTitle">Access & finding it</div>
            ${row("Access method", r.access_method)}
            ${row("Findability", r.findability)}
          </div>

          <div class="section">
            <div class="sectionTitle">Amenities & safety</div>
            ${row("Water refill nearby", r.water_refill_nearby)}
            ${row("Visible signage", r.visible_signage)}
            ${row("Security cameras", r.security_cameras)}
            ${row("Baby changing", r.baby_changing)}
          </div>

          ${!hasUpdate ? `
            <div class="section">
              <div class="sectionTitle">About (baseline)</div>
              ${row("Category", r.category)}
              ${row("Operated by", r.operated_by)}
              ${row("Baseline assessed?", r.restroom_assessed)}
              ${row("Public buildings", r.public_buildings)}
              ${row("Outdoor facilities", r.outdoor_facilities)}
              ${row("Government facilities", r.government_facilities)}
              ${row("Commercial", r.commercial)}
              ${row("Transportation/MTS", r.transportation_mts)}
              ${row("Other", r.other)}
            </div>
          ` : ""}

          <div class="section">
            <div class="sectionTitle">Field observations</div>
            ${row("Access barriers", r.access_barriers)}
            ${row("Overall impressions", r.overall_impressions)}
            ${row("Outside context", r.outside_context)}
            ${row("Notes", r.notes)}
          </div>
        </details>

        <div class="popupActions">
          <button class="popupBtn" data-update type="button">Suggest a change</button>
        </div>
      </div>
    `;
  }

  /* ---------------- MARKERS ---------------- */
  function drawMarkers(rows) {
    leafletMarkers.clearLayers();

    rows.forEach((r) => {
      const lat = +r.latitude;
      const lng = +r.longitude;
      if (!lat || !lng) return;

      const m = L.marker([lat, lng]).addTo(leafletMarkers);
      m.bindPopup(popupHtml(r), { maxWidth: 360 });

      m.on("popupopen", (e) => {
        const btn = e.popup.getElement()?.querySelector("[data-update]");
        if (!btn) return;
        btn.onclick = () => fillForm(r, "update");
      });
    });
  }

  /* ---------------- INIT ---------------- */
  (async () => {
    const baseline = await loadCsv(BASELINE_CSV_URL);
    const updates = (await loadCsv(UPDATES_CSV_URL)).filter((r) =>
      toBool(r.approved)
    );

    const latest = {};
    updates.forEach((u) => {
      const key = String(u.place_id ?? "").trim();
      if (!key) return;
      if (!latest[key] || Date.parse(u.timestamp) > Date.parse(latest[key].timestamp)) {
        latest[key] = u;
      }
    });

    const merged = baseline.map((b) => {
      const key = String(b.globalid ?? "").trim();
      return latest[key] ? { ...b, ...latest[key] } : b;
    });

    drawMarkers(merged);
  })();
});
