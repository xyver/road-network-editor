const scenarioId = "default";
let lakeCountyView = { center: [39.08, -122.76], zoom: 10 };
const map = L.map("map", { preferCanvas: true }).setView(lakeCountyView.center, lakeCountyView.zoom);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors © CARTO",
}).addTo(map);
const stateColors = { open: "#19b84b", forward_only: "#1687e8", reverse_only: "#8f42df", closed: "#ef3434" };
let roads;
let roadHitAreas;
let shelters;
let liveShelters;
let studyFog;
let countyOutlines;
let loadTimer;
const scenarioMarkers = new Map();

function selectedRoadTypes() {
  const types = new Set();
  document.querySelectorAll("#road-type-filters input:checked").forEach(input => {
    input.value.split(",").forEach(type => types.add(type));
  });
  return types;
}
function clearScenarioMarkers() {
  scenarioMarkers.forEach(marker => map.removeLayer(marker));
  scenarioMarkers.clear();
}

const centerControl = L.control({ position: "topleft" });
centerControl.onAdd = () => {
  const button = L.DomUtil.create("button", "lake-center-control");
  button.type = "button";
  button.title = "Center map on Lake County";
  button.setAttribute("aria-label", "Center map on Lake County");
  button.textContent = "Center Lake County";
  L.DomEvent.disableClickPropagation(button);
  L.DomEvent.on(button, "click", () => map.setView(lakeCountyView.center, lakeCountyView.zoom));
  return button;
};
centerControl.addTo(map);

function style(feature) {
  const state = feature.properties.scenario_state || "open";
  return { color: stateColors[state], weight: state === "open" ? 2.7 : 4.2, opacity: state === "open" ? .86 : 1 };
}
function iconSize() {
  return Math.max(18, Math.min(38, 18 + (map.getZoom() - 9) * 3.5));
}
function segmentMidpoint(feature) {
  const coordinates = feature.geometry.coordinates;
  return coordinates[Math.floor(coordinates.length / 2)];
}
function segmentAngle(feature, state) {
  const coordinates = feature.geometry.coordinates;
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  let angle = -Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
  if (state === "reverse_only") angle += 180;
  return angle;
}
function scenarioIcon(feature, state) {
  const size = iconSize();
  const closed = state === "closed";
  const symbol = closed ? "×" : "➜";
  const rotation = closed ? 0 : segmentAngle(feature, state);
  const className = `road-scenario-icon is-${state}`;
  return L.divIcon({
    className: "scenario-icon-wrapper",
    html: `<span class="${className}" style="width:${size}px;height:${size}px;font-size:${size}px;transform:rotate(${rotation}deg)">${symbol}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
function updateScenarioMarker(feature) {
  const id = feature.properties.segment_id;
  const state = feature.properties.scenario_state || "open";
  const existing = scenarioMarkers.get(id);
  if (state === "open") {
    if (existing) {
      map.removeLayer(existing);
      scenarioMarkers.delete(id);
    }
    return;
  }
  const midpoint = segmentMidpoint(feature);
  if (existing) {
    existing.setLatLng([midpoint[1], midpoint[0]]);
    existing.setIcon(scenarioIcon(feature, state));
    return;
  }
  const marker = L.marker([midpoint[1], midpoint[0]], {
    icon: scenarioIcon(feature, state),
    interactive: true,
    keyboard: false,
    zIndexOffset: 1000,
  }).addTo(map);
  marker.on("click", event => {
    L.DomEvent.stopPropagation(event.originalEvent);
    if (marker.__scenarioFeature && marker.__scenarioRoadLayer) {
      cycle(marker.__scenarioFeature, marker.__scenarioRoadLayer).catch(error => alert(error.message));
    }
  });
  scenarioMarkers.set(id, marker);
}
function resizeScenarioMarkers() {
  scenarioMarkers.forEach((marker, id) => {
    const feature = marker.__scenarioFeature;
    if (feature) marker.setIcon(scenarioIcon(feature, feature.properties.scenario_state));
  });
}
function selectedText(properties) {
  return `${properties.name} · ${properties.highway}<br><strong>${properties.scenario_state || "open"}</strong><br><small>${properties.segment_id}</small>`;
}
async function cycle(feature, layer) {
  const id = encodeURIComponent(feature.properties.segment_id);
  const response = await fetch(`/api/scenarios/${scenarioId}/segments/${id}/cycle`, { method: "POST" });
  if (!response.ok) throw new Error((await response.json()).detail || "Could not change segment state");
  const result = await response.json();
  feature.properties.scenario_state = result.state;
  layer.setStyle(style(feature));
  updateScenarioMarker(feature);
  const marker = scenarioMarkers.get(feature.properties.segment_id);
  if (marker) {
    marker.__scenarioFeature = feature;
    marker.__scenarioRoadLayer = layer;
  }
  document.querySelector("#selection").innerHTML = `Selected: <strong>${feature.properties.name}</strong><br>State: ${result.state}`;
}
async function clearRoadChanges() {
  if (!window.confirm("Reset every edited road in this scenario to its normal baseline state?")) return;
  const response = await fetch(`/api/scenarios/${scenarioId}/clear`, { method: "POST" });
  if (!response.ok) throw new Error((await response.json()).detail || "Could not clear road changes.");
  await loadRoads();
  document.querySelector("#selection").textContent = "All road changes cleared; every segment is back to its normal baseline state.";
}
async function loadRoads() {
  const bounds = map.getBounds();
  const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",");
  const response = await fetch(`/api/network?scenario_id=${scenarioId}&zoom=${map.getZoom()}&bbox=${bbox}`);
  if (!response.ok) throw new Error((await response.json()).detail || "Could not load roads for this map area.");
  const network = await response.json();
  const types = selectedRoadTypes();
  network.features = network.features.filter(feature => types.has(feature.properties.highway));
  if (roads) map.removeLayer(roads);
  if (roadHitAreas) map.removeLayer(roadHitAreas);
  clearScenarioMarkers();
  const visibleLayers = new Map();
  roads = L.geoJSON(network, { style, onEachFeature(feature, layer) {
    visibleLayers.set(feature.properties.segment_id, layer);
    updateScenarioMarker(feature);
    const marker = scenarioMarkers.get(feature.properties.segment_id);
    if (marker) {
      marker.__scenarioFeature = feature;
      marker.__scenarioRoadLayer = layer;
    }
  }}).addTo(map);
  roadHitAreas = L.geoJSON(network, {
    style: { color: "#000000", weight: 14, opacity: .001, interactive: true },
    onEachFeature(feature, layer) {
      layer.on("click", async () => {
        try { await cycle(feature, visibleLayers.get(feature.properties.segment_id)); } catch (error) { alert(error.message); }
      });
    },
  }).addTo(map);
  const detail = map.getZoom() < 11 ? "major-road overview — zoom in for local streets" : "local editable road segments";
  document.querySelector("#status").textContent = `Loaded ${network.features.length.toLocaleString()} ${detail}.`;
}
function shelterIcon(feature) {
  const state = feature.properties.is_currently_open ? "open" : "closed";
  return L.divIcon({
    className: "shelter-pin-wrapper",
    html: `<span class="shelter-pin is-${state}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 16],
  });
}
function shelterTooltip(feature) {
  const properties = feature.properties;
  const location = [properties.address, properties.city, properties.state].filter(Boolean).join(", ");
  return [properties.name, properties.status, location, properties.capacity ? `Capacity: ${properties.capacity}` : ""].filter(Boolean).join("<br>");
}
async function loadShelters() {
  const payload = await (await fetch("/api/shelters")).json();
  if (shelters) map.removeLayer(shelters);
  shelters = L.markerClusterGroup({ disableClusteringAtZoom: 14, maxClusterRadius: 42, showCoverageOnHover: false });
  payload.features.forEach(feature => {
    const [lon, lat] = feature.geometry.coordinates;
    const marker = L.marker([lat, lon], { icon: shelterIcon(feature), keyboard: false });
    marker.bindTooltip(shelterTooltip(feature), { sticky: true });
    shelters.addLayer(marker);
  });
  shelters.addTo(map);
}
async function loadLiveShelters() {
  const response = await fetch("/api/shelters/live");
  if (!response.ok) throw new Error((await response.json()).detail || "Could not load live FEMA shelter updates.");
  const payload = await response.json();
  if (liveShelters) map.removeLayer(liveShelters);
  liveShelters = L.markerClusterGroup({ disableClusteringAtZoom: 14, maxClusterRadius: 42, showCoverageOnHover: false });
  payload.features.forEach(feature => {
    const [lon, lat] = feature.geometry.coordinates;
    const marker = L.marker([lat, lon], { icon: shelterIcon(feature), keyboard: false, zIndexOffset: 100 });
    marker.bindTooltip(shelterTooltip(feature), { sticky: true });
    liveShelters.addLayer(marker);
  });
  liveShelters.addTo(map);
  const checkedAt = new Date(payload.metadata.fetched_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  document.querySelector("#live-shelter-status").textContent = `FEMA live: ${payload.features.length} open in road scope (checked ${checkedAt}).`;
}
async function loadStudyArea() {
  const payload = await (await fetch("/api/study-area")).json();
  if (studyFog) map.removeLayer(studyFog);
  if (countyOutlines) map.removeLayer(countyOutlines);
  studyFog = L.geoJSON(payload.fog, {
    style: { color: "transparent", weight: 0, fillColor: "#687583", fillOpacity: .24, interactive: false },
  }).addTo(map);
  countyOutlines = L.geoJSON(payload.counties, {
    style: { color: "#657281", weight: 1.2, opacity: .75, fillOpacity: 0, interactive: false },
  }).addTo(map);
}
async function load() {
  const health = await (await fetch("/api/health")).json();
  if (!health.baseline_ready) throw new Error("Baseline is not prepared. Run the Docker prep command in the README.");
  const scope = await (await fetch("/api/scope")).json();
  const [minLon, minLat, maxLon, maxLat] = scope.display_bounds || scope.bounds;
  const scopeBounds = L.latLngBounds([[minLat, minLon], [maxLat, maxLon]]);
  const minimumZoom = map.getBoundsZoom(scopeBounds);
  lakeCountyView = { center: scopeBounds.getCenter(), zoom: minimumZoom };
  map.setMaxBounds(scopeBounds);
  map.setMinZoom(minimumZoom);
  map.fitBounds(scopeBounds, { padding: [10, 10] });
  await loadStudyArea();
  await loadRoads();
  await loadShelters();
  await loadLiveShelters();
  map.on("moveend", () => {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => loadRoads().catch(error => { document.querySelector("#status").textContent = error.message; }), 150);
  });
  map.on("zoomend", resizeScenarioMarkers);
  document.querySelectorAll("#road-type-filters input").forEach(input => {
    input.addEventListener("change", () => loadRoads().catch(error => { document.querySelector("#status").textContent = error.message; }));
  });
  document.querySelector("#clear-road-changes").addEventListener("click", () => {
    clearRoadChanges().catch(error => { document.querySelector("#status").textContent = error.message; });
  });
  window.setInterval(() => {
    loadLiveShelters().catch(error => { document.querySelector("#live-shelter-status").textContent = error.message; });
  }, 5 * 60 * 1000);
}
load().catch(error => { document.querySelector("#status").textContent = error.message; });
