import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {towerAttackNotices} from '../lib/tower-attacks.mjs';
import {discordPublishing,discordDestinations} from '../lib/discord-publishing.mjs';
const now=Date.parse('2026-11-25T12:00:00Z');
const notice={type:'TowerAlertMsg',timestamp:new Date(now-1000).toISOString(),text:'moonID: 40000001\nsolarSystemID: 30000001\ntypeID: 20059\nshieldValue: 1.0\narmorValue: 0.75\nhullValue: 0.5'};
test('Tower alerts use native moon/type identity without a fabricated structure ID',()=>{
 const rows=towerAttackNotices([notice,notice],[],now);assert.equal(rows.length,1);assert.equal(rows[0].id,undefined);
 assert.deepEqual([rows[0].moonId,rows[0].systemId,rows[0].typeId,rows[0].shield,rows[0].armor,rows[0].hull],[40000001,30000001,20059,100,75,50]);
 assert.deepEqual(towerAttackNotices([notice],rows,now),rows);
 for(const bad of [{...notice,type:'TowerResourceAlertMsg'},{...notice,timestamp:new Date(now+1000).toISOString()},{...notice,timestamp:new Date(now-13*3600000).toISOString()},{...notice,text:'moonID: 40000001'},{...notice,text:notice.text.replace('40000001','90071992547409999')}])assert.deepEqual(towerAttackNotices([bad],[],now),[]);
 const missing=towerAttackNotices([{...notice,text:'towerID: 99\nshieldValue: NaN\narmorValue: 101'}],[],now);assert.equal(missing[0].shield,null);assert.equal(missing[0].armor,null);
});
test('Tower attack channel is opt-in, independent, deduplicated and retries without general structure duplicates',async()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE users(id,admin,main_id);CREATE TABLE characters(id,user_id,name);CREATE TABLE snapshots(character_id,kind,data,updated);CREATE TABLE den_notification_checks(character_id,checked);CREATE TABLE discord_accounts(user_id,discord_id);INSERT INTO users VALUES(1,1,1);');
  const routes={},posts=[];let fail=false;const app={get(path,_admin,handler){routes['GET'+path]=handler;},post(path,_admin,handler){routes[path]=handler;}};
  const snapshot={structures:[{id:99,moon_id:40000001,kind:'POS',name:'Moon Tower',moon:'Example VII - Moon 5',system:'Example',type_id:20059,type_name:'Caldari Control Tower Small'},{id:98,kind:'Structure',name:'Citadel',type_id:35833}],customsOffices:{attacks:[{id:99,at:now-1000},{id:98,at:now-1000}],towerAttacks:towerAttackNotices([notice],[],now).map(row=>({...row,id:99})),destroyed:[]}};
  const discord={read:()=>({guild_id:'123456',enabled:true,connected:now}),snowflake:value=>/^\d{6,20}$/.test(value||''),request:async(path,options)=>{if(!options)return {guild_id:'123456',type:0};if(fail&&path.includes('222222'))throw Error('Temporary failure');posts.push({path,body:options.body});return {id:'345678'};}};
  const service=discordPublishing(app,{db,discord,config:{owner:1,base:'https://tools.example'},calendar:{list:()=>({events:[]})},corp:{snapshot:()=>snapshot}});
  await service.tick(now);assert.equal(posts.length,0);
  const save=(tower,omit=false)=>routes['/api/admin/discord/publishing']({session:{user_id:1},body:{tab:'notifications',dailyTime:'09:00',threshold:24,destinations:Object.fromEntries(Object.keys(discordDestinations).filter(k=>k!=='timerboard'&&(!omit||k!=='towerAttacked')).map(k=>[k,{enabled:k==='towerAttacked'?tower:k==='structureAttacked',channel:k==='towerAttacked'?'222222':k==='structureAttacked'?'111111':''}]))}},{json(){}});
  save(false,true);fail=true;await service.tick(now);assert.equal(posts.length,1);assert.match(posts[0].body.embeds[0].title,/Structure attacked/);
  save(true);await service.tick(now+60000);assert.equal(posts.length,1);
  fail=false;await service.tick(now+120000);assert.equal(posts.length,2);const tower=posts[1];assert.equal(tower.path,'/channels/222222/messages');assert.match(tower.body.embeds[0].title,/Tower under attack/);assert.match(tower.body.embeds[0].description,/Moon 5/);assert.match(tower.body.embeds[0].description,/Shield \*\*100%\*\*.*Armour \*\*75%\*\*.*Hull \*\*50%\*\*/);assert.match(tower.body.embeds[0].thumbnail.url,/20059/);assert.deepEqual(tower.body.allowed_mentions,{parse:[]});
  await service.tick(now+180000);assert.equal(posts.length,2);
  snapshot.customsOffices.towerAttacks.push({...snapshot.customsOffices.towerAttacks[0],at:now-2*3600000},{...snapshot.customsOffices.towerAttacks[0],at:now+300000});snapshot.customsOffices.destroyed=[[99,now]];await service.tick(now+240000);assert.equal(posts.length,2);
 }finally{db.close();}
});
