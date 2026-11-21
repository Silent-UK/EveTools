const closedStatuses=new Set(['finished','cancelled','rejected','failed','deleted','reversed']);
export async function collectContracts(c,eve,cat,previous,{corporation=false,onList=null}={}){
 if(!JSON.parse(c.scopes).includes(corporation?'esi-contracts.read_corporation_contracts.v1':'esi-contracts.read_character_contracts.v1'))throw Object.assign(Error('Reconnect this pilot to enable Contracts.'),{status:403});
 const base=(corporation?'/corporations/':'/characters/')+c.id+'/contracts',contracts=[],seen=new Set();let pages=1;
 for(let page=1;page<=pages;page++){
  const r=await eve.request(base+'?page='+page,c);
  if(!Array.isArray(r.data)||!Number.isInteger(r.pages)||r.pages<1||r.pages>1000||(page>1&&r.pages!==pages))throw Error('Incomplete contracts');pages=r.pages;
  for(const row of r.data){if(!Number.isSafeInteger(row.contract_id)||seen.has(row.contract_id))throw Error('Invalid contracts');seen.add(row.contract_id);contracts.push({...row,observed:Date.now()});}
 }
 const old=new Map((previous?.contracts||[]).map(r=>[r.contract_id,r]));
 if(onList)onList({names:previous?.names||{},locations:previous?.locations||{},contracts:[...new Map([...(previous?.contracts||[]).map(r=>({...r,retained:true})),...contracts.map(r=>({...old.get(r.contract_id),...r,retained:false,items_error:old.get(r.contract_id)?.items_error||(!old.get(r.contract_id)?.items?'Details are refreshing in the background.':undefined)}))].map(r=>[r.contract_id,r])).values()]});
 let backfill=0,lookups=0,failures=0,limited=false;const started=Date.now();
 const detailOrder=[...contracts].sort((a,b)=>Number(closedStatuses.has(a.status))-Number(closedStatuses.has(b.status))||String(b.date_issued||'').localeCompare(String(a.date_issued||'')));
 for(const row of detailOrder){
  if(row.type==='courier')continue;
  const saved=old.get(row.contract_id),closed=closedStatuses.has(row.status);
  if(Array.isArray(saved?.items)&&!saved.items_error){row.items=saved.items;continue;}
  if(limited||lookups>=40||Date.now()-started>=8000||saved?.items_retry_at>Date.now()||(closed&&backfill>=20)){
   row.items=saved?.items;row.items_retry_at=saved?.items_retry_at;row.items_error='Item details will retry on a later sync.';continue;
  }
  if(closed)backfill++;lookups++;
  try{const result=await eve.request(base+'/'+row.contract_id+'/items',c);if(!Array.isArray(result.data))throw Error('Invalid items');row.items=result.data.map(i=>({...i,name:cat.type(i.type_id)?.name||'Type '+i.type_id}));}
  catch(e){if(e.status===429||e.status===420||++failures>=3)limited=true;row.items_retry_at=Date.now()+86400000;row.items=saved?.items;row.items_error='Items unavailable; any retained items are from an earlier sync.';}
 }
 const names={...(previous?.names||{})},ids=[...new Set(contracts.flatMap(r=>[r.issuer_id,r.issuer_corporation_id,r.assignee_id,r.acceptor_id]).filter(id=>id>0&&!names[id]))];
 for(let i=0;i<ids.length;i+=1000){try{const r=await eve.request('/universe/names',null,'POST',ids.slice(i,i+1000));for(const n of r.data)names[n.id]=n.name;}catch{}}
 const locations={...(previous?.locations||{})};
 let locationLookups=0;const location_retry={...(previous?.location_retry||{})};
 for(const id of [...new Set(contracts.flatMap(r=>[r.start_location_id,r.end_location_id]).filter(Boolean))]){if(locations[id]||location_retry[id]>Date.now()||locationLookups>=20)continue;locationLookups++;try{const place=id>=1000000000000?await eve.get('/universe/structures/'+id,c):await eve.publicGet('/universe/stations/'+id);locations[id]=place.name;delete location_retry[id];}catch{location_retry[id]=Date.now()+86400000;}}
 return {location_retry,locations,contracts:[...new Map([...(previous?.contracts||[]).map(r=>({...r,retained:true})),...contracts].map(r=>[r.contract_id,r])).values()],names};
}
