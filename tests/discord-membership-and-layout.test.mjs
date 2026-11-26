import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {discordPublishing,discordDestinations} from '../lib/discord-publishing.mjs';
import {discordUI} from '../public/discord-view.mjs';

test('join and leave alerts use independent channels and silent baselines, share roster reads and retry safely',async()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE users(id,admin,main_id);CREATE TABLE characters(id,user_id,name);CREATE TABLE snapshots(character_id,kind,data,updated);CREATE TABLE den_notification_checks(character_id,checked);CREATE TABLE discord_accounts(user_id,discord_id)');
  const start=Date.parse('2026-11-22T10:00:00Z'),interval=300000,routes={},posts=[];
  let roster={ids:[11,22],observed:start},reads=0,outage=false,failJoin=false;
  const service=discordPublishing({get(){},post(path,_admin,handler){routes[path]=handler;}},{db,config:{owner:1,base:'https://tools.example'},
   corp:{memberRoster:async()=>{reads++;if(outage)throw Error('ESI unavailable');return roster;},memberNames:async()=>({22:'Departed',33:'New Member'})},
   discord:{read:()=>({enabled:true,connected:start,guild_id:'123456'}),snowflake:()=>true,request:async(path,options)=>{if(!options)return {guild_id:'123456',type:0};if(failJoin&&path.includes('111111'))throw Error('Discord unavailable');posts.push({path,...options.body});return {id:'345678'};}}});
  const save=(joined,left)=>routes['/api/admin/discord/publishing']({session:{user_id:1},body:{tab:'notifications',dailyTime:'09:00',threshold:24,destinations:Object.fromEntries(Object.keys(discordDestinations).filter(k=>k!=='timerboard').map(k=>[k,{enabled:k==='corpJoin'?joined:k==='corpDeparture'?left:false,channel:k==='corpJoin'?'111111':k==='corpDeparture'?'222222':''}]))}},{json(){}});
  await service.tick(start);assert.equal(reads,0);
  save(true,true);await service.tick(start);assert.equal(reads,1);assert.equal(posts.length,0);
  outage=true;await service.tick(start+interval);assert.equal(reads,2);assert.equal(posts.length,0);outage=false;
  roster={ids:[11,33],observed:start+2*interval};failJoin=true;
  await service.tick(start+2*interval);assert.equal(reads,3);assert.equal(posts.length,1);assert.match(posts[0].embeds[0].title,/left corporation/);assert.equal(posts[0].path,'/channels/222222/messages');
  failJoin=false;await service.tick(start+3*interval);assert.equal(posts.length,2);assert.match(posts[1].embeds[0].title,/joined corporation/);assert.match(posts[1].embeds[0].description,/New Member/);assert.equal(posts[1].path,'/channels/111111/messages');
  await service.tick(start+4*interval);assert.equal(posts.length,2);
  save(false,true);roster={ids:[11,33,44],observed:start+5*interval};await service.tick(start+5*interval);assert.equal(posts.length,2);
  save(true,true);await service.tick(start+6*interval);assert.equal(posts.length,2,'re-enabled join starts with a quiet baseline');
  roster={ids:[11],observed:start-1};await service.tick(start+7*interval);assert.equal(posts.length,2,'older cached roster cannot invent changes');
 }finally{db.close();}
});

test('notification settings preserve all fields in the requested six groups and leave Timerboard separate',async()=>{
 const previous=globalThis.document,clicks=[];
 globalThis.document={addEventListener:(type,handler)=>{if(type==='click')clicks.push(handler);},getElementById:()=>({focus(){}})};
 try{
  const data={labels:discordDestinations,destinations:Object.fromEntries(Object.keys(discordDestinations).map(key=>[key,{enabled:true,channel:'123456'}])),connected:true,errors:{},dailyTime:'09:00',threshold:24};
  const ui=discordUI({api:async()=>data,esc:String,intro:()=>'',date:String,refresh:async()=>{},toast(){},context:()=>({me:{admin:true}})});
  await clicks[0]({target:{closest:()=>({dataset:{discordTab:'notifications'}})}});
  const html=await ui.render('admin-discord');
  const groups=[...html.matchAll(/<section class="discord-notification-group"[^>]*><h3>(.*?)<\/h3><div class="discord-notification-grid">(.*?)<\/section>/gs)];
  assert.deepEqual(groups.map(m=>m[1]),['Dens','Structures','Moons','Pilots','Groups','Fuel']);
  assert.deepEqual(groups.map(m=>[...m[2].matchAll(/name="([\w]+)-enabled"/g)].map(n=>n[1])),[['denReinforced','denAttacked','structureDestroyed'],['structureAttacked','structureReinforced','structureAnchoring'],['moonReady','moonFractured','towerAttacked'],['corpDeparture','corpJoin'],['groupJoin','groupLeave','groupRequest'],['lowFuel','dailyFuel']]);
  for(const key of Object.keys(discordDestinations).filter(k=>k!=='timerboard'))assert.equal(html.split('name="'+key+'-channel"').length-1,1);
  await clicks[0]({target:{closest:()=>({dataset:{discordTab:'timerboard'}})}});
  assert.doesNotMatch(await ui.render('admin-discord'),/discord-notification-group/);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
