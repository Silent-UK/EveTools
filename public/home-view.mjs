import {homeCategories} from './home-categories.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const utc=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const date=at=>Number.isFinite(at)?utc.format(at)+' UTC':'';
const image=(kind,id,variant,classes='')=>Number.isSafeInteger(id)&&id>0
 ?`<img class="${classes}" src="https://images.evetech.net/${kind}/${id}/${variant}?size=64" alt="" loading="lazy">`
 :'';
const portrait=(id,classes)=>image('characters',id,'portrait',classes);
const typeImage=(id,classes)=>image('types',id,'icon',classes);

export function exitCountdown(at,now=Date.now()){
 const minutes=Math.ceil((at-now)/60000);
 if(minutes<=0)return 'Elapsed';
 if(minutes===1)return at-now<60000?'<1m':'1m';
 const days=Math.floor(minutes/1440),hours=Math.floor(minutes/60)%24;
 return [days?days+'d':'',hours?hours+'h':'',minutes%60?minutes%60+'m':''].filter(Boolean).join(' ');
}

function eventRow(event,category,readOnly){
 const target=event.calendarEventId?`data-home-calendar-event="${Number(event.calendarEventId)}" data-home-calendar-time="${Number(event.at)}"`:event.pilotId&&!event.accountWide&&event.page!=='contracts'
  ?`data-my-target="${esc(event.page)}" data-my-pilot="${Number(event.pilotId)}"`
  :`data-nav="${esc(event.page)}"${event.homeAction?` data-home-action="${esc(event.homeAction)}"`:''}`;
 const countdown=['Exits','Completes'].includes(event.timeLabel)&&Number.isFinite(event.at);
 const pi=event.page==='pi';
 const title=pi?event.pilot+' · '+event.title:event.title;
 const pilotImage=portrait(event.pilotId,'home-pilot-portrait');
 const itemImage=typeImage(event.typeId,pilotImage?'home-type-overlay':'home-type-icon');
 const details=event.items?.length?`<details><summary>${pi?'View planets':'View details'}</summary><ul>${
  [...event.items].sort((a,b)=>pi?a.at-b.at:b.at-a.at).map(item=>`<li>${typeImage(item.typeId,'home-detail-icon')}<span>${esc(item.title)} <small>${date(item.at)}</small></span></li>`).join('')
 }</ul></details>`:'';
 return `<article class="home-event"${event.stance?` data-stance="${esc(event.stance)}"`:''}>
  <div class="home-event-art" aria-hidden="true">${pilotImage||itemImage?`${pilotImage}${itemImage}`:category.icon}</div>
  <div class="home-event-main${pi?' home-pi-summary':''}"><button ${target}>${esc(title)} <span aria-hidden="true">↗</span></button>${event.stance?` <span class="timerboard-stance" data-stance="${esc(event.stance)}">${esc(event.stance)}</span>`:''}
   ${pi?'':`<small class="${event.announcementId?'announcement-message':''}">${[event.pilot,event.detail].filter(Boolean).map(esc).join(' · ')}</small>`}
   ${details}
   ${event.announcementId&&!readOnly?`<button data-announcement-read="${event.announcementId}">Mark as read</button>`:''}
   ${event.attackKey&&!readOnly?`<button data-action="clear-dashboard-attack" data-key="${esc(event.attackKey)}">Clear for everyone</button>`:''}
   ${event.savedKey&&!readOnly?`<button data-action="save-dashboard-structure" data-key="${esc(event.savedKey)}">Mark as Saved</button>`:''}
   ${['completedContracts','market'].includes(category.id)&&!readOnly&&event.items?.length&&event.items.every(item=>Number.isSafeInteger(item.id))?`<button data-action="${category.id==='market'?'clear-market-orders':'clear-completed-contracts'}" data-pilot="${event.pilotId}" data-notification-ids="${esc(event.items.map(item=>item.id).join(','))}">Clear</button>`:''}
  </div>
  <div class="home-event-time${countdown?' home-exit-timing':''}">
   ${countdown?`<strong class="event-countdown" data-event-countdown="${event.at}" aria-label="Time remaining">${esc(exitCountdown(event.at))}</strong>`:''}${date(event.at)?`<time>${event.timeLabel?esc(event.timeLabel)+' ':''}${date(event.at)}</time>`:''}
   ${event.estimated?'<small>Estimated</small>':''}${event.stale?'<small class="home-stale">Saved data may be stale</small>':''}</div>
 </article>`;
}

function selectedEvents(events,selection){
 return events.filter(event=>!selection||(selection==='corporation'?!event.pilotId:String(event.pilotId)===selection));
}

export function homeSections(feed,selection='',expanded={},readOnly=false){
 const panels=homeCategories.map(category=>{
  const {id,label,icon,tone='accent'}=category;
  const events=selectedEvents(feed[id]||[],selection);
  if(!events.length)return '';
  const open=typeof expanded[id]==='boolean'?expanded[id]:category.open===true;
  const sectionIcon=typeImage(events.find(event=>event.typeId)?.typeId,'home-section-image')||icon;
  return `<details class="panel compact home-section" data-home-section="${id}" data-home-tone="${tone}" ${open?'open':''}>
   <summary><span class="home-section-title"><span class="home-section-icon" aria-hidden="true">${sectionIcon}</span>${label}</span><span class="home-count">${events.length}</span></summary>
   ${events.map(event=>eventRow(event,category,readOnly)).join('')}
  </details>`;
 }).join('');
 return panels||'<p class="panel compact home-empty">No events to show for this selection.</p>';
}

export const homeHasCorporation=feed=>homeCategories.some(({id})=>(feed[id]||[]).some(event=>!event.pilotId));

export function homeView(feed,selection='',expanded={},account={}){
 const corporation=homeHasCorporation(feed);
 const pilot=feed.pilots.find(p=>String(p.id)===selection);
 const imageId=pilot?.id||account.main_id;
 return `<div class="home-view">
  <div class="panel compact home-controls">
   <div class="home-identity">${portrait(imageId,'home-identity-portrait')}<div><strong>${esc(pilot?.name||account.name||'Pilot activity')}</strong><small>${feed.pilots.length} linked ${feed.pilots.length===1?'character':'characters'}</small></div></div>
   <label>Show <select id="home-pilot">
    <option value="">All events</option>${feed.pilots.map(p=>`<option value="${Number(p.id)}" ${String(p.id)===selection?'selected':''}>${esc(p.name)}</option>`).join('')}
    ${corporation?`<option value="corporation" ${selection==='corporation'?'selected':''}>Corporation</option>`:''}
   </select></label>
  </div>
  <div id="home-sections" class="home-sections">${homeSections(feed,selection,expanded,!!account.inspect)}</div>
 </div>`;
}
