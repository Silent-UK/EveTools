export const PROJECT_SCOPE='esi-corporations.read_projects.v1';

async function cursorRows(request,path,field) {
 const rows=[], seen=new Set();
 let after='0';
 for(let page=0;page<100;page++) {
  if(seen.has(after)) throw Error('ESI repeated a Projects page.');
  seen.add(after);
  const data=await request(`${path}${path.includes('?')?'&':'?'}limit=100&after=${encodeURIComponent(after)}`);
  if(!Array.isArray(data?.[field])) throw Error('ESI returned an incomplete Projects list.');
  rows.push(...data[field]);
  after=data.cursor?.after;
  if(!after || data[field].length===0) return rows;
 }
 throw Error('ESI Projects history exceeded the page limit.');
}

export function projectWeek(now=Date.now()) {
 const today=new Date(now);today.setUTCHours(0,0,0,0);
 return {today:+today,week:+today-((today.getUTCDay()+6)%7)*86400000};
}

export async function collectProjects({id,request,location,now=Date.now()}) {
 const base=`/corporations/${id}/projects`, {week}=projectWeek(now);
 const listed=await cursorRows(request,base+'?state=All','projects');
 const projects=[...new Map(listed.map(project=>[project.id,project])).values()].filter(project=>project.state==='Active'||(project.state==='Completed'&&Date.parse(project.last_modified)>=week));
 const rows=[], locations=new Map();
 const resolve=(kind,id)=>{
  const key=`${kind}:${id}`;
  if(!locations.has(key)) locations.set(key,Promise.resolve().then(()=>location(kind,id)).catch(()=>null));
  return locations.get(key);
 };
 async function enrich(project) {
  if(typeof project.id!=='string'||!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(project.id)) throw Error('ESI returned an invalid project ID.');
  let details;
  try{details=await request(`${base}/${project.id}`);}catch{return {...project,detailMissing:true};}
  const data={...project,...details};
  const [kind,settings]=Object.entries(data.configuration||{})[0] || [];
  const refs=[...(settings?.docking_locations||[]),...(settings?.locations||[])].flatMap(row=>Object.entries(row)).filter(([key,value])=>['station_id','structure_id','solar_system_id','constellation_id','region_id'].includes(key)&&Number.isSafeInteger(value));
  const places=[];
  for(const [key,value] of refs) places.push(await resolve(key,value) || `${key.replace(/_id$/,'').replaceAll('_',' ')} ${value}`);
  const item=[...(settings?.items||[]),...(settings?.materials||[]),...(settings?.ships||[])].find(item=>Number.isSafeInteger(item.type_id));
  let contributors=null;
  if(data.state==='Active' && data.reward?.remaining>0 && data.contribution?.participation_limit>0) {
   try{contributors=Object.fromEntries((await cursorRows(request,`${base}/${project.id}/contributors`,'contributors')).map(row=>[row.id,row.contributed]));}catch{}
  }
  return {...data,kind,locations:[...new Set(places)],office:settings?.office_id || null,typeId:item?.type_id || null,contributors};
 }
 for(let i=0;i<projects.length;i+=4) rows.push(...await Promise.all(projects.slice(i,i+4).map(enrich)));
 return {rows};
}

export function projectsForPilot(snapshot,pilot,now=Date.now()) {
 const {today,week}=projectWeek(now), active=snapshot.rows.filter(project=>project.state==='Active');
 const completed=snapshot.rows.filter(project=>project.state==='Completed');
 const missingCompletion=completed.some(project=>!Number.isFinite(Date.parse(project.details?.finished)));
 const completeSince=start=>missingCompletion?null:completed.filter(project=>Date.parse(project.details.finished)>=start&&Date.parse(project.details.finished)<=now).length;
 let personal=0, personalKnown=true;
 for(const project of active) {
  const remaining=project.reward?.remaining || 0;
  if(remaining<=0) continue;
  const cap=project.contribution?.participation_limit;
  if(project.detailMissing) {personalKnown=false;continue;}
  if(!cap) {personal+=remaining;continue;}
  const rate=project.contribution?.reward_per_contribution;
  if(project.contributors===null || !Number.isFinite(rate)) {personalKnown=false;continue;}
  personal+=Math.min(remaining,Math.max(0,cap-(project.contributors?.[pilot]||0))*rate);
 }
 return {...snapshot,rows:snapshot.rows.filter(project=>project.state==='Active'||Date.parse(project.details?.finished)>=week||project.detailMissing&&Date.parse(project.last_modified)>=week).map(({contributors,configuration,contribution,...project})=>project),stats:snapshot.updated?{
  personal:personalKnown?personal:null,shared:active.reduce((sum,project)=>sum+(project.reward?.remaining||0),0),active:active.length,
  today:completeSince(today),week:completeSince(week)
 }:null};
}
