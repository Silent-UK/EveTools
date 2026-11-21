"""Build the compact moon ID index used to validate EVE clipboard scans."""
import gzip
import json
import sys
import zipfile
from pathlib import Path

with zipfile.ZipFile(sys.argv[1]) as archive:
    def records(name):
        with archive.open(name + '.jsonl') as file:
            for line in file:
                yield json.loads(line)

    regions = {r['_key']: r['name']['en'] for r in records('mapRegions')}
    constellations = {r['_key']: r['name']['en'] for r in records('mapConstellations')}
    systems = {r['_key']: [r['name']['en'], regions[r['regionID']], constellations[r['constellationID']]]
               for r in records('mapSolarSystems')}
    planets = {r['_key']: r['celestialIndex'] for r in records('mapPlanets')}
    moons = [[r['_key'], r['solarSystemID'], r['orbitID'], planets[r['orbitID']], r['orbitIndex']]
             for r in records('mapMoons')]

target = Path(sys.argv[2] if len(sys.argv) > 2 else 'lib/moon-celestials.json.gz')
payload = json.dumps({'systems': systems, 'moons': moons}, separators=(',', ':'), ensure_ascii=False)
target.write_bytes(gzip.compress(payload.encode('utf-8'), mtime=0))
print(f'Indexed {len(moons):,} moons from {Path(sys.argv[1]).name}.')
