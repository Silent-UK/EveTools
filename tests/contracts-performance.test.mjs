import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeContracts,filterContracts} from '../public/contracts-model.mjs';
import {contractsView} from '../public/contracts-view.mjs';
test('large corporation history shares lookup dictionaries and renders only one page',()=>{
 const names=Object.fromEntries(Array.from({length:3000},(_,i)=>[i+1,'Pilot '+(i+1)])),locations={60000001:'Example station'};
 const contracts=Array.from({length:22000},(_,i)=>({contract_id:i+1,issuer_id:1,assignee_id:2,start_location_id:60000001,type:'courier',status:'finished',date_issued:'2026-11-01T00:00:00Z'}));
 const pilots=[{id:1,name:'Main',updated:Date.now(),data:{contracts,names,locations}}],rows=mergeContracts(pilots);
 assert.equal(rows.length,22000);assert.equal(new Set(rows.map(r=>r.names)).size,1);assert.equal(rows[0].names,names);
 assert.equal(filterContracts(rows,{q:'Pilot 2999'}).length,0);assert.equal(filterContracts(rows,{q:'Example station'}).length,22000);
 const html=contractsView(pilots,{},0,true,{all:rows,rows});assert.equal((html.match(/<details>/g)||[]).length,50);assert.match(html,/of 22000/);
});
test('duplicate contracts retain merged party names and latest observed status',()=>{
 const a={id:1,name:'First',data:{names:{1:'One'},locations:{10:'Start'},contracts:[{contract_id:1,observed:1,status:'outstanding'}]}};
 const b={id:2,name:'Second',data:{names:{2:'Two'},locations:{20:'End'},contracts:[{contract_id:1,observed:2,status:'finished'}]}};
 const [r]=mergeContracts([a,b]);assert.equal(r.status,'finished');assert.deepEqual(r.names,{1:'One',2:'Two'});assert.deepEqual(r.locations,{10:'Start',20:'End'});assert.deepEqual(r.pilots,['First','Second']);
});
