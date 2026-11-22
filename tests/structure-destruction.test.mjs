import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {collectDestructions,savedDestructions,rememberDens,recentDenHistory,corporationDestructions} from '../lib/structure-destruction.mjs';
import {syncService} from '../lib/sync.mjs';import {addDenReinforcement} from '../lib/den-reinforcement.mjs';
import {discordPublishing,discordDestinations} from '../lib/discord-publishing.mjs';
const now=Date.parse('2026-11-22T10:00:00Z'),pilot={id:11,user_id:1,owner_hash:'owned',name:'Den Pilot',scopes:'["esi-characters.read_notifications.v1"]'};
function fixture(){const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE public_cache(path TEXT PRIMARY KEY,data TEXT,expires INTEGER);CREATE TABLE users(id INTEGER PRIMARY KEY,main_id INTEGER,admin INTEGER);
 CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER,owner_hash TEXT,name TEXT,scopes TEXT,reconnect INTEGER DEFAULT 0);
 CREATE TABLE login_membership_checks(character_id INTEGER,corporation_id INTEGER);CREATE TABLE snapshots(character_id INTEGER,kind TEXT,data TEXT,updated INTEGER);
 CREATE TABLE den_notification_checks(character_id INTEGER PRIMARY KEY,next_due INTEGER,checked INTEGER);CREATE TABLE esi_cache(character_id INTEGER,path TEXT,data TEXT,expires INTEGER);
 CREATE TABLE page_preferences(user_id INTEGER,data TEXT);CREATE TABLE jobs(status TEXT);CREATE TABLE discord_accounts(user_id INTEGER,discord_id TEXT);
 INSERT INTO users VALUES(1,11,0),(2,22,0);INSERT INTO characters VALUES(11,1,'owned','Den Pilot','["esi-characters.read_notifications.v1"]',0);
 INSERT INTO login_membership_checks VALUES(11,100),(22,999);`);return db;}
const killed=(id,typeId=81826,at=now)=>({type:'StructureDestroyed',timestamp:new Date(at).toISOString(),text:`structureID: &id001 ${id}\nstructureTypeID: ${typeId}\nsolarsystemID: 30002458\nownerCorpLinkData:\n- showinfo\n- 2\n- 100`});
const kill=(id=77,typeId=85230)=>({type:'KillReportVictim',timestamp:new Date(now).toISOString(),text:`killMailID: ${id}\nkillMailHash: ${'a'.repeat(40)}\nvictimShipTypeID: ${typeId}`});
const cat={type:id=>({name:id===85230?'Mercenary Den':'Structure',category_id:id===587?6:65})};
test('confirmed corporate deaths survive inventory removal; wrong-corp, stale, future and unrelated notifications do not publish',async()=>{
 const db=fixture();try{
  await collectDestructions(db,[killed(5),killed(5),killed(6,35832),killed(7,81826,now+1),killed(8,81826,now-13*3600000),{...killed(9),text:killed(9).text.replace('- 100','- 999')},{...killed(10),type:'StructureUnderAttack'}],{corporationId:100,cat,structures:[{id:5,name:'Named drill',type_id:81826,system:'LX-ZOJ'}]},now);
  assert.equal(savedDestructions(db,now).length,2);assert.equal(savedDestructions(db,now)[0].name,'Named drill');
  await collectDestructions(db,[killed(5)],{corporationId:100,cat,structures:[]},now+1000);
  assert.equal(savedDestructions(db,now+1000).length,2);assert.equal(corporationDestructions(db,100,now).length,2);assert.equal(corporationDestructions(db,999,now).length,0);
 }finally{db.close();}
});
test('last Den loss is collected after its list empties, without inferring a death from disappearance',async()=>{
 const db=fixture();try{
  const previous=[{id:500,type_id:85230,planet:{name:'LX-ZOJ XIII',system_id:30002458},system:'LX-ZOJ'}];
  rememberDens(db,pilot,previous,[],now);assert.equal(savedDestructions(db,now).length,0);
  db.prepare("INSERT INTO snapshots VALUES(11,'dens','[]',?)").run(now);
  let notificationReads=0,lossReads=0;
  const eve={get:async path=>{assert.equal(path,'/characters/11/notifications');notificationReads++;return [kill(),kill(),kill(78,587)];},publicGet:async()=>{lossReads++;return {solar_system_id:30002458,victim:{ship_type_id:85230,character_id:11,corporation_id:100}};}};
  const service=syncService(db,eve,cat);await service.tickDenNotifications(now);
  assert.equal(notificationReads,1);assert.equal(lossReads,1);assert.equal(savedDestructions(db,now).length,1);assert.equal(savedDestructions(db,now)[0].name,'LX-ZOJ XIII');
  assert.equal(corporationDestructions(db,100,now).length,1,'an unlinked Discord account still shares its confirmed loss');
  await service.tickDenNotifications(now+1000);assert.equal(notificationReads,1);
  rememberDens(db,pilot,[],[],now+3600000);assert.equal(recentDenHistory(db,11,now+2*3600000+1).length,0,'empty lists do not extend the temporary watch');
  await service.tickDenNotifications(now+2*3600000+1);assert.equal(notificationReads,1);
  const notices=await addDenReinforcement([],previous,pilot,eve,now);assert.equal(notices.length,3,'full sync can check losses after the last Den disappears');
 }finally{db.close();}
});
test('personal ship kills, other-owner losses and an account deleted during lookup cannot create Den alerts',async()=>{
 const db=fixture();try{
  await collectDestructions(db,[kill()],{pilot,cat,eve:{publicGet:async()=>({victim:{ship_type_id:85230,character_id:999}})}},now);assert.equal(savedDestructions(db,now).length,0);
  await collectDestructions(db,[kill()],{pilot,cat,eve:{publicGet:async()=>{db.prepare('DELETE FROM characters WHERE id=11').run();return {victim:{ship_type_id:85230,character_id:11}};}}},now);assert.equal(savedDestructions(db,now).length,0);
 }finally{db.close();}
});
test('structure loss delivery is opt-in and deduplicated across retries, including Den kill reports',async()=>{
 const db=fixture();try{
  await collectDestructions(db,[killed(5)],{corporationId:100,cat},now);
  await collectDestructions(db,[kill()],{pilot,cat,eve:{publicGet:async()=>({solar_system_id:30002458,victim:{ship_type_id:85230,character_id:11,corporation_id:100}})}},now);
  const routes={},posts=[];let failed=false;
  const service=discordPublishing({get(){},post(path,_admin,fn){routes[path]=fn;}},{db,config:{owner:11,base:'https://tools.example'},destructionNotices:()=>corporationDestructions(db,100,now),discord:{read:()=>({enabled:true,connected:now,guild_id:'123456'}),snowflake:()=>true,request:async(path,options)=>{if(!options)return {guild_id:'123456',type:0};if(failed)throw Error('Discord unavailable');posts.push(options.body);return {id:'234567'};}}});
  await service.tick(now);assert.equal(posts.length,0);
  routes['/api/admin/discord/publishing']({session:{user_id:1},body:{tab:'notifications',dailyTime:'09:00',threshold:24,destinations:Object.fromEntries(Object.keys(discordDestinations).filter(k=>k!=='timerboard').map(k=>[k,{enabled:k==='structureDestroyed',channel:k==='structureDestroyed'?'234567':''}]))}},{json(){}});
  failed=true;await service.tick(now);assert.equal(posts.length,0);failed=false;await service.tick(now+1);assert.equal(posts.length,2);assert.match(posts[0].embeds[0].title,/Structure destroyed/);assert.match(posts[1].embeds[0].description,/Den Pilot/);assert.match(posts[1].embeds[0].thumbnail.url,/85230/);
  await service.tick(now+2);assert.equal(posts.length,2);assert.deepEqual(posts[0].allowed_mentions,{parse:[]});
 }finally{db.close();}
});

test('corporation structure loss reports cover POCOs and POS while excluding ships and foreign corporations',async()=>{
 const db=fixture();try{
  const types={91:2233,92:16213,93:32458};let calls=0;
  await collectDestructions(db,[kill(91,2233),kill(92,16213),kill(93,32458),kill(94,587)],{corporationId:100,
   cat:{type:id=>({name:'Structure',category_id:({2233:46,16213:23,32458:40,587:6})[id]})},
   eve:{publicGet:async path=>{calls++;const id=Number(path.split('/')[2]);return {solar_system_id:30002458,victim:{ship_type_id:types[id],corporation_id:id===93?999:100}};}}},now);
  assert.equal(calls,3);assert.deepEqual(savedDestructions(db,now).map(row=>row.typeId),[2233,16213]);
 }finally{db.close();}
});
