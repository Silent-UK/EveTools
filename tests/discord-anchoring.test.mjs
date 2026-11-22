import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {discordPublishing,discordDestinations} from '../lib/discord-publishing.mjs';

test('Structure Anchoring is opt-in, channel-specific, deduplicated and retries failed sends',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const now=Date.parse('2026-11-22T10:00:00Z'),hour=3600000;
  db.exec(`CREATE TABLE users(id,admin,main_id);CREATE TABLE characters(id,user_id,name);
   CREATE TABLE snapshots(character_id,kind,data,updated);CREATE TABLE den_notification_checks(character_id,checked);
   CREATE TABLE discord_accounts(user_id,discord_id);`);
  const routes={},posts=[];let fail=false;
  const app={get(path,_admin,handler){routes['GET'+path]=handler;},post(path,_admin,handler){routes[path]=handler;}};
  const snapshots={structures:[
   {id:5,name:'Drill',state:'anchoring',timer:new Date(now+hour).toISOString(),type_id:81826},
   {id:10,name:'Fortizar',state:'anchoring',timer:new Date(now+2*hour).toISOString(),type_id:35833,system:'Jita'},
   {id:11,name:'Unknown finish',state:'anchoring',timer:'bad'},
   {id:12,name:'Online',state:'shield_vulnerable',timer:new Date(now+hour).toISOString()}],customsOffices:{destroyed:[[8,now]]}};
  const events=[{id:'anchoring-5',kind:'anchoring',title:'Drill',starts:now+hour,typeId:81826,estimated:true,system:'E9KD-N',region:'Fade'},
   {id:'manual',kind:'anchoring',manual:true,title:'Manual',starts:now+hour},
   {id:'anchoring-7',kind:'anchoring',title:'Finished',starts:now-1},
   {id:'anchoring-8',kind:'anchoring',title:'Destroyed',starts:now+hour}];
  const discord={read:()=>({guild_id:'123456',enabled:true,connected:now}),snowflake:value=>/^\d{6,20}$/.test(value||''),request:async(path,options)=>{
   if(!options)return {guild_id:'123456',type:0};if(fail)throw Error('temporary Discord failure');posts.push({path,body:options.body});return {id:'345678'};
  }};
  const service=discordPublishing(app,{db,discord,config:{owner:1,base:'https://tools.example'},calendar:{list:()=>({events})},corp:{snapshot:()=>snapshots}});
  let labels;routes['GET/api/admin/discord/publishing']({}, {json(data){labels=data.labels;}});
  assert.equal(labels.structureAnchoring,'Structure Anchoring');
  await service.tick(now);assert.equal(posts.length,0);
  const save=enabled=>routes['/api/admin/discord/publishing']({session:{user_id:1},body:{tab:'notifications',dailyTime:'09:00',threshold:24,destinations:Object.fromEntries(Object.keys(discordDestinations).filter(k=>k!=='timerboard').map(k=>[k,{enabled:k==='structureAnchoring'&&enabled,channel:k==='structureAnchoring'?'234567':''}]))}},{json(){}});
  save(true);fail=true;await service.tick(now);assert.equal(posts.length,0);
  fail=false;await service.tick(now+60000);assert.equal(posts.length,2);
  assert.ok(posts.every(p=>p.path==='/channels/234567/messages'));
  assert.match(posts[0].body.embeds[0].title,/Structure anchoring/);
  assert.match(posts[0].body.embeds[0].description,/Completes.*<t:.*Estimated/);
  assert.match(posts[0].body.embeds[0].description,/Fade/);
  assert.match(posts[1].body.embeds[0].thumbnail.url,/35833/);
  assert.ok(posts.every(p=>p.body.allowed_mentions.parse.length===0));
  await service.tick(now+120000);assert.equal(posts.length,2);
  snapshots.structures.push({id:13,name:'New drill',state:'anchoring',timer:new Date(now+3*hour).toISOString()});
  save(false);await service.tick(now+180000);assert.equal(posts.length,2);
  save(true);await service.tick(now+240000);assert.equal(posts.length,3);
  await service.tick(now+4*hour);assert.equal(posts.length,3);
 }finally{db.close();}
});
