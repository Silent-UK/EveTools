"""Build public NPC station lookup data from an official CCP JSONL SDE ZIP."""
import json,sys,zipfile
from pathlib import Path
archive=Path(sys.argv[1]);target=Path(sys.argv[2] if len(sys.argv)>2 else 'lib/station-locations.json')
def roman(n):
 out=''
 for value,symbol in [(100,'C'),(90,'XC'),(50,'L'),(40,'XL'),(10,'X'),(9,'IX'),(5,'V'),(4,'IV'),(1,'I')]:
  while n>=value:out+=symbol;n-=value
 return out
with zipfile.ZipFile(archive) as z:
 def rows(name):
  with z.open(name) as f:return [json.loads(line) for line in f]
 systems={r['_key']:r['name'].get('en','') for r in rows('mapSolarSystems.jsonl')}
 corps={r['_key']:r['name'].get('en','') for r in rows('npcCorporations.jsonl')}
 operations={r['_key']:r['operationName'].get('en','') for r in rows('stationOperations.jsonl')}
 result=[]
 for r in rows('npcStations.jsonl'):
  system=systems.get(r['solarSystemID'],'');planet=r.get('celestialIndex',0);moon=r.get('orbitIndex',0)
  orbit=(f" {roman(planet)}" if planet else '')+(f" - Moon {moon}" if moon else '')
  owner=corps.get(r['ownerID'],'');operation=operations.get(r['operationID'],'') if r.get('useOperationName') else ''
  name=r.get('name',{}).get('en') or f"{system}{orbit} - {owner} {operation}".strip()
  result.append({'id':r['_key'],'name':name,'system':system,'alias':f"{system} {planet}-{moon}"})
result.sort(key=lambda r:r['id']);target.write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8');print(f'Built {len(result)} public NPC station locations')
