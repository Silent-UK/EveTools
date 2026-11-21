import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {discordPublishing,fuelDigest,timerboardMessage} from '../lib/discord-publishing.mjs';
import {timerboardRoutes} from '../lib/timerboard.mjs';
import {addDenReinforcement} from '../lib/den-reinforcement.mjs';
import {structureAttackNotices} from '../lib/customs-office-timers.mjs';

test('Discord posts opt-in alerts and one daily digest, then edits the existing timerboard',async()=>{
 const now=Date.parse('2026-11-16T09:00:00Z'),hour=3600000;
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE users(id INTEGER,admin INTEGER,main_id INTEGER);
   CREATE TABLE characters(id INTEGER,user_id INTEGER,name TEXT);
   CREATE TABLE snapshots(character_id INTEGER,kind TEXT,data TEXT,updated INTEGER);
   CREATE TABLE den_notification_checks(character_id INTEGER,checked INTEGER); CREATE TABLE discord_accounts(user_id INTEGER,discord_id TEXT);
   INSERT INTO users VALUES(1,1,100),(2,0,200),(3,0,300);
   INSERT INTO characters VALUES(1,1,'Belderan'),(2,2,'Kalissa Alt'),(3,3,'Other pilot');
   INSERT INTO discord_accounts VALUES(2,'654321')`);
  const den={id:123,system:'0-ARFO',region:'Fade',reinforcement_timer:{end:new Date(now+6*hour).toISOString()},attack:{at:now-hour/2}};
  for(const id of [1,2,3])db.prepare("INSERT INTO snapshots VALUES(?,'dens',?,?)").run(id,JSON.stringify([{...den,id}]),now);
  const sends=[],routes={};
  const app={get(){},post(path,_admin,handler){routes[path]=handler;}};
  const connection={guild_id:'123456',enabled:true,connected:now};
  let wrongGuild=false;
  const discord={read:()=>connection,snowflake:value=>/^\d{6,20}$/.test(value||''),request:async(path,options)=>{
   if(!options)return {guild_id:wrongGuild?'112233':connection.guild_id,type:0};
   sends.push({path,...options});return {id:'456789'};
  }};
  const snapshot={updated:now,structures:[{id:5,fuel:1190}]};
  const events=[{id:'fuel-5',kind:'fuel',title:'Metenox',starts:now+4*hour,updated:now}];
  const timers=[{at:now+hour,name:'Stevestar 1',type:'POS',stance:'Friendly'}];
  const service=discordPublishing(app,{db,discord,config:{owner:100,base:'https://tools.example'},
   calendar:{list:()=>({events})},corp:{snapshot:()=>snapshot},
   timerboard:{listTimers:(_access,_now,_events,dens)=>[...timers,...dens.map(row=>({at:now+3*hour,name:row.name,type:'Mercenary Den'}))]},timerboardEnabled:()=>true});
  const save=(tab,keys,includeDens)=>routes['/api/admin/discord/publishing']({session:{user_id:1},body:{tab,dailyTime:'09:00',threshold:24,includeDens,
   destinations:Object.fromEntries(keys.map(key=>[key,{enabled:true,channel:'234567'}]))}},{json(){}});
  await service.tick(now);
  assert.equal(sends.length,0);
  save('notifications',['denReinforced','denAttacked','lowFuel','dailyFuel']);
  save('timerboard',['timerboard']);
  wrongGuild=true;
  await service.tick(now);
  assert.equal(sends.length,0);
  wrongGuild=false;
  await service.tick(now);
  assert.deepEqual(sends.map(x=>x.body.embeds[0]?.title||x.body.content.split('\n')[0]),[
   '🛡️ Mercenary Den reinforced','🛡️ Mercenary Den reinforced','⚔️ Mercenary Den under attack','⚔️ Mercenary Den under attack','⚠️ Low fuel blocks','⛽ Daily fuel & gas','**🗺️ Timerboard** · EVE time (UTC)'
  ]);
  assert.match(sends[0].body.embeds[0].description,/Belderan/);
  assert.equal(sends[0].body.content,undefined);
  const tags=sends.filter(send=>send.body.content?.startsWith('<@'));
  assert.equal(tags.length,2);
  for(const {body} of tags){
   assert.equal(body.content,'<@654321>');
   assert.deepEqual(body.allowed_mentions,{parse:[],users:['654321']});
   assert.match(body.embeds[0].description,/Kalissa Alt/);
  }
  assert.ok(sends.every(send=>!send.body.embeds[0]?.description.includes('Other pilot')));
  assert.ok(sends.every(x=>x.body.allowed_mentions.parse.length===0));
  await service.tick(now+1000);
  assert.equal(sends.length,7);
  await service.tick(now+60000);
  assert.equal(sends.length,8);
  assert.match(sends.at(-1).body.content,/\(0:59\)/);
  timers.push({at:now+2*hour,name:'New timer',stance:'Hostile'});
  await service.tick(now+120000);
  assert.deepEqual([sends.length,sends.at(-1).method,sends.at(-1).path],[9,'PATCH','/channels/234567/messages/456789']);
  assert.doesNotMatch(sends.at(-1).body.content,/Mercenary Den/);
  save('timerboard',['timerboard'],true);
  await service.tick(now+180000);
  assert.match(sends.at(-1).body.content,/Mercenary Den/);
  assert.doesNotMatch(sends.at(-1).body.content,/Other pilot/);
  save('timerboard',['timerboard'],false);
  await service.tick(now+240000);
  assert.doesNotMatch(sends.at(-1).body.content,/Mercenary Den/);
  snapshot.structures[0].name='Corporation Metenox';
  snapshot.customsOffices={attacks:[{id:5,at:now},{id:999,at:now}]};
  events.push({id:'reinforcement-5',kind:'reinforcement',title:'Corporation Metenox',starts:now+hour});
  events.push({id:'manual-1',kind:'reinforcement',title:'Hostile manual timer',starts:now+hour,manual:true});
  save('notifications',['denReinforced','denAttacked','lowFuel','dailyFuel','structureAttacked','structureReinforced']);
  await service.tick(now+300000);
  const combat=sends.filter(send=>/Structure (attacked|reinforced)/.test(send.body.embeds[0]?.title||''));
  assert.deepEqual(combat.map(send=>send.body.embeds[0].title),['⚔️ Structure attacked','🛡️ Structure reinforced']);
  assert.ok(combat.every(send=>send.body.embeds[0].description.includes('Corporation Metenox')));
  await service.tick(now+360000);
  assert.equal(sends.filter(send=>/Structure (attacked|reinforced)/.test(send.body.embeds[0]?.title||'')).length,2);
 }finally{db.close();}
});

test('Corporation attack notices deduplicate and ignore stale and unrelated alerts',()=>{
 const now=Date.parse('2026-11-16T09:00:00Z');
 const notice={type:'StructureUnderAttack',timestamp:new Date(now-1000).toISOString(),text:'structureID: &id001 1056391296278'};
 const tower={type:'TowerAlertMsg',timestamp:notice.timestamp,text:'towerID: 1056391296280'};
 const attacks=structureAttackNotices([notice,notice,tower,{...notice,type:'StructureLostArmor'},{...notice,timestamp:new Date(now-13*3600000).toISOString()}],[],now);
 assert.deepEqual(attacks,[{id:1056391296278,at:now-1000},{id:1056391296280,at:now-1000}]);
 assert.deepEqual(structureAttackNotices([notice],attacks,now),attacks);
});

test('Discord Timerboard lists corporation timers without a user ID and includes shared Dens only on request',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const now=Date.parse('2026-11-16T09:00:00Z'),app={get(){},post(){},delete(){}};
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)');
  const board=timerboardRoutes(app,{db,cat:{},corporationOwner:'STEMP/FRT'});
  const access={allowed:['corp-structures']};
  const events=[{id:'reinforcement-1',title:'Corp POS',system:'O-VWPB',kind:'reinforcement',starts:now+600000}];
  assert.equal(board.listTimers(access,now,events).length,1);
  const dens=[{id:123,data:JSON.stringify([{id:1,planet:{name:'0-ARFO III'},reinforcement_timer:{end:new Date(now+1200000).toISOString()}}])}];
  db.prepare("INSERT INTO timerboard_entries(stage,type,stance,ticker,name,system,at) VALUES('Final','Mercenary Den','Hostile','VIRUS','Mercenary Den','E9KD-N',?)").run(now+1800000);
  assert.deepEqual(board.listTimers(access,now,events,dens).map(row=>[row.name,row.system,row.region]),[
   ['Corp POS','O-VWPB','Geminate'],
   ['0-ARFO III','0-ARFO','Fade'],
   ['Mercenary Den','E9KD-N','Fade'],
  ]);
 }finally{db.close();}
});

test('Daily fuel report keeps every structure across pages and puts reinforced POS first',()=>{
 const now=Date.parse('2026-11-16T09:00:00Z'),hour=3600000;
 const structures=[{id:1,kind:'Structure',name:'Urgent Astrahus'},{id:2,kind:'POS',name:'Reinforced POS'},{id:3,kind:'Structure',name:'No estimate'}];
 for(let id=4;id<104;id++)structures.push({id,kind:'Structure',name:'Long structure name '.repeat(4)+id});
 const fuel=[{id:'fuel-1',starts:now+hour},{id:'fuel-2',starts:now+hour*240}];
 const events=[{id:'reinforcement-2',kind:'reinforcement',starts:now+hour*36},
  {id:'customs-office-1',kind:'reinforcement',title:'POCO excluded',starts:now+hour}];
 const pages=fuelDigest(fuel,events,{structures},'https://tools.example',now).map(page=>page.embeds[0].description);
 assert.ok(pages.length>1);
 assert.ok(pages.every(page=>page.length<=4096));
 assert.match(pages[0],/\n🔵 \*\*Reinforced POS\*\* · POS · \*\*Reinforced\*\*[\s\S]*\n🔴 \*\*Urgent Astrahus\*\*/);
 assert.equal(pages.join('\n').split('\n').length,structures.length+1);
 assert.ok(!pages.join('\n').includes('POCO excluded'));
 assert.match(pages.join('\n'),/No estimate\*\* · Fuel unknown/);
});

test('Den attack uses the newest matching and recent EVE notification',async()=>{
 const now=Date.parse('2026-11-16T09:00:00Z');
 const rows=[{id:12345}];
 const notices=[{type:'MercenaryDenAttacked',timestamp:new Date(now-1000).toISOString(),text:'itemID: 12345\naggressorCorporationName: Example Corp'}];
 await addDenReinforcement(rows,[],{id:10,scopes:'["esi-characters.read_notifications.v1"]'},{get:async()=>notices},now);
 assert.deepEqual(rows[0].attack,{at:now-1000,corporation:'Example Corp',alliance:null});
});

test('Timerboard message stays within Discord limits with long names and shows an overflow count',()=>{
 const rows=Array.from({length:47},()=>({at:Date.now(),name:'_'.repeat(300),system:'_'.repeat(64),region:'_'.repeat(64),type:'_'.repeat(64),stage:'_'.repeat(64),ticker:'_'.repeat(64)}));
 const message=timerboardMessage(rows,'https://tools.example');
 assert.ok(message.content.length<=2000);
 assert.match(message.content,/of 47/);
 const at=Date.parse('2026-11-16T20:12:00Z');
 const sample=timerboardMessage([{at,system:'RD-2GR',name:'RD-2GR - To Boldly Go',region:'Pure Blind',type:'Ansiblex Jump Bridge',ticker:'TIAAS/TEST',stage:'Final',stance:'Hostile'}],'https://tools.example',at-60000);
 const row=sample.content.split('\n')[2].replace(/\x1b\[[0-9]+m/g,'');
 assert.equal(row,'2026-11-16 20:12 [Pure Blind] - RD-2GR - To Boldly Go [Ansiblex Jump Bridge][TIAAS/TEST][Final] (0:01)');
 assert.deepEqual(sample.embeds,[]);
});

test('corporation departure alerts use a silent baseline and retry without duplicate posts',async()=>{
 const db=new DatabaseSync(':memory:'),start=Date.parse('2026-11-16T09:00:00Z'),interval=300000;
 try{
  db.exec('CREATE TABLE users(id,admin,main_id); CREATE TABLE characters(id,user_id,name); CREATE TABLE snapshots(character_id,kind,data,updated); CREATE TABLE den_notification_checks(character_id INTEGER,checked INTEGER); CREATE TABLE discord_accounts(user_id,discord_id)');
  const routes={},posts=[];
  const app={get(){},post(path,_admin,handler){routes[path]=handler;}};
  const connection={guild_id:'123456',enabled:true,connected:start};
  let roster={ids:[11,22],observed:start},esiFailed=false,discordFailed=false;
  const discord={read:()=>connection,snowflake:()=>true,request:async(_path,options)=>{
   if(!options)return {guild_id:connection.guild_id,type:0};
   if(discordFailed)throw Error('Discord unavailable');
   posts.push(options.body);
  }};
  const {tick}=discordPublishing(app,{db,discord,config:{owner:100,base:'https://tools.example'},corp:{
   memberRoster:async()=>{if(esiFailed)throw Error('ESI unavailable');return roster;},memberNames:async()=>({22:'Departed Pilot'})
  }});
  const destinations={denReinforced:{},denAttacked:{},lowFuel:{},dailyFuel:{}};
  for(const key of Object.keys(destinations))destinations[key]={enabled:false,channel:''};
  destinations.corpDeparture={enabled:true,channel:'234567'};
  routes['/api/admin/discord/publishing']({session:{user_id:1},body:{tab:'notifications',dailyTime:'09:00',threshold:24,destinations}},{json(){}});
  await tick(start);
  esiFailed=true;await tick(start+interval);esiFailed=false;
  assert.equal(posts.length,0);
  roster={ids:[11,33],observed:start+2*interval};
  discordFailed=true;await tick(start+2*interval);discordFailed=false;
  await tick(start+3*interval);
  await tick(start+4*interval);
  assert.equal(posts.length,1);
  assert.match(posts[0].embeds[0].description,/Departed Pilot/);
  assert.deepEqual(posts[0].allowed_mentions,{parse:[]});
 }finally{db.close();}
});

test('opted-in group membership events post once to their configured channels',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE users(id,name,admin,main_id); CREATE TABLE characters(id,user_id,name);
   CREATE TABLE snapshots(character_id,kind,data,updated); CREATE TABLE discord_accounts(user_id,discord_id);
   CREATE TABLE den_notification_checks(character_id,checked); CREATE TABLE access_groups(id,discord_notify);
   INSERT INTO users VALUES(1,'Pilot',1,100); INSERT INTO access_groups VALUES(5,1),(6,0)`);
  const routes={},posts=[], config={enabled:true,connected:1,guild_id:'123456'};
  const app={get(){},post(path,_access,handler){routes[path]=handler;}};
  const discord={read:()=>config,snowflake:()=>true,request:async(path,options)=>{
   if(!options)return {guild_id:config.guild_id,type:0};
   posts.push({path,description:options.body.embeds[0].description});
  }};
  const service=discordPublishing(app,{db,discord,config:{owner:100,base:'https://tools.example'}});
  const destinations=Object.fromEntries(['denReinforced','denAttacked','lowFuel','dailyFuel'].map(route=>[route,{enabled:false,channel:''}]));
  for(const [route,channel] of [['groupJoin','234561'],['groupRequest','234562'],['groupLeave','234563']])destinations[route]={enabled:true,channel};
  routes['/api/admin/discord/publishing']({session:{user_id:1},body:{tab:'notifications',dailyTime:'09:00',threshold:24,destinations}},{json(){}});
  const enabled={id:5,name:'Patrol',discord_notify:1};
  service.queueGroupEvent({id:6,name:'Quiet'},1,'pending');
  for(const status of ['pending','approved','left'])service.queueGroupEvent(enabled,1,status);
  await service.tick();await service.tick();
  assert.deepEqual(posts.map(p=>p.path).sort(),['/channels/234561/messages','/channels/234562/messages','/channels/234563/messages']);
  assert.ok(posts.some(p=>p.description==='**Pilot** requested to join **Patrol**'));
 }finally{db.close();}
});
