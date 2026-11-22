import systemNames from './system-names.json' with {type:'json'};
import {regionForSystem} from './moon-scan-upload.mjs';
export const DESTRUCTION_MAX_AGE=12*3600000;
const key='/tools/structure-destructions',watch=id=>'/tools/den-destruction-watch/'+id;
const field=(text,name)=>text.match(new RegExp('^'+name+':[ \\t]*(?:&[\\w-]+[ \\t]+)?([0-9]+)[ \\t]*\\r?$','m'))?.[1];
const num=(text,...names)=>Number(names.map(name=>field(text,name)).find(Boolean));
export function savedDestructions(db,now=Date.now()){
 const data=db.prepare('SELECT data FROM public_cache WHERE path=?').get(key);
 return (data?JSON.parse(data.data):[]).filter(row=>Number.isFinite(row.at)&&row.at>=now-DESTRUCTION_MAX_AGE&&row.at<=now);
}
export function recentDenHistory(db,id,now=Date.now()){
 const row=db.prepare('SELECT data FROM public_cache WHERE path=? AND expires>?').get(watch(id),now);
 return row?JSON.parse(row.data):[];
}
export function rememberDens(db,pilot,previous,current,now=Date.now()){
 const known=[...new Map([...recentDenHistory(db,pilot.id,now),...previous,...current].map(row=>[row.id,row])).values()];
 if((previous.length||current.length)&&currentPilot(db,pilot))db.prepare('INSERT INTO public_cache VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data,expires=excluded.expires')
  .run(watch(pilot.id),JSON.stringify(known.map(({id,type_id,planet,system,region})=>({id,type_id,planet,system,region}))),now+2*3600000);
 return [...new Map([...known,...previous].map(row=>[row.id,row])).values()];
}
const currentPilot=(db,pilot)=>db.prepare('SELECT 1 FROM characters WHERE id=? AND user_id=? AND owner_hash=?').get(pilot.id,pilot.user_id,pilot.owner_hash);
export function corporationDestructions(db,corporationId,now=Date.now()){
 const users=new Set(db.prepare('SELECT u.id FROM users u JOIN login_membership_checks m ON m.character_id=u.main_id WHERE m.corporation_id=?').all(corporationId).map(row=>row.id));
 return savedDestructions(db,now).filter(row=>row.corporationId===corporationId||users.has(row.ownerUser));
}
export async function collectDestructions(db,notices,{structures=[],corporationId,pilot,cat,eve},now=Date.now()){
 const additions=[],known=new Map(structures.map(row=>[row.id,row]));
 const saved=savedDestructions(db,now),seenKillmails=new Set(saved.map(row=>row.killmailId).filter(Boolean));
 const existing=new Set(saved.map(row=>row.key));
 const record=(event)=>{if(!existing.has(event.key)){additions.push(event);existing.add(event.key);}};
 for(const notice of Array.isArray(notices)?notices:[]){
  const at=Date.parse(notice?.timestamp),text=notice?.text;
  if(!Number.isFinite(at)||at<now-DESTRUCTION_MAX_AGE||at>now||typeof text!=='string'||text.length>20000)continue;
  if(['StructureDestroyed','SkyhookDestroyed','SovStructureDestroyed'].includes(notice.type)){
   const typeId=num(text,'structureTypeID','typeID'),systemId=num(text,'solarsystemID','solarSystemID');
   let id=num(text,'structureID','skyhookID','itemID','towerID'),row=known.get(id);
   if(!row&&notice.type==='SovStructureDestroyed'){
    const matches=structures.filter(s=>s.type_id===typeId&&(s.system_id===systemId||s.system===systemNames[systemId]));
    if(matches.length===1){row=matches[0];id=row.id;}
   }
   if(!Number.isSafeInteger(id)||id<=0)continue;
   const owner=Number(text.match(/^ownerCorpLinkData:\s*\r?\n- showinfo\r?\n- 2\r?\n- (\d+)\s*$/m)?.[1]);
   if(pilot?(!row&&typeId!==85230):(!row&&owner!==corporationId))continue;
   record({key:'structure-'+id,structureId:id,at,typeId:row?.type_id||typeId||null,
    name:row?.name||row?.planet?.name||cat?.type?.(typeId)?.name||'Structure',
    system:row?.system||systemNames[systemId]||null,region:row?.region||regionForSystem(systemId)||null,
    corporationId:pilot?null:corporationId,ownerUser:pilot?.user_id||null,pilot:pilot?.name||null});
   continue;
  }
  if(notice.type!=='KillReportVictim')continue;
  const typeId=num(text,'victimShipTypeID'),killmailId=num(text,'killMailID');
  if(!Number.isSafeInteger(typeId)||typeId<=0)continue;
  const type=cat?.type?.(typeId);
  const structural=typeId===85230||[23,40,46,65].includes(type?.category_id)||structures.some(row=>row.type_id===typeId);
  if(pilot?typeId!==85230:!structural)continue;
  if(!Number.isSafeInteger(killmailId)||killmailId<=0||seenKillmails.has(killmailId))continue;
  seenKillmails.add(killmailId);
  const hash=text.match(/^killMailHash:[ \t]*['"]?([a-f0-9]{40})['"]?[ \t]*\r?$/mi)?.[1];
  let loss;try{if(hash)loss=await eve?.publicGet?.('/killmails/'+killmailId+'/'+hash);}catch{}
  if(loss&&(loss.victim?.ship_type_id!==typeId||pilot&&loss.victim?.character_id&&loss.victim.character_id!==pilot.id))continue;
  if(!pilot&&loss?.victim?.corporation_id!==corporationId)continue;
  const systemId=loss?.solar_system_id;
  const matches=structures.filter(row=>(row.type_id||85230)===typeId&&(row.planet?.system_id===systemId||row.system_id===systemId||row.system&&row.system===systemNames[systemId]));
  const row=matches.length===1?matches[0]:null;
  record({key:row?'structure-'+row.id:'killmail-'+killmailId,structureId:row?.id||null,at,killmailId,typeId,
   name:row?.name||row?.planet?.name||type?.name||(typeId===85230?'Mercenary Den':'Structure'),
   system:row?.system||systemNames[systemId]||null,region:row?.region||regionForSystem(systemId)||null,
   corporationId:pilot?loss?.victim?.corporation_id||null:corporationId,ownerUser:pilot?.user_id||null,pilot:pilot?.name||null});
 }
 if(!additions.length||pilot&&!currentPilot(db,pilot))return;
 const rows=new Map(savedDestructions(db,now).map(row=>[row.key,row]));
 for(const row of additions)if(!rows.has(row.key))rows.set(row.key,row);
 db.prepare('INSERT INTO public_cache VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data,expires=excluded.expires').run(key,JSON.stringify([...rows.values()]),0);
}
