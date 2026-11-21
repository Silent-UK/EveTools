import {REINFORCEMENT_GRACE} from './structure-reinforcement.mjs';
import {regionForSystem,regionForSystemName} from './moon-scan-upload.mjs';
import systemNames from './system-names.json' with {type:'json'};
import {parseTimerDetail,timerStages,timerStances,timerTypes} from '../public/timerboard-model.mjs';

export function unmatchedDashboardTimers(timers, displayed, corporationOwner) {
 const normalise=name=>String(name??'').trim().toLowerCase();
 const ticker=corporationOwner.split('/')[0].toUpperCase();
 const isOwnPos=timer=>timer.stance==='Friendly'&&timer.type==='POS'&&timer.ticker===ticker;
 const near=(left,right)=>Math.abs(left.at-right.at)<=1000;
 return timers.filter(timer=>{
  if(timer.stance!=='Friendly')return true;
  if(displayed.some(row=>row.at===timer.at&&normalise(row.structureName)===normalise(timer.name)))return false;
  if(!isOwnPos(timer))return true;
  // ESI can label a POS by its moon, while the paste holds its custom name.
  const matches=displayed.filter(row=>row.structureKind==='POS'&&row.typeId===timer.typeId&&near(row,timer));
  if(matches.length!==1)return true;
  return timers.filter(other=>isOwnPos(other)&&other.typeId===matches[0].typeId&&near(other,matches[0])).length!==1;
 });
}

export function timerboardRoutes(app,{db,services,calendar,calendarAccess,cat,corporationOwner,corporationName,member,canContribute,canRemoveTimers=()=>false}){
 db.exec(`CREATE TABLE IF NOT EXISTS timerboard_entries(
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stage TEXT NOT NULL, type TEXT NOT NULL, stance TEXT NOT NULL, ticker TEXT NOT NULL,
  name TEXT NOT NULL, system TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS timerboard_exit ON timerboard_entries(at);
  CREATE TABLE IF NOT EXISTS timerboard_targets(
   id INTEGER PRIMARY KEY, stage TEXT NOT NULL, type TEXT NOT NULL, stance TEXT NOT NULL,
   ticker TEXT NOT NULL, name TEXT NOT NULL, system TEXT NOT NULL);`);
 // Manual POS entries store a generic type. Use the Caldari Control Tower icon.
 const manualTypeId=type=>type==='POS'?16213:cat.named?.(type);
 async function visible(req,access){
  if(!services.available(req,'timerboard'))return false;
  const settings=services.timerboardSettings();
  if(settings?.audience==='group')return Boolean(db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND status='approved'").get(settings.review_group,req.session.user_id));
  if(settings?.audience==='directors')return (access??await calendarAccess(req)).organiser;
  return member(req);
 }
 const allowed=async(req,res,next)=>await visible(req)?next():res.sendStatus(403);
 const external=db.prepare("SELECT id,name,system,type,stage,stance,ticker,at FROM timerboard_entries WHERE at>? AND at<=? AND stance IN ('Hostile','Neutral') ORDER BY at,id");
 const externalTimers=(from,to)=>external.all(from,to).map(timer=>({...timer,typeId:manualTypeId(timer.type)}));
 const dashboardRows=db.prepare("SELECT id,name,system,type,stage,stance,ticker,at FROM timerboard_entries WHERE at>? AND stage<>'Anchoring' ORDER BY at,id");
 const dashboardReinforcements=(now,displayed)=>unmatchedDashboardTimers(
  dashboardRows.all(now-REINFORCEMENT_GRACE).map(timer=>({...timer,typeId:manualTypeId(timer.type)})),displayed,corporationOwner
 );
 function calendarEvents(now){
  return externalTimers(now-REINFORCEMENT_GRACE,Number.MAX_SAFE_INTEGER).filter(timer=>timer.stage!=='Anchoring').map(timer=>({
   id:'timerboard-'+timer.id,kind:'reinforcement',title:timer.name,system:timer.system,typeId:timer.typeId,
   starts:timer.at,source:'timerboard',notes:[timer.stance,timer.stage,timer.type,timer.ticker].join(' · ')
  }));
 }
 function listTimers(access,now,events=calendar.list(access.allowed,false,now).events,sharedDens=[]){
  const automatic=events
   .filter(event=>!event.manual&&['reinforcement','anchoring'].includes(event.kind)&&event.starts>now-REINFORCEMENT_GRACE)
   .map(event=>({
    id:event.id,name:event.title,system:event.system,region:event.region,typeId:event.typeId,at:event.starts,
    type:(event.typeId?cat.type(event.typeId)?.name:null)||event.structureKind||'Structure',
    stage:event.kind==='anchoring'?'Anchoring':event.structureState?.includes('armor')?'Armor':'Final',
    stance:'Friendly',ticker:corporationOwner,ownerName:event.source==='corp-structures'?corporationName:undefined,source:'ESI'
   }));
  if(access.allowed.includes('corp-structures')){
   const saved=Number.isSafeInteger(access.user)
    ?db.prepare("SELECT s.data,c.id FROM snapshots s JOIN characters c ON c.id=s.character_id WHERE c.user_id=? AND s.kind='dens'").all(access.user)
    :sharedDens;
   for(const pilot of saved)for(const den of JSON.parse(pilot.data)||[]){
    const at=Date.parse(den.reinforcement_timer?.end);
    if(!(at>now-REINFORCEMENT_GRACE))continue;
    const systemId=den.planet?.system_id??den.skyhook?.solar_system_id;
    const planetName=den.planet?.name;
    const nameSystem=planetName?.match(/^(.+) [IVXLCDM]+$/i)?.[1];
    const system=den.system||systemNames[systemId]||(regionForSystemName(nameSystem)?nameSystem:undefined);
    automatic.push({id:'den-'+pilot.id+'-'+den.id,name:planetName||'Mercenary Den',
     system,region:den.region||regionForSystem(systemId),type:'Mercenary Den',typeId:den.type_id,stage:'Final',stance:'Friendly',at,source:'ESI'});
   }
  }
  const manual=db.prepare('SELECT id,stage,type,stance,ticker,name,system,at FROM timerboard_entries WHERE at>? ORDER BY at,id').all(now-REINFORCEMENT_GRACE);
  const duplicate=timer=>timer.stance==='Friendly'&&automatic.some(event=>event.at===timer.at&&event.stage===timer.stage&&event.name.toLowerCase()===timer.name.toLowerCase());
  return [...automatic,...manual.filter(timer=>!duplicate(timer)).map(timer=>({...timer,typeId:manualTypeId(timer.type),source:'Manual'}))]
   .map(timer=>({...timer,region:timer.region||regionForSystemName(timer.system)}))
   .sort((a,b)=>a.at-b.at||a.name.localeCompare(b.name));
 }
 app.get('/api/timerboard',allowed,async(req,res)=>{
  const now=Date.now(),access=await calendarAccess(req);
  const targets=db.prepare('SELECT * FROM timerboard_targets ORDER BY system COLLATE NOCASE,name COLLATE NOCASE,id').all().map(target=>({...target,typeId:manualTypeId(target.type)}));
  res.json({targets,canAdd:access.organiser||canContribute(req),canRemoveTargets:access.organiser,canRemoveTimers:canRemoveTimers(req),timers:listTimers(access,now)});
 });
 function save(req,res,target){
  const {stage,type,stance,ticker,detail}=req.body||{};
  const timer=target?null:parseTimerDetail(detail,req.body?.system);
  const name=typeof detail==='string'&&detail.length<=1500?detail.trim().split(/\r?\n/)[0].trim():'';
  const system=name.match(/^([\w-]+)\s+-\s+\S/)?.[1];
  const parsed=target?(system&&name.length<=200?{name,system}:null):timer;
  const invalid=message=>res.status(400).json({error:message});
  if(!(timerStages.includes(stage)||(target&&stage==='Shield'))||!timerTypes.includes(type)||!timerStances.includes(stance))return invalid('Choose a valid stage, type and stance.');
  if(typeof ticker!=='string'||!ticker.trim()||ticker.trim().length>12)return invalid('Enter an owner ticker of up to 12 characters.');
  if(!parsed)return invalid(target?'Paste a structure name starting with its system.':'Paste the structure name and a valid in-game timer in EVE time.');
  if(!target&&!parsed.system)return invalid('Enter the solar system when the structure name does not include it.');
  if(parsed.anchoring&&stage!=='Anchoring')return invalid('Choose Anchoring for an anchoring timer.');
  if(!target&&parsed.at<=Date.now()-REINFORCEMENT_GRACE)return invalid('This timer ended more than two hours ago.');
  if(target)db.prepare('INSERT INTO timerboard_targets(stage,type,stance,ticker,name,system) VALUES(?,?,?,?,?,?)')
   .run(stage,type,stance,ticker.trim().toUpperCase(),parsed.name,parsed.system);
  else db.prepare('INSERT INTO timerboard_entries(user_id,stage,type,stance,ticker,name,system,at) VALUES(?,?,?,?,?,?,?,?)')
   .run(req.session.user_id,stage,type,stance,ticker.trim().toUpperCase(),parsed.name,parsed.system,parsed.at);
  res.status(201).json({ok:true});
 }
 async function canAdd(req,res,next){
  if(canContribute(req)||(await calendarAccess(req)).organiser)return next();
  res.status(403).json({error:'Group permission is required to add timers and targets.'});
 }
 app.post('/api/timerboard',allowed,canAdd,(req,res)=>save(req,res,false));
 app.post('/api/timerboard/targets',allowed,canAdd,(req,res)=>save(req,res,true));
 app.delete('/api/timerboard/timers/:id',(req,res)=>{
  if(!services.available(req,'timerboard')||!canRemoveTimers(req))return res.sendStatus(403);
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0||!db.prepare('DELETE FROM timerboard_entries WHERE id=?').run(id).changes)return res.sendStatus(404);
  res.json({ok:true});
 });
 app.delete('/api/timerboard/targets/:id',async(req,res)=>{
  if(!services.available(req,'timerboard')||!(await calendarAccess(req)).organiser)return res.sendStatus(403);
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0||!db.prepare('DELETE FROM timerboard_targets WHERE id=?').run(id).changes)return res.sendStatus(404);
  res.json({ok:true});
 });
 return {visible,dashboardReinforcements,calendarEvents,listTimers};
}
