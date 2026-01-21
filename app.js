// WRITE endpoint (Apps Script Web App) — for submitting survey responses
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwTUAGegDO_w2Hh1W0aPiFTmiVlYF-8zfMX_M4QQ_AyaPaB2HlETTOMq1xseZk9Y_Xpsw/exec";

// READ endpoint (Published-to-web CSV) — for showing submissions on the map
const UPDATES_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTqaGnxOFnazRsFkP-J3tx0cMtjDi2a8-jLHR44XnjbUMIRudAtprAmulLVCD8nDxS-LbZghRA5TFrk/pub?gid=436844958&single=true&output=csv";

// 
const BASELINE_CSV_URL = "data/restrooms.csv";

// --- Map setup ---
const map = L.map("map").setView([32.7157, -117.1611], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

// --- Helpers ---
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function toBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1";
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

// --- Data loading ---
async function loadCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parsed.data;
}

async function loadBaseline() {
  return loadCsv(BASELINE_CSV_URL);
}

async function loadUpdates() {
  return loadCsv(UPDATES_CSV_URL);
}

// --- Merge logic ---
// Keep only latest approved update per place_id
function pickLatestApprovedByPlaceId(rows) {
  const approvedWithId = rows
    .filter(r => toBool(r.approved))
    .filter(r => String(r.place_id || "").trim() !== "");

  const byId = new Map();
  for (const r of approvedWithId) {
    const id = String(r.place_id).trim();
    const t = Date.parse(r.timestamp || "") || 0;
    const cur = byId.get(id);
    if (!cur || t > cur._t) byId.set(id, { ...r, _t: t });
  }
  return byId;
}

function applyUpdateToBaselineRow(b, u) {
  const out = { ...b };

  const setIf = (key, val) => {
    if (val === undefined || val === null) return;
    const s = String(val).trim();
    if (s === "") return;
    out[key] = val;
  };

  // Text
  setIf("name", u.name);
  setIf("address", u.address);
  setIf("restroom_open_status", u.restroom_open_status);
  setIf("advertised_hours", u.advertised_hours);

  // Lat/lng
  const lat = Number(u.latitude);
  const lng = Number(u.longitude);
  if (Number.isFinite(lat)) out.latitude = lat;
  if (Number.isFinite(lng)) out.longitude = lng;

  // Booleans: override if provided
  if (String(u.ada_accessible ?? "").trim() !== "") out.ada_accessible = toBool(u.ada_accessible) ? "Yes" : "No";
  if (String(u.gender_neutral ?? "").trim() !== "") out.gender_neutral = toBool(u.gender_neutral) ? "Yes" : "No";
  if (String(u.baby_changing ?? "").trim() !== "") out.baby_changing = toBool(u.baby_changing) ? "Yes" : "No";

  return out;
}

// Approved “new points” (action=new) get added as extra markers
function getApprovedNewPoints(rows) {
  return rows
    .filter(r => toBool(r.approved))
    .filter(r => String(r.action || "").toLowerCase() === "new")
    .filter(r => {
      const lat = Number(r.latitude), lng = Number(r.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng);
    })
    .map(r => ({
      globalid: r.place_id || "", // may be blank for new
      name: r.name || "(New submission)",
      address: r.address || "",
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      restroom_open_status: r.restroom_open_status || "",
      advertised_hours: r.advertised_hours || "",
      ada_accessible: String(r.ada_accessible ?? ""),
      gender_neutral: String(r.gender_neutral ?? ""),
      baby_changing: String(r.baby_changing ?? "")
    }));
}

// --- Rendering ---
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

// Click map -> prepare new point submission
map.on("click", (e) => {
  setFormForNew(e.latlng.lat, e.latlng.lng);
  document.getElementById("panel").scrollIntoView({ behavior: "smooth" });
});

// --- Submit handler (writes to the sheet) ---
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

    if (out.ok) {
      status.textContent = "Submitted! It will appear on the map once approved.";
      evt.target.reset();
    } else {
      status.textContent = "Submission failed: " + (out.error || out.raw || "Unknown error");
    }
  } catch (err) {
    status.textContent = "Submission failed: " + String(err);
  } finally {
    btn.disabled = false;
  }
});

// --- Init: load baseline + updates, merge, render ---
(async function init() {
  const c = map.getCenter();
  setFormForNew(c.lat, c.lng);

  const baseline = await loadBaseline();
  const updates = await loadUpdates();

  const latestUpdatesById = pickLatestApprovedByPlaceId(updates);

  const mergedBaseline = baseline.map(b => {
    const id = String(b.globalid || "").trim();
    const u = latestUpdatesById.get(id);
    return u ? applyUpdateToBaselineRow(b, u) : b;
  });

  const newPoints = getApprovedNewPoints(updates);

  addMarkers([...mergedBaseline, ...newPoints]);
})();
