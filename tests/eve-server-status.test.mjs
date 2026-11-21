import test from 'node:test';
import assert from 'node:assert/strict';
import {eveServerStatus} from '../lib/eve-server-status.mjs';

test('EVE status distinguishes online, reported issues, offline and unavailable checks',async()=>{
 for(const [vip,component,expected] of [[false,'operational','online'],[false,'degraded_performance','issues'],[true,'operational','offline']]){
  const status=eveServerStatus(async url=>Response.json(url.includes('/status/')?
   {vip,players:100}:{components:[{name:'Tranquility',status:component}]}));
  assert.equal((await status.read()).state,expected);
 }
 const unavailable=eveServerStatus(async()=>{throw Error('Unavailable');});
 assert.equal((await unavailable.read()).state,'issues');
});

test('EVE status shares concurrent checks and caches the result',async()=>{
 let requests=0;
 const status=eveServerStatus(async url=>{
  requests++;
  return Response.json(url.includes('/status/')?{vip:false,players:100}:{components:[{name:'Tranquility',status:'operational'}]});
 });
 const results=await Promise.all([status.read(),status.read()]);
 assert.equal(requests,2);
 assert.deepEqual(results[0],results[1]);
 await status.read();
 assert.equal(requests,2);
});
