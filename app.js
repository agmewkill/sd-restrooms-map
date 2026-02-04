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

  /* ---------------- REQUIRED ELEMENTS ---------------- */
  const panel = $("panel");
  const form = $("surveyForm");
  const submitBtn = $("submitBtn");
  const statusEl = $("status");

  if (!panel || !form || !submitBtn || !statusEl) {
    console.error("Missing #panel, #surveyForm, #submitBtn, or #status in index.html");
    return;
  }

  /* ---------------- FORM ELEMENTS ---------------- */
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

  /* ---------------- MAP INIT ---------------- */
  let leafletMap;
  try {
    leafletMap = L.map("map").setView([32.7157, -117.1611], 12);
  } catch (e) {
    console.error("Leaflet failed to initialize. Check leaflet.js loaded.", e);
    return;
  }

  // safe global name (avoid colliding with #map id)
  window.leafletMap = leafletMap;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(leafletMap);

  const leafletMarkers = L.layerGroup().addTo(leafletMap);

  function safeInvalidate() {
    try {
      leafletMap.invalidateSize();
    } catch (_) {}
  }

  window.addEventListener("load", () => setTimeout(safeInvalidate, 250));
  window.addEventListener("resize", () => setTimeout(safeInvalidate, 120));

  /* ---------------- PANEL OPEN/CLOSE (MOBILE) ---------------- */
  function openPanel() {
    if (isMobile()) panel.classList.add("open");
    setTimeout(safeInvalidate, 250);
    updateMobileToggleLabel();
  }

  function closePanel() {
    if (isMobile()) panel.classList.remove("open");
    setTimeout(safeInvalidate, 250);
    updateMobileToggleLabel();
  }

  function togglePanel() {
    if (!isMobile()) return;
    panel.classList.toggle("open");
    setTimeout(safeInvalidate, 250);
    updateMobileToggleLabel();
  }

  const drawerHeader = $("drawerHeader");
  if (drawerHeader) drawerHeader.addEventListener("click", togglePanel);

  /* ---------------- MODE INDICATOR ---------------- */
  function setMode(mode) {
    const m = $("modeIndicator");
    if (!m) return;
    m.className = mode === "update" ? "mode update" : "mode new";
    m.hidden = false;
    m.textContent =
      mode === "update"
        ? "Suggest a change to this restroom"
        : "Suggest a new restroom location";
  }

  /* ---------------- MOBILE TOGGLE BUTTON ---------------- */
  const mobileToggleBtn = $("mobileToggleBtn");
  const mobileToggleLabel = $("mobileToggleLabel");

  function updateMobileToggleLabel() {
    if (!mobileToggleLabel) return;
    if (!isMobile()) return; // button hidden by CSS
    const open = panel.classList.contains("open");
    // if panel open, next action is to view MAP
    mobileToggleLabel.textContent = open ? "Map" : "Form";
  }

  if (mobileToggleBtn) mobileToggleBtn.addEventListener("click", togglePanel);
  window.addEventListener("resize", updateMobileToggleLabel);
  updateMobileToggleLabel();

  /* ---------------- CSV LOADING ---------------- */
  async function loadCsv(url) {
    const res = await fetch(url);
    const t = await res.text();
    return Papa.parse(t, { header: true, skipEmptyLines: true }).data;
  }

  /* ---------------- MARKERS ---------------- */
  function popupHtml(r) {
    return `
      <strong>${esc(r.restroom_name || r.name)}</strong><br>
      ${esc(r.address || "")}<br>
      ${esc(r.open_when_visited || r.restroom_open_status || "")}<br>
      <button data-update type="button">Suggest a change</button>
    `;
  }

  function drawMarkers(rows) {
    leafletMarkers.clearLayers();

    rows.forEach((r) => {
      const lat = +r.latitude;
      const lng = +r.longitude;
      if (!lat || !lng) return;

      const m = L.marker([lat, lng]).addTo(leafletMarkers);
      m.bindPopup(popupHtml(r));

      m.on("popupopen", (e) => {
        const root = e.popup.getElement();
        if (!root) return;
        const btn = root.querySelector("[data-update]");
        if (!btn) return;

        btn.onclick = () => {
          fillForm(r, "update");
          openPanel();
        };
      });
    });
  }

  /* ---------------- FILL FORM ---------------- */
  function fillForm(r, mode) {
    if (placeIdEl) placeIdEl.value = r.globalid || r.place_id || "";
    if (actionEl) actionEl.value = mode;

    setMode(mode);

    if (auditDatetimeEl) auditDatetimeEl.value = r.audit_datetime || "";
    if (restroomNameEl) restroomNameEl.value = r.restroom_name || r.name || "";
    if (researcherNameEl) researcherNameEl.value = r.researcher_name || "";

    if (addressEl) addressEl.value = r.address || "";
    if (latEl) latEl.value = r.latitude || "";
    if (lngEl) lngEl.value = r.longitude || "";

    if (openWhenVisitedEl) openWhenVisitedEl.value = r.open_when_visited || "";
    if (hoursEl) hoursEl.value = r.advertised_hours || r.hours || "";

    if (accessMethodEl) accessMethodEl.value = r.access_method || "";
    if (findabilityEl) findabilityEl.value = r.findability || "";

    if (genderNeutralEl) genderNeutralEl.value = r.gender_neutral || "";
    if (menstrualProductsEl) menstrualProductsEl.value = r.menstrual_products || "";
    if (showersEl) showersEl.value = r.showers_available || "";
    if (waterRefillEl) waterRefillEl.value = r.water_refill_nearby || "";
    if (signageEl) signageEl.value = r.visible_signage || "";
    if (camerasEl) camerasEl.value = r.security_cameras || "";
    if (adaEl) adaEl.value = r.ada_accessible || "";

    if (accessBarriersEl) accessBarriersEl.value = r.access_barriers || "";
    if (impressionsEl) impressionsEl.value = r.overall_impressions || "";
    if (outsideEl) outsideEl.value = r.outside_context || "";
    if (notesEl) notesEl.value = r.notes || "";
  }

  /* ---------------- MAP CLICK -> NEW RESTROOM ---------------- */
  leafletMap.on("click", (e) => {
    fillForm({ latitude: e.latlng.lat, longitude: e.latlng.lng }, "new");
    openPanel();
  });

  /* ---------------- NEW RESTROOM BUTTON ---------------- */
  const newRestroomBtn = $("newRestroomBtn");
  if (newRestroomBtn) {
    newRestroomBtn.addEventListener("click", () => {
      form.reset();
      if (actionEl) actionEl.value = "new";
      setMode("new");
      openPanel();
      setTimeout(() => {
        if (restroomNameEl) restroomNameEl.focus();
      }, 200);
    });
  }

  /* ---------------- SUBMIT ---------------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Browser validation (helps mobile)
    if (!form.reportValidity()) {
      const invalid = form.querySelector(":invalid");
      if (invalid) {
        const d = invalid.closest("details");
        if (d) d.open = true;
        invalid.scrollIntoView({ behavior: "smooth", block: "center" });
        invalid.focus({ preventScroll: true });
      }
      return;
    }

    submitBtn.textContent = "Submitting…";
    submitBtn.disabled = true;

    const payload = {
      place_id: placeIdEl ? placeIdEl.value : "",
      action: actionEl ? actionEl.value : "new",

      audit_datetime: auditDatetimeEl ? auditDatetimeEl.value : "",
      restroom_name: restroomNameEl ? restroomNameEl.value : "",
      researcher_name: researcherNameEl ? researcherNameEl.value : "",

      address: addressEl ? addressEl.value : "",
      latitude: latEl ? latEl.value : "",
      longitude: lngEl ? lngEl.value : "",

      open_when_visited: openWhenVisitedEl ? openWhenVisitedEl.value : "",
      advertised_hours: hoursEl ? hoursEl.value : "",

      access_method: accessMethodEl ? accessMethodEl.value : "",
      findability: findabilityEl ? findabilityEl.value : "",

      gender_neutral: genderNeutralEl ? genderNeutralEl.value : "",
      menstrual_products: menstrualProductsEl ? menstrualProductsEl.value : "",
      showers_available: showersEl ? showersEl.value : "",
      water_refill_nearby: waterRefillEl ? waterRefillEl.value : "",
      visible_signage: signageEl ? signageEl.value : "",
      security_cameras: camerasEl ? camerasEl.value : "",
      ada_accessible: adaEl ? adaEl.value : "",

      access_barriers: accessBarriersEl ? accessBarriersEl.value : "",
      overall_impressions: impressionsEl ? impressionsEl.value : "",
      outside_context: outsideEl ? outsideEl.value : "",
      notes: notesEl ? notesEl.value : "",
    };

    try {
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
      });

      statusEl.textContent = "Submitted ✓ Thank you!";
      submitBtn.textContent = "Submit suggestion";
      submitBtn.disabled = false;

      // reset + KEEP PANEL OPEN (mobile + desktop)
      form.reset();
      setMode("new");
      panel.scrollTop = 0;

      if (isMobile()) {
        panel.classList.add("open"); // keep open on mobile
      }

      updateMobileToggleLabel();
      setTimeout(safeInvalidate, 250);
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        "Submit failed. Please check your connection and try again.";
      submitBtn.textContent = "Submit suggestion";
      submitBtn.disabled = false;
    }
  });

  /* ---------------- INIT ---------------- */
  (async () => {
    try {
      const baseline = await loadCsv(BASELINE_CSV_URL);
      const updates = (await loadCsv(UPDATES_CSV_URL)).filter((r) =>
        toBool(r.approved)
      );

      const latest = {};
      updates.forEach((u) => {
        if (!u.place_id) return;
        if (
          !latest[u.place_id] ||
          Date.parse(u.timestamp) > Date.parse(latest[u.place_id].timestamp)
        ) {
          latest[u.place_id] = u;
        }
      });

      const merged = baseline.map((b) =>
        latest[b.globalid] ? { ...b, ...latest[b.globalid] } : b
      );

      drawMarkers(merged);
      setTimeout(safeInvalidate, 200);
      updateMobileToggleLabel();

      // if you want the form to start open on mobile:
      if (isMobile()) {
        panel.classList.add("open");
        updateMobileToggleLabel();
        setTimeout(safeInvalidate, 250);
      }
    } catch (err) {
      console.error("Failed to load baseline/updates CSV:", err);
    }
  })();
});
