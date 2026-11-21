import {operationKinds,manualKinds} from './operation-kinds.mjs';

import {calendarOccurrences,recurrenceLabels} from './operation-recurrence.mjs';

const day=86400000;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isoDay=time=>new Date(time).toISOString().slice(0,10);
const monthStart=key=>Date.parse(key+'-01T00:00:00Z');

const audienceLabels={all:'Show to all',directors:'Show to directors',private:'Only me',calendar:'Calendar access only'};

export function operationCalendarUI({api,intro,toast,embedded=false,onSaved,preferenceKey}){
 const rootId=embedded?'home-month-calendar':'operations-calendar';
 const formId=rootId+'-form';
 const endpoint=embedded?'/calendar':'/corporation/calendar';
 let data, view=embedded&&!globalThis.matchMedia?.('(max-width: 650px)').matches?'month':'upcoming', zone='utc', month, selectedDay='', editing=null, showTimers=true;
 const filters={kind:'',region:'',system:''};
 let filterScope;
 function loadEventType(){
  const scope=preferenceKey?.();
  if(scope===filterScope)return;
  filterScope=scope;
  filters.kind='';
  if(!scope)return;
  try{const saved=localStorage.getItem(scope);if(Object.hasOwn(operationKinds,saved))filters.kind=saved;}catch{}
 }
 const format=(time,options)=>new Intl.DateTimeFormat('en-GB',{...options,...(zone==='utc'?{timeZone:'UTC'}:{})}).format(time);
 const dayKey=time=>{
  if(zone==='utc')return isoDay(time);
  const date=new Date(time);
  return isoDay(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
 };
 const dateLabel=time=>format(time,{weekday:'short',day:'numeric',month:'short'});
 const clock=time=>format(time,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const badge=event=>`<span class="ops-kind" data-kind="${event.kind}">${operationKinds[event.kind]}${event.estimated?' · Estimated':''}</span>`;
 const visibleEvents=()=>showTimers?data.events:data.events.filter(event=>event.manual);
 const filtered=(from,until)=>calendarOccurrences(visibleEvents(),from,until).filter(event=>Object.entries(filters).every(([key,value])=>!value||event[key]===value));
 const options=(key,label,entries)=>`<label>${label}<select data-ops-filter="${key}"><option value="">All</option>${entries.map(([value,name])=>`<option value="${esc(value)}" ${filters[key]===value?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
 function eventRow(event){
  const place=[event.system,event.region,event.manual&&audienceLabels[event.audience],event.recurrence&&event.recurrence!=='none'&&recurrenceLabels[event.recurrence]].filter(Boolean).join(' · ');
  return `<details class="ops-event" data-kind="${event.kind}">
   <summary><time datetime="${new Date(event.starts).toISOString()}">${clock(event.starts)}${event.starts<Date.now()&&!event.manual?`<small>${event.kind==='moon'?'Ready':event.kind==='courier'?'Overdue':event.estimated?'Depleted · est.':'Elapsed'}</small>`:''}</time>
    <strong>${esc(event.title)}${place?`<small>${esc(place)}</small>`:''}</strong>${badge(event)}</summary>
   <div class="ops-event-detail">${event.notes?`<p>${esc(event.notes)}</p>`:''}
    ${event.updated?`<small>Source synced ${dateLabel(event.updated)} · ${clock(event.updated)} ${zone==='utc'?'UTC':''}</small>`:''}
    <div class="actions">
     ${event.source?`<a href="#${event.source}">Open source page ↗</a>`:''}
     ${event.fitting?`<a href="${esc(event.fitting)}" target="_blank" rel="noopener noreferrer">Open fitting ↗</a>`:''}
     ${event.manual&&event.canEdit?`<button data-ops-edit="${event.id}">${event.recurrence&&event.recurrence!=='none'?'Edit series':'Edit event'}</button>`:''}
    </div>
   </div></details>`;
 }
 function agenda(events){
  const days=new Map();
  for(const event of events){
   const key=dayKey(event.starts);
   if(!days.has(key))days.set(key,[]);
   days.get(key).push(event);
  }
  if(!days.size)return '<p class="ops-empty">No events match this view.</p>';
  return [...days].map(([key,rows])=>`<section class="ops-agenda-day">
   <h3>${dateLabel(rows[0].starts)}${key===dayKey(Date.now())?' · Today':''}</h3>
   ${rows.map(eventRow).join('')}</section>`).join('');
 }
 function monthView(events){
  const first=monthStart(month), date=new Date(first);
  const offset=(date.getUTCDay()+6)%7;
  const count=Math.ceil((offset+new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate())/7)*7;
  const byDay=new Map();
  for(const event of events){
   const key=dayKey(event.starts);
   if(!byDay.has(key))byDay.set(key,[]);
   byDay.get(key).push(event);
  }
  const today=dayKey(Date.now());
  const cells=Array.from({length:count},(_,i)=>{
   const time=first+(i-offset)*day,key=isoDay(time),rows=byDay.get(key)||[];
   return `<button class="ops-day ${key.slice(0,7)===month?'':'outside-month'}" data-ops-day="${key}" aria-pressed="${key===selectedDay}" ${key===today?'aria-current="date"':''} aria-label="${key}, ${rows.length} events">
    <span class="ops-day-number">${Number(key.slice(-2))}</span>
    ${rows.slice(0,2).map(e=>`<span class="ops-day-event" data-kind="${e.kind}">${clock(e.starts)} ${esc(e.title)}</span>`).join('')}
    ${rows.length>2?`<small>+${rows.length-2} more</small>`:''}</button>`;
  });
  const label=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(first);
  return `<div class="ops-month-bar"><button data-ops-action="prev" aria-label="Previous month">‹</button><h2>${label}</h2><button data-ops-action="next" aria-label="Next month">›</button><button data-ops-action="today">Today</button></div>
   <div class="ops-month">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(name=>`<span class="ops-weekday">${name}</span>`).join('')}${cells.join('')}</div>
   ${selectedDay?`<div class="ops-day-agenda"><h2>Events on ${selectedDay}</h2>${agenda(byDay.get(selectedDay)||[])}</div>`:''}`;
 }
 function editor(){
  if(editing===null || !data.canEdit)return '';
  const event=data.events.find(e=>e.manual&&e.id===editing);
  const options=data.canShare?['all',...(data.canShareDirectors?['directors']:[]),'private']:['private'];
  if(event?.audience==='calendar')options.push('calendar');
  const audience=event?.audience||(embedded?'private':'all');
  const nextHour=new Date(Date.now()+3600000).toISOString().slice(0,16);
  const start=event?new Date(event.starts).toISOString().slice(0,16):view==='month'&&selectedDay?selectedDay+'T'+nextHour.slice(11):nextHour;
  return `<form class="panel compact ops-editor" id="${formId}">
   <h2>${event?(event.recurrence&&event.recurrence!=='none'?'Edit series':'Edit event'):'New event'}</h2>
   <div class="ops-form-grid">
    <label>Title<input name="title" maxlength="100" required value="${esc(event?.title)}"></label>
    <label>Type<select name="kind">${manualKinds.map(k=>`<option value="${k}" ${event?.kind===k?'selected':''}>${operationKinds[k]}</option>`).join('')}</select></label>
    <label>Start · EVE time (UTC)<input name="start" type="datetime-local" required value="${start}"></label>
    <label>Repeat<select name="recurrence">${Object.entries(recurrenceLabels).map(([value,label])=>`<option value="${value}" ${(event?.recurrence||'none')===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <label>Visibility<select name="audience">${options.map(value=>`<option value="${value}" ${value===audience?'selected':''}>${audienceLabels[value]}</option>`).join('')}</select></label>
    <label>Form-up system<input name="system" maxlength="60" value="${esc(event?.system)}"></label>
    <label>Region<input name="region" maxlength="60" value="${esc(event?.region)}"></label>
    <label>Fitting link<input name="fitting" type="url" maxlength="500" placeholder="https://" value="${esc(event?.fitting)}"></label>
   </div>
   <label>Notes<textarea name="notes" maxlength="2000" rows="3">${esc(event?.notes)}</textarea></label>
   <div class="actions"><button class="primary">Save event</button><button type="button" data-ops-action="cancel">Cancel</button>
    ${event?`<button type="button" data-ops-action="delete">${event.recurrence&&event.recurrence!=='none'?'Delete series':'Delete event'}</button>`:''}</div>
  </form>`;
 }
 function content(){
  const now=Date.now(),first=monthStart(month);
  const events=view==='month'?filtered(first-8*day,first+44*day):filtered(now,now+90*day);
  const count=days=>filtered(now,now+days*day).filter(e=>e.starts>=now&&e.starts<now+days*day).length;
  const upcoming=events.filter(e=>e.starts>=now || (!e.manual&&e.starts>=now-7*day));
  const choices=key=>[...new Set(data.events.map(e=>e[key]).filter(Boolean))].sort().map(v=>[v,v]);
  const kinds=[...new Set(visibleEvents().map(e=>e.kind))].map(k=>[k,operationKinds[k]]);
  return `<section class="panel compact ops-toolbar" ${editing!==null?'inert':''}>
   ${embedded?'<h2>Calendar</h2>':''}<div class="ops-view-switch${embedded?' ops-embedded-switch':''}" aria-label="Calendar view">
    <button class="${view==='upcoming'?'primary':''}" aria-pressed="${view==='upcoming'}" data-ops-action="upcoming">Upcoming</button>
    <button class="${view==='month'?'primary':''}" aria-pressed="${view==='month'}" data-ops-action="month">Month</button>
   </div>
   <button aria-pressed="${showTimers}" data-ops-action="timers">Event timers: ${showTimers?'On':'Off'}</button>
   <div class="ops-metrics"><span><strong>${count(1)}</strong> Next 24 hours</span><span><strong>${count(7)}</strong> Next 7 days</span></div>
   ${data.canEdit?'<button class="primary" data-ops-action="new">+ New event</button>':''}
  </section>
  ${editor()}
  <section class="panel compact ops-calendar" ${editing!==null?'inert':''}>
   <div class="ops-filters">${options('kind','Event type',kinds)}${options('region','Region',choices('region'))}${options('system','System or destination',choices('system'))}
    <label>Time zone<select data-ops-zone><option value="utc" ${zone==='utc'?'selected':''}>EVE time (UTC)</option><option value="local" ${zone==='local'?'selected':''}>Local time</option></select></label>
   </div>
   ${view==='month'?monthView(events):agenda(upcoming)}
  </section>
  ${!embedded&&data.coverage.length?`<details class="panel compact ops-coverage"><summary>Timer sources</summary>${data.coverage.map(s=>`<div>${operationKinds[s.kind]} · ${s.updated?`${dateLabel(s.updated)} ${clock(s.updated)}`:'No saved snapshot'}${s.failed?' · Last sync failed':''}${s.unavailable?' · '+s.unavailable+' run-out times unavailable':''}</div>`).join('')}</details>`:''}`;
 }
 function update(focusSelector){
  const root=document.getElementById(rootId);
  if(!root)return;
  root.innerHTML=content();
  if(focusSelector)root.querySelector(focusSelector)?.focus();
 }
 function setMonth(step){
  const date=new Date(monthStart(month));
  date.setUTCMonth(date.getUTCMonth()+step);
  month=isoDay(date).slice(0,7);
  selectedDay='';
 }
 document.addEventListener('click',async e=>{
  const b=e.target.closest(`#${rootId} button`);
  if(!b)return;
  const action=b.dataset.opsAction;
  if(!action&&!b.dataset.opsDay&&!b.dataset.opsEdit)return;
  // Leave the form in place while an event write is in flight.
  if(document.querySelector(`#${formId}[aria-busy="true"]`))return;
  if(b.dataset.opsDay){
   selectedDay=b.dataset.opsDay;
   update(`[data-ops-day="${selectedDay}"]`);
   return;
  }
  if(b.dataset.opsEdit||action==='new'){
   editing=b.dataset.opsEdit?Number(b.dataset.opsEdit):0;
   update(`#${formId} input`);
   return;
  }
  if(action==='delete'){
   const event=data.events.find(item=>item.manual&&item.id===editing);
   if(!confirm(event?.recurrence&&event.recurrence!=='none'?'Delete this recurring series and all its occurrences?':'Delete this calendar event?'))return;
   await save(null);
   return;
  }
  if(action==='timers'){
   showTimers=!showTimers;
   if(!showTimers&&!manualKinds.includes(filters.kind))filters.kind='';
  }
  if(action==='cancel')editing=null;
  if(action==='month'||action==='upcoming')view=action;
  if(action==='prev'||action==='next')setMonth(action==='prev'?-1:1);
  if(action==='today'){selectedDay=dayKey(Date.now());month=selectedDay.slice(0,7);}
  update(`[data-ops-action="${action}"]`);
 });
 document.addEventListener('change',e=>{
  const select=e.target.closest(`#${rootId} select`);
  if(!select)return;
  if(select.dataset.opsFilter){
   filters[select.dataset.opsFilter]=select.value;
   if(select.dataset.opsFilter==='kind'&&filterScope){try{localStorage.setItem(filterScope,filters.kind);}catch{}}
   update(`[data-ops-filter="${select.dataset.opsFilter}"]`);
  }
  if(select.hasAttribute('data-ops-zone')){
   zone=select.value;
   selectedDay='';
   update('[data-ops-zone]');
  }
 });
 async function save(fields){
  const form=document.getElementById(formId);
  if(!form||form.getAttribute('aria-busy')==='true')return;
  form.setAttribute('aria-busy','true');
  form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{
   await api(endpoint+(editing?'/'+editing:''),fields||{},fields?'POST':'DELETE');
   editing=null;
   if(onSaved)await onSaved();
   else{
    data=await api(endpoint);
    update('[data-ops-action="new"]');
   }
   toast(fields?'Event saved.':'Event deleted.');
  }catch(error){toast(error.message);}
  finally{
   form.removeAttribute('aria-busy');
   form.querySelectorAll('button').forEach(b=>b.disabled=false);
  }
 }
 document.addEventListener('submit',e=>{
  if(e.target.id!==formId)return;
  e.preventDefault();
  save(Object.fromEntries(new FormData(e.target)));
 });
 function mount(calendarData){
  data=calendarData;
  loadEventType();
  month??=dayKey(Date.now()).slice(0,7);
  editing=null;
  return `<div id="${rootId}" class="ops-workspace">${content()}</div>`;
 }
 return {
  mount,
  async render(){
   return intro('Operations Calendar','Plan corporation events and see upcoming timers in one place.')+
    mount(await api(endpoint));
  },
  showEvent(id,starts){
   const event=data?.events.find(item=>item.manual&&item.id===id);
   if(!event)return;
   view='month';
   selectedDay=dayKey(Number.isFinite(starts)?starts:event.starts);
   month=selectedDay.slice(0,7);
   update(`[data-ops-day="${selectedDay}"]`);
   document.querySelector(`#${rootId} .ops-day-agenda`)?.scrollIntoView({block:'nearest'});
  }
 };
}
