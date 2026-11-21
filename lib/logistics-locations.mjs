import stations from './station-locations.json' with {type:'json'};
const normalize=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function searchLogisticsLocations(query,{structures=[],locations={},saved=[],npcStations=stations}={}){
 const normalized=normalize(query),numeric=/^\d+$/.test(normalized),pair=/\s\d+\s\d+$/.test(normalized),tokens=normalized.split(/\s+/).filter(Boolean),found=new Map();
 if(!tokens.length)return {results:[],more:false,total:0};
 const add=row=>{
  if(!Number.isSafeInteger(row.id)||!((row.id>=60000000&&row.id<64000000)||row.id>=1000000000000)||typeof row.name!=='string'||!row.name.trim())return;
  const text=normalize([row.name,row.system,row.alias,numeric?row.id:''].join(' ')),previous=found.get(row.id);
  if(previous){previous.search+=' '+text;return;}found.set(row.id,{...row,search:text});
 };
 for(const row of saved)if(row.locationId)add({id:row.locationId,name:row.name,source:'Configured location'});
 for(const row of structures)if(!['Moon Drill','POS'].includes(row.kind)&&(!row.type_name||/Astrahus|Fortizar|Keepstar|Raitaru|Azbel|Sotiyo|Athanor|Tatara/i.test(row.type_name)))add({id:row.id,name:row.name,system:row.system,source:'Corporation sync'});
 for(const [id,name] of Object.entries(locations))add({id:Number(id),name,source:'Courier history'});
 for(const row of npcStations)add({...row,source:'NPC station'});
 const rows=[...found.values()].filter(r=>pair?r.search.includes(normalized):tokens.every(token=>r.search.includes(token))).sort((a,b)=>Number(a.source==='NPC station')-Number(b.source==='NPC station')||a.name.localeCompare(b.name)||a.id-b.id);
 return {results:rows.slice(0,20).map(({search,alias,...row})=>row),more:rows.length>20,total:rows.length};
}
