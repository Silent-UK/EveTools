import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {moonFractureNotices,MOON_NOTICE_MAX_AGE} from '../lib/moon-fracture.mjs';
import {discordPublishing,discordDestinations} from '../lib/discord-publishing.mjs';
const start=Date.parse('2026-11-22T10:00:00Z');
const notice=(type,id,at=start)=>({type,timestamp:new Date(at).toISOString(),text:`structureID: &id001 ${id}\nmoonID: 40100001\nsolarSystemID: 30000142`});
test('moon notices distinguish ready, laser and automatic fracture and retain them across director polls',()=>{
 const ready=notice('MoonminingExtractionFinished',1),laser=notice('MoonminingLaserFired',2),auto=notice('MoonminingAutomaticFracture',3);
 const rows=moonFractureNotices([ready,ready,laser,auto,notice('MoonminingExtractionStarted',4),notice('MoonminingLaserFired',5,start+1),notice('MoonminingLaserFired',6,start-MOON_NOTICE_MAX_AGE-1),{...laser,text:'structureID: invalid\nmoonID: 4'},{...auto,text:'structureID: 123'}],[],start);
 assert.deepEqual(rows.map(r=>[r.id,r.phase,r.automatic]),[[1,'ready',false],[2,'fractured',false],[3,'fractured',true]]);
 assert.deepEqual(moonFractureNotices([],rows,start+60000),rows);
 assert.equal(moonFractureNotices([],rows,start+MOON_NOTICE_MAX_AGE+1).length,0);
});
test('ready and fractured notifications are independently configured, corporation scoped and deduplicated',async()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE users(id,admin,main_id);CREATE TABLE characters(id,user_id,name);CREATE TABLE snapshots(character_id,kind,data,updated);CREATE TABLE den_notification_checks(character_id,checked);CREATE TABLE discord_accounts(user_id,discord_id)');
  const routes={},posts=[];let fail=false;
  const app={get(){},post(path,_admin,handler){routes[path]=handler;}};
  const snapshot={structures:[1,2,3,4].map(id=>({id,name:'Refinery '+id,type_id:35835,system:'Jita',region:'The Forge'})),customsOffices:{destroyed:[[4,start]],moonNotifications:moonFractureNotices([notice('MoonminingExtractionFinished',1),notice('MoonminingLaserFired',2),notice('MoonminingAutomaticFracture',3),notice('MoonminingLaserFired',4),notice('MoonminingLaserFired',999)],[],start)}};
  const discord={read:()=>({enabled:true,connected:start,guild_id:'123456'}),snowflake:()=>true,request:async(path,options)=>{if(!options)return {guild_id:'123456',type:0};if(fail)throw Error('temporary failure');posts.push({path,...options.body});return {id:'345678'};}};
  const service=discordPublishing(app,{db,discord,config:{owner:1,base:'https://tools.example'},calendar:{list:()=>({events:[]})},corp:{snapshot:()=>snapshot}});
  const save=(ready,fractured)=>routes['/api/admin/discord/publishing']({session:{user_id:1},body:{tab:'notifications',dailyTime:'09:00',threshold:24,destinations:Object.fromEntries(Object.keys(discordDestinations).filter(k=>k!=='timerboard').map(k=>[k,{enabled:k==='moonReady'?ready:k==='moonFractured'?fractured:false,channel:k==='moonReady'?'111111':k==='moonFractured'?'222222':''}]))}},{json(){}});
  await service.tick(start);assert.equal(posts.length,0);
  save(true,false);fail=true;await service.tick(start);assert.equal(posts.length,0);
  fail=false;await service.tick(start+1);assert.equal(posts.length,1);assert.match(posts[0].embeds[0].title,/ready to fracture/);assert.equal(posts[0].path,'/channels/111111/messages');
  save(true,true);await service.tick(start+2);assert.equal(posts.length,3);assert.ok(posts.slice(1).every(p=>p.path==='/channels/222222/messages'));
  assert.match(posts[1].embeds[0].description,/Mining laser fired/);assert.match(posts[2].embeds[0].description,/Automatic fracture/);
  await service.tick(start+60000);assert.equal(posts.length,3);
  snapshot.customsOffices.moonNotifications=moonFractureNotices([notice('MoonminingExtractionFinished',1,start+120000),notice('MoonminingLaserFired',1,start+120001)],snapshot.customsOffices.moonNotifications,start+120001);
  await service.tick(start+120001);assert.equal(posts.length,4,'no ready alert for a chunk already fractured');
  assert.ok(posts.every(p=>p.allowed_mentions.parse.length===0));
  save(false,false);snapshot.customsOffices.moonNotifications.push({id:1,phase:'fractured',at:start+180000});await service.tick(start+180000);assert.equal(posts.length,4);
 }finally{db.close();}
});
