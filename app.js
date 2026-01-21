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

/* ---------------- CSV LOAD ---------------- */
async function loadCsv(url) {
  const t = await (await fetch(url)).text();
  return Papa.parse(t, { header:true, skipEmptyLines:true }).data;
}

/* ---------------- MARKERS ---------------- */
function popupHtml(r) {
  return `
    <strong>${esc(r.name)}</strong><br>
    ${esc(r.address || "")}<br>
    ${r.restroom_open_status || ""}<br>
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
  document.getElementById("place_id").value = r.globalid || "";
  document.getElementById("action").value = mode;
  document.getElementById("name").value = r.name || "";
  document.getElementById("address").value = r.address || "";
  document.getElementById("latitude").value = r.latitude || "";
  document.getElementById("longitude").value = r.longitude || "";
  setMode(mode);
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
    place_id: place_id.value,
    action: action.value,
    name: name.value,
    address: address.value,
    latitude: latitude.value,
    longitude: longitude.value,
    restroom_open_status: restroom_open_status.value,
    advertised_hours: advertised_hours.value,
    ada_accessible: ada_accessible.checked,
    gender_neutral: gender_neutral.checked,
    baby_changing: baby_changing.checked,
    notes: notes.value
  };

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
};

/* ---------------- INIT ---------------- */
(async () => {
  const baseline = await loadCsv(BASELINE_CSV_URL);
  const updates = (await loadCsv(UPDATES_CSV_URL))
    .filter(r => toBool(r.approved));

  const latest = {};
  updates.forEach(u => {
    if (!latest[u.place_id] || Date.parse(u.timestamp) > Date.parse(latest[u.place_id].timestamp))
      latest[u.place_id] = u;
  });

  const merged = baseline.map(b => latest[b.globalid] ? { ...b, ...latest[b.globalid] } : b);
  drawMarkers(merged);
})();
