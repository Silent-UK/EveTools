import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {discordPilotSync,matchDiscordPilots} from '../lib/discord-pilot-sync.mjs';

const member=(id,nick,attrs={})=>({nick,user:{id:String(id),username:'user'+id,...attrs}});

test('Discord name matching saves unique pilot names and leaves conflicts and verified links alone',()=>{
 const pilots=[
  {user_id:1,name:'Kalissa'}, {user_id:1,name:'Kalissa Alt'},
  {user_id:2,name:'Other Pilot'}, {user_id:3,name:'Verified Pilot'},
  {user_id:4,name:'Fourth Pilot'},
 ];
 const {matches,ambiguous}=matchDiscordPilots([
  member(100001,'Kalissa',{global_name:'Kalissa Alt'}),
  member(100002,'Other Pilot'),
  member(100003,'other pilot',{global_name:'Fourth Pilot'}),
  member(100004,'Fourth Pilot'),
  member(100005,'Verified Pilot'),
  member(100006,'Other Pilot',{bot:true}),
  member(100007,'Kalissa'),
 ],pilots,[{user_id:3,discord_id:'100007'}]);
 assert.deepEqual(matches.map(({user_id,matched_pilot,discord_name})=>[user_id,matched_pilot,discord_name]),[[1,'Kalissa','Kalissa']]);
 assert.equal(ambiguous,3);
});

test('Pilot scan reads every page, stores matches separately and preserves them after a partial failure',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
   CREATE TABLE characters(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT);
   CREATE TABLE discord_accounts(user_id INTEGER PRIMARY KEY,discord_id TEXT UNIQUE,name TEXT,checked INTEGER);
   INSERT INTO users VALUES(1,'Kalissa'); INSERT INTO characters VALUES(2,1,'Kala Alt');`);
  const seen=[];
  let failed=false,nickname=' kala alt ';
  const page=Array.from({length:1000},(_,index)=>member(100000+index,'Unmatched '+index));
  const service=discordPilotSync(db,{
   read:()=>({guild_id:'999999',connected:1,bot_token:'demo'}),
   snowflake:value=>/^\d{6,20}$/.test(value||''),
   request:async path=>{
    seen.push(path);
    if(path.endsWith('/members/101000'))return member(101000,nickname);
    if(path.endsWith('after=0'))return page;
    if(failed)throw Object.assign(Error('Denied'),{discordStatus:403});
    return [member(101000,' kala alt ')];
   },
  });
  assert.deepEqual(await service.sync(),{matched:1,scanned:1001,ambiguous:0});
  assert.deepEqual(seen,['/guilds/999999/members?limit=1000&after=0','/guilds/999999/members?limit=1000&after=100999']);
  const saved=service.view('999999');
  assert.equal(saved.matches[0].pilot,'Kalissa');
  assert.equal(saved.matches[0].matched_pilot,'Kala Alt');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM discord_accounts').get().count,0);
  assert.deepEqual(service.view('888888').matches,[]);
  failed=true;
  await assert.rejects(service.sync(),/Server Members Intent/);
  assert.deepEqual(service.view('999999'),saved);
  nickname='Changed nickname';
  await assert.rejects(service.approve({user_id:1,discord_id:'101000'}),/changed since the scan/);
  nickname=' kala alt ';
  assert.deepEqual(await service.approve({user_id:1,discord_id:'101000'}),{ok:true});
  assert.equal(db.prepare('SELECT discord_id FROM discord_accounts WHERE user_id=1').get().discord_id,'101000');
  assert.deepEqual(service.view('999999').matches,[]);
  await assert.rejects(service.approve({user_id:1,discord_id:'101000'}),/no longer available/);
 }finally{db.close();}
});
