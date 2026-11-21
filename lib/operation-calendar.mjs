import {REINFORCEMENT_GRACE,structureReinforcementEnd} from './structure-reinforcement.mjs';
import {recurrenceLabels} from '../public/operation-recurrence.mjs';
import {manualKinds} from '../public/operation-kinds.mjs';
import {activeOperations} from '../public/den-model.mjs';

const day = 86400000;
const bad = message => Object.assign(new Error(message), {status:400});
const forbidden = () => Object.assign(new Error('You do not have permission for this calendar action.'),{status:403});
const notFound = () => Object.assign(new Error('Event not found.'),{status:404});
const audiences = new Set(['all','directors','private','calendar']);

function eventFields(body = {}) {
 const field = (key, limit) => {
  const value = body?.[key] ?? '';
  if(typeof value !== 'string' || value.length > limit) throw bad('Check the event fields and try again.');
  return value.trim();
 };
 const title = field('title',100), kind = field('kind',20), start = field('start',24);
 const system = field('system',60), region = field('region',60), notes = field('notes',2000);
 const fitting = field('fitting',500);
 if(!title || !manualKinds.includes(kind) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(start) ||
    !Number.isFinite(Date.parse(start+'Z')) || new Date(start+'Z').toISOString().slice(0,16)!==start)
  throw bad('Enter an event title, type and valid EVE time (UTC).');
 if(fitting){
  try {
   const url=new URL(fitting);
   if(url.protocol!=='https:' || url.username || url.password)throw new Error();
  } catch { throw bad('Use an HTTPS fitting link.'); }
 }
 return {title,kind,starts:Date.parse(start+'Z'),system,region,notes,fitting};
}

export function operationCalendar(db, corp){
 db.exec(`CREATE TABLE IF NOT EXISTS operation_events(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, starts INTEGER NOT NULL,
  system TEXT NOT NULL, region TEXT NOT NULL, notes TEXT NOT NULL, fitting TEXT NOT NULL
 )`);
 const columns=db.prepare('PRAGMA table_info(operation_events)').all();
 if(!columns.some(column=>column.name==='audience'))
  db.exec("ALTER TABLE operation_events ADD COLUMN audience TEXT NOT NULL DEFAULT 'calendar'");
 if(!columns.some(column=>column.name==='owner_id'))
  db.exec('ALTER TABLE operation_events ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE');

 if(!columns.some(column=>column.name==='recurrence'))
  db.exec("ALTER TABLE operation_events ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'");

 function canEditEvent(event,actor){
  return event.audience==='private'?event.owner_id===actor.user:actor.organiser===true;
 }
 const read = path => {
  const row=db.prepare('SELECT data FROM public_cache WHERE path=?').get(path);
  return row ? JSON.parse(row.data) : {};
 };
 function list(allowed,canEdit,now=Date.now(),viewer={},savedSnapshot){
  const events=db.prepare(`SELECT id,title,kind,starts,system,region,notes,fitting,audience,owner_id,recurrence
   FROM operation_events
   WHERE audience='all' OR (audience='calendar' AND ?=1) OR (audience='directors' AND ?=1)
    OR (audience='private' AND owner_id=?)
   ORDER BY starts,id`).all(Number(allowed.includes('corp-calendar')),Number(!!viewer.organiser),viewer.user??null)
   .map(({owner_id,...event})=>({...event,manual:true,
    canEdit:canEdit&&canEditEvent({...event,owner_id},viewer)}));
  const coverage=[];
  const snapshot=allowed.includes('corp-moons')||allowed.includes('corp-structures') ? (savedSnapshot??corp.snapshot()) : null;
  const structures=new Map((snapshot?.structures||[]).map(row=>[row.id,row]));
  const add = (event, starts) => {
   if(Number.isFinite(starts))events.push({...event,starts});
  };
  if(viewer.user!=null && viewer.mto!==false){
   const pilots=db.prepare(`SELECT c.id,c.name,s.data,s.updated FROM characters c
    JOIN snapshots s ON s.character_id=c.id AND s.kind='dens' WHERE c.user_id=?`).all(viewer.user);
   for(const pilot of pilots)for(const den of JSON.parse(pilot.data)||[]){
    if(den.operations_error)continue;
    for(const operation of activeOperations(den,now)){
     const location=den.planet?.name||'Mercenary Den';
     add({id:`mto-${pilot.id}-${operation.id}`,kind:'mto',title:`${operation.definition?.name?.en||'MTO'} · ${pilot.name}`,
      typeId:den.type_id,system:den.system||location,region:den.region,source:'dens',updated:pilot.updated,
      notes:`${operation.state} · ${location}`},Date.parse(operation.expires));
    }
   }
  }
  if(snapshot){
   const resources=['fuel','gas'].map(kind=>({kind,updated:snapshot.updated,
    failed:!!snapshot.job?.error,unavailable:0}));
   for(const row of structures.values()){
    const drill=row.kind==='Moon Drill';
    if(!allowed.includes('corp-structures') && !(drill&&allowed.includes('corp-moons')))continue;
    for(const kind of drill?['fuel','gas']:['fuel']){
     const rate=kind==='gas'?row.gas_rate:row.rate;
     // A zero consumption rate is deliberate, for example a stopped drill.
     if(rate===0)continue;
     let starts=NaN, basis='Saved inventory and consumption rate';
     if(kind==='fuel'&&row.kind==='Structure'&&Number.isFinite(Date.parse(row.fuel_expires))){
      starts=Date.parse(row.fuel_expires);
      basis='Saved ESI fuel expiry';
     }else if(Number.isFinite(rate)&&rate>0&&Number.isFinite(row[kind])&&row[kind]>=0&&
       Number.isFinite(row.inventory_at)&&row.inventory_at>0){
      starts=row.inventory_at+row[kind]/rate*3600000;
     }else if(kind==='fuel' && !/offline|unanchoring/i.test(row.state||'')){
      starts=Date.parse(row.fuel_expires);
      basis='Saved ESI fuel expiry';
     }
     if(!Number.isFinite(starts)){
      resources.find(resource=>resource.kind===kind).unavailable++;
      continue;
     }
     add({id:kind+'-'+row.id,kind,title:row.name,typeId:row.type_id,system:row.system,region:row.region,
      source:allowed.includes('corp-structures')?'corp-structures':'corp-moons',
      updated:row.inventory_at||snapshot.updated,estimated:true,
      notes:basis+'. Assumes the recorded services keep running, with no refuelling or consumption changes.'},starts);
    }
   }
   coverage.push(...resources);
  }
  if(allowed.includes('corp-moons')){
   const saved=read('/tools/moon-extractions');
   coverage.push({kind:'moon',updated:saved.updated||null,failed:!!saved.error});
   for(const row of saved.rows||[]){
    if(Date.parse(row.natural_decay_time)<=now)continue;
    const structure=structures.get(row.structure_id);
    add({id:'moon-'+row.structure_id,kind:'moon',title:structure?.name||'Moon '+row.moon_id,typeId:structure?.type_id,
     system:structure?.system,region:structure?.region,source:'corp-moons',updated:saved.updated,
     notes:'Ready to fracture from this time.'},Date.parse(row.chunk_arrival_time));
   }
  }
  if(allowed.includes('corp-structures')){
   coverage.push({kind:'reinforcement',updated:snapshot.updated,failed:!!snapshot.job?.error});
   const destroyed=new Map(snapshot.customsOffices?.destroyed||[]);
   const alerts=new Map((snapshot.customsOffices?.reinforced||[]).map(timer=>[timer.id,timer]));
   for(const row of structures.values()){
    if(destroyed.has(row.id))continue;
    const observedEnd=structureReinforcementEnd(row),alert=alerts.get(row.id);
    const fromAlert=row.kind==='Moon Drill'&&alert&&alert.started>(row.structure_observed??snapshot.updated??0)&&!Number.isFinite(observedEnd);
    const end=fromAlert?alert.end:observedEnd;
    if(!(end+REINFORCEMENT_GRACE>now))continue;
    add({id:'reinforcement-'+row.id,kind:'reinforcement',title:row.name,typeId:row.type_id,system:row.system,
     region:row.region,source:'corp-structures',structureKind:row.kind,structureState:fromAlert?'hull_reinforce':row.state,updated:fromAlert?snapshot.customsOffices.updated:snapshot.updated},end);
   }
   const anchoring=new Map((snapshot.customsOffices?.anchoring||[]).map(timer=>[timer.id,timer]));
   for(const row of structures.values()){
    if(row.kind!=='Moon Drill'||row.state!=='anchoring')continue;
    const end=Date.parse(row.timer);
    if(Number.isFinite(end))anchoring.set(row.id,{id:row.id,end});
   }
   for(const timer of anchoring.values()){
    if(timer.end<=now||destroyed.has(timer.id))continue;
    const drill=structures.get(timer.id);
    add({id:'anchoring-'+timer.id,kind:'anchoring',title:drill?.name||timer.name||'Metenox '+timer.id,
     typeId:81826,system:drill?.system||timer.system,region:drill?.region,source:'corp-structures',
     estimated:timer.started!==undefined,updated:timer.started!==undefined?snapshot.customsOffices.updated:snapshot.updated},timer.end);
   }
   for(const office of snapshot.customsOffices?.timers||[]){
    if(!(office.end+REINFORCEMENT_GRACE>now))continue;
    add({id:'customs-office-'+office.planetId,kind:'reinforcement',title:office.name||'Planet '+office.planetId,
     typeId:office.typeId,system:office.name?.match(/^(.+) [IVXLCDM]+$/)?.[1],source:'corp-structures',structureKind:'Customs Office',updated:snapshot.customsOffices.updated},office.end);
   }
  }
  if(allowed.includes('corp-contracts')){
   const saved=read('/tools/corp-data/contracts');
   coverage.push({kind:'courier',updated:saved.updated||null,failed:!!saved.error});
   for(const row of saved.contracts||[]){
    if(row.retained || row.type!=='courier' || row.status!=='in_progress' || !(row.days_to_complete>0))continue;
    add({id:'courier-'+row.contract_id,kind:'courier',title:row.title||'Courier #'+row.contract_id,
     system:saved.locations?.[row.end_location_id],source:'corp-contracts',updated:saved.updated},
     Date.parse(row.date_accepted)+row.days_to_complete*day);
   }
  }
  return {events:events.sort((a,b)=>a.starts-b.starts),coverage,canEdit,canShare:canEdit&&!!(viewer.organiser||viewer.contributor),canShareDirectors:canEdit&&!!viewer.organiser};
 }
 function editable(id,actor){
  const row=db.prepare('SELECT owner_id,audience,recurrence FROM operation_events WHERE id=?').get(id);
  if(!row||(row.audience==='private'&&row.owner_id!==actor.user))throw notFound();
  if(!canEditEvent(row,actor))throw forbidden();
  return row;
 }
 function save(body,id,actor){
  const existing=id===undefined?null:editable(id,actor);
  const {title,kind,starts,system,region,notes,fitting}=eventFields(body);
  const recurrence=body?.recurrence??existing?.recurrence??'none';
  if(typeof recurrence!=='string'||!Object.hasOwn(recurrenceLabels,recurrence))throw bad('Choose a valid repeat interval.');
  const audience=body?.audience??existing?.audience??(actor.organiser?'calendar':'private');
  if(!audiences.has(audience))throw bad('Choose a valid event audience.');
  if(audience!=='private'&&!actor.organiser&&!(id===undefined&&actor.contributor&&['all','calendar'].includes(audience)))throw forbidden();
  if(audience==='private'&&existing&&existing.owner_id!==actor.user)throw forbidden();
  if(id===undefined){
   return {id:Number(db.prepare(`INSERT INTO operation_events
    (title,kind,starts,system,region,notes,fitting,audience,owner_id,recurrence) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(title,kind,starts,system,region,notes,fitting,audience,actor.user,recurrence).lastInsertRowid)};
  }
  db.prepare('UPDATE operation_events SET title=?,kind=?,starts=?,system=?,region=?,notes=?,fitting=?,audience=?,recurrence=? WHERE id=?')
   .run(title,kind,starts,system,region,notes,fitting,audience,recurrence,id);
  return {id};
 }
 function remove(id,actor){
  editable(id,actor);
  db.prepare('DELETE FROM operation_events WHERE id=?').run(id);
  return {ok:true};
 }
 return {list,save,remove};
}
