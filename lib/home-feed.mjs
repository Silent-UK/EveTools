import {piPlanetTypeId} from '../public/pi-view.mjs';
import {homeCategories,homePreference} from '../public/home-categories.mjs';
import {activeOperations} from '../public/den-model.mjs';
import {plainEveText} from '../public/detail-models.mjs';
import {operationKinds} from '../public/operation-kinds.mjs';

import {calendarOccurrences} from '../public/operation-recurrence.mjs';

const day=86400000;
const kinds=['skills','pi','dens','contracts','market'];
const pages={skills:'skills',pi:'pi',dens:'dens',contracts:'contracts',market:'market'};
const completedStatuses=new Set(['finished','finished_issuer','finished_contractor']);

function reinforcementTitle(kind,exited){
 const name=kind==='Moon Drill'?'Moon Drill':kind==='Customs Office'?'Customs Office':'Structure';
 return name+(exited?' exited reinforcement':' reinforced');
}

export function savedStructureKey(event,now){
 if(event.manual||event.kind!=='reinforcement'||event.source!=='corp-structures'||!Number.isFinite(event.starts)||event.starts>now)return null;
 return 'dashboard-saved-structure:'+event.id+':'+event.starts;
}

export const fulfilledMarketOrder=order=>order.status==='fulfilled'&&Number.isSafeInteger(order.order_id)&&order.order_id>0;

export function homeFeed(db,user,prefs,calendar,now=Date.now()){
 const pilots=db.prepare(`SELECT c.id,c.name,COALESCE(g.parent_id,u.main_id,c.id) AS parentId
  FROM characters c JOIN users u ON u.id=c.user_id
  LEFT JOIN character_groups g ON g.character_id=c.id
  WHERE c.user_id=? ORDER BY c.name COLLATE NOCASE`).all(user);
 const byId=new Map(pilots.map(pilot=>[pilot.id,pilot]));
 const feed=Object.fromEntries(homeCategories.map(({id})=>[id,[]]));
 const soon=now+7*day, recent=now-7*day;
 const add=(section,event)=>{
  if(prefs[homePreference(section)]!==false)feed[section].push(event);
 };
 const dismissedContracts=new Set(db.prepare("SELECT event_key FROM notification_dismissals WHERE user_id=? AND event_key GLOB 'dashboard-contract:*' AND dismissed>=?").all(user,now-2*day).map(row=>row.event_key));
 const dismissedMarket=new Set(db.prepare("SELECT event_key FROM notification_dismissals WHERE user_id=? AND event_key GLOB 'dashboard-market:*'").all(user).map(row=>row.event_key));
 const savedStructures=new Set(db.prepare("SELECT event_key FROM notification_dismissals WHERE user_id=? AND event_key GLOB 'dashboard-saved-structure:*' AND dismissed>=?").all(user,now-day).map(row=>row.event_key));
 const recentAt=at=>Number.isFinite(at)&&at>=recent&&at<=now;
 const rows=db.prepare(`SELECT s.character_id,s.kind,s.data,s.updated,e.message AS error
  FROM snapshots s JOIN characters c ON c.id=s.character_id
  LEFT JOIN sync_errors e ON e.character_id=s.character_id AND e.kind=s.kind
  WHERE c.user_id=? AND s.kind IN ('skills','pi','dens','contracts','market')`).all(user);

 for(const row of rows){
  if(!kinds.includes(row.kind)||prefs[pages[row.kind]]===false)continue;
  const pilot=byId.get(row.character_id),data=JSON.parse(row.data);
  const base={pilotId:pilot.id,pilot:pilot.name,page:pages[row.kind],stale:!!row.error||now-row.updated>2*3600000};
  const personal=(section,title,at,detail='',extra={})=>add(section,{...base,title,at,detail,...extra});
  if(row.kind==='skills'&&Array.isArray(data?.queue)){
   const queue=data.queue;
   const finishes=queue.map(skill=>Date.parse(skill.finish_date)).filter(Number.isFinite);
   const last=finishes.length?Math.max(...finishes):null;
   if(pilot.id===pilot.parentId&&(!queue.length||finishes.length===queue.length&&last<=now)&&prefs['notify-empty-training']!==false)
    personal('skills',queue.length?'Skill queue ended':'Skill queue empty',last);
   if(last>now&&last<=soon&&finishes.length===queue.length&&prefs['notify-training-ending']!==false)
    personal('skills','Skill queue ends',last);
  }
  if(row.kind==='pi'&&prefs['notify-pi-extractor']!==false){
   const piSoon=now+8*3600000;
   const finished=[], ending=[];
   for(const planet of data||[]){
    const name=planet.info?.name||planet.name||'Planet '+planet.planet_id;
    const typeId=piPlanetTypeId(planet);
    const deadlines=(planet.pins||[]).filter(pin=>pin.extractor_details)
     .map(pin=>Date.parse(pin.expiry_time)).filter(Number.isFinite);
    const stopped=deadlines.filter(at=>at<=now);
    if(stopped.length)finished.push({title:name,at:Math.max(...stopped),typeId});
    const next=deadlines.filter(at=>at>now&&at<=piSoon);
    if(next.length)ending.push({title:name,at:Math.min(...next),typeId});
   }
   if(finished.length)personal('pi',finished.length+' PI '+(finished.length===1?'planet':'planets')+' finished',
    Math.max(...finished.map(item=>item.at)),'',{items:finished,timeLabel:'Last ended',typeId:finished[0].typeId});
   if(ending.length)personal('pi',ending.length+' PI '+(ending.length===1?'planet':'planets')+' ending soon',
    Math.min(...ending.map(item=>item.at)),'',{items:ending,timeLabel:'Next',typeId:ending[0].typeId});
  }
  if(row.kind==='dens'){
   for(const den of data||[]){
    const location=den.planet?.name||'Mercenary Den';
    const end=Date.parse(den.reinforcement_timer?.end);
    if(end>now&&prefs['notify-den-reinforced']!==false){
     const attacker=den.reinforcement;
     const details=[attacker?.character||(attacker?.character_id?'Character '+attacker.character_id:''),plainEveText(attacker?.corporation),plainEveText(attacker?.alliance)].filter(Boolean);
     personal('reinforced','Mercenary Den reinforced',end,[location,...details].join(' · '),{timeLabel:'Exits',typeId:den.type_id});
    }
    if(prefs['notify-operation']!==false&&!den.operations_error)
     for(const operation of activeOperations(den,now)){
      const expires=Date.parse(operation.expires);
      if(expires<=soon)personal('denMtos','Den MTO expires',expires,location+' · '+(operation.definition?.name?.en||operation.state),{typeId:den.type_id});
     }
   }
  }
  if(row.kind==='contracts'){
   const finished=[];
   for(const contract of data?.contracts||[]){
    const title=contract.title||'Contract #'+contract.contract_id;
    const completed=Date.parse(contract.date_completed);
    const key='dashboard-contract:'+contract.contract_id;
    if(completedStatuses.has(contract.status)&&completed>=now-2*day&&completed<=now&&!dismissedContracts.has(key))
     finished.push({title,at:completed,id:contract.contract_id});
    if(contract.retained||contract.type!=='courier'||contract.status!=='in_progress'||!(contract.days_to_complete>0))continue;
    const due=Date.parse(contract.date_accepted)+contract.days_to_complete*day;
    if(Number.isFinite(due)&&due<=soon)personal('couriers',due<=now?'Courier overdue':'Courier delivery due',due,title);
   }
   if(finished.length)personal('completedContracts',finished.length+' completed '+(finished.length===1?'contract':'contracts'),Math.max(...finished.map(item=>item.at)),'',{items:finished});
  }
  if(row.kind==='market'){
   const fulfilled=(data?.history||[]).filter(order=>fulfilledMarketOrder(order)&&recentAt(order.fulfilled_observed)&&!dismissedMarket.has('dashboard-market:'+order.order_id))
    .map(order=>({title:order.name||'Order #'+order.order_id,at:order.fulfilled_observed,id:order.order_id}));
   if(fulfilled.length)personal('market',fulfilled.length+' fulfilled market '+(fulfilled.length===1?'order':'orders'),Math.max(...fulfilled.map(item=>item.at)),'Seen in saved market history',{items:fulfilled,timeLabel:'Seen'});
  }
 }

  for(const event of calendarOccurrences(calendar.events,now,soon+1)){
   const page=event.manual?'home':event.source;
   const fuel=event.kind==='fuel'||event.kind==='gas';
   const anchoring=event.kind==='anchoring';
   const reinforced=!event.manual&&event.kind==='reinforcement';
   const reinforcedDrill=reinforced&&event.structureKind==='Moon Drill';
   const reinforcedOffice=reinforced&&event.structureKind==='Customs Office';
   if(event.starts>soon&&!reinforced)continue;
   const overdue=event.starts<=now;
   if(overdue&&event.manual)continue;
   const savedKey=savedStructureKey(event,now);
   if(savedKey&&savedStructures.has(savedKey))continue;
   const courierOverdue=overdue&&event.kind==='courier';
   const failed=calendar.coverage.some(source=>source.kind===event.kind&&source.failed);
   const section=event.manual?'calendar':anchoring?'anchoringDrills':reinforcedDrill?'reinforcedDrills':reinforcedOffice?'reinforcedOffices':reinforced?'corpReinforced':fuel?'fuel':event.kind==='moon'?'extractions':'corpContracts';
   add(section,{
    page,title:event.manual?event.title:reinforced?reinforcementTitle(event.structureKind,overdue):overdue&&fuel?(event.kind==='fuel'?'Fuel estimated depleted':'Gas estimated depleted'):overdue&&event.kind==='courier'?'Corporation courier overdue':operationKinds[event.kind],
    detail:[event.manual?operationKinds[event.kind]:event.title,event.system,event.region].filter(Boolean).join(' · '),
    ...(reinforced?{structureName:event.title,structureKind:event.structureKind}:{}),
    savedKey,at:event.starts,typeId:event.typeId,calendarEventId:event.manual?event.id:undefined,timeLabel:anchoring?'Completes':reinforced?(overdue?'Exited':'Exits'):event.kind==='moon'&&overdue?'Ready since':undefined,
    estimated:event.estimated,stale:!event.manual&&(failed||!event.updated||now-event.updated>2*3600000)
   });
  }
 for(const [section,events] of Object.entries(feed)){
  if(section==='completedContracts'||section==='market')events.sort((a,b)=>b.at-a.at);
  else events.sort((a,b)=>(a.at??Infinity)-(b.at??Infinity));
 }
 return {pilots:pilots.map(({id,name})=>({id,name})),...feed,monthCalendar:calendar};
}
