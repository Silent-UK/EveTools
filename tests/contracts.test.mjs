import test from 'node:test';
import assert from 'node:assert/strict';
import {collectContracts} from '../lib/contracts.mjs';
import {contractRows,contractsView} from '../public/contracts-view.mjs';
test('refreshes active contracts first, reuses finished details and backs off the remaining batch on 429',async()=>{
 const c={id:1,scopes:'["esi-contracts.read_character_contracts.v1"]'},calls=[];
 const rows=[{contract_id:1,status:'finished'},{contract_id:2,status:'finished'},{contract_id:3,status:'outstanding'},{contract_id:4,status:'finished'}];
 const items=[{type_id:34,quantity:100}];
 const result=await collectContracts(c,{request:async path=>{
  if(path.includes('?page='))return {pages:1,data:rows};
  calls.push(path);
  throw Object.assign(Error('ESI unavailable'),{status:429});
 }},{},{contracts:[{...rows[0],items},{...rows[2],items}]});
 const byId=new Map(result.contracts.map(row=>[row.contract_id,row]));
 assert.deepEqual(calls,['/characters/1/contracts/2/items']);
 assert.deepEqual(byId.get(1).items,items);
 assert.equal(byId.get(1).items_error,undefined);
 assert.deepEqual(byId.get(3).items,items);
 assert.match(byId.get(2).items_error,/unavailable/);
 assert.match(byId.get(4).items_error,/retry/);
});
test('contracts paginate, retain older entries and keep item failures visible',async()=>{
 const c={id:1,scopes:'["esi-contracts.read_character_contracts.v1"]'};
 const eve={request:async path=>path.includes('?page=')?{pages:2,data:[{contract_id:path.endsWith('1')?1:2,type:'item_exchange'}]}:Promise.reject(Error('unavailable'))};
 const result=await collectContracts(c,eve,{}, {contracts:[{contract_id:3,status:'outstanding'}]});assert.equal(result.contracts.length,3);assert(result.contracts.find(r=>r.contract_id===3).retained);assert(result.contracts[1].items_error);
 await assert.rejects(collectContracts(c,{request:async()=>({pages:0,data:[]})},{}),/Incomplete/);
});
test('contracts deduplicate pilots, filter and escape contract titles',()=>{
 const row={contract_id:1,type:'courier',status:'outstanding',title:'<Test>',observed:1};
 const pilots=['A','B'].map(name=>({name,data:{contracts:[row]}}));assert.equal(contractRows(pilots).length,1);assert.equal(contractRows(pilots)[0].pilots.length,2);assert.equal(contractRows(pilots,{status:'finished'}).length,0);assert(contractsView(pilots).includes('&lt;Test&gt;'));
});


test('outstanding contracts lead the list before pagination, newest first within status',()=>{
 const rows=[{contract_id:1,status:'finished',date_issued:'2026-11-01'},{contract_id:2,status:'outstanding',date_issued:'2026-10-01'},{contract_id:3,status:'outstanding',date_issued:'2026-10-20'}];
 const pilots=[{name:'Pilot',data:{contracts:rows}}];
 assert.deepEqual(contractRows(pilots).map(r=>r.contract_id),[3,2,1]);
 assert.deepEqual(contractRows(pilots,{status:'finished'}).map(r=>r.contract_id),[1]);
});

test('contract detail work is bounded, repeated errors stop the batch, and failures wait 24 hours',async()=>{
 const c={id:1,scopes:'["esi-contracts.read_character_contracts.v1"]'},rows=Array.from({length:200},(_,i)=>({contract_id:i+1,status:'outstanding',type:'item_exchange'}));
 let calls=0;
 const eve={request:async path=>path.includes('?page=')?{pages:1,data:rows}:(calls++,{data:[]})};
 const first=await collectContracts(c,eve,{type:()=>null});assert.equal(calls,40);assert.equal(first.contracts.length,200);
 calls=0;eve.request=async path=>{if(path.includes('?page='))return {pages:1,data:rows};calls++;throw Object.assign(Error('ESI error'),{status:520});};
 const failed=await collectContracts(c,eve,{},null);assert.equal(calls,3);assert.ok(failed.contracts[0].items_retry_at>Date.now());
 calls=0;await collectContracts(c,eve,{},failed);assert.equal(calls,3); // skips the first failed IDs, progresses to new IDs
 const single={...failed,contracts:failed.contracts.slice(0,3)};eve.request=async path=>{if(path.includes('?page='))return {pages:1,data:rows.slice(0,3)};throw Error('Should not retry deferred details');};
 await collectContracts(c,eve,{},single);
});

test('saved contract locations and immutable item lists require no enrichment requests',async()=>{
 const c={id:1,scopes:'["esi-contracts.read_character_contracts.v1"]'},row={contract_id:1,status:'outstanding',start_location_id:60000001,items:[]};
 const d=await collectContracts(c,{request:async path=>{assert.ok(path.includes('?page='));return {pages:1,data:[row]};}}, {},{contracts:[row],locations:{60000001:'Saved station'}});
 assert.equal(d.locations[60000001],'Saved station');assert.deepEqual(d.contracts[0].items,[]);
});

test('contract list is published before slow optional item enrichment finishes',async()=>{
 let finish,published;const slow=new Promise(resolve=>finish=resolve),row={contract_id:1,status:'outstanding'};
 const job=collectContracts({id:1,scopes:'["esi-contracts.read_character_contracts.v1"]'},{request:async path=>path.includes('?page=')?{pages:1,data:[row]}:slow},{type:()=>null},{contracts:[{...row,retained:true}]},{onList:data=>published=data});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(published.contracts[0].contract_id,1);assert.equal(published.contracts[0].retained,false);
 finish({data:[]});await job;
});
