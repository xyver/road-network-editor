# California reference data

`reference_data/california/` is a compact, versioned planning-data package.
It is separate from the editable Lake road baseline and scenario files.

It contains:

- `population_blocks_2020.parquet`: canonical block `loc_id`, population, and
  year. This is the sole population weight for the current optimizer.
- `cejst_classification.parquet` and `cejst_burdens.parquet`: California
  tract-level disadvantaged-community context.
- `nri_counties.parquet` and `future_nri_counties.parquet`: California
  county-level baseline and future risk context.
- `nss_shelters.parquet`: California FEMA shelter inventory snapshot.

`manifest.json` records row counts, sizes, provenance, and population QA. The
population source is 2020 Census P.L. 94-171 `P1_001N`; it is block-level,
matches every current California geometry-spine block ID, has no duplicates,
missing values, or negative counts. Zero-population blocks are retained.

Smart Location is intentionally deferred: it will be a separate California
block-group context package. ClimRR is also deferred because it needs an
explicit grid-versus-aggregation design.

## Rebuild

Download and extract the official California 2020 Census P.L. 94-171 archive,
then run:

```powershell
python scripts/prepare_california_reference_data.py `
  --source-data-root "C:\path\to\county-map-data" `
  --pl-directory ".\data\analysis\ca2020_pl"
```

The large download is local and ignored; only the compact reference package is
versioned.
