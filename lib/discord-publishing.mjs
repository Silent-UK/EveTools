import {DESTRUCTION_MAX_AGE} from './structure-destruction.mjs';
import {MOON_NOTICE_MAX_AGE} from './moon-fracture.mjs';
import {hash} from './security.mjs';
import {isSiteAdmin} from './admin.mjs';
import {structureReinforcementEnd} from './structure-reinforcement.mjs';
import {STRUCTURE_ATTACK_MAX_AGE} from './customs-office-timers.mjs';
import {plainEveText} from '../public/detail-models.mjs';

const HOUR=3600000, DAY=24*HOUR;
const clean=(value,limit=95)=>String(value??'').replace(/[\r\n]+/g,' ').trim().slice(0,limit).replace(/[\\*`_~|<>[\]]/g,'\\$&');
const stamp=(at,style)=>'<t:'+Math.floor(at/1000)+':'+style+'>';
const colors={danger:0xed4245,warning:0xf0a637,blue:0x579af6,green:0x57b878};
const image=id=>Number.isSafeInteger(id)&&id>0?{thumbnail:{url:'https://images.evetech.net/types/'+id+'/icon?size=64'}}:{};
const link=(base,title,description,color,extra={})=>({embeds:[{title,description,color,url:base,...extra}],allowed_mentions:{parse:[]}});
const location=row=>[row.system,row.region].filter(Boolean).map(value=>clean(value)).join(' · ');
const stock=amount=>Number.isFinite(amount)?Math.round(amount).toLocaleString('en-GB'):'Unknown';

const groupNotifications={
 approved:{route:'groupJoin',label:'Group join',action:'joined'},
 pending:{route:'groupRequest',label:'Group request',action:'requested to join'},
 left:{route:'groupLeave',label:'Group leave',action:'left'}
};
const groupRoutes=Object.values(groupNotifications);
export const discordDestinations={
 denReinforced:'Den reinforced', denAttacked:'Den under attack', structureDestroyed:'Structure Destroyed',
 structureAttacked:'Structure Attacked', structureReinforced:'Structure Reinforced', structureAnchoring:'Structure Anchoring',
 moonReady:'Moon Ready to Fracture', moonFractured:'Moon Fractured',
 corpDeparture:'Pilot left corporation', corpJoin:'Pilot joined corporation',
 ...Object.fromEntries(groupRoutes.map(({route,label})=>[route,label])),
 lowFuel:'Low fuel or gas', dailyFuel:'Daily fuel report', timerboard:'Timerboard',
};


export function timerboardMessage(rows,base,now=Date.now()){
 const field=(value,limit)=>String(value??'').replace(/[\x00-\x1f\x7f-\x9f`]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
 const tone=(value,color)=>value?'\x1b['+color+'m'+value+'\x1b[0m':'';
 const rest=(at)=>{
  const minutes=Math.max(0,Math.ceil((at-Math.floor(now/60000)*60000)/60000));
  const hours=Math.floor(minutes/60);
  return '('+hours+':'+String(minutes%60).padStart(2,'0')+')';
 };
 const header='**🗺️ Timerboard** · EVE time (UTC)\n';
 const footer=count=>'\n'+count+' of '+rows.length+' upcoming · [Open Timerboard](<'+base+'/#timerboard>)';
 const lines=[];
 const codeBlock=lines=>'```ansi\n'+lines.join('\n')+'\n```';
 for(const row of rows.slice(0,12)){
  const system=field(row.system,24),region=field(row.region,23);
  const prefix=system+' - ';
  const name=field(row.name,150);
  const structure=field(system&&name.startsWith(prefix)?name.slice(prefix.length):name,54);
  const exit=new Date(row.at).toISOString().slice(0,16).replace('T',' ');
  const stance=({Friendly:34,Hostile:31,Neutral:37})[row.stance]||37;
  const owner=field(row.ticker,18)||field(row.stance,10);
  const details=[field(row.type,27),tone(owner,stance),tone(field(row.stage,12),33)].filter(Boolean);
  const line=[exit,tone(region?'['+region+']':'',34),region&&system?'- '+system:system,tone(structure?'- '+structure:'',32),
   details.map(value=>'['+value+']').join(''),rest(row.at)].filter(Boolean).join(' ');
  if((header+codeBlock([...lines,line])+footer(lines.length+1)).length>1950)break;
  lines.push(line);
 }
 return {content:header+(lines.length?codeBlock(lines)+footer(lines.length):'No upcoming timers.'),embeds:[],allowed_mentions:{parse:[]}};
}

export function denMessage(row,base){
 const where=clean(row.den.planet?.name||row.den.system||'Location unavailable');
 const attacker=[row.aggressor?.character,plainEveText(row.aggressor?.corporation),plainEveText(row.aggressor?.alliance)].filter(Boolean).map(value=>clean(value,60)).join(' · ');
 const heading=row.reinforced?'🛡️ Mercenary Den reinforced':'⚔️ Mercenary Den under attack';
 const timing=row.reinforced?'**Exits** '+stamp(row.at,'f')+' · '+stamp(row.at,'R'):'**Reported** '+stamp(row.at,'R');
 const message=link(base+'/#dens',heading,
  '**'+where+'**'+(row.den.region?' · '+clean(row.den.region):'')+'\n'+
  clean(row.pilot)+' · '+timing+(attacker?'\n**Attacker** '+attacker:''),colors.danger,image(row.den.type_id));
 if(typeof row.discordId==='string'&&/^[1-9]\d{5,19}$/.test(row.discordId)){
  message.content='<@'+row.discordId+'>';
  message.allowed_mentions={parse:[],users:[row.discordId]};
 }
 return message;
}

export function lowFuelMessage(event,row,base){
 const gas=event.kind==='gas';
 return link(base+'/#corp-structures',gas?'⚠️ Low magmatic gas':'⚠️ Low fuel blocks',
  '**'+clean(event.title)+'**'+(location(event)?' · '+location(event):'')+'\n'+
  '**'+stock(row?.[event.kind])+'** '+(gas?'gas':'blocks')+' · Est. depleted '+stamp(event.starts,'R'),
  colors.warning,image(event.typeId));
}

function structureMessage(event,base,reinforced){
 const where=location(event);
 return link(base+'/#corp-structures',reinforced?'🛡️ Structure reinforced':'⚔️ Structure attacked',
  '**'+clean(event.title)+'**'+(where?' · '+where:'')+'\n'+
  (reinforced?'**Exits** '+stamp(event.starts,'f')+' · '+stamp(event.starts,'R'):'**Reported** '+stamp(event.starts,'R')),
  reinforced?colors.blue:colors.danger,image(event.typeId));
}

export function fuelDigest(fuel,reinforcements,snapshot,base,now){
 const byId=new Map(fuel.map(event=>[event.id,event]));
 const active=reinforcements.filter(event=>event.kind==='reinforcement'&&!event.manual&&event.starts>now);
 const ends=new Map(active.map(event=>[event.id,event.starts]));
 const destroyed=new Set((snapshot.customsOffices?.destroyed||[]).map(([id])=>id));
 const rows=(snapshot.structures||[]).filter(row=>!destroyed.has(row.id)).map(row=>{
  const block=byId.get('fuel-'+row.id),gas=byId.get('gas-'+row.id);
  const earliest=Math.min(block?.starts??Infinity,gas?.starts??Infinity);
  const savedEnd=structureReinforcementEnd(row);
  const end=ends.get('reinforcement-'+row.id)??(savedEnd>now?savedEnd:undefined);
  const reinforced=Boolean(end)||(/reinforc/i.test(row.state||'')&&!Number.isFinite(Date.parse(row.timer)));
  const priority=reinforced?0:earliest<=now+DAY?1:earliest<=now+7*DAY?2:!Number.isFinite(earliest)?3:4;
  const estimate=(label,event,rate)=>event?label+' '+(event.starts<=now?'depleted ':'')+stamp(event.starts,'R'):label+(rate===0?' idle':' unknown');
  const detail=[row.kind==='POS'?'POS':'',reinforced?'**Reinforced**'+(end?' · Exits '+stamp(end,'R'):''):'',
   estimate('Fuel',block,row.rate),row.kind==='Moon Drill'?estimate('Gas',gas,row.gas_rate):''].filter(Boolean);
  return {name:row.name,priority,at:end??earliest,detail};
 });
 rows.sort((a,b)=>a.priority-b.priority||a.at-b.at||String(a.name).localeCompare(String(b.name)));
 const count=priority=>rows.filter(row=>row.priority===priority).length;
 const descriptions=['**'+rows.length+' structures** · '+count(0)+' reinforced · '+count(1)+' urgent · '+count(2)+' due within 7 days'];
 for(const row of rows){
  const line=['🔵','🔴','🟠','⚪','🟢'][row.priority]+' **'+clean(row.name,100)+'** · '+row.detail.join(' · ');
  if(descriptions.at(-1).length+1+line.length>3900)descriptions.push(line);
  else descriptions[descriptions.length-1]+='\n'+line;
 }
 const color=count(0)?colors.blue:count(1)?colors.danger:count(2)?colors.warning:colors.green;
 return descriptions.map((description,index)=>link(base+'/#corp-structures',
  '⛽ Daily fuel & gas'+(descriptions.length>1?' · '+(index+1)+'/'+descriptions.length:''),
  description,color,{timestamp:new Date(now).toISOString()}));
}

const bad=message=>Object.assign(Error(message),{status:400});
const validTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const defaults=()=>({destinations:Object.fromEntries(Object.keys(discordDestinations).map(key=>[key,{enabled:false,channel:''}])),dailyTime:'09:00',threshold:24,denOwner:null,includeDens:false});

export function discordPublishing(app,{db,discord,config,calendar,corp,timerboard,timerboardEnabled,sharedDenTimers=()=>[],destructionNotices=()=>[]}){
 db.exec(`CREATE TABLE IF NOT EXISTS discord_publishing_config(guild TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS discord_publishing_state(guild TEXT NOT NULL, destination TEXT NOT NULL, key TEXT NOT NULL,
  value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(guild,destination,key));
 CREATE TABLE IF NOT EXISTS discord_group_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT NOT NULL,
  route TEXT NOT NULL,channel TEXT NOT NULL,group_id INTEGER NOT NULL,pilot TEXT NOT NULL,group_name TEXT NOT NULL,created INTEGER NOT NULL);`);
 const enqueueGroup=db.prepare('INSERT INTO discord_group_outbox(guild,route,channel,group_id,pilot,group_name,created) VALUES(?,?,?,?,?,?,?)');
 const pendingGroup=db.prepare('SELECT * FROM discord_group_outbox WHERE guild=? AND route=? AND channel=? AND created>=? ORDER BY id LIMIT 10');
 const deleteGroup=db.prepare('DELETE FROM discord_group_outbox WHERE id=?');
 const cleanOutbox=db.prepare('DELETE FROM discord_group_outbox WHERE created<?');
 const getConfig=db.prepare('SELECT data FROM discord_publishing_config WHERE guild=?');
 const saveConfig=db.prepare('INSERT INTO discord_publishing_config VALUES (?,?) ON CONFLICT(guild) DO UPDATE SET data=excluded.data');
 const get=db.prepare('SELECT value FROM discord_publishing_state WHERE guild=? AND destination=? AND key=?');
 const set=db.prepare('INSERT INTO discord_publishing_state VALUES (?,?,?,?,?) ON CONFLICT(guild,destination,key) DO UPDATE SET value=excluded.value,updated=excluded.updated');
 const deleteState=db.prepare('DELETE FROM discord_publishing_state WHERE guild=? AND destination=? AND key=?');
 const denSnapshots=db.prepare(`SELECT c.id,c.name,s.data,max(s.updated,COALESCE(n.checked,0)) AS updated,a.discord_id
  FROM snapshots s JOIN characters c ON c.id=s.character_id JOIN users u ON u.id=c.user_id
  LEFT JOIN discord_accounts a ON a.user_id=u.id
  LEFT JOIN den_notification_checks n ON n.character_id=c.id
  WHERE s.kind='dens' AND (a.discord_id IS NOT NULL OR (u.id=? AND (u.admin=1 OR u.main_id=?)))
  ORDER BY s.updated DESC,c.id`);
 const admin=(req,res,next)=>!req.inspect&&isSiteAdmin(req.session,config.owner)?next():res.sendStatus(403);
 const read=guild=>{
  const initial=defaults(),saved=JSON.parse(getConfig.get(guild)?.data||'null');
  return {...initial,...saved,destinations:{...initial.destinations,...saved?.destinations}};
 };
 function queueGroupEvent(group,user,status){
  if(!group.discord_notify)return;
  const connection=discord.read();
  if(!connection.enabled||!connection.connected)return;
  const {route}=groupNotifications[status];
  const destination=read(connection.guild_id).destinations[route];
  if(!destination.enabled)return;
  const pilot=db.prepare('SELECT name FROM users WHERE id=?').get(user);
  if(pilot)enqueueGroup.run(connection.guild_id,route,destination.channel,group.id,pilot.name,group.name,Date.now());
 }
 const errors=Object.create(null);
 app.get('/api/admin/discord/publishing',admin,(_req,res)=>{
  const c=discord.read(),saved=read(c.guild_id);
  res.json({destinations:saved.destinations,threshold:saved.threshold,dailyTime:saved.dailyTime,includeDens:saved.includeDens===true,connected:Boolean(c.connected),labels:discordDestinations,errors});
 });
 app.post('/api/admin/discord/publishing',admin,(req,res)=>{
  const c=discord.read(),input=req.body||{},saved=read(c.guild_id);
  if(!discord.snowflake(c.guild_id))throw bad('Save the Discord server ID in Setup first.');
  const keys=input.tab==='timerboard'?['timerboard']:input.tab==='notifications'?Object.keys(discordDestinations).filter(key=>key!=='timerboard'):null;
  if(!keys)throw bad('Choose a publishing tab.');
  const previousRoutes={...saved.destinations};
  for(const key of keys){
   const route=input.destinations?.[key];
   if(route===undefined&&(['structureAttacked','structureReinforced','structureAnchoring','structureDestroyed','moonReady','moonFractured','corpDeparture','corpJoin'].includes(key)||groupRoutes.some(item=>item.route===key)))continue;
   if(typeof route?.enabled!=='boolean'||typeof route.channel!=='string'||(route.enabled||route.channel)&&!discord.snowflake(route.channel))throw bad('Enter a valid channel ID for '+discordDestinations[key]+'.');
   saved.destinations[key]={enabled:route.enabled,channel:route.channel};
  }
  if(input.tab==='notifications'){
   if(!validTime(input.dailyTime)||!Number.isInteger(input.threshold)||input.threshold<1||input.threshold>168)throw bad('Set a daily UTC time and a warning threshold from 1 to 168 hours.');
   Object.assign(saved,{dailyTime:input.dailyTime,threshold:input.threshold,denOwner:req.session.user_id});
  }
  if(input.tab==='timerboard'){
   if(input.includeDens!==undefined&&typeof input.includeDens!=='boolean')throw bad('Choose whether the Timerboard includes Den timers.');
   saved.includeDens=input.includeDens??(saved.includeDens===true);
  }
  saveConfig.run(c.guild_id,JSON.stringify(saved));
  for(const {route} of groupRoutes){
   const before=previousRoutes[route],after=saved.destinations[route];
   if(before.enabled!==after.enabled||before.channel!==after.channel)
    db.prepare('DELETE FROM discord_group_outbox WHERE guild=? AND route=?').run(c.guild_id,route);
  }
  for(const route of ['corpDeparture','corpJoin']){
   const before=previousRoutes[route],after=saved.destinations[route];
   if(after.enabled&&(!before.enabled||before.channel!==after.channel)){
    deleteState.run(c.guild_id,route+':'+after.channel,'roster');
    nextRosterChecks.delete(route);
   }
  }
  for(const key of keys)delete errors[key];
  res.json({ok:true});
 });
 let busy=false, nextCleanup=0, nextRosterChecks=new Map(), nextOutboxCleanup=0;
 async function tick(now=Date.now()){
  if(busy)return;
  if(now>=nextOutboxCleanup){cleanOutbox.run(now-DAY);nextOutboxCleanup=now+HOUR;}
  const c=discord.read();
  if(!c.enabled||!c.connected)return;
  const {destinations,dailyTime,threshold,denOwner,includeDens}=read(c.guild_id);
  if(!Object.values(destinations).some(route=>route.enabled))return;
  busy=true;
  try{
   const checkedChannels=new Map();
   const destination=key=>key+':'+destinations[key].channel;
   const active=key=>destinations[key].enabled;
   const mark=(route,key,value)=>set.run(c.guild_id,destination(route),key,value,now);
   const state=(route,key)=>get.get(c.guild_id,destination(route),key)?.value;
   const channelPath=key=>'/channels/'+destinations[key].channel;
   async function send(route,key,payload,messageId){
    const current=()=>{
     const connection=discord.read(),settings=read(c.guild_id),saved=settings.destinations[route];
     if(connection.guild_id!==c.guild_id||!connection.enabled||!connection.connected||!saved.enabled||saved.channel!==destinations[route].channel||
      (route==='denReinforced'||route==='denAttacked')&&settings.denOwner!==denOwner||
      route==='timerboard'&&(settings.includeDens!==includeDens||includeDens&&settings.denOwner!==denOwner))
      throw Error('Discord settings changed. Retrying on the next check.');
    };
    current();
    const path=channelPath(route);
    if(!checkedChannels.has(path))checkedChannels.set(path,discord.request(path));
    const channel=await checkedChannels.get(path);
    if(String(channel.guild_id)!==c.guild_id||![0,5].includes(channel.type))throw Error('Choose a text or announcement channel in the configured Discord server.');
    current();
    const messages=path+'/messages';
    if(messageId){
     try{return await discord.request(messages+'/'+messageId,{method:'PATCH',body:payload});}
     catch(error){if(error.discordStatus!==404)throw error;current();}
    }
    return discord.request(messages,{method:'POST',body:{...payload,nonce:hash(c.guild_id+'/'+destination(route)+'/'+key).slice(0,25),enforce_nonce:true}});
   }
   async function publish(route,key,payload){
    if(state(route,key))return;
    await send(route,key,payload);
    mark(route,key,'sent');
   }
   const run=async(key,fn)=>{
    if(!active(key))return;
    try{await fn();delete errors[key];}catch(error){errors[key]=error.discordStatus===403?'Allow View Channel, Send Messages and Embed Links for the bot.':error.message;}
   };
   const base=config.base.replace(/\/$/,'');
   for(const {route,label,action} of groupRoutes)await run(route,async()=>{
    for(const event of pendingGroup.all(c.guild_id,route,destinations[route].channel,now-DAY)){
     const group=db.prepare('SELECT discord_notify FROM access_groups WHERE id=?').get(event.group_id);
     if(group?.discord_notify)await publish(route,String(event.id),link(base+'/#admin-group-management',label,
      '**'+clean(event.pilot)+'** '+action+' **'+clean(event.group_name)+'**',
      route==='groupJoin'?colors.green:route==='groupRequest'?colors.blue:colors.warning));
     deleteGroup.run(event.id);
    }
   });
   let rosterFetch;
   for(const route of ['corpDeparture','corpJoin'])await run(route,async()=>{
    if(now<(nextRosterChecks.get(route)||0))return;
    nextRosterChecks.set(route,now+5*60000);
    const saved=JSON.parse(state(route,'roster')||'null');
    const {ids,observed}=await (rosterFetch??=corp.memberRoster());
    if(!saved){
     mark(route,'roster',JSON.stringify({ids,observed,pending:[]}));
     return;
    }
    let roster=saved;
    if(observed>saved.observed){
     const current=new Set(ids);
     const pending=saved.pending.filter(row=>row.detected>now-7*DAY);
     const previous=new Set(saved.ids);
     const candidates=route==='corpJoin'?ids:saved.ids,missingFrom=route==='corpJoin'?previous:current;
     for(const id of candidates)if(!missingFrom.has(id))pending.push({id,detected:now,observed});
     roster={ids,observed,pending};
     mark(route,'roster',JSON.stringify(roster));
    }
    const batch=roster.pending.slice(0,5);
    if(!batch.length)return;
    const names=await corp.memberNames(batch.map(row=>row.id));
    for(const row of batch){
     const key=row.id+':'+row.observed;
     await publish(route,key,link(base+'/#corp-members',discordDestinations[route],
      '**'+clean(names[row.id]||'Pilot '+row.id)+'** · Detected '+stamp(row.detected,'R'),
      route==='corpJoin'?colors.green:colors.warning,{thumbnail:{url:'https://images.evetech.net/characters/'+row.id+'/portrait?size=64'}}));
     roster.pending.shift();
     mark(route,'roster',JSON.stringify(roster));
    }
   });
   await run('structureDestroyed',async()=>{
    let sent=0;
    for(const event of destructionNotices()){
     if(!Number.isFinite(event.at)||event.at<now-DESTRUCTION_MAX_AGE||event.at>now||state('structureDestroyed',event.key))continue;
     const where=location(event);
     await publish('structureDestroyed',event.key,link(base+'/#timerboard','💥 Structure destroyed',
      '**'+clean(event.name)+'**'+(where?' · '+where:'')+'\n'+
      (event.pilot?clean(event.pilot)+' · ':'')+'**Destroyed** '+stamp(event.at,'f')+' · '+stamp(event.at,'R'),
      colors.danger,image(event.typeId)));
     if(++sent>=5)return;
    }
   });
   const needsCorp=active('lowFuel')||active('dailyFuel')||active('structureAttacked')||active('structureReinforced')||active('structureAnchoring')||active('moonReady')||active('moonFractured')||active('timerboard')&&timerboardEnabled();
   const snapshot=needsCorp?corp.snapshot():null;
   const events=needsCorp?calendar.list(['corp-structures'],false,now,{},snapshot).events:[];
   const fuel=events.filter(event=>['fuel','gas'].includes(event.kind)&&event.updated>=now-6*HOUR);
   const fuelRows=new Map((snapshot?.structures||[]).map(row=>[String(row.id),row]));
   const destroyed=new Set((snapshot?.customsOffices?.destroyed||[]).map(([id])=>id));
   await run('structureAttacked',async()=>{
    let sent=0;
    for(const attack of snapshot?.customsOffices?.attacks||[]){
     const row=fuelRows.get(String(attack.id)),key=attack.id+':'+Math.floor(attack.at/1000);
     if(!row||destroyed.has(attack.id)||attack.at<now-STRUCTURE_ATTACK_MAX_AGE||attack.at>now||state('structureAttacked',key))continue;
     await publish('structureAttacked',key,structureMessage({...row,title:row.name,starts:attack.at,typeId:row.type_id},base,false));
     if(++sent>=5)return;
    }
   });
   await run('structureReinforced',async()=>{
    let sent=0;
    for(const event of events){
     if(event.manual||event.kind!=='reinforcement'||event.starts<=now)continue;
     const key=event.id+':'+Math.floor(event.starts/1000);
     if(state('structureReinforced',key))continue;
     await publish('structureReinforced',key,structureMessage(event,base,true));
     if(++sent>=5)return;
    }
   });
   await run('structureAnchoring',async()=>{
    // Calendar notifications cover drills; structure snapshots also cover citadels.
    const anchoring=new Map(events.filter(event=>!event.manual&&event.kind==='anchoring').map(event=>[event.id,event]));
    for(const row of snapshot?.structures||[]){
     const end=Date.parse(row.timer);
     if(row.state!=='anchoring'||!Number.isFinite(end))continue;
     const id='anchoring-'+row.id;
     if(!anchoring.has(id))anchoring.set(id,{id,title:row.name,starts:end,system:row.system,region:row.region,typeId:row.type_id});
    }
    let sent=0;
    for(const event of anchoring.values()){
     if(!Number.isFinite(event.starts)||event.starts<=now||destroyed.has(Number(event.id.replace(/^anchoring-/,''))))continue;
     const key=event.id+':'+Math.floor(event.starts/1000);
     if(state('structureAnchoring',key))continue;
     const where=location(event);
     await publish('structureAnchoring',key,link(base+'/#corp-structures','🏗️ Structure anchoring',
      '**'+clean(event.title)+'**'+(where?' · '+where:'')+'\n'+
      '**Completes** '+stamp(event.starts,'f')+' · '+stamp(event.starts,'R')+(event.estimated?' · Estimated':''),
      colors.blue,image(event.typeId)));
     if(++sent>=5)return;
    }
   });
   const moonNotices=(snapshot?.customsOffices?.moonNotifications||[]).filter(row=>
    Number.isFinite(row.at)&&row.at>=now-MOON_NOTICE_MAX_AGE&&row.at<=now);
   for(const [route,phase] of [['moonReady','ready'],['moonFractured','fractured']])await run(route,async()=>{
    let sent=0;
    for(const notice of moonNotices){
     const row=fuelRows.get(String(notice.id));
     if(notice.phase!==phase||!row||destroyed.has(notice.id))continue;
     // A later laser/auto fracture proves the older chunk is no longer ready.
     if(phase==='ready'&&moonNotices.some(other=>other.id===notice.id&&other.phase==='fractured'&&other.at>=notice.at))continue;
     const key=notice.id+':'+phase+':'+Math.floor(notice.at/1000);
     if(state(route,key))continue;
     const where=location(row);
     await publish(route,key,link(base+'/#corp-moons',phase==='ready'?'🌕 Moon ready to fracture':'💥 Moon fractured',
      '**'+clean(row.name)+'**'+(where?' · '+where:'')+'\n'+
      (phase==='ready'?'**Ready** ':'**Fractured** ')+stamp(notice.at,'f')+' · '+stamp(notice.at,'R')+
      (phase==='fractured'?(notice.automatic?' · Automatic fracture':' · Mining laser fired'):''),
      phase==='ready'?colors.warning:colors.green,image(row.type_id)));
     if(++sent>=5)return;
    }
   });
   const needsDens=active('denReinforced')||active('denAttacked')||active('timerboard')&&includeDens===true&&timerboardEnabled();
   const dens=needsDens?denSnapshots.all(denOwner,config.owner).filter(pilot=>pilot.updated>=now-2*HOUR):[];
   for(const [route,reinforced] of [['denReinforced',true],['denAttacked',false]])await run(route,async()=>{
    let sent=0;
    for(const pilot of dens){
     for(const den of JSON.parse(pilot.data)){
      const at=reinforced?Date.parse(den.reinforcement_timer?.end):den.attack?.at;
      if(!Number.isFinite(at)||(reinforced?at<=now:at<now-HOUR||at>now))continue;
      const key=den.id+':'+Math.floor(at/1000);
      if(state(route,key))continue;
      await publish(route,key,denMessage({den,pilot:pilot.name,discordId:pilot.discord_id,at,reinforced,aggressor:reinforced?den.reinforcement:den.attack},base));
      if(++sent>=5)return;
     }
    }
   });
   await run('lowFuel',async()=>{
    let sent=0;
    for(const event of fuel){
     if(event.starts>now+threshold*HOUR){deleteState.run(c.guild_id,destination('lowFuel'),event.id);continue;}
     if(state('lowFuel',event.id)||sent>=5)continue;
     const row=fuelRows.get(event.id.slice(event.kind.length+1));
     await publish('lowFuel',event.id,lowFuelMessage(event,row,base));
     sent++;
    }
   });
   const utc=new Date(now).toISOString();
   await run('dailyFuel',async()=>{
    if(utc.slice(11,16)<dailyTime||!snapshot?.updated||snapshot.updated<now-6*HOUR)return;
    const day=utc.slice(0,10);
    if(state('dailyFuel',day))return;
    const planKey=day+':plan';
    const saved=state('dailyFuel',planKey);
    const pages=saved?JSON.parse(saved):fuelDigest(fuel,events,snapshot,base,now);
    if(!saved)mark('dailyFuel',planKey,JSON.stringify(pages));
    for(const [index,page] of pages.entries())await publish('dailyFuel',day+':'+index,page);
    mark('dailyFuel',day,'sent');
    deleteState.run(c.guild_id,destination('dailyFuel'),planKey);
   });
   await run('timerboard',async()=>{
    if(!timerboardEnabled())return;
    const rows=timerboard.listTimers({allowed:['corp-structures']},now,events,includeDens===true?[...dens,...sharedDenTimers()]:[]).filter(row=>row.at>now);
    const payload=timerboardMessage(rows,base,now), digest=hash(JSON.stringify(payload));
    const saved=JSON.parse(state('timerboard','board')||'null');
    if(saved?.digest===digest&&saved.checked>now-HOUR)return;
    const message=await send('timerboard','board',payload,saved?.id);
    if(!discord.snowflake(message?.id))throw Error('Discord did not return the Timerboard message ID.');
    mark('timerboard','board',JSON.stringify({id:message.id,digest,checked:now}));
   });
   if(now>nextCleanup){
    db.prepare("DELETE FROM discord_publishing_state WHERE updated<? AND destination NOT LIKE 'timerboard:%' AND destination NOT LIKE 'lowFuel:%' AND NOT ((destination LIKE 'corpDeparture:%' OR destination LIKE 'corpJoin:%') AND key='roster')").run(now-7*DAY);
    nextCleanup=now+DAY;
   }
  }finally{busy=false;}
 }
 return {tick,queueGroupEvent};
}
