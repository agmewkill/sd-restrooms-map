const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwTUAGegDO_w2Hh1W0aPiFTmiVlYF-8zfMX_M4QQ_AyaPaB2HlETTOMq1xseZk9Y_Xpsw/exec";

const UPDATES_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTqaGnxOFnazRsFkP-J3tx0cMtjDi2a8-jLHR44XnjbUMIRudAtprAmulLVCD8nDxS-LbZghRA5TFrk/pub?gid=436844958&single=true&output=csv";

const BASELINE_CSV_URL = "data/restrooms_baseline_public.csv";

/* ---------------- MAP ---------------- */
const map = L.map("map").setView([32.7157, -117.1611], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

/* ---------------- MOBILE PANEL ---------------- */
const isMobile = () => window.matchMedia("(max-width: 900px)").matches;
const panel = document.getElementById("panel");

function openPanel() { if (isMobile()) panel.classList.add("open"); }
function togglePanel() { if (isMobile()) panel.classList.toggle("open"); }

document.getElementById("drawerHeader")
  ?.addEventListener("click", togglePanel);

/* ---------------- HELPERS ---------------- */
const toBool = v => ["true","yes","1"].includes(String(v).toLowerCase());
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
);

function setMode(mode) {
  const m = document.getElementById("modeIndicator");
  if (mode === "update") {
    m.textContent = "Suggest a change to this restroom";
    m.className = "mode update";
  } else {
    m.textContent = "Suggest a new restroom location";
    m.className = "mode new";
  }
}

function getRadioValue(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : "";
}

function setRadioValue(name, value) {
  if (!value) return;
  const el = document.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
  if (el) el.checked = true;
}

/* ---------------- CSV LOAD ---------------- */
async function loadCsv(url) {
  const t = await (await fetch(url)).text();
  return Papa.parse(t, { header:true, skipEmptyLines:true }).data;
}

/* ---------------- MARKERS ---------------- */
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

    const m = L.marker([lat,lng]).addTo(markersLayer);
    m.bindPopup(popupHtml(r));

    m.on("popupopen", e => {
      e.popup.getElement()
        .querySelector("[data-update]")
        .onclick = () => {
          fillForm(r, "update");
          openPanel();
        };
    });
  });
}

/* ---------------- FORM ---------------- */
function fillForm(r, mode) {
  // core
  place_id.value = r.globalid || r.place_id || "";
  action.value = mode;
  setMode(mode);

  // audit + identity
  audit_datetime.value = r.audit_datetime || "";
  restroom_name.value = r.restroom_name || r.name || "";
  researcher_name.value = r.researcher_name || "";

  // location
  address.value = r.address || "";
  latitude.value = r.latitude || "";
  longitude.value = r.longitude || "";

  // visit/ops
  open_when_visited.value = r.open_when_visited || "";
  advertised_hours.value = r.advertised_hours || r.hours || "";

  // radios
  setRadioValue("access_method", r.access_method || "");
  setRadioValue("findability", r.findability || "");

  // dropdown amenities/safety
  gender_neutral.value = r.gender_neutral || "";
  menstrual_products.value = r.menstrual_products || "";
  showers_available.value = r.showers_available || "";
  water_refill_nearby.value = r.water_refill_nearby || "";
  visible_signage.value = r.visible_signage || "";
  security_cameras.value = r.security_cameras || "";
  ada_accessible.value = r.ada_accessible || "";

  // open-ended
  access_barriers.value = r.access_barriers || "";
  overall_impressions.value = r.overall_impressions || "";
  outside_context.value = r.outside_context || "";
  notes.value = r.notes || "";
}

map.on("click", e => {
  fillForm({ latitude:e.latlng.lat, longitude:e.latlng.lng }, "new");
  openPanel();
});

/* ---------------- SUBMIT ---------------- */
document.getElementById("surveyForm").onsubmit = async e => {
  e.preventDefault();

  const btn = submitBtn;
  btn.textContent = "Submitting…";
  btn.disabled = true;

  const payload = {
    // existing routing fields
    place_id: place_id.value,
    action: action.value,

    // audit metadata
    audit_datetime: audit_datetime.value,
    restroom_name: restroom_name.value,
    researcher_name: researcher_name.value,

    // location
    address: address.value,
    latitude: latitude.value,
    longitude: longitude.value,

    // visit/ops
    open_when_visited: open_when_visited.value,
    advertised_hours: advertised_hours.value,
    access_method: getRadioValue("access_method"),
    findability: getRadioValue("findability"),

    // amenities/safety (Yes/No/Unknown)
    gender_neutral: gender_neutral.value,
    menstrual_products: menstrual_products.value,
    showers_available: showers_available.value,
    water_refill_nearby: water_refill_nearby.value,
    visible_signage: visible_signage.value,
    security_cameras: security_cameras.value,
    ada_accessible: ada_accessible.value,

    // open-ended
    access_barriers: access_barriers.value,
    overall_impressions: overall_impressions.value,
    outside_context: outside_context.value,
    notes: notes.value
  };

  try {
    await fetch(APPS_SCRIPT_URL, {
      method:"POST",
      headers:{ "Content-Type":"text/plain" },
      body: JSON.stringify(payload)
    });

    status.textContent = "Thanks! Your suggestion will appear after review.";
    btn.textContent = "Submit suggestion";
    btn.disabled = false;
    e.target.reset();
    setMode("new");
  } catch (err) {
    console.error(err);
    status.textContent = "Something went wrong submitting. Please try again.";
    btn.textContent = "Submit suggestion";
    btn.disabled = false;
  }
};

/* ---------------- INIT ---------------- */
(async () => {
  const baseline = await loadCsv(BASELINE_CSV_URL);
  const updates = (await loadCsv(UPDATES_CSV_URL))
    .filter(r => toBool(r.approved));

  // keep most recent update per place_id
  const latest = {};
  updates.forEach(u => {
    const key = u.place_id;
    if (!key) return;
    if (!latest[key] || Date.parse(u.timestamp) > Date.parse(latest[key].timestamp)) {
      latest[key] = u;
    }
  });

  // merge latest update onto baseline row by globalid
  const merged = baseline.map(b => latest[b.globalid]
    ? { ...b, ...latest[b.globalid] }
    : b
  );

  drawMarkers(merged);
})();
