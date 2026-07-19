from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any
from functools import lru_cache
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from shapely.geometry import Point, shape

from .scenarios import STATES, ScenarioStore


DATA_DIR = Path(os.environ.get("ROAD_EDITOR_DATA_DIR", Path(__file__).parents[1] / "data"))
BASELINE_DIR = DATA_DIR / "baseline"
STATIC_DIR = Path(__file__).parent / "static"
store = ScenarioStore(DATA_DIR)
app = FastAPI(title="Lake County Road Network Editor", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

FEMA_OPEN_SHELTERS_URL = "https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer/0/query"
LIVE_SHELTER_CACHE_SECONDS = 120
_live_shelter_cache: dict[str, Any] = {"expires_at": 0.0, "payload": None}


def _baseline_path(filename: str) -> Path:
    path = BASELINE_DIR / filename
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail="Lake baseline is not prepared. Run the documented prepare_lake_network.py Docker command first.",
        )
    return path


def _live_shelter_payload() -> dict[str, Any]:
    """Retrieve the current FEMA Open Shelters feed for the editable road scope."""
    now = datetime.now(timezone.utc)
    now_timestamp = now.timestamp()
    cached = _live_shelter_cache["payload"]
    if cached and now_timestamp < _live_shelter_cache["expires_at"]:
        return cached

    query = urlencode({
        "where": "state = 'CA'",
        "outFields": ",".join((
            "shelter_id", "shelter_name", "address", "city", "state", "zip",
            "shelter_status", "evacuation_capacity", "post_impact_capacity",
            "total_population", "hours_open", "hours_close", "org_name",
            "ada_compliant", "pet_accommodations_code", "wheelchair_accessible",
        )),
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    })
    try:
        with urlopen(f"{FEMA_OPEN_SHELTERS_URL}?{query}", timeout=20) as response:
            source = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="Could not retrieve FEMA Open Shelters right now.") from exc

    scope = json.loads(_baseline_path("scope.json").read_text(encoding="utf-8"))
    scope_geometry = shape(scope["scope_geometry"])
    features: list[dict[str, Any]] = []
    for feature in source.get("features", []):
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates")
        if not coordinates or len(coordinates) < 2:
            continue
        longitude, latitude = coordinates[:2]
        if not scope_geometry.covers(Point(longitude, latitude)):
            continue
        properties = feature.get("properties") or {}
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
            "properties": {
                "id": str(properties.get("shelter_id") or properties.get("objectid") or ""),
                "name": properties.get("shelter_name") or "Unnamed shelter",
                "status": properties.get("shelter_status") or "Open",
                "is_currently_open": True,
                "address": properties.get("address"),
                "city": properties.get("city"),
                "state": properties.get("state"),
                "capacity": properties.get("evacuation_capacity") or properties.get("post_impact_capacity"),
                "population": properties.get("total_population"),
                "hours_open": properties.get("hours_open"),
                "hours_close": properties.get("hours_close"),
            },
        })
    payload = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "source": "FEMA Open Shelters",
            "fetched_at": now.isoformat(),
            "cache_seconds": LIVE_SHELTER_CACHE_SECONDS,
        },
    }
    _live_shelter_cache["payload"] = payload
    _live_shelter_cache["expires_at"] = now_timestamp + LIVE_SHELTER_CACHE_SECONDS
    return payload


@lru_cache(maxsize=256)
def _load_tile(tile_x: int, tile_y: int) -> dict[str, Any]:
    path = BASELINE_DIR / "road_tiles" / f"{tile_x}_{tile_y}.geojson"
    if not path.exists():
        return {"type": "FeatureCollection", "features": []}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "baseline_ready": (BASELINE_DIR / "graph.json").exists(),
        "scope": "Lake County plus a small cross-border buffer",
        "cycle": list(STATES),
    }


@app.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str) -> dict[str, Any]:
    return {"scenario_id": scenario_id, "segment_states": store.get(scenario_id), "cycle": list(STATES)}


@app.get("/api/scope")
def scope() -> dict[str, Any]:
    return json.loads(_baseline_path("scope.json").read_text(encoding="utf-8"))


@app.get("/api/shelters")
def shelters() -> dict[str, Any]:
    return json.loads(_baseline_path("shelters.geojson").read_text(encoding="utf-8"))


@app.get("/api/shelters/live")
def live_shelters() -> dict[str, Any]:
    return _live_shelter_payload()


@app.get("/api/study-area")
def study_area() -> dict[str, Any]:
    return json.loads(_baseline_path("study_area.geojson").read_text(encoding="utf-8"))


@app.get("/api/network")
def network(bbox: str, zoom: int, scenario_id: str = "default") -> dict[str, Any]:
    try:
        min_lon, min_lat, max_lon, max_lat = (float(value) for value in bbox.split(","))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="bbox must be min_lon,min_lat,max_lon,max_lat") from exc
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(status_code=422, detail="bbox must have increasing longitude and latitude")
    scope = json.loads(_baseline_path("scope.json").read_text(encoding="utf-8"))
    tile_size = float(scope["tile_size_degrees"])
    if zoom < 11:
        payload = json.loads(_baseline_path("overview_roads.geojson").read_text(encoding="utf-8"))
    else:
        x_values = range(math.floor(min_lon / tile_size), math.floor(max_lon / tile_size) + 1)
        y_values = range(math.floor(min_lat / tile_size), math.floor(max_lat / tile_size) + 1)
        if len(x_values) * len(y_values) > 100:
            raise HTTPException(status_code=413, detail="Zoom in one level to load local road segments.")
        payload = {"type": "FeatureCollection", "features": []}
        for tile_x in x_values:
            for tile_y in y_values:
                payload["features"].extend(_load_tile(tile_x, tile_y)["features"])
    states = store.get(scenario_id)
    for feature in payload["features"]:
        segment_id = feature["properties"]["segment_id"]
        feature["properties"]["scenario_state"] = states.get(segment_id, "open")
    return payload


@app.post("/api/scenarios/{scenario_id}/segments/{segment_id}/cycle")
def cycle_segment(scenario_id: str, segment_id: str) -> dict[str, str]:
    try:
        state = store.cycle(scenario_id, segment_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"scenario_id": scenario_id, "segment_id": segment_id, "state": state}


@app.post("/api/scenarios/{scenario_id}/clear")
def clear_scenario(scenario_id: str) -> dict[str, str]:
    try:
        store.clear(scenario_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"scenario_id": scenario_id, "status": "cleared"}
