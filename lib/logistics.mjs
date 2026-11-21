import {searchLogisticsLocations} from './logistics-locations.mjs';
import {isotopeEstimate} from '../public/logistics-pricing.mjs';
const fail=message=>Object.assign(Error(message),{status:400});
export const logisticsDefaults=()=>({locations:[],maxVolumes:{nullsec:350000,lowsec:350000,empire:350000},pricePerM3:0,collateralPerM3:0});
export function logisticsSettings(body){
 if(!body||typeof body!=='object')throw fail('Enter Logistics settings.');
 if(!Array.isArray(body.locations)||body.locations.length>100)throw fail('Add up to 100 locations.');
 const names=new Set(),locations=body.locations.map(row=>{
  if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.trim().length>160)throw fail('Enter a location name up to 160 characters.');
  const name=row.name.trim(),key=name.toLowerCase();if(names.has(key))throw fail('Each location must have a unique name.');names.add(key);
  if(typeof row.pickup!=='boolean'||typeof row.destination!=='boolean'||(!row.pickup&&!row.destination))throw fail('Choose pickup, destination or both for each location.');
  if(row.locationId!=null&&(!Number.isSafeInteger(row.locationId)||row.locationId<=0))throw fail('Location IDs must be positive numeric EVE station or structure IDs.');
  return {name,pickup:row.pickup,destination:row.destination,...(row.locationId?{locationId:row.locationId}:{})};
 });
 const maxVolumes={};for(const key of ['nullsec','lowsec','empire']){const value=body.maxVolumes?.[key];if(!Number.isFinite(value)||value<=0||value>1e12)throw fail('Enter a positive cargo limit for every space type.');maxVolumes[key]=value;}
 for(const key of ['pricePerM3','collateralPerM3'])if(!Number.isFinite(body[key])||body[key]<0||body[key]>1e12)throw fail('Enter valid non-negative ISK rates per m³.');
 const extra={};
 if(body.pricingMode!=null||body.routes!=null){
  if(!['volume','isotopes'].includes(body.pricingMode))throw fail('Choose volume or isotope pricing.');
  if(!Array.isArray(body.routes)||body.routes.length>250)throw fail('Add up to 250 directional routes.');
  const seen=new Set();extra.pricingMode=body.pricingMode;extra.routes=body.routes.map(r=>{
   if(!r||!locations.some(l=>l.name===r.from&&l.pickup)||!locations.some(l=>l.name===r.to&&l.destination)||r.from===r.to)throw fail('Choose different configured pickup and destination locations for each route.');
   const key=JSON.stringify([r.from,r.to]);if(seen.has(key))throw fail('Each directional route must be unique.');seen.add(key);
   if(!Number.isSafeInteger(r.isotopes)||r.isotopes<0||!Number.isFinite(r.isotopePrice)||r.isotopePrice<0||!Number.isSafeInteger(Math.ceil(r.isotopes*r.isotopePrice)))throw fail('Enter valid isotope quantities and prices.');
   return {from:r.from,to:r.to,isotopes:r.isotopes,isotopePrice:r.isotopePrice};
  });
 }
 return {locations,maxVolumes,pricePerM3:body.pricePerM3,collateralPerM3:body.collateralPerM3,...extra};
}
export function logisticsQuote(settings,body){
 const {space,volume}=body;
 if(!Object.hasOwn(settings.maxVolumes,space))throw fail('Choose 0.0, Lowsec or Empire.');
 const from=settings.locations.find(row=>row.pickup&&row.name===body.from),to=settings.locations.find(row=>row.destination&&row.name===body.to);
 if(!from||!to)throw fail('Choose an available pickup and destination.');
 if(from.name===to.name)throw fail('Pickup and destination must be different.');
 if(!Number.isFinite(volume)||volume<=0||volume>settings.maxVolumes[space])throw fail('Cargo exceeds the selected route limit or has an invalid volume.');
 const isotope=settings.pricingMode==='isotopes'?isotopeEstimate(settings,from.name,to.name):null;
 if(settings.pricingMode==='isotopes'&&!isotope)throw fail('No isotope cost is configured for this route.');
 const estimatedFee=isotope?isotope.fee:Math.ceil(volume*settings.pricePerM3),estimatedCollateral=Math.ceil(volume*settings.collateralPerM3);
 if(!Number.isSafeInteger(estimatedFee)||!Number.isSafeInteger(estimatedCollateral))throw fail('The calculated amount is too large.');
 return {space,estimatedFee,collateral:settings.collateralPerM3>0?estimatedCollateral:body.collateral,pricePerM3:settings.pricePerM3,collateralPerM3:settings.collateralPerM3,...(isotope?{pricingMode:'isotopes',isotopes:isotope.isotopes,isotopePrice:isotope.isotopePrice}:{})};
}
export function courierQueue(snapshot,corporation,now=Date.now(),{includeFinished=false}={}){
 const rows=(snapshot.contracts||[]).filter(row=>row.type==='courier'&&row.assignee_id===corporation&&(includeFinished?['outstanding','in_progress','finished']:['outstanding','in_progress']).includes(row.status)&&(row.status!=='outstanding'||!row.date_expired||Date.parse(row.date_expired)>now))
 .map(row=>({id:row.contract_id,fromId:row.start_location_id,toId:row.end_location_id,title:row.title||'Courier contract',status:row.status,issuer:snapshot.names?.[row.issuer_id]||'Pilot '+row.issuer_id,acceptor:row.acceptor_id?(snapshot.names?.[row.acceptor_id]||'Pilot '+row.acceptor_id):null,from:snapshot.locations?.[row.start_location_id]||'Location '+row.start_location_id,to:snapshot.locations?.[row.end_location_id]||'Location '+row.end_location_id,volume:row.volume,reward:row.reward,collateral:row.collateral,expires:row.status==='in_progress'&&row.date_accepted&&row.days_to_complete?new Date(Date.parse(row.date_accepted)+row.days_to_complete*86400000).toISOString():row.date_expired,retained:Boolean(row.retained)}))
 .sort((a,b)=>Number(a.status==='in_progress')-Number(b.status==='in_progress')||(Date.parse(a.expires)||Infinity)-(Date.parse(b.expires)||Infinity)||a.id-b.id);
 return {contracts:rows,updated:snapshot.updated||null,refreshing:Boolean(snapshot.refreshing),error:snapshot.error?'Corporation contracts could not refresh. Last available data is shown.':null};
}
export function logisticsRoutes(app,{db,available,isAdmin,canManage,contracts,corporation,enabled,structures}){
 db.exec("CREATE TABLE IF NOT EXISTS logistics_settings(id INTEGER PRIMARY KEY CHECK(id=1),settings TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS logistics_courier_jobs(contract_id INTEGER PRIMARY KEY,handler_id INTEGER REFERENCES users(id) ON DELETE SET NULL,handler_name TEXT,claimed INTEGER,completed INTEGER,completed_by TEXT)");
 const settings=()=>{const row=db.prepare('SELECT settings FROM logistics_settings WHERE id=1').get();return row?JSON.parse(row.settings):logisticsDefaults();};
 app.get('/api/logistics',(req,res)=>{if(!available(req,'logistics'))return res.sendStatus(403);res.json({settings:settings(),admin:isAdmin(req),reviewer:canManage(req,'logistics')});});
 app.get('/api/logistics/locations',(req,res)=>{
  if(!available(req,'logistics')||!isAdmin(req))return res.sendStatus(403);
  const q=req.query.q;if(typeof q!=='string'||q.trim().length<2||q.length>100)throw fail('Enter 2–100 characters to find a station or structure.');
  const state=structures(),cached=db.prepare("SELECT data FROM public_cache WHERE path='/tools/corp-data/contracts'").get();
  const known=cached?JSON.parse(cached.data):{};
  res.json({...searchLogisticsLocations(q,{structures:state.structures,locations:known.locations,saved:settings().locations}),structuresUpdated:state.updated});
 });
 app.get('/api/logistics/settings',(req,res)=>{if(!available(req,'logistics')||!isAdmin(req))return res.sendStatus(403);res.json({settings:settings()});});
 app.post('/api/logistics/settings',(req,res)=>{if(!available(req,'logistics')||!isAdmin(req))return res.sendStatus(403);const value=logisticsSettings(req.body);db.prepare('INSERT INTO logistics_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings').run(JSON.stringify(value));res.json({ok:true});});
 async function queue(user){
  const snapshot=await contracts(),result=courierQueue(snapshot,corporation,Date.now(),{includeFinished:true});
  const jobs=new Map(db.prepare('SELECT * FROM logistics_courier_jobs').all().map(r=>[r.contract_id,r])),config=settings();
  result.contracts=result.contracts.filter(r=>r.status!=='finished'||jobs.has(r.id)).map(row=>{
   const job=jobs.get(row.id),done=Boolean(job?.completed)||row.status==='finished';
   const from=config.locations.find(l=>l.locationId?l.locationId===row.fromId:l.name.toLowerCase()===row.from.toLowerCase()),to=config.locations.find(l=>l.locationId?l.locationId===row.toId:l.name.toLowerCase()===row.to.toLowerCase()),cost=config.pricingMode==='isotopes'&&from&&to?isotopeEstimate(config,from.name,to.name):null;
   return {...row,...(cost?{expectedReward:cost.fee}:{}),claimedBy:(job?.handler_id||job?.completed)?job.handler_name:null,mine:job?.handler_id===user,claimedAt:job?.claimed||null,completedAt:job?.completed||null,completedBy:job?.completed_by||null,verified:row.status==='finished',workflowStatus:done?'completed':job?.handler_id?'claimed':'pending'};
  });return result;
 }
 app.get('/api/logistics/pending',async(req,res)=>{if(!available(req,'logistics')||!canManage(req,'logistics'))return res.sendStatus(403);res.json(await queue(req.session.user_id));});
 app.post('/api/logistics/couriers/:id',async(req,res)=>{
  if(!available(req,'logistics')||!canManage(req,'logistics'))return res.sendStatus(403);
  const id=Number(req.params.id),user=req.session.user_id,action=req.body.action;
  if(!Number.isSafeInteger(id)||id<=0)throw fail('Choose a valid courier contract.');
  const row=(await queue(user)).contracts.find(r=>r.id===id);if(!row)return res.sendStatus(404);
  if(row.workflowStatus==='completed')throw Object.assign(Error('This courier is already completed.'),{status:409});
  if(action==='claim'){
   const changed=db.prepare('INSERT INTO logistics_courier_jobs(contract_id,handler_id,handler_name,claimed) VALUES(?,?,?,?) ON CONFLICT(contract_id) DO UPDATE SET handler_id=excluded.handler_id,handler_name=excluded.handler_name,claimed=excluded.claimed WHERE logistics_courier_jobs.handler_id IS NULL AND logistics_courier_jobs.completed IS NULL').run(id,user,req.session.name,Date.now());
   if(!changed.changes&&!row.mine)throw Object.assign(Error('Another hauler has already claimed this courier.'),{status:409});
  }else if(action==='release'||action==='complete'){
   if(!row.mine)throw Object.assign(Error('Only the assigned hauler can update this courier.'),{status:409});
   const changed=action==='release'?db.prepare('UPDATE logistics_courier_jobs SET handler_id=NULL,handler_name=NULL,claimed=NULL WHERE contract_id=? AND handler_id=? AND completed IS NULL').run(id,user):db.prepare('UPDATE logistics_courier_jobs SET completed=?,completed_by=? WHERE contract_id=? AND handler_id=? AND completed IS NULL').run(Date.now(),req.session.name,id,user);
   if(!changed.changes)throw Object.assign(Error('This courier changed. Refresh the queue.'),{status:409});
  }else throw fail('Choose claim, release or complete.');
  res.json({ok:true});
 });
 return {settings,tick:async()=>{if(enabled())await contracts();}};
}
