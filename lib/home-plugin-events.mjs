const isk=new Intl.NumberFormat('en-GB');

export function homePluginEvents(db,req,prefs,srp,services,timers=[],now=Date.now()) {
 const account=req.session.user_id, pilotId=req.session.main_id, pilot=req.session.name;
 const recent=now-7*86400000;
 const output={srp:[],buyback:[],upcomingTimers:[]};
 if(prefs['home-show-upcomingTimers']!==false){
  output.upcomingTimers=timers.map(timer=>({
   page:'timerboard',title:timer.name,at:timer.at,stance:timer.stance,typeId:timer.typeId,
   detail:[timer.system,timer.type,timer.stage,timer.ticker].filter(Boolean).join(' · '),
   timeLabel:timer.at<=now?'Exited':'Exits'
  }));
 }
 function push(page,title,mine=false,detail='') {
  output[page].push({page,title,detail,...(mine?{pilotId,pilot,accountWide:true}:{})});
 }
 const count=(sql,...args)=>db.prepare(sql).get(...args).count;
 if(prefs['home-show-srp']!==false && srp.available(req)) {
  const balance=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(c.payout),0) amount FROM srp_claims c WHERE c.user_id=? AND c.status='approved'
   AND NOT EXISTS(SELECT 1 FROM srp_payout_claims p WHERE p.kill_id=c.kill_id)`).get(account);
  if(balance.count) push('srp','SRP available to request',true,`${isk.format(balance.amount)} ISK`);
  const requested=count("SELECT COUNT(*) count FROM srp_payouts WHERE user_id=? AND status<>'verified'",account);
  if(requested) push('srp',`${requested} SRP ${requested===1?'payout':'payouts'} in progress`,true);
  const paid=count("SELECT COUNT(*) count FROM srp_payouts WHERE user_id=? AND verified>=?",account,recent);
  if(paid) push('srp',`${paid} SRP ${paid===1?'payout':'payouts'} verified paid`,true);
  const rejected=count("SELECT COUNT(*) count FROM srp_claims WHERE user_id=? AND status='declined' AND reviewed_at>=?",account,recent);
  if(rejected) push('srp',`${rejected} SRP ${rejected===1?'claim':'claims'} rejected`,true);
  if(srp.canReview(req)) {
   const claims=count("SELECT COUNT(*) count FROM srp_claims WHERE status='pending'");
   const payouts=count("SELECT COUNT(*) count FROM srp_payouts WHERE status='requested'");
   if(claims) push('srp',`${claims} SRP ${claims===1?'claim':'claims'} to review`);
   if(payouts) push('srp',`${payouts} SRP ${payouts===1?'payout':'payouts'} requested`);
  }
 }
 if(prefs['home-show-buyback']!==false && services.available(req,'buyback')) {
  const balance=services.payments.balance.get(account);
  if(balance.count) push('buyback','Buyback payment available to request',true,`${isk.format(balance.amount)} ISK`);
  const quotes=count("SELECT COUNT(*) count FROM service_plugin_requests WHERE plugin='buyback' AND user_id=? AND status='quoted'",account);
  const requested=count('SELECT COUNT(*) count FROM buyback_payments WHERE user_id=? AND paid_at IS NULL',account);
  const contracts=count("SELECT COUNT(*) count FROM service_plugin_requests WHERE plugin='buyback' AND user_id=? AND status='accepted' AND settlement='contract'",account);
  const paid=count("SELECT COUNT(*) count FROM service_plugin_requests WHERE plugin='buyback' AND user_id=? AND status='completed' AND updated>=?",account,recent);
  if(quotes) push('buyback',`${quotes} Buyback ${quotes===1?'quote':'quotes'} awaiting your response`,true);
  if(requested) push('buyback',`${requested} Buyback ${requested===1?'payment':'payments'} in progress`,true);
  if(contracts) push('buyback',`${contracts} Buyback ${contracts===1?'request ready':'requests ready'} for an item exchange contract`,true);
  if(paid) push('buyback',`${paid} Buyback ${paid===1?'request':'requests'} paid`,true);
  if(services.canManage(req,'buyback')) {
   const requests=count("SELECT COUNT(*) count FROM service_plugin_requests WHERE plugin='buyback' AND status='requested'");
   const payments=services.payments.pending.get().count;
   if(requests) push('buyback',`${requests} Buyback ${requests===1?'request':'requests'} awaiting a quote`);
   if(payments) push('buyback',`${payments} Buyback ${payments===1?'payment':'payments'} requested`);
  }
 }
 return output;
}
