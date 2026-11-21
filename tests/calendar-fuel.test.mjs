import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {operationCalendar} from '../lib/operation-calendar.mjs';

test('calendar depletion uses anchored inventory and respects source access, stopped consumption and missing data',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE public_cache(path TEXT PRIMARY KEY,data TEXT)');
 const at=Date.UTC(2026,10,11), structures=[
  {id:1,name:'Tower',kind:'POS',inventory_at:at,fuel:960,rate:40},
  {id:2,name:'Drill',kind:'Moon Drill',inventory_at:at,fuel:120,rate:5,gas:4800,gas_rate:200},
  {id:3,name:'Stopped',kind:'Moon Drill',fuel:0,rate:0,gas:0,gas_rate:0,fuel_expires:new Date(at+1).toISOString()},
  {id:4,name:'Unknown',kind:'Structure',fuel:999},
  {id:5,name:'ESI expiry',kind:'Structure',fuel_expires:new Date(at+48*3600000).toISOString()}
 ];
 const calendar=operationCalendar(db,{snapshot:()=>({structures,updated:at})});
 try{
  assert.deepEqual(calendar.list(['corp-calendar'],false,at).events,[]);
  const moon=calendar.list(['corp-moons'],false,at).events;
  assert.deepEqual(moon.map(e=>e.id),['fuel-2','gas-2']);
  assert.ok(moon.every(e=>e.source==='corp-moons'&&e.estimated));
  const all=calendar.list(['corp-structures'],true,at+12*3600000);
  assert.equal(all.events.find(e=>e.id==='fuel-1').starts,at+24*3600000);
  assert.equal(all.events.find(e=>e.id==='gas-2').starts,at+24*3600000);
  assert.equal(all.events.find(e=>e.id==='fuel-5').starts,at+48*3600000);
  assert.ok(!all.events.some(e=>e.title==='Stopped'||e.title==='Unknown'));
  assert.equal(all.coverage.find(s=>s.kind==='fuel').unavailable,1);
 }finally{db.close();}
});

test('citadel runway prefers ESI expiry over a conflicting consumption estimate',async()=>{
 const {runway}=await import('../public/corp-workspace-model.mjs');
 const now=Date.parse('2026-11-18T10:00:00Z');
 const row={kind:'Structure',fuel:19000,rate:8,inventory_at:now,fuel_expires:new Date(now+87*86400000).toISOString()};
 assert.equal(runway(row,'fuel',now),87);
 assert.equal(runway({...row,rate:null},'fuel',now),87);
 assert.equal(runway({...row,fuel_expires:null},'fuel',now),19000/8/24);
});
