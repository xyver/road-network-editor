# Lake County scenario-analysis scripts

These scripts are the editor-native batch lane. They use the small Lake County
graph and its stable segment IDs, so saved road closures, one-way edits, and
shelter changes apply directly. They are intentionally scoped to the current
Lake County plus border-buffer prototype; they are not a California-wide
Valhalla replacement.

## Workflow

```powershell
# 1. Export the current editor state.
docker compose run --rm editor python scripts/export_scenario.py --output data/analysis/scenario.json

# 2. Prepare coordinate origins from a CSV/Parquet.
# Required columns: origin_id (or id), longitude/lon, latitude/lat.
# Optional: origin_name/name and weight (population/equity weight).
docker compose run --rm editor python scripts/prepare_origins.py --input /app/data/analysis/origins.csv --output /app/data/analysis/origins.parquet

# 3. Calculate nearest active-shelter access in one multi-source graph pass.
docker compose run --rm editor python scripts/run_scenario_access.py --origins /app/data/analysis/origins.parquet --scenario /app/data/analysis/scenario.json --output /app/data/analysis/access.parquet

# 4. Compare two result tables.
docker compose run --rm editor python scripts/compare_scenarios.py --baseline /app/data/analysis/baseline.parquet --scenario /app/data/analysis/access.parquet --output /app/data/analysis/comparison.parquet
```

`optimize_shelters.py` accepts the same origins plus a candidate CSV/Parquet
with `candidate_id` (or `id`), `longitude`, `latitude`, and optional `name`.
It uses greedy maximum coverage to recommend up to ten candidates that bring
the most currently underserved weighted origins within the chosen threshold.

```powershell
docker compose run --rm editor python scripts/optimize_shelters.py --origins /app/data/analysis/origins.parquet --candidates /app/data/analysis/candidates.csv --scenario /app/data/analysis/scenario.json --count 10 --threshold-minutes 30 --output /app/data/analysis/recommendations.json
```

## Origin sources

For now, use a normalized CSV/Parquet. The copied `legacy/road_access/`
pipeline remains the source for County Map block-group, tract, or block origin
tables. Export those as coordinate tables, then bring only the Lake study-area
rows into this toolkit. Address lists are simply coordinate CSVs.

The scripts use reverse multi-source Dijkstra from all active shelters, which
returns each origin's nearest shelter time in one graph traversal. This is much
faster than an origin-by-shelter matrix for dynamic Lake scenarios. The first
optimizer is deliberately transparent; capacity, demand, equity, and hazard
constraints are next additions.
