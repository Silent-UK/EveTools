import {isSiteAdmin} from './admin.mjs';
import {srpPayoutRoutes} from './srp-payouts.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const fitted = flag => (flag >= 11 && flag <= 34) || (flag >= 92 && flag <= 99) || (flag >= 125 && flag <= 132) || (flag >= 164 && flag <= 171);
const timeWindow = 120_000;
const claimSections = {pending:['pending','pending'],rejected:['declined','declined'],accepted:['approved','paid']};
const claimOffset = value => Math.max(0,Math.min(100000,Number.parseInt(value,10) || 0));

export function srpLoss(mail, prices, cat) {
 const hull = cat.type(mail.victim.ship_type_id)?.name || `Type ${mail.victim.ship_type_id}`;
 const items = [];
 function add(type, section, destroyed, dropped) {
  const price = prices[type];
  items.push({type, name:cat.type(type)?.name || `Type ${type}`, section, destroyed, dropped,
   value:Number.isFinite(price) && price > 0 ? Math.round(price * (destroyed + dropped)) : null});
 }
 function visit(item, carried = false) {
  const section = carried ? 'Cargo' : fitted(item.flag) ? 'Fit' : item.flag === 87 || (item.flag >= 158 && item.flag <= 163) ? 'Drones and fighters' : 'Cargo';
  const destroyed = item.quantity_destroyed || 0, dropped = item.quantity_dropped || 0;
  if(destroyed + dropped > 0) add(item.item_type_id, section, destroyed, dropped);
  for(const child of item.items || []) visit(child, section === 'Cargo');
 }
 add(mail.victim.ship_type_id, 'Hull', 1, 0);
 for(const item of mail.victim.items || []) visit(item);
 const sum = rows => rows.every(item => item.value !== null) ? rows.reduce((total,item) => total + item.value,0) : null;
 const slots = [[11,18],[19,26],[27,34],[92,99],[125,132],[164,171]];
 const fit = slots.map(([start,end]) => (mail.victim.items || []).filter(item => item.flag >= start && item.flag <= end && cat.type(item.item_type_id)?.category_id !== 8)
 .sort((a,b) => a.flag-b.flag).flatMap(item => Array.from({length:Math.min(8,(item.quantity_destroyed || 0)+(item.quantity_dropped || 0))}, () => cat.type(item.item_type_id)?.name || `Type ${item.item_type_id}`)).join('\n')).filter(Boolean);
 const droneLines = items.filter(item => item.section === 'Drones and fighters').map(item => `${item.name} x${item.destroyed + item.dropped}`);
 return {hull, items, total:sum(items), eligible:sum(items.filter(item => item.section !== 'Cargo')),
  fit:[`[${hull}, SRP loss]`, ...fit, droneLines.join('\n')].filter(Boolean).join('\n\n')};
}

export function srpInsurance(journal, killId, killedAt, levels) {
 const candidates = journal.filter(entry => entry.ref_type === 'insurance_payout' && Number.isFinite(entry.amount) && entry.amount > 0 && Number.isSafeInteger(entry.id) && Math.abs(Date.parse(entry.date)-killedAt) <= timeWindow);
 const direct = candidates.filter(entry => entry.context_id_type === 'killmail_id' && Number(entry.context_id) === killId);
 const nearby = candidates.filter(entry => !entry.context_id_type || entry.context_id_type !== 'killmail_id');
 const match = direct.length === 1 ? direct[0] : !direct.length && candidates.length === 1 && nearby.length === 1 && levels.some(level => Math.abs(level-nearby[0].amount) < 1) ? nearby[0] : null;
 return {amount:match?.amount ?? null, journal:match?.id ?? null, range:levels.length ? [Math.min(...levels),Math.max(...levels)] : null};
}

export function shipReplacement(app,{db,cat,eve,config,discord,corp}) {
 db.exec(`CREATE TABLE IF NOT EXISTS srp_config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,review_group INTEGER REFERENCES access_groups(id) ON DELETE SET NULL);
 CREATE TABLE IF NOT EXISTS srp_claims(kill_id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, victim_id INTEGER NOT NULL,
   pilot TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL, comment TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
   insurance_journal INTEGER, payout INTEGER, reviewed_by TEXT, paid_by TEXT, decision TEXT, reviewed_at INTEGER, paid_at INTEGER,
   UNIQUE(victim_id,insurance_journal));
 CREATE INDEX IF NOT EXISTS srp_claim_status ON srp_claims(status,created DESC,kill_id DESC);
 CREATE INDEX IF NOT EXISTS srp_claim_owner_status ON srp_claims(user_id,status,created DESC,kill_id DESC);
 INSERT OR IGNORE INTO srp_config(id) VALUES(1);`);
 const settings = () => db.prepare('SELECT enabled,review_group FROM srp_config WHERE id=1').get();
 const admin = req => !req.inspect && isSiteAdmin(req.session,config.owner);
 const user = req => req.session.user_id;
 const canReview = req => admin(req) || Boolean(db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=? AND status='approved'").get(settings().review_group,user(req)));
 const available = req => Boolean(!req.inspect && !req.recruit && settings().enabled);
 const reconcileWallet = srpPayoutRoutes(app,{db,corp,available,canReview});
 const network = config.srpNetwork || fetch;
 const recentPrices = new Map();
 const importing = new Set();
 let zkillRetryAt = 0;

 async function zkill(path) {
  if(Date.now() < zkillRetryAt) throw fail('zKillboard is rate limited. Try again shortly.',503);
  let response;
  try {
   response = await network(`https://zkillboard.com/api/${path}/`,{headers:{'User-Agent':`Tools SRP (${config.base})`},signal:AbortSignal.timeout(8000),redirect:'error'});
  } catch { throw fail('zKillboard is temporarily unavailable. Try again shortly.',503); }
  if(response.status === 429) zkillRetryAt = Date.now()+Math.max(10,Number(response.headers.get('retry-after')) || 60)*1000;
  if(!response.ok) throw fail(response.status === 404 ? 'Killmail or prices are unavailable on zKillboard.' : 'zKillboard is temporarily unavailable.',response.status === 404 ? 404 : 503);
  const data = await response.json().catch(() => null);
  if(!data || data.error) throw fail('zKillboard returned no usable data.',503);
  return data;
 }
 function pricesFor(day) {
  if(recentPrices.get(day)?.expires > Date.now()) return recentPrices.get(day).data;
  if(recentPrices.size >= 8) recentPrices.delete(recentPrices.keys().next().value);
  const data = zkill(`prices/date/${day}`).catch(() => {recentPrices.delete(day); return {};});
  recentPrices.set(day,{data,expires:Date.now()+600_000});
  return data;
 }
 function insuranceFor(victim, killId, time, levels) {
  const wallet = db.prepare("SELECT data FROM snapshots WHERE character_id=? AND kind='wallet-history'").get(victim);
  const insurance = srpInsurance(JSON.parse(wallet?.data || '{}').journal || [],killId,time,levels);
  const used = insurance.journal !== null && db.prepare('SELECT 1 FROM srp_claims WHERE victim_id=? AND insurance_journal=? AND kill_id<>?').get(victim,insurance.journal,killId);
  return used ? {...insurance,amount:null,journal:null} : insurance;
 }
 const safeClaim = (row,account) => {
  const {data,insurance_journal,user_id,...claim} = row;
  return {...claim,...JSON.parse(data),mine:user_id===account};
 };

 app.get('/api/admin/plugins',(req,res) => {
  if(!admin(req)) return res.sendStatus(403);
  res.json({discord: Boolean(discord.read().enabled), srp:settings(), groups:db.prepare('SELECT id,name FROM access_groups ORDER BY name COLLATE NOCASE').all()});
 });
 app.post('/api/admin/plugins/discord',(req,res) => {
  if(!admin(req)) return res.sendStatus(403);
  if(typeof req.body.enabled !== 'boolean') throw fail('Choose whether Discord is enabled.');
  const saved = discord.read();
  if(req.body.enabled && !(saved.client_id && saved.guild_id && saved.bot_token && saved.client_secret)) throw fail('Configure Discord before enabling it.');
  discord.write({...saved,enabled:req.body.enabled});
  res.json({ok:true});
 });
 app.post('/api/admin/plugins/srp',(req,res) => {
  if(!admin(req)) return res.sendStatus(403);
  const {enabled,review_group} = req.body;
  if(typeof enabled !== 'boolean' || (review_group !== null && !db.prepare('SELECT 1 FROM access_groups WHERE id=?').get(Number(review_group)))) throw fail('Choose a valid SRP review group.');
  db.prepare('UPDATE srp_config SET enabled=?,review_group=? WHERE id=1').run(Number(enabled),review_group === null ? null : Number(review_group));
  res.json({ok:true});
 });
 app.get('/api/srp',(req,res) => {
  if(!available(req)) return res.sendStatus(403);
  const reviewing = canReview(req), status = req.query.status || 'pending';
  const queue = reviewing && req.query.view === 'review';
  const result = rows => ({claims:rows.slice(0,50).map(row=>safeClaim(row,user(req))),more:rows.length>50});
  if(req.query.grouped === '1') {
   const filter = queue ? 'status IN (?,?)' : 'user_id=? AND status IN (?,?)';
   const list = db.prepare(`SELECT * FROM srp_claims WHERE ${filter} ORDER BY created DESC,kill_id DESC LIMIT 51 OFFSET ?`);
   const owner = queue ? [] : [user(req)];
   const sections = Object.fromEntries(Object.entries(claimSections).map(([key,states])=>[key,result(list.all(...owner,...states,claimOffset(req.query[key])))]));
   return res.json({reviewing,sections});
  }
  const offset = claimOffset(req.query.offset);
  if(!['pending','approved','declined','paid'].includes(status)) throw fail('Choose a valid claim status.');
  const rows = queue
   ? db.prepare('SELECT * FROM srp_claims WHERE status=? ORDER BY created DESC,kill_id DESC LIMIT 51 OFFSET ?').all(status,offset)
   : db.prepare('SELECT * FROM srp_claims WHERE user_id=? ORDER BY created DESC,kill_id DESC LIMIT 51 OFFSET ?').all(user(req),offset);
  res.json({reviewing,...result(rows)});
 });
 app.post('/api/srp',async(req,res) => {
  if(!available(req)) return res.sendStatus(403);
  const id = /^https:\/\/(?:www\.)?zkillboard\.com\/kill\/([1-9]\d{0,14})\/?(?:[?#][^\s]*)?$/i.exec(String(req.body.link || '').trim());
  if(!id) throw fail('Paste a zKillboard killmail link.');
  const killId = Number(id[1]), account = user(req);
  if(importing.has(account)) throw fail('A killmail import is already running.',409);
  if(db.prepare('SELECT 1 FROM srp_claims WHERE kill_id=?').get(killId)) throw fail('This killmail already has a claim.',409);
  importing.add(account);
  try {
   const result = await zkill(`killID/${killId}`);
   const mail = Array.isArray(result) ? result.find(row => row.killmail_id === killId) : null;
   const time = Date.parse(mail?.killmail_time);
   if(!mail?.victim?.character_id || !Number.isFinite(time)) throw fail('Killmail not found. Recent losses can take a few minutes to appear.',404);
   const victim = mail.victim.character_id;
   const pilot = () => db.prepare('SELECT name FROM characters WHERE id=? AND user_id=?').get(victim,account);
   if(!pilot()) throw fail('The victim must be one of your linked pilots.',403);
   const [prices,quotes] = await Promise.all([pricesFor(new Date(time).toISOString().slice(0,10)),eve.publicGet?.('/insurance/prices/').catch(() => []) || []]);
   const tiers = Array.isArray(quotes) ? quotes.find(row => row.type_id === mail.victim.ship_type_id)?.levels || [] : [];
   const basic = tiers.find(tier => tier.name === 'Basic')?.payout;
   const levels = [basic * 0.8,...tiers.map(tier => tier.payout)].filter(n => Number.isFinite(n) && n > 0);
   const loss = srpLoss(mail,prices,cat), insurance = insuranceFor(victim,killId,time,levels);
   const suggested = loss.eligible === null ? null : Math.max(0,Math.round(loss.eligible-(insurance.amount || 0)));
   const {journal,...insuranceView} = insurance;
   const data = {...loss,insurance:insuranceView,levels,suggested,time,system:mail.solar_system_id,zkillTotal:Number.isFinite(mail.zkb?.totalValue) ? mail.zkb.totalValue : null};
   if(!available(req) || !pilot()) return res.sendStatus(403);
   const comment = String(req.body.comment || '').trim().slice(0,1000);
   const inserted = db.prepare('INSERT INTO srp_claims(kill_id,user_id,victim_id,pilot,created,data,comment,insurance_journal) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(kill_id) DO NOTHING').run(killId,account,victim,pilot().name,Date.now(),JSON.stringify(data),comment,journal);
   if(!inserted.changes) throw fail('This killmail already has a claim.',409);
   res.status(201).json({id:killId});
  } finally { importing.delete(account); }
 });
 app.post('/api/srp/:id/recheck',(req,res) => {
  if(!available(req)) return res.sendStatus(403);
  const id = Number(req.params.id), row = db.prepare('SELECT * FROM srp_claims WHERE kill_id=?').get(id);
  if(!row || (row.user_id !== user(req) && !canReview(req))) return res.sendStatus(404);
  if(row.status !== 'pending') throw fail('Only pending claims can recheck insurance.',409);
  if(!db.prepare('SELECT 1 FROM characters WHERE id=? AND user_id=?').get(row.victim_id,row.user_id)) throw fail('The loss pilot is no longer linked to this claimant.',409);
  const data = JSON.parse(row.data);
  const {journal,...insurance} = insuranceFor(row.victim_id,id,data.time,data.levels);
  if(journal !== null){
   data.insurance = insurance;
   data.suggested = data.eligible === null ? null : Math.max(0,Math.round(data.eligible-insurance.amount));
   db.prepare('UPDATE srp_claims SET data=?,insurance_journal=? WHERE kill_id=?').run(JSON.stringify(data),journal,id);
  }
  res.json({verified:journal !== null});
 });
 app.delete('/api/srp/:id',(req,res) => {
  if(!available(req)) return res.sendStatus(403);
  const id = Number(req.params.id), row = db.prepare('SELECT user_id,status FROM srp_claims WHERE kill_id=?').get(id);
  if(!row || (row.user_id !== user(req) && !admin(req))) return res.sendStatus(404);
  if(row.status !== 'pending') throw fail('Only pending claims can be deleted.',409);
  const result = db.prepare("DELETE FROM srp_claims WHERE kill_id=? AND status='pending'").run(id);
  if(!result.changes) throw fail('This claim is no longer pending.',409);
  res.json({ok:true});
 });
 app.post('/api/srp/:id/review',(req,res) => {
  if(!available(req) || !canReview(req)) return res.sendStatus(403);
  const id = Number(req.params.id), row = db.prepare('SELECT * FROM srp_claims WHERE kill_id=?').get(id);
  if(!row) return res.sendStatus(404);
  const {action, payout} = req.body, actor = req.session.name, now = Date.now();
  if(row.user_id === user(req) && !admin(req)) throw fail('A site admin or another reviewer must handle your own claim.',403);
  const decision = String(req.body.decision || '').trim().slice(0,1000);
  if(['approved','declined'].includes(action) && row.status === 'pending') {
   if(action === 'approved' && (!Number.isSafeInteger(payout) || payout < 1)) throw fail('Enter a positive whole ISK payout.');
   if(action === 'declined' && !decision) throw fail('Enter a reason for rejecting the claim.');
   db.prepare('UPDATE srp_claims SET status=?,payout=?,reviewed_by=?,reviewed_at=?,decision=? WHERE kill_id=?').run(action,action === 'approved' ? payout : null,actor,now,decision,id);
  } else throw fail('This claim is no longer awaiting that action.',409);
  res.json({ok:true});
 });
 return {available,canReview,reconcileWallet};
}
