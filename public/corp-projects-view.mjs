const icons={deliver_item:'▦',manufacture_item:'⚒',mine_material:'⛏',destroy_npc:'✦',destroy_ship:'⚔',manual:'✓'};
const projectTypes={deliver_item:'Deliver items',manufacture_item:'Manufacture items',mine_material:'Mine materials',destroy_npc:'Destroy NPCs',destroy_ship:'Destroy ships',manual:'Manual contribution'};
const symbol=value=>`<span class="projects-symbol" aria-hidden="true">${value}</span>`;

export function projectsView(data,{esc,num,date,intro}) {
 const isk=value=>value==null?'—':`${num(value)} ISK`;
 const stats=data.stats;
 const tiles=[['◈','Available to you',isk(stats?.personal)],['◇','Available to all members',isk(stats?.shared)],
  ['◷','Active Projects',stats?`${num(stats.active)} / 100`:'—'],['✓','Completed Today',stats?.today==null?'—':num(stats.today)],['▤','Completed This Week',stats?.week==null?'—':num(stats.week)]];
 function card(project) {
  const current=project.progress?.current, goal=project.progress?.desired;
  const progress=Number.isFinite(current)&&Number.isFinite(goal)&&goal>0 ? Math.min(100,Math.max(0,Math.round(current*100/goal))) : null;
  const percent=progress===null?'—':`${progress}%`;
  const type=projectTypes[project.kind]||project.kind?.replaceAll('_',' ')||'Corporation project';
  const image=Number.isSafeInteger(project.typeId)&&project.typeId>0?`<img src="https://images.evetech.net/types/${project.typeId}/icon?size=64" width="30" height="30" alt="" loading="lazy">`:symbol(icons[project.kind]||'◇');
  const location=project.locations?.join(' · ')||(project.office?`Corporation office ${project.office}`:project.detailMissing?'Location unavailable':'No location restriction');
  return `<article class="panel project-card"><div class="project-ring" data-project-progress="${progress??0}" role="img" aria-label="${progress===null?'Progress unavailable':percent+' complete'}"><strong aria-hidden="true">${percent}</strong></div>
   <div class="project-main"><div class="project-heading"><span class="project-art">${image}</span><div><h3>${esc(project.name)}</h3><small>${esc(type)}</small></div></div>
   <div class="project-location">${symbol('⌖')}${esc(location)}</div><div class="project-meta">${progress===null?'':`<span>${num(current)} / ${num(goal)} progress</span>`}${project.reward?.remaining>0?`<span>${isk(project.reward.remaining)} remaining</span>`:''}${project.details?.expires&&project.state==='Active'?`<span>Expires ${date(project.details.expires)}</span>`:''}${project.details?.finished?`<span>Completed ${date(project.details.finished)}</span>`:''}</div>
   ${project.details?.description?`<details><summary>Project details</summary><p>${esc(project.details.description)}</p></details>`:''}</div></article>`;
 }
 const active=data.rows.filter(row=>row.state==='Active'), completed=data.rows.filter(row=>row.state==='Completed');
 const connect=data.canConnect&&/grant|401|403/i.test(data.error||'')?'<a class="button" href="/auth/login?corporation=1&amp;projects=1">Connect Projects ESI</a>':'';
 const summary=data.refreshing?'Refreshing corporation projects…':data.updated?`Updated ${date(data.updated)}`:'';
 return intro('Projects','Corporation goals, locations, and rewards.','<button data-nav="corp-projects">↻ Refresh view</button>')+
  `<section class="project-stats">${tiles.map(([icon,label,value])=>`<div class="panel project-stat">${symbol(icon)}<div><strong>${value}</strong><small>${label}</small></div></div>`).join('')}</section>
   ${stats?'<small class="project-note">Available to you estimates remaining rewards for your login pilot. Today and this week use EVE time, with weeks starting Monday.</small>':''}
   ${data.error?`<section class="notice">${esc(data.error)} ${connect}</section>`:''}${summary?`<small class="project-note" role="status">${esc(summary)}</small>`:''}
   <section><h2 class="project-section-title">Active projects</h2><div class="project-grid">${active.map(card).join('') || `<p class="muted">${data.updated?'No active projects.':'Waiting for a corporation project snapshot.'}</p>`}</div></section>
   ${completed.length?`<details class="panel project-completed"><summary>Completed this week</summary><div class="project-grid">${completed.map(card).join('')}</div></details>`:''}`;
}
