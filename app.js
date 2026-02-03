document.addEventListener("DOMContentLoaded", () => {
  alert("app.js loaded"); // remove after testing

  const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbwTUAGegDO_w2Hh1W0aPiFTmiVlYF-8zfMX_M4QQ_AyaPaB2HlETTOMq1xseZk9Y_Xpsw/exec";

  const UPDATES_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTqaGnxOFnazRsFkP-J3tx0cMtjDi2a8-jLHR44XnjbUMIRudAtprAmulLVCD8nDxS-LbZghRA5TFrk/pub?gid=436844958&single=true&output=csv";

  const BASELINE_CSV_URL = "data/restrooms_baseline_public.csv";

  const $ = (id) => document.getElementById(id);
  const toBool = v => ["true","yes","1"].includes(String(v).toLowerCase());
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );

  // ---- REQUIRED elements ----
  const panel = $("panel");
  const form = $("surveyForm");
  const submitBtn = $("submitBtn");
  const statusEl = $("status");

  // If any of these are missing, show a helpful error instead of crashing
  if (!panel || !form || !submitBtn || !statusEl) {
    alert("Missing required element(s): panel/form/submitBtn/status. Check IDs in index.html.");
    return;
  }

  const placeIdEl = $("place_id");
  const actionEl = $("action");

  const auditDatetimeEl = $("audit_datetime");
  const restroomNameEl = $("restroom_name");
  const researcherNameEl = $("researcher_name");
  const addressEl = $("address");
  const latEl = $("latitude");
  const lngEl = $("longitude");

  const openWhenVisitedEl = $("open_when_visited");
  const hoursEl = $("advertised_hours");
  const accessMethodEl = $("access_method");
  const findabilityEl = $("findability");

  const genderNeutralEl = $("gender_neutral");
  const menstrualProductsEl = $("menstrual_products");
  const showersEl = $("showers_available");
  const waterRefillEl = $("water_refill_nearby");
  const signageEl = $("visible_signage");
  const camerasEl = $("security_cameras");
  const adaEl = $("ada_accessible");

  const accessBarriersEl = $("access_barriers");
  const impressionsEl = $("overall_impressions");
  const outsideEl = $("outside_context");
  const notesEl = $("notes");

  // ---- MAP (initialize AFTER DOM is ready) ----
  const map = L.map("map").setView([32.7157, -117.1611], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);

  // ---- Panel helpers ----
  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

  function openPanel() {
    if (isMobile()) panel.classList.add("open");
    setTimeout(() => map.invalidateSize(), 250);
  }

  function togglePanel() {
    if (!isMobile()) return;
    panel.classList.toggle("open");
    setTimeout(() => map.invalidateSize(), 250);
  }

  $("drawerHeader")?.addEventListener("click", togglePanel);

  function setMode(mode) {
    const m = $("modeIndicator");
    if (!m) return;
    m.className = (mode === "update") ? "mode update" : "mode new";
  }

  async function loadCsv(url) {
    const t = await (await fetch(url)).text();
    return Papa.parse(t, { header: true, skipEmptyLines: true }).data;
  }

  function popupHtml(r) {
    return `
      <strong>${esc(r.restroom_name || r.name)}</strong><br>
      ${esc(r.address || "")}<br>
      ${esc(r.open_when_visited || r.restroom_open_status || "")}<br>
      <button data-update>Suggest a change</button>
    `;
  }

  function drawMarkers(rows) {
    markersLayer.clearLayers();
    rows.forEach(r => {
      const lat = +r.latitude, lng = +r.longitude;
      if (!lat || !lng) return;

      const m = L.marker([lat, lng]).addTo(markersLayer);
      m.bindPopup(popupHtml(r));

      m.on("popupopen", e => {
        e.popup.getElement().querySelector("[data-update]").onclick = () => {
          fillForm(r, "update");
          openPanel();
        };
      });
    });
  }

  function fillForm(r, mode) {
    placeIdEl.value = r.globalid || r.place_id || "";
    actionEl.value = mode;
    setMode(mode);

    auditDatetimeEl.value = r.audit_datetime || "";
    restroomNameEl.value = r.restroom_name || r.name || "";
    researcherNameEl.value = r.researcher_name || "";

    addressEl.value = r.address || "";
    latEl.value = r.latitude || "";
    lngEl.value = r.longitude || "";

    openWhenVisitedEl.value = r.open_when_visited || "";
    hoursEl.value = r.advertised_hours || r.hours || "";

    accessMethodEl.value = r.access_method || "";
    findabilityEl.value = r.findability || "";

    genderNeutralEl.value = r.gender_neutral || "";
    menstrualProductsEl.value = r.menstrual_products || "";
    showersEl.value = r.showers_available || "";
    waterRefillEl.value = r.water_refill_nearby || "";
    signageEl.value = r.visible_signage || "";
    camerasEl.value = r.security_cameras || "";
    adaEl.value = r.ada_accessible || "";

    accessBarriersEl.value = r.access_barriers || "";
    impressionsEl.value = r.overall_impressions || "";
    outsideEl.value = r.outside_context || "";
    notesEl.value = r.notes || "";
  }

  map.on("click", e => {
    fillForm({ latitude: e.latlng.lat, longitude: e.latlng.lng }, "new");
    openPanel();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!form.reportValidity()) {
      const invalid = form.querySelector(":invalid");
      if (invalid) {
        invalid.closest("details")?.open = true;
        invalid.scrollIntoView({ behavior: "smooth", block: "center" });
        invalid.focus({ preventScroll: true });
      }
      return;
    }

    submitBtn.textContent = "Submitting…";
    submitBtn.disabled = true;

    const payload = {
      place_id: placeIdEl.value,
      action: actionEl.value,

      audit_datetime: auditDatetimeEl.value,
      restroom_name: restroomNameEl.value,
      researcher_name: researcherNameEl.value,

      address: addressEl.value,
      latitude: latEl.value,
      longitude: lngEl.value,

      open_when_visited: openWhenVisitedEl.value,
      advertised_hours: hoursEl.value,

      access_method: accessMethodEl.value,
      findability: findabilityEl.value,

      gender_neutral: genderNeutralEl.value,
      menstrual_products: menstrualProductsEl.value,
      showers_available: showersEl.value,
      water_refill_nearby: waterRefillEl.value,
      visible_signage: signageEl.value,
      security_cameras: camerasEl.value,
      ada_accessible: adaEl.value,

      access_barriers: accessBarriersEl.value,
      overall_impressions: impressionsEl.value,
      outside_context: outsideEl.value,
      notes: notesEl.value
    };

    try {
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload)
      });

      statusEl.textContent = "Thanks! Your suggestion will appear after review.";
      submitBtn.textContent = "Submit suggestion";
      submitBtn.disabled = false;
      form.reset();
      setMode("new");
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Submit failed. Please check your connection and try again.";
      submitBtn.textContent = "Submit suggestion";
      submitBtn.disabled = false;
    }
  });

  // ---- INIT ----
  (async () => {
    const baseline = await loadCsv(BASELINE_CSV_URL);
    const updates = (await loadCsv(UPDATES_CSV_URL)).filter(r => toBool(r.approved));

    const latest = {};
    updates.forEach(u => {
      if (!u.place_id) return;
      if (!latest[u.place_id] || Date.parse(u.timestamp) > Date.parse(latest[u.place_id].timestamp)) {
        latest[u.place_id] = u;
      }
    });

    const merged = baseline.map(b => latest[b.globalid] ? { ...b, ...latest[b.globalid] } : b);
    drawMarkers(merged);
  })();
});
