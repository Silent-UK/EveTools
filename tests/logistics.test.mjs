import {test} from 'node:test';
import assert from 'node:assert/strict';
import {logisticsDefaults,logisticsSettings,logisticsQuote,courierQueue} from '../lib/logistics.mjs';
test('Logistics validates direction, limits and calculates whole-ISK estimates without trusting posted rates',()=>{
 const s=logisticsDefaults();assert.deepEqual(Object.values(s.maxVolumes),[350000,350000,350000]);
 s.locations=[{name:'A',pickup:true,destination:false},{name:'B',pickup:false,destination:true}];s.pricePerM3=2.1;s.collateralPerM3=10;
 assert.deepEqual(logisticsSettings(s),s);
 const body={from:'A',to:'B',space:'empire',volume:1.5,collateral:0,pricePerM3:0};
 assert.equal(logisticsQuote(s,body).estimatedFee,4);assert.equal(logisticsQuote(s,body).collateral,15);
 for(const patch of [{from:'B',to:'A'},{space:'unknown'},{volume:350001},{volume:NaN},{volume:0}])assert.throws(()=>logisticsQuote(s,{...body,...patch}));
 assert.throws(()=>logisticsSettings({...s,locations:[...s.locations,{name:' a ',pickup:true,destination:true}]}));
 assert.throws(()=>logisticsSettings({...s,maxVolumes:{...s.maxVolumes,lowsec:-1}}));
 assert.throws(()=>logisticsSettings({...s,pricePerM3:-1}));
});
test('Courier queue excludes expired offers, outbound, finished and unrelated contracts and retains sync warnings',()=>{
 const base={type:'courier',assignee_id:99,status:'outstanding',date_expired:'2099-01-01'};
 const p=courierQueue({updated:100,error:'secret details',contracts:[{...base,contract_id:1},{...base,contract_id:2,status:'in_progress',date_accepted:'2026-01-01T00:00:00Z',days_to_complete:3},{...base,contract_id:3,date_expired:'2000-01-01'},{...base,contract_id:4,status:'finished'},{...base,contract_id:5,assignee_id:100}]},99);
 assert.deepEqual(p.contracts.map(r=>r.id),[1,2]);assert.equal(p.contracts[1].expires,'2026-01-04T00:00:00.000Z');assert.ok(!p.error.includes('secret'));
});
