import {autosavePluginSettings,pluginToggle} from './service-plugin-options.mjs';

const statusLabels = {pending:'Pending',approved:'Awaiting payment',declined:'Rejected',paid:'Paid'};
const sectionLabels = {pending:'Pending Claims',rejected:'Rejected Claims',accepted:'Accepted Claims'};
const payoutLabels = {requested:'Requested',processing:'In progress',sent:'Awaiting wallet verification',verified:'Verified paid'};
const statusIcons = {pending:'◷',approved:'✓',declined:'×',paid:'✓',requested:'◷',processing:'↗',sent:'↻',verified:'✓'};
const glyph = symbol => `<span class="srp-glyph" aria-hidden="true">${symbol}</span>`;
const badge = (status,label) => `<span class="srp-badge srp-${status}">${glyph(statusIcons[status])}${label}</span>`;
function eveImage(id,kind) {
 if(!Number.isSafeInteger(id) || id<1) return glyph('◇');
 const path = kind==='portrait' ? `characters/${id}/portrait` : `types/${id}/${kind}`;
 return `<img src="https://images.evetech.net/${path}?size=64" width="32" height="32" loading="lazy" alt="">`;
}

export function shipReplacementUI({api,esc,intro,date,num,toast,refresh,account}) {
 let view = 'mine', offsets = {}, payoutQueue = false, payoutStatus = 'requested', payoutOffset = 0;
 const money = value => value == null ? 'Unavailable' : `${num(value)} ISK`;
 const option = (value,label,selected) => `<option value="${esc(value)}" ${selected?'selected':''}>${esc(label)}</option>`;

 function claimView(claim,reviewing) {
  const insurance = claim.insurance.amount !== null ? money(claim.insurance.amount) : `Unverified${claim.insurance.range ? ` · current quotes ${claim.insurance.range.map(money).join(' to ')}` : ''}`;
  const suggest = claim.suggested === null ? 'Unavailable' : `${money(claim.suggested)}${claim.insurance.amount === null ? ' before unverified insurance' : ''}`;
  const rows = claim.items.map(item => `<tr><td><span class="srp-item">${eveImage(item.type,'icon')}${esc(item.name)}</span></td><td>${esc(item.section)}</td><td>${num(item.destroyed)}</td><td>${num(item.dropped)}</td><td>${money(item.value)}</td></tr>`).join('');
  const canAct = reviewing && (!claim.mine || account().admin);
  const hull = claim.items.find(item=>item.section==='Hull');
  return `<details class="srp-claim"><summary><span class="srp-art">${eveImage(hull?.type,'render')}</span><span class="srp-name"><strong>${esc(claim.hull)}</strong><small>${esc(claim.pilot)} · ${date(claim.time)}</small></span>${badge(claim.status,statusLabels[claim.status])}${claim.payout !== null ? `<strong class="srp-amount">${money(claim.payout)}</strong>` : ''}</summary><div class="srp-detail">
    <p><a href="https://zkillboard.com/kill/${claim.kill_id}/" target="_blank" rel="noopener noreferrer">Killmail ↗</a>${claim.comment ? ` · ${esc(claim.comment)}` : ''}</p>
    <div class="srp-values"><span><small>Total loss</small><strong>${money(claim.total ?? claim.zkillTotal)}</strong>${claim.total === null && claim.zkillTotal !== null ? '<small>zKillboard estimate</small>' : ''}</span><span><small>Eligible</small><strong>${money(claim.eligible)}</strong></span><span><small>Insurance</small><strong>${insurance}</strong></span><span><small>Suggested SRP</small><strong>${suggest}</strong></span></div>
    <small>Item prices from zKillboard on the loss date. Eligible value includes hull, fittings, drones and fighters.</small>
    <details><summary>Items and EFT fit</summary><div class="table-wrap"><table><thead><tr><th>Item</th><th>Section</th><th>Destroyed</th><th>Dropped</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div><textarea readonly rows="6" aria-label="EFT fit">${esc(claim.fit)}</textarea></details>
    ${claim.reviewed_by ? `<p>${claim.status==='declined'?'Rejected':'Accepted'} by ${esc(claim.reviewed_by)} · ${date(claim.reviewed_at)}${claim.decision ? ` · ${esc(claim.decision)}` : ''}</p>` : ''}
    ${claim.paid_by ? `<p>Marked paid by ${esc(claim.paid_by)} · ${date(claim.paid_at)}</p>` : ''}
    ${claim.status === 'pending' && claim.insurance.amount === null ? `<button data-srp-recheck="${claim.kill_id}">Recheck insurance</button>` : ''}
    ${claim.status === 'pending' && (claim.mine || account().admin) ? `<button data-srp-delete="${claim.kill_id}">Delete pending claim</button>` : ''}
    ${reviewing && claim.mine && !canAct && claim.status==='pending' ? '<p><small>A site admin or another reviewer must handle your own claim.</small></p>' : ''}
    ${canAct && claim.status === 'pending' ? `<form class="management-form" data-srp-review="${claim.kill_id}"><label>Payout (ISK)<input name="payout" type="number" min="1" step="1" value="${claim.suggested ?? ''}" required></label><label>Decision note<input name="decision" maxlength="1000"></label><div class="actions"><button class="primary" name="action" value="approved">Accept claim</button></div></form>
    <details><summary>Reject claim</summary><form class="management-form" data-srp-review="${claim.kill_id}"><label>Rejection reason<input name="decision" maxlength="1000" required></label><div class="actions"><button name="action" value="declined">Reject claim</button></div></form></details>` : ''}</div></details>`;
 }

 function tabs(reviewer) {
  return `<div class="srp-tabs" aria-label="Ship Replacement views"><button data-srp-view="mine" aria-pressed="${view==='mine'}">${glyph('▤')}My claims</button>${reviewer?`<button data-srp-view="review" aria-pressed="${view==='review'}">${glyph('☷')}Review queue</button>`:''}<button data-srp-view="payout" aria-pressed="${view==='payout'}">${glyph('◈')}Payout</button></div>`;
 }

 function payoutRow(payout,reviewing) {
  let controls = '';
  if(reviewing && !payout.mine) {
   if(payout.status==='requested') controls=`<form class="management-form" data-srp-payout="${payout.id}"><label>Corporation wallet division<select name="division" required><option value="">Select a division</option>${Array.from({length:7},(_,i)=>option(i+1,`Division ${i+1}`,false)).join('')}</select></label><div class="actions"><button class="primary" value="start">Confirm payout</button></div></form>`;
   if(payout.status==='processing' && payout.assigned) controls=`<p>Send <strong>${money(payout.amount)}</strong> from corporation wallet division ${payout.division} to <strong>${esc(payout.pilot)}</strong> (character ${payout.recipient}). Paste the reference below into the transfer reason.</p><label>Transfer reference <input readonly value="${esc(payout.reference)}"></label><form data-srp-payout="${payout.id}"><button class="primary" value="sent">Record transfer sent</button></form>`;
   if(payout.status==='sent') controls=`<button data-srp-payout-verify="${payout.id}">Check corporation wallet</button>`;
  }
  return `<details class="srp-claim"><summary><span class="srp-art">${eveImage(payout.recipient,'portrait')}</span><span class="srp-name"><strong>${esc(payout.pilot)}</strong><small>${date(payout.requested)}</small></span>${badge(payout.status,payoutLabels[payout.status])}<strong class="srp-amount">${money(payout.amount)}</strong></summary><div class="srp-detail">
   <p>${esc(payout.reference)}${payout.handler_name?` · Handled by ${esc(payout.handler_name)} · Division ${payout.division}`:''}</p>
   ${payout.verified ? `<small>Verified against the corporation wallet ${date(payout.verified)}</small>` : ''}${controls}</div></details>`;
 }

 async function payoutPage() {
  const query=new URLSearchParams({view:payoutQueue?'review':'mine',status:payoutStatus,offset:payoutOffset});
  const data=await api(`/srp/payouts?${query}`), reviewing=data.reviewer && payoutQueue;
  return tabs(data.reviewer)+`<section class="panel srp-balance"><div class="srp-art">${eveImage(account().main_id,'portrait')}</div><div class="srp-name"><h2>Available for payout</h2><small>${data.balance.count} accepted ${data.balance.count===1?'claim':'claims'} · Payable to ${esc(account().name)}</small></div><strong class="srp-amount">${money(data.balance.amount)}</strong><button class="primary" data-srp-payout-request ${data.balance.count?'':'disabled'}>Request payout</button></section>`+
   (data.reviewer?`<div class="actions"><button data-srp-payout-view="mine" aria-pressed="${!reviewing}">My payouts</button><button data-srp-payout-view="review" aria-pressed="${reviewing}">Payout queue</button></div>`:'')+
   (reviewing?`<label>Status<select id="srp-payout-status">${Object.entries(payoutLabels).map(([key,label])=>option(key,label,key===payoutStatus)).join('')}</select></label>`:'')+
   (data.payouts.map(payout=>payoutRow(payout,reviewing)).join('') || '<p>No payouts in this view.</p>')+
   (payoutOffset || data.more?`<div class="actions"><button data-srp-payout-page="-50" ${payoutOffset?'':'disabled'}>Previous</button><button data-srp-payout-page="50" ${data.more?'':'disabled'}>Next</button></div>`:'');
 }

 function claimSection(key,data,reviewing) {
  const offset = offsets[key] || 0;
  return `<section class="panel srp-section" aria-label="${sectionLabels[key]}"><h2>${glyph({pending:'◷',rejected:'×',accepted:'✓'}[key])}${sectionLabels[key]}</h2>
   ${data.claims.map(claim=>claimView(claim,reviewing)).join('') || '<p class="srp-empty">No claims in this section.</p>'}
   ${offset || data.more ? `<div class="actions"><button data-srp-section="${key}" data-srp-page="-50" ${offset?'':'disabled'}>Previous</button><button data-srp-section="${key}" data-srp-page="50" ${data.more?'':'disabled'}>Next</button></div>` : ''}</section>`;
 }

 async function render(page) {
  if(page === 'admin-plugins' && account().admin && !account().inspect) {
   const data = await api('/admin/plugins');
   return intro('Plugins','Manage optional modules for this installation.')+`<section class="panel compact plugin-card"><form data-plugin="discord">${pluginToggle('Discord',data.discord,'Link pilot accounts and sync group roles.','☏')}</form><div class="plugin-card-settings"><button data-nav="admin-discord">Configure Discord ↗</button></div></section>
   <section class="panel compact plugin-card"><form data-plugin="srp">${pluginToggle('Ship Replacement',data.srp.enabled,'Manage reimbursement claims for ship losses.','⬡')}
    <div class="plugin-card-settings" data-srp-settings ${data.srp.enabled?'':'hidden'}><div class="management-form"><label>Reviewer group<select name="review_group">${option('','Site admins only',!data.srp.review_group)}${data.groups.map(group => option(group.id,group.name,group.id===data.srp.review_group)).join('')}</select></label><small>Site admins and approved members of this group can review claims and record manual payouts.</small></div></div>
    </form></section>`;
  }
  if(page !== 'srp' || !account().srp) return null;
  if(view==='payout') return intro('Ship Replacement','Request and track payments across your account.')+await payoutPage();
  const queue = view==='review';
  const query = new URLSearchParams({view:queue?'review':'mine',grouped:'1',...offsets});
  const data = await api(`/srp?${query}`);
  const reviewing = data.reviewing && queue;
  return intro('Ship Replacement','Submit a loss and track its reimbursement.')+
   tabs(data.reviewing)+
   (reviewing ? '<p><small>Accept a claim with an ISK amount or reject it with a reason. Accepted claims are collected in the pilot’s Payout tab.</small></p>' : `<section class="panel compact"><form class="management-form" id="srp-claim"><label>zKillboard link<input name="link" type="url" required maxlength="250" placeholder="https://zkillboard.com/kill/…/"></label><label>Notes<input name="comment" maxlength="1000" placeholder="Fleet, doctrine or other details"></label><button class="primary">Submit claim</button></form></section>`)+
   Object.keys(sectionLabels).map(key=>claimSection(key,data.sections[key],reviewing)).join('');
 }

 async function run(button, action, reloadAccount = false) {
  if(button) button.disabled = true;
  try { await action(); await refresh(reloadAccount); }
  catch(error) { toast(error.message); }
  finally { if(button) button.disabled = false; }
 }
 autosavePluginSettings('form[data-plugin]',{api,refresh,toast},(form,fields)=>{
  const plugin=form.dataset.plugin;
  return {path:'/admin/plugins/'+plugin,body:{enabled:fields.has('enabled'),
   ...(plugin==='srp'?{review_group:Number(fields.get('review_group'))||null}:{})}};
 });
 document.addEventListener('submit',event => {
  const form = event.target;
  if(!form.matches('#srp-claim,[data-srp-review],[data-srp-payout]')) return;
  event.preventDefault();
  const button = event.submitter || form.querySelector('button'), fields = new FormData(form);
  if(form.id === 'srp-claim') {
   run(button,async()=>{await api('/srp',Object.fromEntries(fields)); offsets.pending = 0; toast('Claim submitted.');});
  } else if(form.dataset.srpPayout) {
   const action=button.value;
   if(action==='sent' && !confirm('Record that you already sent this payout from the corporation wallet?')) return;
   run(button,async()=>{await api(`/srp/payouts/${form.dataset.srpPayout}`,{action,division:Number(fields.get('division'))}); payoutStatus=action==='start'?'processing':'sent'; payoutOffset=0;});
  } else {
   const action = button.value;
   run(button,async()=>{await api(`/srp/${form.dataset.srpReview}/review`,{action,payout:Number(fields.get('payout')),decision:fields.get('decision')}); offsets = {}; toast(action==='approved'?'Claim accepted.':'Claim rejected.');});
  }
 });
 document.addEventListener('change',event => {
  if(event.target.id==='srp-payout-status') { payoutStatus=event.target.value; payoutOffset=0; run(null,()=>{}); }
 });
 document.addEventListener('click',event => {
  const button = event.target.closest('[data-srp-view],[data-srp-page],[data-srp-recheck],[data-srp-delete],[data-srp-payout-request],[data-srp-payout-view],[data-srp-payout-page],[data-srp-payout-verify]');
  if(!button) return;
  if(button.dataset.srpDelete) {
   if(confirm('Delete this pending claim? You can submit the killmail again if needed.')) run(button,async()=>{await api(`/srp/${button.dataset.srpDelete}`,{},'DELETE'); toast('Pending claim deleted.');});
   return;
  }
  if(button.dataset.srpRecheck) {
   run(button,async()=>{const result = await api(`/srp/${button.dataset.srpRecheck}/recheck`,{}); toast(result.verified?'Insurance matched.':'No matching payout in the saved wallet journal yet.');});
   return;
  }
  if(button.hasAttribute('data-srp-payout-request')) {
   run(button,async()=>{await api('/srp/payouts',{}); payoutQueue=false; payoutOffset=0; toast('Payout requested.');});
   return;
  }
  if(button.dataset.srpPayoutVerify) {
   run(button,async()=>{const result=await api(`/srp/payouts/${button.dataset.srpPayoutVerify}/verify`,{}); if(result.verified)payoutStatus='verified'; toast(result.verified?'Corporation wallet transfer verified.':'No matching transfer in the corporation wallet yet.');});
   return;
  }
  if(button.dataset.srpPayoutView) { payoutQueue=button.dataset.srpPayoutView==='review'; payoutOffset=0; }
  else if(button.dataset.srpPayoutPage) payoutOffset=Math.max(0,payoutOffset+Number(button.dataset.srpPayoutPage));
  else if(button.dataset.srpView) { view=button.dataset.srpView; offsets={}; }
  else { const key = button.dataset.srpSection; offsets[key] = Math.max(0,(offsets[key] || 0)+Number(button.dataset.srpPage)); }
  run(button,()=>{});
 });
 return {render,focus(action){view=action.startsWith('payout')?'payout':'review';payoutQueue=action==='payout-review';payoutStatus='requested';payoutOffset=0;offsets={};}};
}
