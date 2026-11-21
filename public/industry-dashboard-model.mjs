export const industryActivities={1:'Manufacturing',3:'TE research',4:'ME research',5:'Copying',7:'Reverse engineering',8:'Invention',9:'Reaction',11:'Reaction'};
export function industryPreferences(raw={}){const p=raw&&typeof raw==='object'?raw:{};return {q:typeof p.q==='string'?p.q.slice(0,200):'',status:['','active','ready','soon','paused'].includes(p.status)?p.status:'',activity:p.activity==='reaction'?'reaction':Object.hasOwn(industryActivities,p.activity)?String(p.activity):'',location:typeof p.location==='string'?p.location:'',sort:['finish','product','location','pilot'].includes(p.sort)?p.sort:'finish',grouped:p.grouped===true};}
const stamp=v=>{const n=Date.parse(v);return Number.isFinite(n)?n:null;};
export function industryState(j,now=Date.now()){return j.status==='active'&&stamp(j.end_date)!==null&&stamp(j.end_date)<=now?'ready-estimated':j.status;}
export function industryProgress(j,now=Date.now()){const start=stamp(j.start_date),end=stamp(j.end_date);if(j.status==='paused'||start===null||end===null||end<=start)return null;return Math.round(Math.max(0,Math.min(100,(now-start)/(end-start)*100)));}
export function industryRows(pilots,f=industryPreferences(),now=Date.now()){
 const q=f.q.trim().toLowerCase(),seen=new Set();
 return pilots.flatMap(p=>(p.data?.jobs||[]).flatMap((j,i)=>{if(!['active','ready','paused'].includes(j.status))return [];const key=p.id+':'+(j.job_id??'row'+i);if(seen.has(key))return [];seen.add(key);const state=industryState(j,now),end=stamp(j.end_date),soon=state==='active'&&end!==null&&end>now&&end<=now+86400000;
 if(f.status&&(f.status==='ready'?!state.startsWith('ready'):f.status==='soon'?!soon:state!==f.status)||f.activity&&(f.activity==='reaction'?![9,11].includes(Number(j.activity_id)):String(j.activity_id)!==f.activity)||f.location&&j.location!==f.location||q&&![p.name,j.name,j.location,industryActivities[j.activity_id]].join(' ').toLowerCase().includes(q))return [];
 return [{...j,character_id:p.id,character_name:p.name,snapshot_updated:p.updated,state,end,soon,progress:industryProgress(j,now)}];})).sort((a,b)=>{if(f.sort!=='finish'){const key={product:'name',location:'location',pilot:'character_name'}[f.sort],order=String(a[key]||'').localeCompare(String(b[key]||''));if(order)return order;}return Number(!a.state.startsWith('ready'))-Number(!b.state.startsWith('ready'))||(a.end??Infinity)-(b.end??Infinity)||a.character_name.localeCompare(b.character_name)||Number(a.job_id||0)-Number(b.job_id||0);});
}
export function industrySummary(rows){return {running:rows.filter(j=>j.state==='active').length,ready:rows.filter(j=>j.state.startsWith('ready')).length,paused:rows.filter(j=>j.state==='paused').length,soon:rows.filter(j=>j.soon).length,next:rows.filter(j=>j.state==='active'&&j.end!==null).sort((a,b)=>a.end-b.end)[0]||null};}
export function industryCSV(rows){const date=v=>{const n=typeof v==='number'?v:stamp(v);return n!==null&&Number.isFinite(n)?new Date(n).toISOString():'';},cells=[['Pilot','Pilot ID','Job ID','Product / Blueprint','Activity','Runs','Status','Start UTC','Finish UTC','Location','Installation cost ISK','Snapshot UTC'],...rows.map(j=>[j.character_name,j.character_id,j.job_id,j.name,industryActivities[j.activity_id]||j.activity_id,j.runs,j.state,date(j.start_date),date(j.end_date),j.location,j.cost,date(j.snapshot_updated)])];return '\uFEFF'+cells.map(row=>row.map(v=>{let s=String(v??'');if(typeof v==='string'&&/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}

const slotTypes = [
 { key:'manufacturing', label:'Manufacturing Slots', activities:[1], skills:[3387,24625] },
 { key:'reactions', label:'Reaction Slots', activities:[9,11], skills:[45748,45749] },
 { key:'science', label:'Science Slots', activities:[3,4,5,7,8], skills:[3406,24624] },
];

export function industrySlotLimits(skills) {
 if (!Array.isArray(skills)) return null;
 const levels = new Map(skills.map(skill => [skill.skill_id, skill.active_skill_level]));
 return Object.fromEntries(slotTypes.map(({key,skills}) => [
  key, 1 + skills.reduce((total,id) => total + (levels.get(id) ?? 0), 0),
 ]));
}

export function industrySlotSummary(pilots, jobs) {
 const withLimits = pilots.filter(pilot => pilot.slot_limits);
 const covered = withLimits.filter(pilot => Array.isArray(pilot.data?.jobs));
 const coveredIds = new Set(covered.map(pilot => pilot.id));
 return slotTypes.map(({key,label,activities}) => {
  const usedByPilot = new Map();
  for (const job of jobs) {
   if (coveredIds.has(job.character_id) && activities.includes(Number(job.activity_id))) {
    usedByPilot.set(job.character_id, (usedByPilot.get(job.character_id) ?? 0) + 1);
   }
  }
  const limits = covered.length ? covered : withLimits;
  return {
   key, label, covered:covered.length,
   total:limits.length ? limits.reduce((sum,pilot) => sum + pilot.slot_limits[key], 0) : null,
   used:covered.length ? [...usedByPilot.values()].reduce((sum,used) => sum + used, 0) : null,
   free:covered.length ? covered.reduce((sum,pilot) => sum + Math.max(0,pilot.slot_limits[key] - (usedByPilot.get(pilot.id) ?? 0)), 0) : null,
  };
 });
}
