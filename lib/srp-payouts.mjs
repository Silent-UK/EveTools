import {randomBytes} from 'node:crypto';
import {transaction} from './store.mjs';

const fail = (message,status=409) => Object.assign(new Error(message),{status});

export function srpPayoutRoutes(app,{db,corp,available,canReview}) {
 db.exec(`CREATE TABLE IF NOT EXISTS srp_payouts(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient INTEGER NOT NULL,pilot TEXT NOT NULL,amount INTEGER NOT NULL,reference TEXT NOT NULL UNIQUE,requested INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',handler INTEGER REFERENCES users(id) ON DELETE SET NULL,handler_name TEXT,
  division INTEGER,started INTEGER,sent INTEGER,verified INTEGER,journal_id INTEGER UNIQUE);
 CREATE TABLE IF NOT EXISTS srp_payout_claims(payout_id INTEGER NOT NULL REFERENCES srp_payouts(id),kill_id INTEGER PRIMARY KEY REFERENCES srp_claims(kill_id));
 CREATE INDEX IF NOT EXISTS srp_payout_account ON srp_payouts(user_id,id DESC);
 CREATE INDEX IF NOT EXISTS srp_payout_status ON srp_payouts(status,id DESC);
 CREATE INDEX IF NOT EXISTS srp_payout_claim_batch ON srp_payout_claims(payout_id);`);
 const balance = db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(c.payout),0) amount FROM srp_claims c
  WHERE c.user_id=? AND c.status='approved' AND NOT EXISTS(SELECT 1 FROM srp_payout_claims p WHERE p.kill_id=c.kill_id)`);
 const pendingSent = db.prepare("SELECT * FROM srp_payouts WHERE status='sent'");
 const get = db.prepare('SELECT * FROM srp_payouts WHERE id=?');
 const savedWallet = db.prepare("SELECT data FROM public_cache WHERE path='/tools/corp-data/wallet'");
 const safe = ({user_id,handler,journal_id,...row},account) => ({...row,mine:user_id===account,assigned:handler===account});

 function verify(row,journal) {
  const matches = journal.filter(entry=>{
   const time = Date.parse(entry.date);
   return entry.ref_type==='corporation_account_withdrawal' && Number.isSafeInteger(entry.id) && entry.amount===-row.amount &&
    entry.second_party_id===row.recipient && time>=row.started-5000 && time<=row.sent+86_400_000 &&
    String(entry.reason || '').trim().toUpperCase()===row.reference;
  });
  if(matches.length!==1) return false;
  return transaction(db,()=>{
   const entry = matches[0];
   if(db.prepare('SELECT 1 FROM srp_payouts WHERE journal_id=?').get(entry.id)) return false;
   const changed = db.prepare("UPDATE srp_payouts SET status='verified',verified=?,journal_id=? WHERE id=? AND status='sent'").run(Date.now(),entry.id,row.id);
   if(!changed.changes) return false;
   db.prepare("UPDATE srp_claims SET status='paid',paid_by=?,paid_at=? WHERE kill_id IN (SELECT kill_id FROM srp_payout_claims WHERE payout_id=?)").run(row.handler_name,Date.parse(entry.date),row.id);
   return true;
  });
 }
 function reconcileWallet(wallet) {
  for(const row of pendingSent.all()) verify(row,wallet.rows?.find(div=>div.division===row.division)?.journal || []);
 }

 app.get('/api/srp/payouts',(req,res)=>{
  if(!available(req)) return res.sendStatus(403);
  const account=req.session.user_id, reviewer=canReview(req), queue=reviewer && req.query.view==='review';
  const status=req.query.status || 'requested';
  if(!['requested','processing','sent','verified'].includes(status)) throw fail('Choose a valid payout status.',400);
  const offset=Math.max(0,Math.min(100000,Number.parseInt(req.query.offset,10)||0));
  const rows=queue
   ? db.prepare('SELECT * FROM srp_payouts WHERE status=? ORDER BY id DESC LIMIT 51 OFFSET ?').all(status,offset)
   : db.prepare('SELECT * FROM srp_payouts WHERE user_id=? ORDER BY id DESC LIMIT 51 OFFSET ?').all(account,offset);
  res.json({reviewer,balance:balance.get(account),payouts:rows.slice(0,50).map(row=>safe(row,account)),more:rows.length>50});
 });
 app.post('/api/srp/payouts',(req,res)=>{
  if(!available(req)) return res.sendStatus(403);
  const account=req.session.user_id;
  const result=transaction(db,()=>{
   const {count,amount}=balance.get(account);
   if(!count || !Number.isSafeInteger(amount) || amount<=0) throw fail('No accepted claims are available for payout.');
   const reference='SRP-'+randomBytes(8).toString('hex').toUpperCase();
   const id=db.prepare('INSERT INTO srp_payouts(user_id,recipient,pilot,amount,reference,requested) VALUES(?,?,?,?,?,?)')
    .run(account,req.session.main_id,req.session.name,amount,reference,Date.now()).lastInsertRowid;
   db.prepare(`INSERT INTO srp_payout_claims(payout_id,kill_id) SELECT ?,kill_id FROM srp_claims c WHERE user_id=? AND status='approved'
    AND NOT EXISTS(SELECT 1 FROM srp_payout_claims p WHERE p.kill_id=c.kill_id)`).run(id,account);
   return {id,amount};
  });
  res.status(201).json(result);
 });
 app.post('/api/srp/payouts/:id',(req,res)=>{
  if(!available(req) || !canReview(req)) return res.sendStatus(403);
  const row=get.get(Number(req.params.id)), account=req.session.user_id;
  if(!row) return res.sendStatus(404);
  if(row.user_id===account) throw fail('Another reviewer must handle your payout.',403);
  const {action,division}=req.body, now=Date.now();
  if(action==='start' && row.status==='requested') {
   if(!Number.isInteger(division) || division<1 || division>7) throw fail('Choose corporation wallet division 1–7.',400);
   const changed=db.prepare("UPDATE srp_payouts SET status='processing',handler=?,handler_name=?,division=?,started=? WHERE id=? AND status='requested'")
    .run(account,req.session.name,division,now,row.id);
   if(!changed.changes) throw fail('Another reviewer already took this payout.');
  } else if(action==='sent' && row.status==='processing' && row.handler===account) {
   db.prepare("UPDATE srp_payouts SET status='sent',sent=? WHERE id=? AND status='processing'").run(now,row.id);
   const wallet=JSON.parse(savedWallet.get()?.data || '{}');
   verify(get.get(row.id),wallet.rows?.find(div=>div.division===row.division)?.journal || []);
  } else throw fail('This payout is already handled or assigned to another reviewer.');
  res.json(safe(get.get(row.id),account));
 });
 app.post('/api/srp/payouts/:id/verify',async(req,res)=>{
  if(!available(req) || !canReview(req)) return res.sendStatus(403);
  const row=get.get(Number(req.params.id));
  if(!row) return res.sendStatus(404);
  if(row.status==='verified') return res.json({verified:true});
  if(row.status!=='sent') throw fail('Record the transfer before checking the wallet.');
  const result=await corp.walletJournal(row.division);
  if(result.error) throw fail(result.error,503);
  res.json({verified:verify(row,result.rows) || get.get(row.id).status==='verified'});
 });
 return reconcileWallet;
}
