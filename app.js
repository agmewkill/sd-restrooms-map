// app.js (FULL, cleaned, with temp pin + GPS button)
// NOTE: no mobile map/survey toggle button in this version
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
    if (isNaN(d.getTime())) return v; // fall back to raw string if parsing fails
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /* ---------------- REQUIRED ELEMENTS ---------------- */
  const panel = $("panel");
  const form = $("surveyForm");
  const submitBtn = $("submitBtn");
  const statusEl = $("status");

  if (!panel || !form || !submitBtn || !statusEl) {
    console.error("Missing required elements (#panel, #surveyForm, #submitBtn, #status).");
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
    console.error("Leaflet failed to initialize.", e);
    return;
  }

  // Avoid global name collisions with the #map element
  window.leafletMap = leafletMap;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(leafletMap);

  const leafletMarkers = L.layerGroup().addTo(leafletMap);

  function safeInvalidate() {
    try { leafletMap.invalidateSize(); } catch (_) {}
  }

  window.addEventListener("load", () => setTimeout(safeInvalidate, 250));
  window.addEventListener("resize", () => setTimeout(safeInvalidate, 120));

  /* ---------------- DRAFT MARKER (TEMP PIN) ---------------- */
  let draftMarker = null;

  function setDraftMarker(lat, lng) {
    if (draftMarker) {
      leafletMap.removeLayer(draftMarker);
      draftMarker = null;
    }
    draftMarker = L.marker([lat, lng], { keyboard: false }).addTo(leafletMap);
    draftMarker.bindPopup("New restroom location").openPopup();
  }

  function clearDraftMarker() {
    if (draftMarker) {
      leafletMap.removeLayer(draftMarker);
      draftMarker = null;
    }
  }

  /* ---------------- PANEL CONTROL ---------------- */
  function openPanel() {
    if (isMobile()) panel.classList.add("open");
    setTimeout(safeInvalidate, 250);
  }

  function togglePanel() {
    if (!isMobile()) return;
    panel.classList.toggle("open");
    setTimeout(safeInvalidate, 250);
  }

  $("drawerHeader")?.addEventListener("click", togglePanel);

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

  /* ---------------- CSV LOADING ---------------- */
  async function loadCsv(url) {
    const res = await fetch(url);
    const t = await res.text();
    return Papa.parse(t, { header: true, skipEmptyLines: true }).data;
  }

  /* ---------------- MARKERS ---------------- */
  function popupHtml(r) {
    const line = (label, val) => {
      const v = String(val ?? "").trim();
      if (!v) return "";
      return `<div><strong>${esc(label)}:</strong> ${esc(v)}</div>`;
    };

    // Map baseline vs submission field names
    const name = r.restroom_name || r.name || "";
    const address = r.address || "";

    const openStatus = r.open_when_visited || r.restroom_open_status || "";
    const hours = r.advertised_hours || "";

    const showers = r.showers_available || r.showers || "";
    const ada = r.ada_accessible || "";
    const genderNeutral = r.gender_neutral || "";
    const menstrual = r.menstrual_products || "";

    // Baseline-only fields
    const babyChanging = r.baby_changing || "";
    const category = r.category || "";
    const operatedBy = r.operated_by || "";

    // "Updated on" line: show only if this record includes an approved update timestamp
    const updatedOn = r.timestamp ? fmtDate(r.timestamp) : "";
    const updatedLine = updatedOn
      ? `<div style="margin:6px 0 8px; font-size:12px; opacity:.8;">Updated on ${esc(updatedOn)}</div>`
      : "";

    return `
      <div class="popup">
        <div style="font-weight:700; margin-bottom:4px;">
          ${esc(name || "Restroom")}
        </div>

        ${address ? `<div style="margin-bottom:6px;">${esc(address)}</div>` : ""}

        ${updatedLine}

        ${line("Open status", openStatus)}
        ${line("Hours", hours)}
        ${line("Access method", r.access_method)}
        ${line("Findability", r.findability)}

        ${line("ADA accessible", ada)}
        ${line("Gender neutral", genderNeutral)}
        ${line("Menstrual products", menstrual)}
        ${line("Showers", showers)}
        ${line("Water refill nearby", r.water_refill_nearby)}
        ${line("Visible signage", r.visible_signage)}
        ${line("Security cameras", r.security_cameras)}

        ${line("Baby changing", babyChanging)}
        ${line("Category", category)}
        ${line("Operated by", operatedBy)}

        ${line("Access barriers", r.access_barriers)}
        ${line("Overall impressions", r.overall_impressions)}
        ${line("Outside context", r.outside_context)}
        ${line("Notes", r.notes)}

        <div style="margin-top:8px;">
          <button data-update type="button">Suggest a change</button>
        </div>
      </div>
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
          clearDraftMarker(); // don’t show draft pin when editing existing
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
    if (hoursEl) hoursEl.value = r.advertised_hours || r.advertised_hours || "";

    if (accessMethodEl) accessMethodEl.value = r.access_method || "";
    if (findabilityEl) findabilityEl.value = r.findability || "";

    if (genderNeutralEl) genderNeutralEl.value = r.gender_neutral || "";
    if (menstrualProductsEl) menstrualProductsEl.value = r.menstrual_products || "";
    if (showersEl) showersEl.value = r.showers_available || r.showers || "";
    if (waterRefillEl) waterRefillEl.value = r.water_refill_nearby || "";
    if (signageEl) signageEl.value = r.visible_signage || ""; // FIXED
    if (camerasEl) camerasEl.value = r.security_cameras || "";
    if (adaEl) adaEl.value = r.ada_accessible || "";

    if (accessBarriersEl) accessBarriersEl.value = r.access_barriers || "";
    if (impressionsEl) impressionsEl.value = r.overall_impressions || "";
    if (outsideEl) outsideEl.value = r.outside_context || "";
    if (notesEl) notesEl.value = r.notes || "";
  }

  /* ---------------- MAP CLICK -> NEW RESTROOM ---------------- */
  leafletMap.on("click", (e) => {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    setDraftMarker(lat, lng);
    fillForm({ latitude: lat, longitude: lng }, "new");
    openPanel();
  });

  /* ---------------- NEW RESTROOM BUTTON ---------------- */
  const newRestroomBtn = $("newRestroomBtn");
  if (newRestroomBtn) {
    newRestroomBtn.addEventListener("click", () => {
      clearDraftMarker();
      form.reset();
      if (actionEl) actionEl.value = "new";
      setMode("new");
      openPanel();
      setTimeout(() => restroomNameEl?.focus(), 200);
    });
  }

  /* ---------------- GPS BUTTON ---------------- */
  const useLocationBtn = $("useLocationBtn");
  if (useLocationBtn && "geolocation" in navigator) {
    useLocationBtn.addEventListener("click", () => {
      useLocationBtn.disabled = true;
      useLocationBtn.textContent = "Locating…";

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          leafletMap.setView([lat, lng], 17);
          setDraftMarker(lat, lng);

          if (latEl) latEl.value = lat.toFixed(6);
          if (lngEl) lngEl.value = lng.toFixed(6);

          openPanel();

          useLocationBtn.textContent = "Use my location";
          useLocationBtn.disabled = false;
        },
        (err) => {
          console.warn("Geolocation error:", err);
          alert("Unable to access your location. You can tap the map instead.");

          useLocationBtn.textContent = "Use my location";
          useLocationBtn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  } else if (useLocationBtn) {
    // Browser doesn't support geolocation
    useLocationBtn.disabled = true;
    useLocationBtn.textContent = "Location not available";
  }

  /* ---------------- SUBMIT ---------------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

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

      form.reset();
      setMode("new");
      panel.scrollTop = 0;

      clearDraftMarker(); // reset temp pin after submit

      if (isMobile()) panel.classList.add("open");
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

      // Keep only the newest approved update per place_id (baseline uses globalid)
      const latest = {};
      updates.forEach((u) => {
        const key = String(u.place_id ?? "").trim();
        if (!key) return;

        if (!latest[key] || Date.parse(u.timestamp) > Date.parse(latest[key].timestamp)) {
          latest[key] = u;
        }
      });

      // Merge by baseline.globalid <-> updates.place_id
      const merged = baseline.map((b) => {
        const key = String(b.globalid ?? "").trim();
        return latest[key] ? { ...b, ...latest[key] } : b;
      });

      drawMarkers(merged);
      setTimeout(safeInvalidate, 200);

      // 🔑 Ensure panel is visible on mobile on first load
      if (isMobile()) {
        panel.classList.add("open");
        setTimeout(safeInvalidate, 250);
      }
    } catch (err) {
      console.error("Failed to load baseline/updates CSV:", err);
    }
  })();
});
