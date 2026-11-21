import test from 'node:test';
import assert from 'node:assert/strict';
import {corpPages,csv,expiry,marketOrders,filterMembers,structureReasons,fuelPlan,bestBlueprints,validateDates} from '../public/corp-workspace-model.mjs';
import {corporationWorkspace} from '../public/corp-workspace.mjs';
import {batchMaterialPlan} from '../lib/industry-materials.mjs';
import recipes from '../lib/manufacturing-recipes.json' with {type:'json'};
const now=Date.UTC(2026,10,11);
test('member filters keep unknown activity separate from inactivity',()=>{
 const rows=[{id:1,name:'Old',last_active:'2026-01-01',signed_up:true},{id:2,name:'Unknown'},{id:3,name:'Recent',last_active:new Date(now-1000).toISOString()}];
 assert.deepEqual(filterMembers(rows,{activity:'30'},now).map(r=>r.id),[1]);
 assert.deepEqual(filterMembers(rows,{activity:'unknown'},now).map(r=>r.id),[2]);
});
test('market expiration filters exclude closed orders and CSV protects formulas',()=>{
 const a={issued:new Date(now-86400000).toISOString(),duration:2,status:'active',price:2,volume_remain:3};
 const d={active:[a,{...a,duration:null}],history:[{...a,status:'expired'}]};
 assert.equal(expiry(a),now+86400000);
 assert.equal(marketOrders(d,{expiry:'1',history:true},now).length,1);
 assert.match(csv([['=HYPERLINK("evil")',-3]]),/"'=HYPERLINK/);
 assert.throws(()=>validateDates({from:'2026-02-30'}),/valid dates/);
 assert.throws(()=>validateDates({from:'2026-12-01',to:'2026-01-01'}),/start date/);
});
test('fuel planning groups fuel types and leaves unknown rates out',()=>{
 const s={name:'Citadel',fuel:10,rate:1,inventory_at:now,fuels:[{type_id:1,name:'Oxygen Fuel Block'}]};
 const plan=fuelPlan([s,{...s,name:'Unknown',rate:null}],1,now);
 assert.deepEqual(plan.items,[{name:'Oxygen Fuel Block',quantity:14}]);
 assert.equal(plan.unknown.length,1);
 assert.ok(structureReasons(s,now).includes('Fuel under 7 days'));
 assert.equal(bestBlueprints([{type_id:1,selection:'copy',copy:true,material_efficiency:10},{type_id:1,selection:'original',copy:false,material_efficiency:5}]).has('original'),true);
});
test('combined material planning rounds per job and counts inventory only once',()=>{
 const [id,recipe]=Object.entries(recipes.blueprints).find(([,r])=>r.materials.length);
 const bp={item_id:1,type_id:Number(id),quantity:-1,material_efficiency:0};
 const material=recipe.materials[0],required=material.quantity*2,cat={type:id=>({name:'Type '+id})};
 const plan=batchMaterialPlan([bp],[{type_id:material.typeID,quantity:required-1}],[{blueprint:'1',runs:1},{blueprint:'1',runs:1}],{facility:0,rig:0},cat);
 assert.equal(plan.materials.find(m=>m.id===material.typeID).missing,1);
 assert.throws(()=>batchMaterialPlan([{...bp,quantity:-2,runs:1}],[],[{blueprint:'1',runs:1},{blueprint:'1',runs:1}],{facility:0,rig:0},cat),/Combined runs/);
});
test('every corporation workspace renders representative saved data without exposing HTML in names',async t=>{
 const doc=globalThis.document,storage=globalThis.localStorage;
 globalThis.document={addEventListener(){}};
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 t.after(()=>{globalThis.document=doc;globalThis.localStorage=storage;});
 const name='<script>bad()</script>',date=new Date(now).toISOString(),base={updated:now,error:null};
 const structure={id:1,name,kind:'Moon Drill',type_name:'Metenox',system:'Example',region:'Region',mining:'online',state:'shield_vulnerable',fuel:100,gas:200,rate:5,gas_rate:200,inventory_at:now,services:[],fuels:[{type_id:1,name:'Oxygen Fuel Block'}],materials:[{name:'Chromium',quantity:10,value:100}],history:[]};
 const data={
  overview:{corporation:{name,ticker:'EX',member_count:1,tax_rate:.1},attention:{rows:[],coverage:[]}},
  members:{...base,rows:[{id:1,name,last_active:date,signed_up:true}]},
  pilots:{...base,rows:[{id:1,name,titles:[],rights:{all:true,assigned:{roles:['Director']},grantable:{},access:[]}}]},
  wallet:{...base,rows:[{division:1,name,balance:3,journal:[{id:1,date,amount:2,ref_type:'player_donation'}],transactions:[]}],names:{}},
  contracts:{...base,contracts:[{contract_id:1,title:name,type:'item_exchange',status:'outstanding',issued:date,date_issued:date,date_expired:date,items:[]}],names:{},locations:{}},
  market:{...base,active:[{name,order_id:1,issued:date,duration:90,price:1,volume_remain:1,volume_total:1,status:'active'}],locations:{}},
  assets:{...base,total:1,locationCount:1,regions:[],locations:[{name,items:[{item_id:1,name,quantity:1,location:'Example'}]}]},
  'pilot-assets':{rows:[{name,type:name,character:name,account:1,location:'Example',quantity:1}],total:1,sources:[]},
  standings:{...base,rows:[{name,from_type:'faction',standing:2}]},
  industry:{...base,rows:[{name,job_id:1,installer:'Pilot',location:'Station',activity_id:1,status:'active',end_date:date,runs:1}]},
  structures:{...base,structures:[structure]},
  harvest:{...base,structures:[structure],refineries:[],income:[],extractions:{rows:[]}}
 };
 const workspace=corporationWorkspace({api:async path=>{
  const key=path.split('/').at(-1).split('?')[0];assert.ok(data[key],path);return data[key];
 },intro:(name,note)=>'<section class="intro"><h1>'+name+'</h1><p>'+note+'</p></section>',context:()=>({me:{main_id:1}}),refresh:async()=>{},toast:()=>{}});
 for(const page of corpPages){
  const html=await workspace.render(page);
  assert.match(html,/corp-workspace/,page);
  assert.doesNotMatch(html,/<script>/,page);
 }
});
