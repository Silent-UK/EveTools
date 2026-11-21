import {structureReasons,expiry,DAY} from '../public/corp-workspace-model.mjs';
export function corporationAttention(db,corp,allowed,now=Date.now()){
 const result=[],coverage=[];
 const read=key=>{const row=db.prepare('SELECT data FROM public_cache WHERE path=?').get(key);return row?JSON.parse(row.data):null;};
 const add=(page,label,count,data)=>{coverage.push({page,updated:data?.updated||null,error:data?.error||null});if(count)result.push({page,label,count,updated:data?.updated||null,stale:!data?.updated||now-data.updated>7200000||!!data.error});};
 const structuresSnapshot=allowed.includes('corp-structures')||allowed.includes('corp-moons')?corp.snapshot():null;
 if(allowed.includes('corp-structures')){
  const data=structuresSnapshot,structures=data.structures.filter(s=>s.kind!=='Moon Drill');
  add('corp-structures','Structures needing attention',structures.filter(s=>structureReasons(s,now).length).length,data);
 }
 if(allowed.includes('corp-moons')){
  const data=structuresSnapshot;add('corp-moons','Moon drills needing attention',data.structures.filter(s=>s.kind==='Moon Drill'&&structureReasons(s,now).length).length,data);
 }
 if(allowed.includes('corp-industry')){const data=corp.industrySnapshot();add('corp-industry','Jobs ready to deliver',(data.rows||[]).filter(j=>j.status==='ready'||j.status==='active'&&Date.parse(j.end_date)<=now).length,data);}
 if(allowed.includes('corp-market')){const data=read('/tools/corp-data/market');add('corp-market','Active orders expiring within 24h',(data?.active||[]).filter(o=>expiry(o)>now&&expiry(o)-now<=DAY).length,data);}
 if(allowed.includes('corp-contracts')){const data=read('/tools/corp-data/contracts');add('corp-contracts','Contracts expiring or overdue',(data?.contracts||[]).filter(c=>!c.retained&&(c.status==='outstanding'&&Date.parse(c.date_expired)<=now+DAY||c.status==='in_progress'&&c.type==='courier'&&Date.parse(c.date_accepted)+c.days_to_complete*DAY<=now)).length,data);}
 return {rows:result,coverage};
}
