const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwTUAGegDO_w2Hh1W0aPiFTmiVlYF-8zfMX_M4QQ_AyaPaB2HlETTOMq1xseZk9Y_Xpsw/exec";

const BASELINE_CSV_URL = "data/restrooms.csv";

const map = L.map("map").setView([32.7157, -117.1611], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function setFormForNew(lat, lng) {
  document.getElementById("place_id").value = "";
  document.getElementById("action").value = "new";
  document.getElementById("latitude").value = lat.toFixed(6);
  document.getElementById("longitude").value = lng.toFixed(6);
}

function setFormForUpdate(placeId, row) {
  document.getElementById("place_id").value = placeId || "";
  document.getElementById("action").value = "update";

  document.getElementById("name").value = row.name || "";
  document.getElementById("address").value = row.address || "";
  document.getElementById("latitude").value = Number(row.latitude || "").toFixed(6);
  document.getElementById("longitude").value = Number(row.longitude || "").toFixed(6);
  document.getElementById("restroom_open_status").value = row.restroom_open_status || "";
  document.getElementById("advertised_hours").value = row.advertised_hours || "";

  const yes = (v) => String(v).toLowerCase() === "yes" || String(v).toLowerCase() === "true";
  document.getElementById("ada_accessible").checked = yes(row.ada_accessible);
  document.getElementById("gender_neutral").checked = yes(row.gender_neutral);
  document.getElementById("baby_changing").checked = yes(row.baby_changing);
}

function popupHtml(row) {
  const name = row.name || "(Unnamed)";
  const addr = row.address || "";
  const open = row.restroom_open_status || "";
  const hours = row.advertised_hours || "";

  return `
    <div style="min-width:220px">
      <div style="font-weight:600">${escapeHtml(name)}</div>
      <div style="font-size:12px; margin-top:4px">${escapeHtml(addr)}</div>
      <div style="font-size:12px; margin-top:6px">
        ${open ? `Status: ${escapeHtml(open)}<br/>` : ""}
        ${hours ? `Hours: ${escapeHtml(hours)}<br/>` : ""}
      </div>
      <button data-action="update" style="margin-top:8px; width:100%">Suggest an update</button>
    </div>
  `;
}

async function loadBaseline() {
  const res = await fetch(BASELINE_CSV_URL, { cache: "no-store" });
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parsed.data;
}

function addMarkers(rows) {
  markersLayer.clearLayers();

  rows.forEach((row) => {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const placeId = row.globalid || ""; // internal key (GlobalID)

    const m = L.marker([lat, lng]).addTo(markersLayer);
    m.bindPopup(popupHtml(row));

    m.on("popupopen", (e) => {
      const btn = e.popup.getElement().querySelector('button[data-action="update"]');
      if (btn) {
        btn.addEventListener("click", () => {
          setFormForUpdate(placeId, row);
          document.getElementById("panel").scrollIntoView({ behavior: "smooth" });
        }, { once: true });
      }
    });
  });
}

// click map -> new point
map.on("click", (e) => {
  setFormForNew(e.latlng.lat, e.latlng.lng);
  document.getElementById("panel").scrollIntoView({ behavior: "smooth" });
});

document.getElementById("surveyForm").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  const status = document.getElementById("status");
  const btn = document.getElementById("submitBtn");

  status.textContent = "";
  btn.disabled = true;

  const payload = {
    place_id: document.getElementById("place_id").value.trim(),
    action: document.getElementById("action").value,
    name: document.getElementById("name").value.trim(),
    address: document.getElementById("address").value.trim(),
    latitude: Number(document.getElementById("latitude").value),
    longitude: Number(document.getElementById("longitude").value),
    restroom_open_status: document.getElementById("restroom_open_status").value,
    advertised_hours: document.getElementById("advertised_hours").value.trim(),
    ada_accessible: document.getElementById("ada_accessible").checked,
    gender_neutral: document.getElementById("gender_neutral").checked,
    baby_changing: document.getElementById("baby_changing").checked,
    notes: document.getElementById("notes").value.trim(),
  };

  if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
    status.textContent = "Please provide valid latitude/longitude.";
    btn.disabled = false;
    return;
  }

  try {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    const txt = await resp.text();
    let out;
    try { out = JSON.parse(txt); } catch { out = { ok: resp.ok, raw: txt }; }

    status.textContent = out.ok ? "Submitted! Thanks — recorded." : ("Submission failed: " + (out.error || out.raw));
    if (out.ok) evt.target.reset();
  } catch (err) {
    status.textContent = "Submission failed: " + String(err);
  } finally {
    btn.disabled = false;
  }
});

(async function init() {
  const c = map.getCenter();
  setFormForNew(c.lat, c.lng);

  const baseline = await loadBaseline();
  addMarkers(baseline);
})();
