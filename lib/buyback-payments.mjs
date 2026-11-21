import {transaction} from './store.mjs';

const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export function buybackPayments(app,{db,available,canManage}) {
 db.exec(`CREATE TABLE IF NOT EXISTS buyback_payments(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient INTEGER NOT NULL,pilot TEXT NOT NULL,amount INTEGER NOT NULL,created INTEGER NOT NULL,paid_at INTEGER,paid_by TEXT,
  handler INTEGER REFERENCES users(id) ON DELETE SET NULL,handler_name TEXT);
 CREATE INDEX IF NOT EXISTS buyback_payment_owner ON buyback_payments(user_id,id DESC);
 CREATE INDEX IF NOT EXISTS buyback_payment_queue ON buyback_payments(paid_at,id DESC);
 CREATE TABLE IF NOT EXISTS buyback_payment_requests(payment_id INTEGER NOT NULL REFERENCES buyback_payments(id),
  request_id INTEGER PRIMARY KEY REFERENCES service_plugin_requests(id));
 CREATE INDEX IF NOT EXISTS buyback_payment_batch ON buyback_payment_requests(payment_id);`);
 const eligible=`FROM service_plugin_requests r WHERE r.plugin='buyback' AND r.user_id=? AND r.status='received'
  AND NOT EXISTS(SELECT 1 FROM buyback_payment_requests b WHERE b.request_id=r.id)`;
 const balance=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(r.quote),0) amount ${eligible}`);
 const get=db.prepare('SELECT * FROM buyback_payments WHERE id=?');
 const pending=db.prepare('SELECT COUNT(*) count FROM buyback_payments WHERE paid_at IS NULL');
 const allowed=req=>available(req,'buyback');

 app.get('/api/service-plugins/buyback/payments',(req,res)=>{
  if(!allowed(req)) return res.sendStatus(403);
  const account=req.session.user_id, reviewer=canManage(req,'buyback'), queue=reviewer && req.query.view==='queue';
  const offset=Math.max(0,Math.min(100000,Number.parseInt(req.query.offset,10)||0));
  const rows=queue
   ? db.prepare('SELECT * FROM buyback_payments WHERE (paid_at IS NOT NULL)=? ORDER BY id DESC LIMIT 51 OFFSET ?').all(Number(req.query.status==='paid'),offset)
   : db.prepare('SELECT * FROM buyback_payments WHERE user_id=? ORDER BY id DESC LIMIT 51 OFFSET ?').all(account,offset);
  res.json({reviewer,balance:balance.get(account),payments:rows.slice(0,50).map(({user_id,handler,...row})=>({...row,mine:user_id===account,assigned:handler===account})),more:rows.length>50});
 });
 app.post('/api/service-plugins/buyback/payments',(req,res)=>{
  if(!allowed(req)) return res.sendStatus(403);
  const account=req.session.user_id;
  const result=transaction(db,()=>{
   const {count,amount}=balance.get(account);
   if(!count || !Number.isSafeInteger(amount) || amount<=0) throw fail('No received Buyback requests are available for payment.');
   const id=db.prepare('INSERT INTO buyback_payments(user_id,recipient,pilot,amount,created) VALUES(?,?,?,?,?)').run(account,req.session.main_id,req.session.name,amount,Date.now()).lastInsertRowid;
   db.prepare(`INSERT INTO buyback_payment_requests(payment_id,request_id) SELECT ?,r.id ${eligible}`).run(id,account);
   return {id,amount};
  });
  res.status(201).json(result);
 });
 app.post('/api/service-plugins/buyback/payments/:id',(req,res)=>{
  if(!allowed(req) || !canManage(req,'buyback')) return res.sendStatus(403);
  const row=get.get(Number(req.params.id));
  if(!row) return res.sendStatus(404);
  if(row.user_id===req.session.user_id) throw fail('Another Buyback reviewer must handle your payment.',403);
  const now=Date.now(), actor=req.session.name;
  if(req.body.action==='start') {
   const changed=db.prepare('UPDATE buyback_payments SET handler=?,handler_name=? WHERE id=? AND paid_at IS NULL AND handler IS NULL').run(req.session.user_id,actor,row.id);
   if(!changed.changes) throw fail('Another reviewer already took this payment.');
   return res.json({ok:true});
  }
  if(req.body.action!=='paid' || row.handler!==req.session.user_id) throw fail('Take this payment before recording it as paid.');
  transaction(db,()=>{
   const changed=db.prepare('UPDATE buyback_payments SET paid_at=?,paid_by=? WHERE id=? AND paid_at IS NULL').run(now,actor,row.id);
   if(!changed.changes) throw fail('This payment has already been recorded.');
   db.prepare("UPDATE service_plugin_requests SET status='completed',updated=?,closed_by=?,revision=revision+1 WHERE id IN (SELECT request_id FROM buyback_payment_requests WHERE payment_id=?)").run(now,actor,row.id);
  });
  res.json({ok:true});
 });
 return {balance,pending};
}
