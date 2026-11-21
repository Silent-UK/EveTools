import {plainEveText} from './detail-models.mjs';

export function denReinforcementView(pilots,{esc,date,table,duration},now=Date.now()){
 const rows=pilots.flatMap(p=>(Array.isArray(p.data)?p.data:[]).flatMap(den=>{
  const end=Date.parse(den.reinforcement_timer?.end);
  return end>now?[{pilot:p.name,den,end}]:[];
 })).sort((a,b)=>a.end-b.end);
 if(!rows.length)return '';
 return `<section class="panel den-reinforced"><div class="panelhead"><h2>Reinforced Dens</h2><small>${rows.length} active</small></div><div class="data-table-scroll">${table(['Character','Location','Region','Reinforced','Timer','Reinforced by','Corporation','Alliance'],rows.map(({pilot,den,end})=>{
  const r=den.reinforcement;
  return `<tr><td>${esc(pilot)}</td><td>${esc(den.planet?.name||(den.skyhook?.planet_id?'Planet '+den.skyhook.planet_id:'Unknown'))}</td><td>${esc(den.region||'—')}</td><td><span class="tag warn">Reinforced</span>${r?.entered?`<small>${date(r.entered)}</small>`:''}</td><td><strong>${duration((end-now)/1000)}</strong><small>${date(end)}</small></td><td>${esc(r?.character||(r?.character_id?'Character '+r.character_id:'Not reported'))}</td><td>${esc(plainEveText(r?.corporation).trim()||'—')}</td><td>${esc(plainEveText(r?.alliance).trim()||'—')}</td></tr>`;
 }))}</div></section>`;
}
