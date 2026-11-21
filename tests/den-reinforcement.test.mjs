import {denAlerts} from '../public/den-model.mjs';
import {notificationIdentity} from '../lib/notification-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {addDenReinforcement} from '../lib/den-reinforcement.mjs';
import {denReinforcementView} from '../public/den-reinforcement-view.mjs';
const now=Date.UTC(2026,10,11),end=new Date(now+3600000).toISOString();
const ticks=ms=>(BigInt(ms)+11644473600000n)*10000n;
const notice=(id,time)=>({type:'MercenaryDenReinforced',text:`itemID: ${id}\naggressorCharacterID: 500\naggressorCorporationName: 'Pilot''s Corp'\naggressorAllianceName: Alliance\ntimestampEntered: ${ticks(now-3600000)}\ntimestampExited: ${ticks(time)}`});
test('attributes an active timer only to the matching den and reinforcement event',async()=>{
 const rows=[{id:10,reinforcement_timer:{end}},{id:20,reinforcement_timer:{end}},{id:30,state:'Paused'}];
 const c={id:1,scopes:'["esi-characters.read_notifications.v1"]'};
 const calls=[];
 const eve={get:async()=>[notice(10,now-1),notice('&id001 20',now+3600000)],publicGet:async path=>{calls.push(path);return {name:'Attacker'};}};
 await addDenReinforcement(rows,[],c,eve,now);
 assert.deepEqual(calls,['/characters/500']);
 assert.equal(rows[0].reinforcement,undefined);
 assert.equal(rows[1].reinforcement.corporation,"Pilot's Corp");
 assert.equal(rows[1].reinforcement.character,'Attacker');
 assert.equal(rows[1].reinforcement.alliance,'Alliance');
 const next=[{id:20,reinforcement_timer:{end}}];
 await addDenReinforcement(next,rows,c,{get:async()=>{throw Error('Unavailable');}},now);
 assert.deepEqual(next[0].reinforcement,rows[1].reinforcement);
});
test('one panel groups active timers soonest first and hides when they expire',()=>{
 const p=[{name:'Later',data:[{reinforcement_timer:{end:new Date(now+7200000).toISOString()}}]},{name:'Sooner',data:[{reinforcement_timer:{end}}]},{name:'Paused',data:[{state:'Paused'}]}];
 const helpers={esc:String,date:String,duration:String,table:(columns,rows)=>columns.join(',')+rows.join('')};
 const html=denReinforcementView(p,helpers,now);
 assert.equal(html.match(/Reinforced Dens/g).length,1);
 assert.ok(html.indexOf('Sooner')<html.indexOf('Later'));
 assert.doesNotMatch(html,/Paused/);
 assert.equal(denReinforcementView(p,helpers,now+7200000),'');
});

test('a current notice supplies a missing timer for an owned den and survives a notification outage',async()=>{
 const rows=[{id:20,state:'Running'},{id:30,state:'Running'},{id:40,state:'Running',reinforcement_timer:{end}}];
 const character={id:1,scopes:'["esi-characters.read_notifications.v1"]'};
 const eve={get:async()=>[notice(30,now-1),notice('&id001 20',now+3600000),notice(40,now+7200000),notice(50,now+3600000)],publicGet:async()=>({name:'Attacker'})};
 await addDenReinforcement(rows,[],character,eve,now);
 assert.deepEqual(rows[0].reinforcement_timer,{end});
 assert.equal(rows[0].reinforcement.source,'notification');
 assert.equal(rows[1].reinforcement_timer,undefined);
 assert.equal(rows[2].reinforcement,undefined);
 assert.deepEqual(denAlerts([{id:1,data:rows,updated:now}],now).map(alert=>alert.den_id),[20,40]);
 const next=[{id:20,state:'Running'}];
 await addDenReinforcement(next,rows,character,{get:async()=>{throw Error('Unavailable');}},now);
 assert.deepEqual(next[0].reinforcement,rows[0].reinforcement);
 const expired=[{id:20,state:'Running'}];
 await addDenReinforcement(expired,next,character,eve,Date.parse(end));
 assert.equal(expired[0].reinforcement_timer,undefined);
});

test('reinforcement notifications expire and can be dismissed per timer',()=>{
 const den={id:10,planet:{name:'Example planet'},reinforcement_timer:{end}};
 const pilots=[{id:1,name:'Owner',updated:now,data:[den]}];
 const [alert]=denAlerts(pilots,now);
 assert.equal(alert.kind,'den-reinforced');
 assert.equal(alert.location,'Example planet');
 assert.equal(alert.expires,end);
 assert.deepEqual(denAlerts(pilots,Date.parse(end)),[]);
 den.reinforcement_timer.end=new Date(now+7200000).toISOString();
 assert.notEqual(notificationIdentity(denAlerts(pilots,now)[0]),notificationIdentity(alert));
});
