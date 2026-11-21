import test from 'node:test';
import assert from 'node:assert/strict';
import {moonGooSummary,moonGooView} from '../public/moon-goo-view.mjs';
import {moonIncome} from '../lib/moon-income.mjs';

const material={type_id:1,name:'Chromium',quantity:10,value:20};
const drill=(id,mining='online')=>({id,mining,inventory_at:1000,materials:[material]});
const regions=[{name:'<Region>',drills:[{id:1,monthly:14400,products:[{...material,quantity:7200,value:14400}]},{id:2,monthly:14400,products:[{...material,quantity:7200,value:14400}]}]}];
test('moon goo separates saved stock from future output and excludes offline production',()=>{
 const s=moonGooSummary([drill(1),drill(2,'offline')],regions);
 assert.equal(s.stock,40);assert.equal(s.monthly,14400);assert.equal(s.monthly*7/30,3360);
 assert.equal(s.rows[0].stock,20);assert.equal(s.rows[0].monthly,7200);assert.equal(s.harvesting,1);
 const filtered=moonGooSummary([drill(2,'offline')],regions);assert.equal(filtered.stock,20);assert.equal(filtered.monthly,0);
});
test('unknown inventories and missing prices stay unavailable while known subtotals survive',()=>{
 assert.equal(moonGooSummary([{id:1,mining:'online'}],[]).stock,null);
 assert.equal(moonGooSummary([{id:1,mining:'online'}],[]).monthly,null);
 const unknown={...drill(1),materials:[{...material,value:null}]},noPrices=[{name:'X',drills:[{id:1,monthly:null,products:[{...material,value:null}]}]}];
 assert.equal(moonGooSummary([unknown],noPrices).stock,null);assert.equal(moonGooSummary([unknown],noPrices).monthly,null);
 assert.equal(moonGooSummary([unknown,drill(2,'offline')],noPrices).stock,20);
 const html=moonGooView([unknown],noPrices,{esc:s=>String(s),num:String});assert.match(html,/Unavailable/);assert.doesNotMatch(html,/NaN/);
});
test('recorded production exposes material quantities even when market prices are missing',()=>{
 const survey={key:'X|1|1',moon_id:10,name:'X I - Moon 1',ores:[],drill_observation:{cycle_seconds:3600,products:[{name:'Chromium',units_per_cycle:10}]}};
 const [r]=moonIncome([{...drill(1),moon_id:10,kind:'Moon Drill',system:'X'}],{rows:[survey]}, {metenox:{},athanor:{}},[],{named:()=>1});
 assert.equal(r.drills[0].products[0].quantity,7200);assert.equal(r.drills[0].products[0].value,null);
});
test('goo view escapes regional names and labels snapshots and forecast assumptions',()=>{
 const html=moonGooView([drill(1)],regions,{esc:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),num:String});
 assert.ok(html.includes('&lt;Region&gt;'));assert.ok(!html.includes('<Region>'));assert.match(html,/last recorded inventory/);assert.match(html,/Estimated next 7 days/);
});
test('material icons and ranking use stock plus thirty-day value',()=>{
 const stockOnly={type_id:2,name:'Stock-heavy',quantity:1,value:20000};
 const drills=[{...drill(1),materials:[material,stockOnly]}];
 const summary=moonGooSummary(drills,regions);
 assert.deepEqual(summary.rows.map(row=>[row.name,row.totalValue]),[['Stock-heavy',20000],['Chromium',14420]]);
 const html=moonGooView(drills,regions,{esc:String,num:String});
 assert.match(html,/\/types\/2\/icon\?size=32/);
 assert.match(html,/Total value · ISK/);
});
