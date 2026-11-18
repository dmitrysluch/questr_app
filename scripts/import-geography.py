"""Generate an external GeoNames location catalog. Runtime never calls GeoNames.
Source: https://download.geonames.org/export/dump/ — CC BY 4.0.
Requires Python 3; run explicitly before starting the app with a new catalog.
"""
import argparse
import io
import json
import os
from pathlib import Path
import urllib.request
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--languages', action='store_true', help='also refresh the tracked language catalog')
args = parser.parse_args()
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
catalog_path = Path(os.environ.get('LOCATION_CATALOG_PATH', root / 'local/locations.json')).resolve()
catalog_path.parent.mkdir(parents=True, exist_ok=True)
catalog_path.write_text('[\n' + ',\n'.join(json.dumps(location, ensure_ascii=False, separators=(',', ':')) for location in locations) + '\n]\n')
if args.languages:
    languages = []
    for line in download('iso-languagecodes.txt').decode().splitlines()[1:]:
        fields = line.split('\t')
        if len(fields) >= 4 and len(fields[2]) == 2:
            languages.append(dict(code=fields[2], label=fields[3]))
    (root / 'shared/languages.json').write_text(json.dumps(sorted(languages, key=lambda l: l['label']), ensure_ascii=False, indent=2) + '\n')
print(f'{len(countries)} countries, {len(cities)} cities; wrote {catalog_path}')
