import test from 'node:test';
import assert from 'node:assert/strict';
import {customsOfficeTimers,moonDrillReinforcementTimers} from '../lib/customs-office-timers.mjs';
import {REINFORCEMENT_GRACE,retainStructureReinforcement,structureReinforcementEnd} from '../lib/structure-reinforcement.mjs';

const now=Date.UTC(2026,10,12,12);
const end=now+3600000;
const ticks=ms=>(BigInt(ms)+11644473600000n)*10000n;

test('POCO notices keep the latest exact timer per planet through the two-hour grace period',()=>{
 const notice={type:'OrbitalReinforced',timestamp:new Date(now-3600000).toISOString(),
  text:`planetID: 40000001\r\nsolarSystemID: 30000001\r\nreinforceExitTime: ${ticks(end)}\r\ntypeID: 2233\r\n`};
 const old={...notice,timestamp:new Date(now-7200000).toISOString(),text:notice.text.replace(String(ticks(end)),String(ticks(end-3600000)))};
 const [timer]=customsOfficeTimers([notice,old,{...notice,text:''}],[],now);
 assert.deepEqual([timer.planetId,timer.systemId,timer.end],[40000001,30000001,end]);
 assert.deepEqual(customsOfficeTimers([], [timer],end+REINFORCEMENT_GRACE-1),[timer]);
 assert.deepEqual(customsOfficeTimers([notice],[timer],end+REINFORCEMENT_GRACE),[]);
});

test('structure exit survives a fresh snapshot that clears the live timer',()=>{
 const row={state:'unknown'};
 retainStructureReinforcement(row,{state:'hull_reinforce',timer:new Date(end).toISOString()},end);
 assert.equal(structureReinforcementEnd(row),end);
 const next={state:'unknown'};
 retainStructureReinforcement(next,row,end+REINFORCEMENT_GRACE);
 assert.equal(structureReinforcementEnd(next),undefined);
});

test('verified online structures immediately clear reinforcement timers including saved grace entries',()=>{
 const prior={state:'hull_reinforce',timer:new Date(end).toISOString()};
 for(const state of ['online','shield_vulnerable','armor_vulnerable','hull_vulnerable']){
  const row={state};
  retainStructureReinforcement(row,prior,end);
  assert.equal(row.recent_reinforcement_end,undefined);
  assert.equal(structureReinforcementEnd({state,recent_reinforcement_end:end}),undefined);
 }
});

test('Metenox armor-loss alerts use the precise EVE timestamp and duration',()=>{
 const started=now-180000, duration=3600123;
 const notice={type:'StructureLostArmor',timestamp:new Date(now).toISOString(),
  text:['structureID: &id001 1056391296278','structureTypeID: 81826','timestamp: '+ticks(started+duration),'timeLeft: '+BigInt(duration)*10000n].join('\n')};
 const timers=moonDrillReinforcementTimers([notice,notice],[],now);
 assert.deepEqual(timers,[{id:1056391296278,started,end:started+duration}]);
 assert.deepEqual(moonDrillReinforcementTimers([notice],timers,started+duration+REINFORCEMENT_GRACE),[]);
});
