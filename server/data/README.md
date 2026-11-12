# Geography snapshot

Source: [GeoNames](https://www.geonames.org/), downloaded 2026-11-12.
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

Refresh explicitly with `python3 scripts/import-geography.py` and review the diff.
Migrations upsert catalog rows; removed records are retained to preserve references.
