# Geography catalog generator

The former bundled snapshot was sourced from [GeoNames](https://www.geonames.org/), downloaded 2026-11-12.
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data is provided as-is.

Derived from countryInfo.txt, cities15000.zip and iso-languagecodes.txt in
https://download.geonames.org/export/dump/ . Names/aliases and IDs are retained;
search aliases are normalized; retired AN/CS country codes are excluded.
Countries/territories follow the source grouping. This is a discovery catalog,
not a statement about borders or sovereignty.

Includes 250 countries/territories, 6462 cities (population >=100,000,
capitals, plus Israeli cities in cities15000), and a separate Online location.
The language catalog includes 185 two-letter ISO languages.
Smaller towns outside this coverage can be added later without changing IDs.
No coordinates, IP location lookup, or external service calls are needed at runtime.

Generate an external catalog with `python3 scripts/import-geography.py` (or set
`LOCATION_CATALOG_PATH` to another destination). The generated JSON is not
committed or copied into the application image. Supply that path to the server;
Docker Compose mounts the host file read-only. Migrations upsert catalog rows;
removed records are retained to preserve references. Changing an existing ID's
kind or parent requires an explicit database migration.

Each JSON array item has `id`, `name`, `kind`, `parentId`, `population`, and
`search` fields. `search` contains normalized names and aliases used by search.
The file must contain `online`; every city must have a country parent in the
same file. Run the generator with `--languages` only when intentionally
refreshing the tracked language catalog too.
