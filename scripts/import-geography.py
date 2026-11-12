"""Refresh the committed GeoNames snapshot. Runtime never calls GeoNames.
Source: https://download.geonames.org/export/dump/ — CC BY 4.0.
Requires Python 3; run explicitly and review catalog changes before committing.
"""
import datetime
import io
import json
from pathlib import Path
import urllib.request
import zipfile

root = Path(__file__).resolve().parent.parent
base = 'https://download.geonames.org/export/dump/'
def download(name):
    with urllib.request.urlopen(base + name, timeout=90) as response:
        return response.read()

def normalize(text):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFKD', text.lower()) if not unicodedata.combining(c) and c.isalnum())

countries = []
for line in download('countryInfo.txt').decode().splitlines():
    if line.startswith('#') or not line.strip():
        continue
    fields = line.split('\t')
    if fields[0] in ('AN', 'CS'):  # GeoNames retains these retired codes.
        continue
    countries.append(dict(id='country:' + fields[0], name=fields[4], kind='country', parentId=None, population=int(fields[7] or 0), search=normalize(fields[0] + ' ' + fields[1] + ' ' + fields[4])))
country_ids = {c['id'] for c in countries}
cities = []
with zipfile.ZipFile(io.BytesIO(download('cities15000.zip'))) as archive:
    for line in archive.read('cities15000.txt').decode().splitlines():
        f = line.split('\t')
        population = int(f[14] or 0)
        parent = 'country:' + f[8]
        if parent not in country_ids or not (population >= 100000 or f[7] == 'PPLC' or f[8] == 'IL'):
            continue
        cities.append(dict(id='city:' + f[0], name=f[1], kind='city', parentId=parent, population=population, search=normalize(','.join(f[1:4]))))
locations = [dict(id='online', name='Online', kind='online', parentId=None, population=0, search='onlineglobalremote')] + sorted(countries, key=lambda c: c['id']) + sorted(cities, key=lambda c: c['id'])
path = root / 'server/data'
path.mkdir(exist_ok=True)
(path / 'locations.json').write_text('[\n' + ',\n'.join(json.dumps(location, ensure_ascii=False, separators=(',', ':')) for location in locations) + '\n]\n')
languages = []
for line in download('iso-languagecodes.txt').decode().splitlines()[1:]:
    fields = line.split('\t')
    if len(fields) >= 4 and len(fields[2]) == 2:
        languages.append(dict(code=fields[2], label=fields[3]))
(root / 'shared/languages.json').write_text(json.dumps(sorted(languages, key=lambda l: l['label']), ensure_ascii=False, indent=2) + '\n')
(path / 'README.md').write_text(f'''# Geography snapshot

Source: [GeoNames](https://www.geonames.org/), downloaded {datetime.date.today().isoformat()}.
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data is provided as-is.

Derived from countryInfo.txt, cities15000.zip and iso-languagecodes.txt in
https://download.geonames.org/export/dump/ . Names/aliases and IDs are retained;
search aliases are normalized; retired AN/CS country codes are excluded.
Countries/territories follow the source grouping. This is a discovery catalog,
not a statement about borders or sovereignty.

Includes {len(countries)} countries/territories, {len(cities)} cities (population >=100,000,
capitals, plus Israeli cities in cities15000), and a separate Online location.
The language catalog includes {len(languages)} two-letter ISO languages.
Smaller towns outside this coverage can be added later without changing IDs.
No coordinates, IP location lookup, or external service calls are needed at runtime.

Refresh explicitly with `python3 scripts/import-geography.py` and review the diff.
Migrations upsert catalog rows; removed records are retained to preserve references.
''')
print(f'{len(countries)} countries, {len(cities)} cities, {len(languages)} languages')
