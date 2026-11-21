// Saved stock and future production are kept separate: collection history cannot
// prove current contents between inventory snapshots.
export function moonGooSummary(structures,regions){
 const outputs=new Map(regions.flatMap(r=>r.drills.map(d=>[d.id,d]))),materials=new Map();
 let inventory=0,stockValued=0,harvesting=0,productionKnown=0,productionValued=0,partial=0,oldest=null;
 const row=m=>{const key=m.type_id||m.name;if(!materials.has(key))materials.set(key,{name:m.name,typeId:Number(m.type_id),stock:0,monthly:0,stockValue:0,monthlyValue:0,stockUnpriced:false,productionUnpriced:false,stockPriced:0,productionPriced:0});return materials.get(key);};
 for(const s of structures){
  if(Number.isFinite(s.inventory_at)&&s.inventory_at>0&&Array.isArray(s.materials)){
   inventory++;oldest=oldest==null?s.inventory_at:Math.min(oldest,s.inventory_at);
   if(s.materials.every(m=>Number.isFinite(m.value)))stockValued++;
   for(const m of s.materials){const r=row(m);r.stock+=m.quantity;r.stockValue+=m.value??0;if(Number.isFinite(m.value))r.stockPriced++;if(!Number.isFinite(m.value))r.stockUnpriced=true;}
  }
  if(s.mining!=='online')continue;harvesting++;
  const d=outputs.get(s.id);if(!d?.products?.length)continue;
  productionKnown++;if(d.monthly!=null)productionValued++;if(d.partial)partial++;
  for(const m of d.products){const r=row(m);r.monthly+=m.quantity;r.monthlyValue+=m.value??0;if(Number.isFinite(m.value))r.productionPriced++;if(!Number.isFinite(m.value))r.productionUnpriced=true;}
 }
 const rows=[...materials.values()].map(row=>({...row,totalValue:row.stockPriced||row.productionPriced?row.stockValue+row.monthlyValue:null}));
 rows.sort((a,b)=>(b.totalValue??-1)-(a.totalValue??-1)||a.name.localeCompare(b.name));
 return {rows,total:structures.length,inventory,stockValued,harvesting,productionKnown,productionValued,partial,oldest,
  stock:inventory&&(stockValued||rows.some(r=>r.stockPriced))?rows.reduce((n,r)=>n+r.stockValue,0):null,
  monthly:!harvesting?0:productionKnown&&rows.some(r=>r.productionPriced)?rows.reduce((n,r)=>n+r.monthlyValue,0):null};
}
export function moonGooView(structures,regions,{esc,num}){
 const total=moonGooSummary(structures,regions),isk=n=>n==null?'Unavailable':num(n)+' ISK';
 const values=s=>`<td>${isk(s.stock)}</td><td>${isk(s.monthly==null?null:s.monthly*7/30)}</td><td>${isk(s.monthly)}</td>`;
 const price=(value,missing,priced)=>missing&&!priced?'Unavailable':num(value)+(missing?' · partial':'');
 const material=r=>`<span class="moon-goo-material">${Number.isSafeInteger(r.typeId)&&r.typeId>0?`<img src="https://images.evetech.net/types/${r.typeId}/icon?size=32" width="18" height="18" loading="lazy" alt="">`:''}${esc(r.name)}</span>`;
 const breakdown=s=>`<div class="cw-scroll"><table><thead><tr><th>Material</th><th>In drills · units</th><th>Stock value · ISK</th><th>Next 7d · units</th><th>7d value · ISK</th><th>Next 30d · units</th><th>30d value · ISK</th><th title="Saved stock plus projected 30-day production">Total value · ISK ↓</th></tr></thead><tbody>${s.rows.map(r=>`<tr><td>${material(r)}</td><td>${s.inventory?num(r.stock):'Unavailable'}</td><td>${s.inventory?price(r.stockValue,r.stockUnpriced,r.stockPriced):'Unavailable'}</td><td>${s.harvesting&&!s.productionKnown?'Unavailable':num(r.monthly*7/30)}</td><td>${price(r.monthlyValue*7/30,r.productionUnpriced,r.productionPriced)}</td><td>${s.harvesting&&!s.productionKnown?'Unavailable':num(r.monthly)}</td><td>${price(r.monthlyValue,r.productionUnpriced,r.productionPriced)}</td><td><strong>${r.totalValue===null?'Unavailable':price(r.totalValue,r.stockUnpriced||r.productionUnpriced||s.inventory<s.total||s.productionKnown<s.harvesting||s.partial>0,true)}</strong></td></tr>`).join('')}</tbody></table></div>`;
 const coverage=s=>`${s.inventory}/${s.total} drill inventories · ${s.stockValued}/${s.total} stock fully valued · ${s.productionValued}/${s.harvesting} harvesting drills valued${s.partial?' · '+s.partial+' partial surveys':''}`;
 const since=s=>s.oldest?'Oldest inventory: '+new Date(s.oldest).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC.':'No saved inventory available.';
 const regional=regions.map(region=>{const ids=new Set(region.drills.map(d=>d.id));return {name:region.name,summary:moonGooSummary(structures.filter(d=>ids.has(d.id)),[region])};});
 return `<section class="panel compact moon-goo"><h2>Moon Goo Estimates</h2><div class="cw-stats"><div><small>Goo in drills · saved stock</small><strong>${isk(total.stock)}</strong></div><div><small>Estimated next 7 days</small><strong>${isk(total.monthly==null?null:total.monthly*7/30)}</strong></div><div><small>Estimated next 30 days</small><strong>${isk(total.monthly)}</strong></div></div><details><summary>Material breakdown · stock / 7 days / 30 days</summary>${breakdown(total)}</details><small>${esc(coverage(total))}. ${esc(since(total))}</small><small>Filtered drills only. Stock is the last recorded inventory, not a live balance. Forecasts are additional gross production at ESI average prices, assuming continuous harvesting from drills last reported online; fuel, gas, fees and tax are excluded. Missing prices or surveys make values known subtotals. No stock is added to forecasts.</small><div class="cw-scroll"><table><thead><tr><th>Region</th><th>Goo in drills</th><th>Next 7 days</th><th>Next 30 days</th></tr></thead><tbody>${regional.map(r=>`<tr><td>${esc(r.name)}</td>${values(r.summary)}</tr>`).join('')}</tbody></table></div><details><summary>Materials by region</summary>${regional.map(r=>`<details><summary>${esc(r.name)}</summary><small>${esc(coverage(r.summary))}. ${esc(since(r.summary))}</small>${breakdown(r.summary)}</details>`).join('')}</details>${structures.length?'':'<p>No drills match these filters.</p>'}</section>`;
}
