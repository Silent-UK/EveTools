export const DAY=86400000;
export const corpPages=['overview','members','pilots','wallet','contracts','assets','search-pilots','standings','market','industry','structures','moons'].map(p=>'corp-'+p);
export function csv(rows){return '\uFEFF'+rows.map(row=>row.map(v=>{let s=String(v??'');if(typeof v==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
export const matches=(q,...values)=>!q||values.flat(Infinity).filter(v=>v!=null).join(' ').toLowerCase().includes(String(q).trim().toLowerCase());
export function inDates(value,filters){const at=Date.parse(value);return (!filters.from||at>=Date.parse(filters.from))&&(!filters.to||at<Date.parse(filters.to)+DAY);}
export function validateDates(f){for(const key of ['from','to'])if(f[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(f[key])||!Number.isFinite(Date.parse(f[key]))||new Date(f[key]).toISOString().slice(0,10)!==f[key]))throw Error('Choose valid dates.');if(f.from&&f.to&&f.from>f.to)throw Error('The start date must be before the end date.');}
export function expiry(order){const issued=Date.parse(order.issued),duration=order.duration;return Number.isFinite(issued)&&Number.isSafeInteger(duration)&&duration>0?issued+duration*DAY:null;}
export function memberBand(row,now=Date.now()){const at=Date.parse(row.last_active);return !Number.isFinite(at)?'unknown':now-at>=90*DAY?'90':now-at>=30*DAY?'30':now-at>=7*DAY?'7':'recent';}
export function filterMembers(rows,f={},now=Date.now()){
 const rank={unknown:4,90:3,30:2,7:1,recent:0};
 return rows.filter(r=>matches(f.q,r.name,r.account_main_name,r.ship,r.location)&&(!f.registration||(f.registration==='yes')===!!r.signed_up)&&(!f.activity||(f.activity==='unknown'?memberBand(r,now)==='unknown':f.activity==='recent'?memberBand(r,now)==='recent':Number.isFinite(Date.parse(r.last_active))&&now-Date.parse(r.last_active)>=Number(f.activity)*DAY)))
 .sort((a,b)=>f.sort==='name'?a.name.localeCompare(b.name):f.sort==='inactive'?rank[memberBand(b,now)]-rank[memberBand(a,now)]||String(a.last_active||'').localeCompare(String(b.last_active||'')):String(b.last_active||'').localeCompare(String(a.last_active||'')));
}
export function marketOrders(data,f={},now=Date.now()){
 return [...(data.active||[]),...(f.history?data.history||[]:[])].filter(r=>matches(f.q,r.name,data.locations?.[r.location_id],r.order_id)&&(!f.side||(f.side==='buy')===!!r.is_buy_order)&&(!f.state||r.status===f.state)&&inDates(r.issued,f)&&(!f.expiry||(r.status==='active'&&expiry(r)!=null&&expiry(r)>now&&expiry(r)-now<=Number(f.expiry)*DAY)))
 .sort((a,b)=>f.sort==='expiry'?(expiry(a)??Infinity)-(expiry(b)??Infinity):f.sort==='value'?b.price*b.volume_remain-a.price*a.volume_remain:String(b.issued).localeCompare(String(a.issued)));
}
export function stockAt(s,kind='fuel',now=Date.now()){
 const stock=s[kind],rate=kind==='gas'?s.gas_rate:s.rate;
 return Number.isFinite(stock)?Number.isFinite(rate)&&Number.isFinite(s.inventory_at)?Math.max(0,stock-rate*Math.max(0,now-s.inventory_at)/3600000):stock:null;
}
export function runway(s,kind='fuel',now=Date.now()){
 const reportedExpiry=kind==='fuel'&&s.kind==='Structure'?Date.parse(s.fuel_expires):NaN;
 if(Number.isFinite(reportedExpiry))return Math.max(0,(reportedExpiry-now)/DAY);
 const stock=stockAt(s,kind,now),rate=kind==='gas'?s.gas_rate:s.rate;return stock==null||!Number.isFinite(rate)||rate<=0?null:stock/rate/24;}
export function structureReasons(s,now=Date.now()){
 const reasons=[];if(/reinforc/i.test(s.state||''))reasons.push('Reinforced');
 if(s.kind==='Moon Drill'&&s.mining==='offline')reasons.push('Not harvesting');
 if(/offline|unanchoring/i.test(s.state||'')||(s.services||[]).some(v=>v.state==='offline'))reasons.push('Offline service / structure');
 for(const kind of ['fuel',...(s.kind==='Moon Drill'?['gas']:[])]){const days=runway(s,kind,now);if(days!=null&&days<=7)reasons.push((kind==='gas'?'Gas':'Fuel')+(days<=0?' depleted':' under 7 days'));}
 return reasons;
}
export function fuelPlan(structures,days,now=Date.now()){
 const groups=new Map(),unknown=[];
 for(const s of structures)for(const kind of ['fuel',...(s.kind==='Moon Drill'?['gas']:[])]){
  const rate=kind==='gas'?s.gas_rate:s.rate,stock=stockAt(s,kind,now);
  if(!Number.isFinite(rate)||stock==null){unknown.push(s.name+' · '+kind);continue;}
  const item=kind==='gas'?'Magmatic Gas':s.fuel_type_name||s.fuels?.find(v=>v.type_id&&v.name?.includes('Fuel Block'))?.name||s.fuel_type?.name;
  if(!item){unknown.push(s.name+' · fuel block type');continue;}
  const need=Math.max(0,Math.ceil(rate*days*24-stock));if(need)groups.set(item,(groups.get(item)||0)+need);
 }
 return {items:[...groups].map(([name,quantity])=>({name,quantity})),unknown};
}
export function transferRow(row){return ['player_donation','corporation_account_withdrawal','corporation_payment'].includes(row.ref_type);}
export function bestBlueprints(rows){
 const best=new Map();for(const r of rows){const old=best.get(r.type_id);if(!old||Number(old.copy)-Number(r.copy)>0||old.copy===r.copy&&((r.material_efficiency??-1)>(old.material_efficiency??-1)||r.material_efficiency===old.material_efficiency&&(r.time_efficiency??-1)>(old.time_efficiency??-1)))best.set(r.type_id,r);}
 return new Set([...best.values()].map(r=>r.selection));
}
