import {REINFORCEMENT_GRACE} from './structure-reinforcement.mjs';

export const NOTIFICATIONS_SCOPE='esi-characters.read_notifications.v1';
export const STRUCTURE_ATTACK_MAX_AGE=3600000;

function numberField(text,key){
 const value=text.match(new RegExp('^'+key+':[ \\t]*(?:&[\\w-]+[ \\t]+)?([0-9]+)[ \\t]*\\r?$','m'))?.[1];
 return value?BigInt(value):0n;
}

export function structureAttackNotices(notices,previous,now){
 const recent=at=>Number.isFinite(at)&&at>=now-12*3600000&&at<=now;
 const attacks=new Map(previous.filter(attack=>recent(attack.at)).map(attack=>[attack.id+':'+attack.at,attack]));
 for(const notice of notices){
  if(!['StructureUnderAttack','TowerAlertMsg'].includes(notice?.type)||typeof notice.text!=='string'||notice.text.length>20000)continue;
  const id=Number(numberField(notice.text,'structureID')||numberField(notice.text,'towerID')||numberField(notice.text,'itemID'));
  const at=Date.parse(notice.timestamp);
  if(Number.isSafeInteger(id)&&id>0&&recent(at))attacks.set(id+':'+at,{id,at});
 }
 return [...attacks.values()].sort((a,b)=>a.at-b.at);
}

export function customsOfficeTimers(notices,previous,now){
 const byPlanet=new Map(previous.filter(timer=>timer.end+REINFORCEMENT_GRACE>now).map(timer=>[timer.planetId,timer]));
 for(const notice of notices){
  if(notice?.type!=='OrbitalReinforced'||typeof notice.text!=='string'||notice.text.length>20000)continue;
  const entered=Date.parse(notice.timestamp);
  const end=Number(numberField(notice.text,'reinforceExitTime')/10000n-11644473600000n);
  const planetId=Number(numberField(notice.text,'planetID'));
  const systemId=Number(numberField(notice.text,'solarSystemID'));
  if(!Number.isSafeInteger(planetId)||planetId<=0||!Number.isSafeInteger(systemId)||systemId<=0||
     !Number.isFinite(entered)||entered>now||end<=entered||end>entered+3*86400000||end+REINFORCEMENT_GRACE<=now)continue;
  const prior=byPlanet.get(planetId);
  if(prior&&prior.entered>=entered)continue;
  byPlanet.set(planetId,{planetId,systemId,end,entered,typeId:Number(numberField(notice.text,'typeID'))||2233,name:prior?.name});
 }
 return [...byPlanet.values()];
}

export function moonDrillAnchoringTimers(notices,previous,corporation,now){
 const timers=new Map(previous.filter(timer=>timer.end>now).map(timer=>[timer.id,timer]));
 for(const notice of notices){
  if(!['StructureAnchoring','StructureOnline','StructureDestroyed','StructureUnanchoring'].includes(notice?.type)||
     typeof notice.text!=='string'||notice.text.length>20000)continue;
  const id=Number(numberField(notice.text,'structureID'));
  const started=Date.parse(notice.timestamp);
  if(!Number.isSafeInteger(id)||id<=0||!Number.isFinite(started)||started>now)continue;
  const prior=timers.get(id);
  if(prior&&prior.started>=started)continue;
  if(notice.type!=='StructureAnchoring'){
   timers.set(id,{id,started,end:0});
   continue;
  }
  const owner=notice.text.match(/^ownerCorpLinkData:\s*\r?\n- showinfo\r?\n- 2\r?\n- (\d+)\s*$/m)?.[1];
  if(Number(owner)!==corporation||numberField(notice.text,'structureTypeID')!==81826n)continue;
  const duration=Number(numberField(notice.text,'timeLeft')/10000n);
  if(duration<=0||!Number.isSafeInteger(duration))continue;
  timers.set(id,{id,started,end:started+duration,systemId:Number(numberField(notice.text,'solarsystemID')),system:prior?.system,name:prior?.name});
 }
 return [...timers.values()].filter(timer=>timer.end>now);
}

export function destroyedStructureIds(notices,previous,now){
 const destroyed=new Map(previous.filter(([,at])=>at>=now-8*86400000));
 for(const notice of notices){
  if(notice?.type!=='StructureDestroyed'||typeof notice.text!=='string'||notice.text.length>20000)continue;
  const id=Number(numberField(notice.text,'structureID'));
  const at=Date.parse(notice.timestamp);
  if(Number.isSafeInteger(id)&&id>0&&at>=now-8*86400000&&at<=now&&at>(destroyed.get(id)||0))destroyed.set(id,at);
 }
 return destroyed;
}

export function moonDrillReinforcementTimers(notices,previous,now){
 const timers=new Map(previous.filter(timer=>timer.end+REINFORCEMENT_GRACE>now).map(timer=>[timer.id,timer]));
 for(const notice of notices){
  if(notice?.type!=='StructureLostArmor'||typeof notice.text!=='string'||notice.text.length>20000||numberField(notice.text,'structureTypeID')!==81826n)continue;
  const id=Number(numberField(notice.text,'structureID'));
  const end=Number(numberField(notice.text,'timestamp')/10000n-11644473600000n);
  const duration=Number(numberField(notice.text,'timeLeft')/10000n),started=end-duration;
  if(!Number.isSafeInteger(id)||id<=0||started<=0||started>now||duration<=0||duration>7*86400000||end+REINFORCEMENT_GRACE<=now)continue;
  if((timers.get(id)?.started||0)<started)timers.set(id,{id,started,end});
 }
 return [...timers.values()];
}
