# Lake County Road Network Editor

Local-only prototype for road-closure scenarios. This is a standalone project:
it does not import Python/JavaScript from DaedalMap or County Map. It accepts
their prepared/source artifacts as explicit Docker mounts, so it can be moved
to its own repository without code surgery.

## Scope

- study origins: Lake County, California
- road context: Lake County only, plus a small (~9 km) cross-border buffer so
  routes do not stop artificially at the county line
- road source: the local California Geofabrik PBF
- shelter source: the local NSS shelter parquet

The regional graph is never overwritten. Each scenario stores only a mapping
of `segment_id -> state`:

`open -> forward_only -> reverse_only -> closed -> open`

`forward` and `reverse` refer to the direction in which the segment geometry
is stored and drawn. The map highlights the active state after every click.

## First run

From the workspace root:

```powershell
Set-Location road-network-editor
$env:ROAD_EDITOR_OSM_DIR = "C:\path\to\geofabrik"
$env:ROAD_EDITOR_SOURCE_DATA_DIR = "C:\path\to\county-map-data"

docker compose build
docker compose run --rm editor python scripts/prepare_lake_network.py
docker compose up
```

Then open `http://localhost:8123`.

The prep command writes these local, gitignored artifacts under `data/baseline/`:

- `lake_region.osm.pbf` - trimmed regional road extract
- `road_tiles/` - viewport-sized clickable physical road chunks
- `graph.json` - directed graph used by the scenario routing API
- `scope.json` - selected counties and bounds

The mounted inputs are read-only. For this workspace, use:

```powershell
$env:ROAD_EDITOR_OSM_DIR = "C:\Users\Bryan\Desktop\global map\county-map-raw\source_data\osm\geofabrik"
$env:ROAD_EDITOR_SOURCE_DATA_DIR = "C:\Users\Bryan\Desktop\global map\county-map-data"
```

The map cannot zoom or pan outside this small Lake County scope. Its widest
view shows only major roads; zoom in for the full local editable network.

## Deliberate build order

1. **Now:** base map tiles and an editable road-network layer. Clicking a
   segment proves that the UI and persisted graph overlay agree on its stable
   ID and its four-state availability cycle.
2. **Next:** import and display scoped shelter locations as a separately
   toggleable point layer.
3. **Then:** add a map click / geocoder origin control and enable travel-time
   calculations against the active road scenario and selected shelters.

The first graph is intentionally a transparent prototype graph: OSM road ways
are split at their existing OSM nodes, travel times use OSM `maxspeed` where
available and conservative highway-class defaults otherwise, and turn
restrictions are not yet modeled. It is suitable for editing and scenario UX,
not an evacuation-direction authority. The next calibration step is comparing
its baseline times against the existing Valhalla results.

## API

- `GET /api/network?zoom=...&bbox=min_lon,min_lat,max_lon,max_lat` - clickable road
  GeoJSON for the current map viewport, with its scenario state
- `POST /api/scenarios/{scenario_id}/segments/{segment_id}/cycle` - advances
  the four-state cycle

Shelter import and routing endpoints will be added only in phases 2 and 3.

Scenario state is persisted as JSON in `data/scenarios/` and remains after a
container restart.
