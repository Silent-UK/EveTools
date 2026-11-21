const fail=message=>Object.assign(Error(message),{status:400});
export const logisticsDefaults=()=>({locations:[],maxVolumes:{nullsec:350000,lowsec:350000,empire:350000},pricePerM3:0,collateralPerM3:0});
export function logisticsSettings(body){
 if(!body||typeof body!=='object')throw fail('Enter Logistics settings.');
 if(!Array.isArray(body.locations)||body.locations.length>100)throw fail('Add up to 100 locations.');
 const names=new Set(),locations=body.locations.map(row=>{
  if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.trim().length>160)throw fail('Enter a location name up to 160 characters.');
  const name=row.name.trim(),key=name.toLowerCase();if(names.has(key))throw fail('Each location must have a unique name.');names.add(key);
  if(typeof row.pickup!=='boolean'||typeof row.destination!=='boolean'||(!row.pickup&&!row.destination))throw fail('Choose pickup, destination or both for each location.');
  return {name,pickup:row.pickup,destination:row.destination};
 });
 const maxVolumes={};for(const key of ['nullsec','lowsec','empire']){const value=body.maxVolumes?.[key];if(!Number.isFinite(value)||value<=0||value>1e12)throw fail('Enter a positive cargo limit for every space type.');maxVolumes[key]=value;}
 for(const key of ['pricePerM3','collateralPerM3'])if(!Number.isFinite(body[key])||body[key]<0||body[key]>1e12)throw fail('Enter valid non-negative ISK rates per m³.');
 return {locations,maxVolumes,pricePerM3:body.pricePerM3,collateralPerM3:body.collateralPerM3};
}
export function logisticsQuote(settings,body){
 const {space,volume}=body;
 if(!Object.hasOwn(settings.maxVolumes,space))throw fail('Choose 0.0, Lowsec or Empire.');
 const from=settings.locations.find(row=>row.pickup&&row.name===body.from),to=settings.locations.find(row=>row.destination&&row.name===body.to);
 if(!from||!to)throw fail('Choose an available pickup and destination.');
 if(from.name===to.name)throw fail('Pickup and destination must be different.');
 if(!Number.isFinite(volume)||volume<=0||volume>settings.maxVolumes[space])throw fail('Cargo exceeds the selected route limit or has an invalid volume.');
 const estimatedFee=Math.ceil(volume*settings.pricePerM3),estimatedCollateral=Math.ceil(volume*settings.collateralPerM3);
 if(!Number.isSafeInteger(estimatedFee)||!Number.isSafeInteger(estimatedCollateral))throw fail('The calculated amount is too large.');
 return {space,estimatedFee,collateral:settings.collateralPerM3>0?estimatedCollateral:body.collateral,pricePerM3:settings.pricePerM3,collateralPerM3:settings.collateralPerM3};
}
export function courierQueue(snapshot,corporation,now=Date.now()){
 const rows=(snapshot.contracts||[]).filter(row=>row.type==='courier'&&row.assignee_id===corporation&&['outstanding','in_progress'].includes(row.status)&&(row.status!=='outstanding'||!row.date_expired||Date.parse(row.date_expired)>now))
 .map(row=>({id:row.contract_id,title:row.title||'Courier contract',status:row.status,issuer:snapshot.names?.[row.issuer_id]||'Pilot '+row.issuer_id,acceptor:row.acceptor_id?(snapshot.names?.[row.acceptor_id]||'Pilot '+row.acceptor_id):null,from:snapshot.locations?.[row.start_location_id]||'Location '+row.start_location_id,to:snapshot.locations?.[row.end_location_id]||'Location '+row.end_location_id,volume:row.volume,reward:row.reward,collateral:row.collateral,expires:row.status==='in_progress'&&row.date_accepted&&row.days_to_complete?new Date(Date.parse(row.date_accepted)+row.days_to_complete*86400000).toISOString():row.date_expired,retained:Boolean(row.retained)}))
 .sort((a,b)=>Number(a.status==='in_progress')-Number(b.status==='in_progress')||(Date.parse(a.expires)||Infinity)-(Date.parse(b.expires)||Infinity)||a.id-b.id);
 return {contracts:rows,updated:snapshot.updated||null,refreshing:Boolean(snapshot.refreshing),error:snapshot.error?'Corporation contracts could not refresh. Last available data is shown.':null};
}
export function logisticsRoutes(app,{db,available,isAdmin,canManage,contracts,corporation}){
 db.exec("CREATE TABLE IF NOT EXISTS logistics_settings(id INTEGER PRIMARY KEY CHECK(id=1),settings TEXT NOT NULL)");
 const settings=()=>{const row=db.prepare('SELECT settings FROM logistics_settings WHERE id=1').get();return row?JSON.parse(row.settings):logisticsDefaults();};
 app.get('/api/logistics',(req,res)=>{if(!available(req,'logistics'))return res.sendStatus(403);res.json({settings:settings(),admin:isAdmin(req),reviewer:canManage(req,'logistics')});});
 app.get('/api/logistics/settings',(req,res)=>{if(!available(req,'logistics')||!isAdmin(req))return res.sendStatus(403);res.json({settings:settings()});});
 app.post('/api/logistics/settings',(req,res)=>{if(!available(req,'logistics')||!isAdmin(req))return res.sendStatus(403);const value=logisticsSettings(req.body);db.prepare('INSERT INTO logistics_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings').run(JSON.stringify(value));res.json({ok:true});});
 app.get('/api/logistics/pending',async(req,res)=>{if(!available(req,'logistics')||!canManage(req,'logistics'))return res.sendStatus(403);res.json(courierQueue(await contracts(),corporation));});
 return {settings};
}
