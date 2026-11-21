function field(text,key){
 const value=text.match(new RegExp('^'+key+':[ \\t]*([^\\r\\n]*)','m'))?.[1].trim();
 if(!value||/^(?:null|~|None)$/i.test(value))return null;
 if(value.startsWith("'"))return value.endsWith("'")?value.slice(1,-1).replaceAll("''","'").slice(0,160):null;
 if(value.startsWith('"')){try{return JSON.parse(value).slice(0,160);}catch{return null;}}
 return value.slice(0,160);
}
function filetime(value){
 if(!/^\d{17,19}$/.test(value||''))return NaN;
 return Number(BigInt(value)/10000n-11644473600000n);
}
export async function addDenReinforcement(rows,previous,c,eve,now=Date.now()){
 if(!rows.length)return;
 const saved=new Map((previous||[]).map(d=>[d.id,d]));
 for(const d of rows){
  const prior=saved.get(d.id),r=prior?.reinforcement, endpointEnd=Date.parse(d.reinforcement_timer?.end);
  if(prior?.attack?.at>=now-3600000)d.attack=prior.attack;
  if(!r || Date.parse(r.end)<=now)continue;
  if(r.end===d.reinforcement_timer?.end)d.reinforcement=r;
  else if(!(endpointEnd>now)&&r.source==='notification'){
   d.reinforcement_timer={end:r.end};
   d.reinforcement=r;
  }
 }
 if(!JSON.parse(c.scopes||'[]').includes('esi-characters.read_notifications.v1'))return;
 let notices;
 try{notices=await eve.get('/characters/'+c.id+'/notifications',c);}catch{return;}
 if(Array.isArray(notices))await applyDenNotifications(rows,notices,eve,now);
}
export async function applyDenNotifications(rows,notices,eve,now=Date.now()){
 const byId=new Map(rows.map(d=>[d.id,d])), newest=new Map();
 for(const notice of notices){
  if(!['MercenaryDenReinforced','MercenaryDenAttacked'].includes(notice?.type)||typeof notice.text!=='string'||notice.text.length>20000)continue;
  // ESI may prefix itemID with a YAML anchor used elsewhere in the notice.
  const itemId=field(notice.text,'itemID')?.replace(/^&[A-Za-z0-9_-]+[ \t]+(?=\d+$)/,'');
  const den=byId.get(Number(itemId));
  if(notice.type==='MercenaryDenAttacked'){
   const at=Date.parse(notice.timestamp);
   if(den&&at>=now-3600000&&at<=now&&at>(den.attack?.at??0))den.attack={at,corporation:field(notice.text,'aggressorCorporationName'),alliance:field(notice.text,'aggressorAllianceName')};
   continue;
  }
  const end=filetime(field(notice.text,'timestampExited')),entered=filetime(field(notice.text,'timestampEntered'));
  if(!den||!Number.isFinite(end)||end<=now||!Number.isFinite(entered)||entered>now||entered>=end)continue;
  const endpointEnd=Date.parse(den.reinforcement_timer?.end);
  const fromNotice=!(endpointEnd>now)||den.reinforcement?.source==='notification';
  if(!fromNotice&&Math.abs(end-endpointEnd)>1000)continue;
  if(fromNotice&&Number.isFinite(den.reinforcement?.entered)&&entered<den.reinforcement.entered)continue;
  if((newest.get(den.id)?.entered??-Infinity)>=entered)continue;
  newest.set(den.id,{notice,end,entered,fromNotice});
 }
 for(const [id,{notice,end,entered,fromNotice}] of newest){
  const den=byId.get(id),characterId=Number(field(notice.text,'aggressorCharacterID'));
  if(fromNotice)den.reinforcement_timer={end:new Date(end).toISOString()};
  const record={end:den.reinforcement_timer.end,entered,...(fromNotice?{source:'notification'}:{}),
   corporation:field(notice.text,'aggressorCorporationName'),alliance:field(notice.text,'aggressorAllianceName')};
  if(Number.isSafeInteger(characterId)&&characterId>0){
   record.character_id=characterId;
   if(den.reinforcement?.character_id===characterId)record.character=den.reinforcement.character;
   if(!record.character){try{record.character=(await eve.publicGet('/characters/'+characterId))?.name||null;}catch{}}
  }
  den.reinforcement=record;
 }
}
