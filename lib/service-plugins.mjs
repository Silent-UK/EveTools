import {logisticsRoutes,logisticsQuote} from './logistics.mjs';
import {isSiteAdmin} from './admin.mjs';
import {servicePlugins} from '../public/service-plugin-options.mjs';
import {buybackItems} from '../public/buyback-items.mjs';
import {buybackPayments} from './buyback-payments.mjs';

const fail = (message,status=400) => Object.assign(new Error(message),{status});
const ids = Object.keys(servicePlugins);
const statuses = ['requested','quoted','accepted','received','completed','declined','cancelled'];

function field(body,key,label,max,required=true) {
 const value = body[key] ?? '';
 if(typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(`Enter ${label} (up to ${max} characters).`);
 return value.trim();
}

function requestDetails(plugin,body) {
 const notes = field(body,'notes','notes',1500,false);
 if(plugin === 'buyback') return {items:field(body,'items','items and quantities',12000),location:field(body,'location','a delivery location',160),notes};
 const from = field(body,'from','a pickup location',160), to = field(body,'to','a destination',160);
 if(from.toLowerCase() === to.toLowerCase()) throw fail('Pickup and destination must be different.');
 const {volume,collateral} = body;
 if(!Number.isFinite(volume) || volume <= 0 || volume > 1e12) throw fail('Enter a cargo volume greater than zero.');
 if(!Number.isSafeInteger(collateral) || collateral < 0) throw fail('Enter collateral in whole ISK. Use zero if none is required.');
 return {from,to,volume,collateral,notes};
}

export function servicePluginRoutes(app,{db,config,cat,jitaQuotes,contracts}) {
 db.exec(`CREATE TABLE IF NOT EXISTS service_plugin_settings(plugin TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS service_plugin_requests(id INTEGER PRIMARY KEY,plugin TEXT NOT NULL,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pilot TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'requested',quote INTEGER,quote_note TEXT,quoted_by TEXT,
  decision_note TEXT,closed_by TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS service_plugin_owner ON service_plugin_requests(plugin,user_id,id DESC);
 CREATE INDEX IF NOT EXISTS service_plugin_queue ON service_plugin_requests(plugin,status,id DESC);`);
 if(!db.prepare('PRAGMA table_info(service_plugin_settings)').all().some(column=>column.name==='review_group'))
  db.exec('ALTER TABLE service_plugin_settings ADD COLUMN review_group INTEGER REFERENCES access_groups(id) ON DELETE SET NULL');
 if(!db.prepare('PRAGMA table_info(service_plugin_requests)').all().some(column=>column.name==='settlement'))
  db.exec("ALTER TABLE service_plugin_requests ADD COLUMN settlement TEXT NOT NULL DEFAULT 'payment'");
 if(!db.prepare('PRAGMA table_info(service_plugin_settings)').all().some(column=>column.name==='audience'))
  db.exec("ALTER TABLE service_plugin_settings ADD COLUMN audience TEXT NOT NULL DEFAULT 'all'");
 const timerboardSettings=()=>db.prepare("SELECT audience,review_group FROM service_plugin_settings WHERE plugin='timerboard'").get();
 const isAdmin = req => !req.inspect && isSiteAdmin(req.session,config.owner);
 const enabledSetting = db.prepare('SELECT enabled FROM service_plugin_settings WHERE plugin=?');
 const enabled = plugin => Boolean(enabledSetting.get(plugin)?.enabled);
 const pluginStates = req => Object.fromEntries(ids.map(id=>[id,Boolean(!req.inspect && !req.recruit && enabled(id))]));
 const available = (req,plugin) => !req.inspect && !req.recruit && Object.hasOwn(servicePlugins,plugin) && enabled(plugin);
 const buybackGroup=db.prepare("SELECT review_group FROM service_plugin_settings WHERE plugin='buyback'");
 const logisticsGroup=()=>db.prepare("SELECT review_group FROM service_plugin_settings WHERE plugin='logistics'").get()?.review_group??null;
 const ensureLogisticsGroup=()=>{
  let id=logisticsGroup();if(!id){id=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Logistics','↗','Apply to review hauling requests and incoming corporation courier contracts.','approval','[]','[]')").run().lastInsertRowid);db.prepare("UPDATE service_plugin_settings SET review_group=? WHERE plugin='logistics'").run(id);}
  db.prepare("UPDATE access_groups SET mode='approval' WHERE id=?").run(id);return id;
 };
 if(enabled('logistics'))ensureLogisticsGroup();
 const canManage=(req,plugin)=>isAdmin(req) || (plugin==='logistics' && Boolean(db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND status='approved'").get(logisticsGroup(),req.session.user_id))) || (plugin==='buyback' && Boolean(db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND status='approved'").get(buybackGroup.get()?.review_group ?? null,req.session.user_id)));
 const logistics=logisticsRoutes(app,{db,available,isAdmin,canManage,contracts,enabled:()=>enabled('logistics'),corporation:config.corporationId});
 const payments=buybackPayments(app,{db,available,canManage});

 app.get('/api/admin/service-plugins',(req,res) => {
  if(!isAdmin(req)) return res.sendStatus(403);
  res.json({...Object.fromEntries(ids.map(id=>[id,enabled(id)])),timerboard_audience:timerboardSettings()?.audience||'all',timerboard_group:timerboardSettings()?.review_group??null,buyback_group:buybackGroup.get()?.review_group ?? null,groups:db.prepare('SELECT id,name FROM access_groups ORDER BY name COLLATE NOCASE').all()});
 });
 app.post('/api/admin/service-plugins/:plugin',(req,res) => {
  if(!isAdmin(req)) return res.sendStatus(403);
  const {plugin} = req.params;
  if(!Object.hasOwn(servicePlugins,plugin)) return res.sendStatus(404);
  if(typeof req.body.enabled !== 'boolean') throw fail('Choose whether the plugin is enabled.');
  if(plugin==='timerboard'){
   const audience=req.body.audience??'all',group=req.body.review_group??null;
   if(!['all','directors','group'].includes(audience))throw fail('Choose a valid Timerboard audience.');
   if(audience==='group'&&(!Number.isSafeInteger(group)||!db.prepare('SELECT 1 FROM access_groups WHERE id=?').get(group)))throw fail('Choose a group for Timerboard.');
   db.prepare('INSERT INTO service_plugin_settings(plugin,enabled,audience,review_group) VALUES(?,?,?,?) ON CONFLICT(plugin) DO UPDATE SET enabled=excluded.enabled,audience=excluded.audience,review_group=excluded.review_group').run(plugin,Number(req.body.enabled),audience,audience==='group'?group:null);
   return res.json({ok:true});
  }
  const group=plugin==='buyback' && Object.hasOwn(req.body,'review_group') ? req.body.review_group : buybackGroup.get()?.review_group ?? null;
  if(plugin==='buyback' && group!==null && (!Number.isSafeInteger(group) || !db.prepare('SELECT 1 FROM access_groups WHERE id=?').get(group))) throw fail('Choose a valid Buyback reviewer group.');
  db.prepare('INSERT INTO service_plugin_settings(plugin,enabled,review_group) VALUES(?,?,?) ON CONFLICT(plugin) DO UPDATE SET enabled=excluded.enabled,review_group=excluded.review_group').run(plugin,Number(req.body.enabled),plugin==='buyback'?group:plugin==='logistics'?logisticsGroup():null);
  if(plugin==='logistics'&&req.body.enabled)ensureLogisticsGroup();
  res.json({ok:true});
 });
 app.get('/api/service-plugins/:plugin',(req,res) => {
  const {plugin} = req.params, account = req.session.user_id;
  if(plugin==='timerboard'||!available(req,plugin)) return res.sendStatus(403);
  const admin = canManage(req,plugin), status = req.query.status || 'requested', queue = admin && req.query.view === 'queue';
  if(!statuses.includes(status)) throw fail('Choose a valid request status.');
  const offset = Math.max(0,Math.min(100000,Number.parseInt(req.query.offset,10) || 0));
  const rows = queue
   ? db.prepare('SELECT * FROM service_plugin_requests WHERE plugin=? AND status=? ORDER BY id DESC LIMIT 51 OFFSET ?').all(plugin,status,offset)
   : db.prepare('SELECT * FROM service_plugin_requests WHERE plugin=? AND user_id=? ORDER BY id DESC LIMIT 51 OFFSET ?').all(plugin,account,offset);
  res.json({admin,more:rows.length>50,requests:rows.slice(0,50).map(({user_id,details,...row})=>({...row,mine:user_id===account,details:JSON.parse(details)}))});
 });
 app.post('/api/service-plugins/:plugin',(req,res) => {
  const {plugin} = req.params;
  if(plugin==='timerboard'||!available(req,plugin)) return res.sendStatus(403);
  const estimate=plugin==='logistics'?logisticsQuote(logistics.settings(),req.body):null;
  const details = {...requestDetails(plugin,{...req.body,...(estimate?{collateral:estimate.collateral}:{})}),...(estimate||{})}, now = Date.now();
  const id = db.prepare('INSERT INTO service_plugin_requests(plugin,user_id,pilot,details,created,updated) VALUES(?,?,?,?,?,?)').run(plugin,req.session.user_id,req.session.name,JSON.stringify(details),now,now).lastInsertRowid;
  res.status(201).json({id});
 });
 app.get('/api/service-plugins/buyback/:id/prices',async(req,res)=>{
  if(!available(req,'buyback')) return res.sendStatus(403);
  const row=db.prepare("SELECT user_id,details,revision FROM service_plugin_requests WHERE plugin='buyback' AND id=?").get(Number(req.params.id));
  if(!row || (row.user_id!==req.session.user_id && !canManage(req,'buyback'))) return res.sendStatus(404);
  const rows=buybackItems(JSON.parse(row.details).items);
  const ids=new Map([...new Set(rows.map(item=>item.name))].map(name=>[name,cat.named?.(name)]));
  const types=[...new Set([...ids.values()].filter(Boolean))];
  if(types.length>100) throw fail('Jita quotes support up to 100 distinct items per request.');
  const quotes=new Map((await jitaQuotes(types)).map(quote=>[quote.id,quote]));
  const totals={};
  for(const side of ['buy','sell']) {
   let cents=0, missing=0;
   for(const item of rows) {
    const price=quotes.get(ids.get(item.name))?.[side];
    if(item.quantity===null || !Number.isFinite(price)) missing++;
    else cents+=Math.round(price*100)*item.quantity;
   }
   totals[side]={value:missing===rows.length || !Number.isSafeInteger(cents)?null:cents/100,missing};
  }
  res.json({revision:row.revision,totals,itemTypes:rows.map(item=>ids.get(item.name) || null)});
 });
 app.delete('/api/service-plugins/buyback/:id',(req,res)=>{
  if(!available(req,'buyback') || !isAdmin(req)) return res.sendStatus(403);
  const id=Number(req.params.id);
  const row=db.prepare("SELECT status,revision FROM service_plugin_requests WHERE plugin='buyback' AND id=?").get(id);
  if(!row) return res.sendStatus(404);
  if(row.revision!==req.body.revision) throw fail('This request changed. Refresh it and check the latest details.',409);
  if(['accepted','received','completed'].includes(row.status)) throw fail('Accepted or paid requests are retained in the queue history.',409);
  const result=db.prepare("DELETE FROM service_plugin_requests WHERE plugin='buyback' AND id=? AND revision=?").run(id,row.revision);
  if(!result.changes) throw fail('This request changed. Refresh it and check the latest details.',409);
  res.json({ok:true});
 });
 app.post('/api/service-plugins/:plugin/:id',(req,res) => {
  const {plugin,id} = req.params;
  if(plugin==='timerboard'||!available(req,plugin)) return res.sendStatus(403);
  const row = db.prepare('SELECT * FROM service_plugin_requests WHERE plugin=? AND id=?').get(plugin,Number(id));
  const mine = row?.user_id === req.session.user_id, admin = canManage(req,plugin);
  if(!row || (!mine && !admin)) return res.sendStatus(404);
  const {action,revision} = req.body;
  if(revision !== row.revision) throw fail('This request changed. Refresh it and check the latest details.',409);
  const waiting = ['requested','quoted'].includes(row.status), now = Date.now(), actor = req.session.name;
  const canAct = admin && (!mine || (plugin==='buyback' && isAdmin(req)));
  if(action==='edit-items' && plugin==='buyback' && mine && row.status==='requested') {
   const details={...JSON.parse(row.details),items:field(req.body,'items','items and quantities',12000)};
   const changed=db.prepare("UPDATE service_plugin_requests SET details=?,updated=?,revision=revision+1 WHERE id=? AND revision=? AND status='requested'").run(JSON.stringify(details),now,row.id,revision);
   if(!changed.changes) throw fail('This request changed. Refresh it and check the latest details.',409);
   return res.json({ok:true});
  }
  const next = {...row};
  if(action === 'quote' && canAct && waiting) {
   if(!Number.isSafeInteger(req.body.quote) || req.body.quote < 0 || (plugin==='buyback' && req.body.quote===0)) throw fail(plugin==='buyback'?'Enter an offer greater than zero in whole ISK.':'Enter the fee in whole ISK. Zero is allowed.');
   const settlement=plugin==='buyback' ? req.body.settlement ?? row.settlement : row.settlement;
   if(!['payment','contract'].includes(settlement)) throw fail('Choose a valid settlement method.');
   Object.assign(next,{status:'quoted',settlement,quote:req.body.quote,quote_note:field(req.body,'note','quote instructions',1500,false),quoted_by:actor});
  } else if(action === 'accept' && mine && row.status === 'quoted') next.status = 'accepted';
  else if(action === 'cancel' && mine && waiting) Object.assign(next,{status:'cancelled',closed_by:actor});
  else if(action === 'decline' && canAct && waiting) Object.assign(next,{status:'declined',closed_by:actor,decision_note:field(req.body,'note','a reason for declining',1500)});
  else if(action === 'close' && canAct && row.status === 'accepted') Object.assign(next,{status:'cancelled',closed_by:actor,decision_note:field(req.body,'note','a reason for cancelling',1500)});
  else if(action === 'complete' && canAct && row.status === 'accepted') Object.assign(next,{status:plugin==='buyback'&&row.settlement==='payment'?'received':'completed',closed_by:actor,decision_note:field(req.body,'note','a completion note',1500,false)});
  else throw fail('That action is unavailable for this request.',409);
  const result = db.prepare(`UPDATE service_plugin_requests SET status=?,quote=?,quote_note=?,quoted_by=?,decision_note=?,closed_by=?,settlement=?,updated=?,revision=revision+1
   WHERE id=? AND revision=?`).run(next.status,next.quote,next.quote_note,next.quoted_by,next.decision_note,next.closed_by,next.settlement,now,row.id,revision);
  if(!result.changes) throw fail('This request changed. Refresh it and check the latest details.',409);
  res.json({ok:true});
 });
 return {pluginStates,available,canManage,payments,timerboardSettings,logisticsGroup,logistics};
}
