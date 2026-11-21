import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timerDiscordCommand} from '../public/timerboard-model.mjs';

test('WC Discord command matches the pasted timer format and uses UTC',()=>{
 const timer={stage:'Final',type:'Skyhook',stance:'Hostile',name:'Orbital Skyhook (LX-ZOJ II) [GSF Logistics and Posting Reserves]',at:Date.parse('2026-11-21T18:37:26Z'),ticker:'CONDI'};
 assert.equal(timerDiscordCommand(timer),'/add_timer stage:Final type:Skyhook stance:Hostile detail:Orbital Skyhook (LX-ZOJ II) [GSF Logistics and Posting Reserves]\n15 km\nReinforced until 2026.11.21 18:37:26 owner_ticker:CONDI');
 assert.equal(timerDiscordCommand({...timer,type:'Orbital Skyhook'}),timerDiscordCommand(timer));
 for(const type of ['Customs Office','Customs office','Player Owned Customs Office','POCO'])assert.match(timerDiscordCommand({...timer,type}),/ type:POCO stance:/);
 assert.match(timerDiscordCommand({...timer,stage:'Anchoring'}),/Anchoring until 2026.11.21 18:37:26/);
 assert.equal(timerDiscordCommand({...timer,at:undefined}),null);
 assert.ok(timerDiscordCommand({...timer,ticker:undefined}).endsWith('owner_ticker:'));
});


test('Timerboard viewers can copy a timer without deletion permission or a server mutation',async()=>{
 const previous=globalThis.document,descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard'),listeners={},messages=[];let copied='';
 globalThis.document={addEventListener:(kind,handler)=>{listeners[kind]=handler;}};
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
 try{
  const {timerboardUI}=await import('../public/timerboard-view.mjs');
  const timer={id:1,name:'Test Skyhook',system:'LX-ZOJ',stage:'Final',type:'Skyhook',stance:'Hostile',ticker:'CONDI',source:'Manual',at:Date.parse('2026-11-21T18:37:26Z')};
  let reads=0;
  const ui=timerboardUI({api:async path=>{assert.equal(path,'/timerboard');reads++;return {timers:[timer],targets:[],canAdd:false,canRemoveTimers:false,canRemoveTargets:false};},esc:String,intro:()=>'',toast:value=>messages.push(value),refresh:async()=>{}});
  const html=await ui.render();assert.ok(html.includes('data-copy-timer="0"'));assert.ok(html.includes('<th>Actions</th>'));assert.ok(!html.includes('data-remove-timer='));
  await listeners.click({target:{closest:selector=>selector==='[data-copy-timer]'?{dataset:{copyTimer:'0'}}:null}});
  assert.equal(copied,timerDiscordCommand(timer));assert.equal(reads,1);assert.equal(messages[0],'Discord timer command copied.');
 }finally{
  if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
  if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;
 }
});


test('POCO details include the in-game Customs Office header and owner without changing the recorded time',()=>{
 const timer={stage:'Final',type:'Customs Office',stance:'Friendly',name:'O-VWPB I',ownerName:'Sacred Templars',ticker:'STEMP/FRT',at:Date.parse('2026-11-21T11:05:49Z')};
 const command=timerDiscordCommand(timer);
 assert.equal(command,'/add_timer stage:Final type:POCO stance:Friendly detail:Customs Office (O-VWPB I) [Sacred Templars]\n15 km\nReinforced until 2026.11.21 11:05:49 owner_ticker:STEMP/FRT');
 assert.equal(timerDiscordCommand({...timer,name:'Customs Office (O-VWPB I) [Sacred Templars]'}),command);
 assert.equal(timerDiscordCommand({...timer,name:'Customs Office (O-VWPB I)'}),command);
});


test('all racial, sized and faction control towers copy as POS',()=>{
 for(const type of ['Caldari Control Tower','Amarr Control Tower Medium','Minmatar Control Tower Small','Gallente Control Tower','Dread Guristas Control Tower','True Sansha Control Tower Medium','Dark Blood Control Tower Small','POS']){
  const command=timerDiscordCommand({type,stage:'Final',stance:'Friendly',name:'Stevestar 1',ticker:'STEMP',at:Date.parse('2026-11-21T11:05:49Z')});
  assert.match(command,/ type:POS stance:/);assert.ok(command.includes('detail:Stevestar 1\n'));
 }
});
