import {searchLogisticsLocations} from '../lib/logistics-locations.mjs';
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

test('directional isotope pricing charges only fuel and never scales with cargo volume',()=>{
 const s={...logisticsDefaults(),pricingMode:'isotopes',locations:[{name:'A',pickup:true,destination:true,locationId:1},{name:'B',pickup:true,destination:true,locationId:2}],routes:[{from:'A',to:'B',isotopes:1000,isotopePrice:543.21}]};
 assert.equal(logisticsSettings(s).routes.length,1);
 for(const volume of [1,350000])assert.equal(logisticsQuote(s,{from:'A',to:'B',space:'nullsec',volume,collateral:0}).estimatedFee,543210);
 assert.throws(()=>logisticsQuote(s,{from:'B',to:'A',space:'nullsec',volume:1,collateral:0}),/No isotope cost/);
 assert.throws(()=>logisticsSettings({...s,routes:[...s.routes,...s.routes]}),/unique/);
 assert.throws(()=>logisticsSettings({...s,routes:[{...s.routes[0],isotopes:-1}]}));
});

test('location search returns NPC IDs and aliases, deduplicates known structures and excludes non-dockable assets',()=>{
 const found=searchLogisticsLocations('jita 4-4');assert.ok(found.results.some(r=>r.id===60003760&&r.name==='Jita IV - Moon 4 - Caldari Navy Assembly Plant'));
 const input={npcStations:[],structures:[{id:1000000000001,name:'Example - Dock',system:'Example',kind:'Structure',type_name:'Keepstar'},{id:1000000000002,name:'Example Moon Drill',kind:'Moon Drill'}],locations:{1000000000001:'Older name',2004:'Asset Safety',30000142:'A system'}};
 assert.equal(searchLogisticsLocations('Example',input).total,1);assert.equal(searchLogisticsLocations('Older',input).results[0].id,1000000000001);assert.equal(searchLogisticsLocations('1000000000001',input).results.length,1);assert.equal(searchLogisticsLocations('Moon Drill',input).total,0);
});
