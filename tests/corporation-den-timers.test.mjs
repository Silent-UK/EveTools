import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {corporationDenTimers} from '../lib/corporation-den-timers.mjs';
import {timerboardRoutes} from '../lib/timerboard.mjs';
import {discordPublishing} from '../lib/discord-publishing.mjs';

test('Tools and Discord share verified corporation Den timers without Discord accounts',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const now=Date.parse('2026-11-21T14:30:00Z');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,main_id INTEGER,admin INTEGER);
   CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT);
   CREATE TABLE snapshots(character_id INTEGER,kind TEXT,data TEXT,updated INTEGER);
   CREATE TABLE den_notification_checks(character_id INTEGER,checked INTEGER);
   CREATE TABLE discord_accounts(user_id INTEGER,discord_id TEXT);
   CREATE TABLE login_membership_checks(character_id INTEGER,corporation_id INTEGER);
   INSERT INTO users VALUES(1,11,1),(2,22,0),(3,33,0);
   INSERT INTO characters VALUES(11,1,'Admin'),(22,2,'Unlinked member'),(23,2,'Member alt'),(33,3,'External pilot');
   INSERT INTO login_membership_checks VALUES(11,100),(22,100),(33,999);`);
  for(const id of [22,23,33])db.prepare("INSERT INTO snapshots VALUES(?,'dens',?,?)").run(id,JSON.stringify([{id,planet:{name:'E9KD-N IX'},reinforcement_timer:{end:'2026-11-21T17:22:53Z'}}]),now-86400000);
  const sharedDenTimers=corporationDenTimers(db,100);
  assert.deepEqual(sharedDenTimers().map(r=>r.id),[22,23]);
  const app={get(){},post(){},delete(){}};
  const board=timerboardRoutes(app,{db,cat:{},corporationOwner:'STEMP/FRT',sharedDenTimers});
  const access={user:1,allowed:['corp-structures']};
  assert.deepEqual(board.listTimers(access,now,[]).map(r=>r.id),['den-22-22','den-23-23']);
  assert.equal(board.listTimers({...access,user:2},now,[]).length,2,'own timers deduplicate against the corporation list');
  assert.equal(board.listTimers({user:1,allowed:[]},now,[]).length,0,'existing structure visibility remains enforced');
  assert.equal(board.listTimers({allowed:['corp-structures']},now,[],[]).length,0,'explicit opt-out suppresses shared Dens');
  const sends=[];
  const service=discordPublishing(app,{db,sharedDenTimers,timerboard:board,timerboardEnabled:()=>true,
   config:{owner:11,base:'https://tools.example'},calendar:{list:()=>({events:[]})},corp:{snapshot:()=>({})},
   discord:{read:()=>({enabled:true,connected:now,guild_id:'123456'}),request:async(_path,options)=>{if(!options)return {guild_id:'123456',type:0};sends.push(options.body);return {id:'345678'};}}});
  const save=includeDens=>db.prepare('INSERT INTO discord_publishing_config VALUES(?,?) ON CONFLICT(guild) DO UPDATE SET data=excluded.data').run('123456',JSON.stringify({denOwner:1,includeDens,destinations:{timerboard:{enabled:true,channel:'234567'}}}));
  save(true);await service.tick(now);
  assert.match(sends.at(-1).content,/E9KD-N IX/);
  assert.match(sends.at(-1).content,/Fade/);
  assert.match(sends.at(-1).content,/17:22/);
  save(false);await service.tick(now+60000);
  assert.doesNotMatch(sends.at(-1).content,/Mercenary Den/);
  db.prepare('UPDATE login_membership_checks SET corporation_id=999 WHERE character_id=22').run();
  assert.equal(board.listTimers(access,now,[]).length,0,'former corporation members stop sharing timers');
 }finally{db.close();}
});
