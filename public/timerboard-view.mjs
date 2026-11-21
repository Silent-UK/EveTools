import {parseTimerDetail,timerStages,timerStances,timerTypes,timerDiscordCommand} from './timerboard-model.mjs';

import {exitCountdown} from './home-view.mjs';

export function timerboardUI({api,esc,intro,toast,refresh}){
 const eveTime=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const eveDay=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short'});
 let active='timers',copyTimers=[];
 const filterFields=[["type","Type"],["ticker","Owner ticker"],["system","System"],["stage","Stage"],["stance","Stance"]];
 const options=values=>values.map(value=>`<option>${esc(value)}</option>`).join('');
 const removeButton=(item,kind)=>`<button type="button" class="target-remove" data-remove-${kind}="${item.id}" data-entry-name="${esc(item.name)}" aria-label="Remove ${esc(item.name)}" title="Remove ${kind}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button>`;
 async function render(){
  const {timers,targets,canAdd,canRemoveTargets,canRemoveTimers}=await api('/timerboard');
  copyTimers=timers;
  if(!targets.length)active='timers';
  const showTargets=active==='targets';
  const filters=showTargets?filterFields.map(([key,label])=>{
   const values=[...new Set(targets.map(target=>target[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
   return `<label>${label}<select data-target-filter="${key}"><option value="">Any</option>${options(values)}</select></label>`;
  }).join(''):'';
  const now=Date.now();
  const rows=(showTargets?targets:timers).map((timer,index)=>`<tr data-stance="${esc(timer.stance)}" ${showTargets?filterFields.map(([key])=>`data-target-${key}="${esc(timer[key])}"`).join(' '):''}>
   ${showTargets?'':`<td class="timerboard-time"><time datetime="${new Date(timer.at).toISOString()}"><strong>${eveTime.format(timer.at)}</strong><small>${eveDay.format(timer.at)}${timer.at<=now?' · Elapsed':''}</small></time></td><td class="timerboard-countdown"><strong class="event-countdown" data-event-countdown="${timer.at}">${esc(exitCountdown(timer.at,now))}</strong></td>`}
   <td class="timerboard-system">${esc(timer.system||'—')}</td>
   <td class="timerboard-name"><div class="timerboard-structure">${Number.isSafeInteger(timer.typeId)&&timer.typeId>0?`<img width="18" height="18" loading="lazy" alt="" src="https://images.evetech.net/types/${timer.typeId}/icon?size=32"> `:''}<strong>${esc(timer.name)}</strong></div></td><td class="timerboard-type">${esc(timer.type)}</td>
   <td><span class="timerboard-stage">${esc(timer.stage)}</span></td><td class="timerboard-stance-cell"><span class="timerboard-stance" data-stance="${esc(timer.stance)}">${esc(timer.stance)}</span></td><td>${esc(timer.ticker||'—')}</td>${showTargets?(canRemoveTargets?`<td>${removeButton(timer,'target')}</td>`:''):`<td><small>${esc(timer.source)}</small></td><td class="timerboard-remove-cell"><div class="timerboard-copy-actions"><button type="button" data-copy-timer="${index}" title="Copy WC Discord timer command" aria-label="Copy ${esc(timer.name)} for Discord"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>${canRemoveTimers&&timer.source==='Manual'?removeButton(timer,'timer'):''}</div></td>`}</tr>`).join('');
  return intro('Timerboard','')+`
   <div class="timerboard">${targets.length?`<div class="actions">${[["timers","Timers"],["targets","Targets"]].map(([id,label])=>`<button data-timerboard-tab="${id}" aria-pressed="${active===id}" class="${active===id?'primary':''}">${label}</button>`).join('')}</div>`:''}${canAdd?`<div class="actions"><details class="panel compact timerboard-editor"><summary><span class="button primary">+ Add Timer</span></summary>
    <form class="management-form" data-timerboard-form="timer">
     <div class="ops-form-grid"><label>Stage<select name="stage">${options(timerStages)}</select></label>
     <label>Type<select name="type">${options(timerTypes)}</select></label>
     <label>Stance<select name="stance">${options(timerStances)}</select></label>
     <label>Owner ticker<input name="ticker" maxlength="12" required></label></div>
     <label>Detail<textarea name="detail" rows="4" maxlength="1500" required placeholder="04-LQM - P03M01&#10;15 km&#10;Reinforced until 2026.11.13 01:22:48"></textarea></label>
     <label>System<input name="system" maxlength="64" placeholder="Enter if missing from the paste"></label>
     <output data-timer-preview aria-live="polite"></output>
     <div class="actions"><button class="primary">Save timer</button></div>
    </form>
   </details>
   <details class="panel compact timerboard-editor"><summary><span class="button primary">+ Add Target</span></summary>
    <form class="management-form" data-timerboard-form="target">
     <div class="ops-form-grid"><label>Stage<select name="stage">${options(['Shield',...timerStages])}</select></label>
     <label>Type<select name="type">${options(timerTypes)}</select></label>
     <label>Stance<select name="stance">${options(['Hostile',...timerStances.filter(stance=>stance!=='Hostile')])}</select></label>
     <label>Owner ticker<input name="ticker" maxlength="12" required></label></div>
     <label>Detail<textarea name="detail" rows="4" maxlength="1500" required placeholder="04-LQM - P03M01"></textarea></label>
     <output data-timer-preview aria-live="polite"></output>
     <div class="actions"><button class="primary">Save target</button></div>
    </form>
   </details></div>`:''}
   ${showTargets?`<details class="panel compact timerboard-filter-panel" ${globalThis.matchMedia?.('(max-width: 650px)').matches?'':'open'}><summary>Filters and sorting</summary><div class="actions timerboard-filters"><label>Search targets <input type="search" data-target-search></label>
    ${filters}<label>Sort by <select data-target-sort><option value="system">System</option><option value="name">Structure</option><option value="type">Type</option><option value="stage">Stage</option><option value="stance">Stance</option><option value="owner">Owner</option></select></label><button type="button" data-target-clear>Clear filters</button><small data-target-count role="status">${targets.length} of ${targets.length} targets</small></div></details>`:''}
   ${rows?`<section class="panel compact timerboard-table${showTargets?' timerboard-targets':''}"><table><thead><tr>${showTargets?'':'<th>Ends · EVE time</th><th>Time remaining</th>'}<th>System</th><th>Structure</th><th>Type</th><th>Stage</th><th>Stance</th><th>Owner</th>${showTargets?(canRemoveTargets?'<th>Actions</th>':''):`<th>Source</th><th>Actions</th>`}</tr></thead><tbody ${showTargets?'data-target-rows':''}>${rows}</tbody></table></section>`:'<p class="panel compact muted">No structure timers to show.</p>'}</div>`;
 }
 function filterTargets(){
  const body=document.querySelector('[data-target-rows]');
  if(!body)return;
  const query=document.querySelector('[data-target-search]').value.trim().toLowerCase();
  const sort=document.querySelector('[data-target-sort]').value;
  const column={system:0,name:1,type:2,stage:3,stance:4,owner:5}[sort];
  const filters=[...document.querySelectorAll('[data-target-filter]')];
  const rows=[...body.rows];
  let count=0;
  rows.sort((a,b)=>a.cells[column].textContent.localeCompare(b.cells[column].textContent));
  for(const row of rows){
   row.hidden=!row.textContent.toLowerCase().includes(query)||filters.some(filter=>{
    const key=filter.dataset.targetFilter;
    return filter.value&&row.getAttribute('data-target-'+key)!==filter.value;
   });
   if(!row.hidden)count++;
   body.append(row);
  }
  document.querySelector('[data-target-count]').textContent=`${count} of ${rows.length} targets`;
 }
 document.addEventListener('change',event=>{if(event.target.matches('[data-target-sort],[data-target-filter]'))filterTargets();});
 document.addEventListener('click',async event=>{
  if(event.target.closest('[data-target-clear]')){
   for(const field of document.querySelectorAll('[data-target-search],[data-target-filter]'))field.value='';
   filterTargets();
   return;
  }
  const tab=event.target.closest('[data-timerboard-tab]');
  if(tab){active=tab.dataset.timerboardTab;await refresh();return;}
  const copy=event.target.closest('[data-copy-timer]');
  if(copy){
   const timer=copyTimers[Number(copy.dataset.copyTimer)],command=timerDiscordCommand(timer);
   if(!command){toast('This entry has no timer to copy.');return;}
   try{await navigator.clipboard.writeText(command);toast(timer.ticker?'Discord timer command copied.':'Copied. Add the owner ticker before posting.');}
   catch{toast('Clipboard unavailable. Allow clipboard access and try again.');}
   return;
  }
  const remove=event.target.closest('[data-remove-target],[data-remove-timer]');
  if(!remove||!confirm('Remove '+remove.dataset.entryName+' from Timerboard?'))return;
  remove.disabled=true;
  const path=remove.dataset.removeTimer?'/timerboard/timers/'+remove.dataset.removeTimer:'/timerboard/targets/'+remove.dataset.removeTarget;
  try{await api(path,{},'DELETE');await refresh();}
  catch(error){toast(error.message);}
  finally{remove.disabled=false;}
 });
 document.addEventListener('input',event=>{
  if(event.target.matches('[data-target-search]'))filterTargets();
  const form=event.target.form;
  if(!form||form.dataset.timerboardForm!=='timer'||!['detail','system'].includes(event.target.name))return;
  const parsed=parseTimerDetail(form.elements.detail.value,form.elements.system.value);
  form.querySelector('[data-timer-preview]').textContent=parsed?`${parsed.system||'Enter system'} · ${parsed.name} · ${eveDay.format(parsed.at)}, ${eveTime.format(parsed.at)} EVE time`:'';
 });
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!form.matches('[data-timerboard-form]'))return;
  event.preventDefault();
  const button=event.submitter||form.querySelector('button');
  if(button.disabled)return;
  button.disabled=true;
  const target=form.dataset.timerboardForm==='target';
  try{
   await api(target?'/timerboard/targets':'/timerboard',Object.fromEntries(new FormData(form)));
   active=target?'targets':'timers';
   toast(target?'Target added.':'Timer added.');
   await refresh();
  }
  catch(error){toast(error.message);}
  finally{button.disabled=false;}
 });
 return {render};
}
