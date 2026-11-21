import {logisticsUI} from './logistics-view.mjs';
import {timerboardUI} from './timerboard-view.mjs';
import {autosavePluginSettings,pluginToggle,servicePlugins} from './service-plugin-options.mjs';
import {buybackItems} from './buyback-items.mjs';

const statusLabels = {requested:'Awaiting quote',quoted:'Quoted',accepted:'Accepted',received:'Items received',completed:'Completed',declined:'Declined',cancelled:'Cancelled'};
const buybackIcons = {requested:'◷',quoted:'◈',accepted:'✓',received:'▦',completed:'✓',declined:'×',cancelled:'–'};
const icon = symbol => `<span class="buyback-icon" aria-hidden="true">${symbol}</span>`;
const metric = (symbol,label,value) => `<div class="buyback-metric"><small>${icon(symbol)}${label}</small><strong>${value}</strong></div>`;

export function servicePluginsUI({api,esc,intro,date,num,toast,refresh,account}) {
 const logistics=logisticsUI({api,esc,num,date,toast,refresh,onRequests:queue=>Object.assign(views.logistics,{queue,offset:0})});
 const timerboard=timerboardUI({api,esc,intro,toast,refresh});
 const views = Object.fromEntries(Object.keys(servicePlugins).map(id=>[id,{queue:false,status:'requested',offset:0}]));
 const paymentView={open:false,queue:false,status:'pending',offset:0};
 const money = value => `${num(value)} ISK`;
 const input = (label,name) => `<label>${label}<input name="${name}" maxlength="160" required></label>`;
 const pastedIsk = new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});

 function itemTable(text,market='') {
  const rows=buybackItems(text);
  if(!rows.length) return '';
  const total=rows.every(row=>row.cents!==null) ? rows.reduce((sum,row)=>sum+row.cents,0) : null;
  return `<div class="buyback-inventory"><div class="buyback-values">${metric('▦','Inventory',`${rows.length} item ${rows.length===1?'line':'lines'}`)}${metric('≋','Pasted estimate',total===null?'Unavailable':`${pastedIsk.format(total/100)} ISK`)}${market}</div><div class="buyback-items"><table><thead><tr><th>Item</th><th>Quantity</th><th>Volume</th><th>Pasted estimate</th></tr></thead><tbody>${rows.map((row,index)=>`<tr><td><span class="buyback-item-name"><span data-buyback-icon="${index}">${icon('◇')}</span>${esc(row.name)}</span></td><td>${row.quantity===null?'—':num(row.quantity)}</td><td>${row.volume?esc(row.volume.replace(/m3$/i,'m³')):'—'}</td><td>${row.cents===null?'—':pastedIsk.format(row.cents/100)+' ISK'}</td></tr>`).join('')}</tbody></table></div></div>`;
 }

 function itemInput(value='') {
  return `<label>Items and quantities<textarea name="items" rows="5" maxlength="12000" placeholder="Paste your in-game item list" required>${esc(value)}</textarea></label><div data-buyback-preview>${itemTable(value)}</div>`;
 }

 function requestForm(id) {
  const fields = id === 'buyback'
   ? `${itemInput()}${input('Delivery location','location')}`
   : logistics.fields();
  return `<section class="panel compact ${id==='buyback'?'buyback-form':'logistics-form'}"><h2>${icon('＋')}${id==='buyback'?'New request':'Request a haul'}</h2><form class="management-form" data-service-new="${id}"><div class="${id==='logistics'?'logistics-fields':''}">${fields}</div><label>Notes<input name="notes" maxlength="1500" placeholder="Any timing or contract details"></label><div class="actions"><button class="primary">Request quote</button></div></form></section>`;
 }

 function actions(id,request,queue) {
  const {mine,status,quote,revision} = request, plugin = servicePlugins[id];
  const waiting = status === 'requested' || status === 'quoted';
  const form = body => `<form class="management-form" data-service-action="${id}" data-request="${request.id}" data-revision="${revision}">${body}</form>`;
  const button = (action,label,primary=false) => `<button name="action" value="${action}" ${primary?'class="primary"':''}>${label}</button>`;
  if(mine && (!queue || id!=='buyback') && waiting) return (id==='buyback' && status==='requested' ? `<details class="buyback-edit"><summary>Edit item list</summary>${form(itemInput(request.details.items)+button('edit-items','Save item list',true))}</details>` : '')+form(`<div class="actions">${status === 'quoted' ? button('accept','Accept quote',true) : ''}${button('cancel','Cancel request')}</div>`);
  if(!queue || (mine && (id!=='buyback' || !account().admin))) return '';
  if(waiting) return form(`<label>${plugin.quote} (ISK)<input name="quote" type="number" min="${id==='buyback'?1:0}" max="9007199254740991" step="1" value="${quote ?? ''}"></label>
    ${id==='buyback'?`<label>Settlement<select name="settlement"><option value="payment" ${request.settlement==='payment'?'selected':''}>Payment tab</option><option value="contract" ${request.settlement==='contract'?'selected':''}>Item exchange contract</option></select></label>`:''}
    <label>Quote instructions or decline reason<input name="note" maxlength="1500" value="${esc(request.quote_note || '')}"></label>
    <div class="actions">${button('quote',status === 'quoted'?'Update quote':'Send quote',true)}${button('decline',id==='buyback'?'Reject request':'Decline')}</div>`);
  if(status === 'accepted') return form(`<label>Completion note or cancellation reason<input name="note" maxlength="1500" placeholder="Contract reference or settlement details"></label><div class="actions">${button('complete',id==='buyback'?(request.settlement==='contract'?'Mark contract paid':'Confirm items received'):plugin.complete,true)}${button('close','Cancel accepted request')}</div>`);
  return '';
 }

 function row(id,request,queue) {
  const {details} = request, plugin = servicePlugins[id];
  const title = id === 'buyback' ? details.location : `${details.from} → ${details.to}`;
  const buyback=id==='buyback', status=request.status==='completed'?plugin.completed:buyback&&request.status==='declined'?'Rejected':statusLabels[request.status];
  const market=`<div class="buyback-market" data-buyback-prices="${request.id}" data-revision="${request.revision}" aria-live="polite"><button data-buyback-price-check>Check Jita prices</button></div>`;
  const cargo=buyback?itemTable(details.items,market):`<dl class="logistics-metrics"><div><dt>Volume</dt><dd>${num(details.volume)} m³</dd></div><div><dt>Collateral</dt><dd>${money(details.collateral)}</dd></div><div><dt>Hauling fee</dt><dd>${request.quote==null?'Awaiting quote':money(request.quote)}</dd></div>${details.estimatedFee!=null?`<div><dt>Estimated fee · ${esc(({nullsec:'0.0',lowsec:'Lowsec',empire:'Empire'})[details.space]||'Route')}</dt><dd>${money(details.estimatedFee)}</dd></div>`:''}</dl>`;
  const remove=buyback&&queue&&account().admin&&!['accepted','received','completed'].includes(request.status)?`<button class="buyback-delete" data-buyback-delete="${request.id}" data-revision="${request.revision}">${icon('×')}Delete request</button>`:'';
  const summary=buyback?`<span class="buyback-emblem">${icon('◈')}</span><span class="buyback-request-name"><strong>${esc(title)}</strong><small>#${request.id} · ${esc(request.pilot)} · ${date(request.created)}</small></span><span class="buyback-status buyback-${request.status}">${icon(buybackIcons[request.status])}${status}</span>${request.quote!==null?`<strong class="buyback-quote">${money(request.quote)}</strong>`:''}`:`<span class="buyback-emblem" aria-hidden="true">⇢</span><span class="buyback-request-name"><strong>${esc(title)}</strong><small>#${request.id} · ${esc(request.pilot)}</small></span><span class="buyback-status buyback-${esc(request.status)}">${esc(status)}</span>${request.quote!=null?`<strong class="buyback-quote">${money(request.quote)}</strong>`:''}`;
  return `<details class="panel compact service-request buyback-request ${buyback?'':'logistics-request'}"><summary>${summary}</summary><div class="buyback-detail">
   ${cargo}${details.notes ? `<p>${esc(details.notes)}</p>` : ''}<small>Requested ${date(request.created)}</small>
   ${request.quoted_by ? `<p>${plugin.quote} <strong>${money(request.quote)}</strong> · ${esc(request.quoted_by)}${request.quote_note ? ` · ${esc(request.quote_note)}` : ''}</p>` : ''}
   ${buyback&&['quoted','accepted','received'].includes(request.status)?`<p>${request.settlement==='contract'?`Item exchange contract · set <strong>I will receive</strong> to <strong>${money(request.quote)}</strong>.`:'Payment tab · added to your balance when staff confirm receipt.'}</p>`:''}
   ${request.closed_by ? `<p>${esc(request.closed_by)} · ${date(request.updated)}${request.decision_note ? ` · ${esc(request.decision_note)}` : ''}</p>` : ''}
   ${actions(id,request,queue)}${remove}</div></details>`;
 }

 function tabs(page,reviewer,queue) {
  const buyback=page==='buyback';
  if(!reviewer && !buyback) return '';
  return `<div class="buyback-tabs"><button data-service-view="mine" data-plugin-id="${page}" aria-pressed="${!queue&&!(buyback&&paymentView.open)}">${buyback?icon('▤'):''}My requests</button>${reviewer?`<button data-service-view="queue" data-plugin-id="${page}" aria-pressed="${queue&&!(buyback&&paymentView.open)}">${buyback?icon('☷'):''}${account().admin?'Admin queue':'Review queue'}</button>`:''}${buyback?`<button data-buyback-payment-tab aria-pressed="${paymentView.open}">${icon('◈')}Payment</button>`:''}</div>`;
 }

 async function paymentPage() {
  const query=new URLSearchParams({view:paymentView.queue?'queue':'mine',status:paymentView.status,offset:paymentView.offset});
  const data=await api(`/service-plugins/buyback/payments?${query}`), queue=data.reviewer&&paymentView.queue;
  const rows=data.payments.map(row=>{
   const status=row.paid_at?'Paid':row.handler_name?'In progress':'Requested';
   const action=row.assigned?'paid':'start', canAct=queue&&!row.mine&&!row.paid_at&&(row.assigned||!row.handler_name);
   return `<details class="panel compact service-request buyback-request"><summary><span class="buyback-emblem">${icon('◈')}</span><span class="buyback-request-name"><strong>${esc(row.pilot)}</strong><small>Payment #${row.id} · ${date(row.created)}</small></span><span class="buyback-status ${row.paid_at?'buyback-completed':''}">${status}</span><strong class="buyback-quote">${money(row.amount)}</strong></summary><div class="buyback-detail"><p>Payable to ${esc(row.pilot)} · character ${row.recipient}</p>${row.paid_at?`<small>Recorded by ${esc(row.paid_by)} · ${date(row.paid_at)}</small>`:row.handler_name?`<small>Handled by ${esc(row.handler_name)}</small>`:''}${canAct?`<div class="actions"><button class="primary" data-buyback-payment="${row.id}" data-payment-action="${action}">${row.assigned?'Mark paid':'Take payment'}</button></div>`:''}</div></details>`;
  }).join('');
  return tabs('buyback',data.reviewer,false)+`<section class="panel compact buyback-form"><h2>${icon('◈')}Available for payment</h2><div class="buyback-values">${metric('◈','Balance',money(data.balance.amount))}${metric('▦','Received requests',num(data.balance.count))}</div><p>Payable to your login main, ${esc(account().name)}.</p><button class="primary" data-buyback-payment-request ${data.balance.count?'':'disabled'}>Request payment</button></section>`+
   (data.reviewer?`<div class="buyback-tabs"><button data-buyback-payment-view="mine" aria-pressed="${!queue}">My payments</button><button data-buyback-payment-view="queue" aria-pressed="${queue}">Payment queue</button></div>`:'')+
   (queue?`<label class="buyback-filter">Status<select data-buyback-payment-status><option value="pending" ${paymentView.status==='pending'?'selected':''}>Outstanding</option><option value="paid" ${paymentView.status==='paid'?'selected':''}>Paid</option></select></label>`:'')+
   (rows || '<p class="muted">No payments to show.</p>')+
   (paymentView.offset||data.more?`<div class="actions"><button data-buyback-payment-offset="-50" ${paymentView.offset?'':'disabled'}>Previous</button><button data-buyback-payment-offset="50" ${data.more?'':'disabled'}>Next</button></div>`:'');
 }

 async function render(page) {
  if(page === 'admin-plugins' && account().admin && !account().inspect) {
   const data = await api('/admin/service-plugins');
   return Object.entries(servicePlugins).map(([id,plugin])=>`<section class="panel compact plugin-card"><form data-service-settings="${id}">
    ${pluginToggle(plugin.label,data[id],plugin.description,plugin.icon)}
    ${id==='logistics'?'<small class="plugin-card-settings">Enables the approval-based Logistics group for courier and request reviewers. Configure routes and rates in Management → Logistics → Admin.</small>':''}
    ${id==='buyback'?`<div class="plugin-card-settings" data-buyback-settings ${data[id]?'':'hidden'}><div class="management-form"><label>Buyback reviewer group<select name="review_group"><option value="">Site admins only</option>${data.groups.map(group=>`<option value="${group.id}" ${group.id===data.buyback_group?'selected':''}>${esc(group.name)}</option>`).join('')}</select></label></div></div>`:''}
    ${id==='timerboard'?`<div class="ops-form-grid plugin-card-settings" ${data[id]?'':'hidden'}><label>Audience<select name="audience">
     <option value="all" ${data.timerboard_audience==='all'?'selected':''}>All corp members</option>
     <option value="directors" ${data.timerboard_audience==='directors'?'selected':''}>Directors, CEO and admins</option>
     <option value="group" ${data.timerboard_audience==='group'?'selected':''}>Group</option>
    </select></label><label data-timerboard-group ${data.timerboard_audience==='group'?'':'hidden'}>Group<select name="review_group">
    <option value="">Choose a group</option>${data.groups.map(group=>`<option value="${group.id}" ${group.id===data.timerboard_group?'selected':''}>${esc(group.name)}</option>`).join('')}
    </select></label></div>`:''}
    </form></section>`).join('');
  }
  if(!Object.hasOwn(servicePlugins,page) || !account().service_plugins?.[page]) return null;
  if(page==='timerboard')return timerboard.render();
  const plugin = servicePlugins[page], view = views[page];
  let logisticsTabs='';
  if(page==='logistics'){logisticsTabs=await logistics.load(view.queue);const body=await logistics.content()??(!view.queue?logistics.calculator():null);if(body!==null)return intro(plugin.label,plugin.description)+`<div class="logistics-page">${logisticsTabs}${body}</div>`;}
  if(page==='buyback'&&paymentView.open) return intro(plugin.label,plugin.description)+`<div class="buyback-page">${await paymentPage()}</div>`;
  const data = await api(`/service-plugins/${page}?view=${view.queue?'queue':'mine'}&status=${view.status}&offset=${view.offset}`);
  const queue = data.admin && view.queue;
  const buyback=page==='buyback';
  return intro(plugin.label,plugin.description)+`<div class="${buyback?'buyback-page':'logistics-page'}">`+
   logisticsTabs+(page==='logistics'?'':tabs(page,data.admin,queue))+
   (queue ? `<label class="buyback-filter">Status<select data-service-status="${page}">${Object.entries(statusLabels).filter(([id])=>buyback||id!=='received').map(([id,label])=>`<option value="${id}" ${id===view.status?'selected':''}>${id==='completed'?plugin.completed:buyback&&id==='declined'?'Rejected':label}</option>`).join('')}</select></label>` : requestForm(page))+
   (data.requests.map(request=>row(page,request,queue)).join('') || '<p class="muted">No requests to show.</p>')+
   (view.offset || data.more ? `<div class="actions"><button data-service-offset="-50" data-plugin-id="${page}" ${view.offset?'':'disabled'}>Previous</button><button data-service-offset="50" data-plugin-id="${page}" ${data.more?'':'disabled'}>Next</button></div>` : '')+'</div>';
 }

 async function run(button,action,reload=false) {
  if(button) button.disabled = true;
  try { await action(); await refresh(reload); }
  catch(error) { toast(error.message); }
  finally { if(button) button.disabled = false; }
 }
 async function loadBuybackPrices(target) {
  if(!target || target.dataset.loaded) return;
  target.dataset.loaded='loading';
  target.textContent='Checking Jita Buy and Sell…';
  try {
   const {revision,totals,itemTypes}=await api(`/service-plugins/buyback/${target.dataset.buybackPrices}/prices`);
   if(String(revision)!==target.dataset.revision) throw Error('Request changed. Refresh for current prices.');
   const format=({value,missing})=>value===null?'Unavailable':`${pastedIsk.format(value)} ISK${missing?` · partial (${missing} unpriced)` : ''}`;
   target.innerHTML=metric('↓','Jita Buy',format(totals.buy))+metric('↑','Jita Sell',format(totals.sell));
   target.title='Jita IV–4 top order prices × quantity';
   for(const holder of target.closest('.buyback-inventory').querySelectorAll('[data-buyback-icon]')) {
    const type=itemTypes?.[Number(holder.dataset.buybackIcon)];
    if(Number.isSafeInteger(type) && type>0) holder.innerHTML=`<img src="https://images.evetech.net/types/${type}/icon?size=32" width="20" height="20" loading="lazy" alt="">`;
   }
   target.dataset.loaded='done';
  } catch(error) {
   delete target.dataset.loaded;
   target.innerHTML=`${esc(error.message)} <button data-buyback-price-check>Retry Jita prices</button>`;
  }
 }
 document.addEventListener('toggle',event=>{
  const details=event.target;
  if(details.open && details.matches('details.service-request')) loadBuybackPrices(details.querySelector('[data-buyback-prices]'));
 },true);
 autosavePluginSettings('form[data-service-settings]',{api,refresh,toast},(form,fields)=>{
  const plugin=form.dataset.serviceSettings;
  const body={enabled:fields.has('enabled')};
  if(plugin==='buyback'||plugin==='timerboard')body.review_group=Number(fields.get('review_group'))||null;
  if(plugin==='timerboard'){
   body.audience=fields.get('audience');
   form.querySelector('[data-timerboard-group]').hidden=body.audience!=='group';
   if(body.audience==='group'&&!body.review_group){
    if(form.elements.enabled.checked!==form.elements.enabled.defaultChecked){
     body.enabled=form.elements.enabled.checked;
     body.audience=form.elements.audience.querySelector('option[selected]')?.value||'all';
    }else return;
   }
  }
  return {path:'/admin/service-plugins/'+plugin,body};
 });
 document.addEventListener('submit',event=>{
  const form = event.target;
  if(!form.matches('[data-service-new],[data-service-action]')) return;
  event.preventDefault();
  const {serviceNew,serviceAction,request,revision} = form.dataset;
  const button = event.submitter || form.querySelector('button'), fields = new FormData(form);
  if(serviceNew) {
   const body = Object.fromEntries(fields);
   if(serviceNew==='logistics') Object.assign(body,{volume:Number(body.volume),collateral:Number(body.collateral)});
   run(button,async()=>{await api(`/service-plugins/${serviceNew}`,body); views[serviceNew].offset=0; toast('Quote requested.');});
  } else {
   const action = button.value, quote = fields.get('quote');
   if(action==='complete' && !confirm(serviceAction==='buyback'?(button.textContent==='Mark contract paid'?'Confirm the item exchange contract has settled in EVE.':'Confirm the items were received. This makes the amount available in the pilot’s Payment tab.'):'Confirm the cargo has been delivered.')) return;
   if(action==='close' && !confirm('Cancel this accepted request?')) return;
   run(button,async()=>{await api(`/service-plugins/${serviceAction}/${request}`,{action,revision:Number(revision),quote:quote?Number(quote):null,note:fields.get('note'),items:fields.get('items'),settlement:fields.get('settlement')}); if(action==='edit-items')toast('Item list saved.');});
  }
 });
 document.addEventListener('input',event=>{
  if(!event.target.matches('textarea[name="items"]')) return;
  const preview=event.target.form?.querySelector('[data-buyback-preview]');
  if(preview) preview.innerHTML=itemTable(event.target.value);
 });
 document.addEventListener('paste',event=>{
  const target=event.target;
  if(!target.matches('textarea[name="items"]') || !target.form?.querySelector('[data-buyback-preview]')) return;
  const html=event.clipboardData?.getData('text/html');
  if(!html) return;
  const template=document.createElement('template');
  template.innerHTML=html;
  const rows=[...template.content.querySelectorAll('tr')].filter(row=>row.querySelector('td')).map(row=>[...row.cells].map(cell=>cell.textContent.trim().replace(/\s+/g,' ')).join('\t')).filter(row=>row.trim());
  if(rows.length<=buybackItems(event.clipboardData.getData('text/plain')).length) return;
  event.preventDefault();
  const text=rows.join('\n');
  if(target.value.length-(target.selectionEnd-target.selectionStart)+text.length>target.maxLength) {
   toast('The item list is too long. Split it into multiple requests.');
   return;
  }
  target.setRangeText(text,target.selectionStart,target.selectionEnd,'end');
  target.dispatchEvent(new Event('input',{bubbles:true}));
 });
 document.addEventListener('change',event=>{
  if(event.target.matches('[data-buyback-payment-status]')) { Object.assign(paymentView,{status:event.target.value,offset:0}); run(null,()=>{}); return; }
  const id = event.target.dataset.serviceStatus;
  if(!id) return;
  Object.assign(views[id],{status:event.target.value,offset:0});
  run(null,()=>{});
 });
 document.addEventListener('click',event=>{
  const payment=event.target.closest('[data-buyback-payment-tab],[data-buyback-payment-request],[data-buyback-payment-view],[data-buyback-payment-offset],[data-buyback-payment]');
  if(payment) {
   const data=payment.dataset;
   if(payment.hasAttribute('data-buyback-payment-request')) run(payment,async()=>{await api('/service-plugins/buyback/payments',{});Object.assign(paymentView,{queue:false,offset:0});toast('Payment requested.');});
   else if(data.buybackPayment) {
    if(data.paymentAction==='paid'&&!confirm('Confirm you already sent this ISK in EVE.')) return;
    run(payment,async()=>{await api(`/service-plugins/buyback/payments/${data.buybackPayment}`,{action:data.paymentAction});toast(data.paymentAction==='paid'?'Payment recorded.':'Payment assigned to you.');});
   } else {
    if(payment.hasAttribute('data-buyback-payment-tab')) paymentView.open=true;
    if(data.buybackPaymentView) Object.assign(paymentView,{queue:data.buybackPaymentView==='queue',offset:0});
    if(data.buybackPaymentOffset) paymentView.offset=Math.max(0,paymentView.offset+Number(data.buybackPaymentOffset));
    run(payment,()=>{});
   }
   return;
  }
  const buyback=event.target.closest('[data-buyback-delete],[data-buyback-price-check]');
  if(buyback?.dataset.buybackDelete) {
   if(confirm('Delete this Buyback request permanently?')) run(buyback,async()=>{await api(`/service-plugins/buyback/${buyback.dataset.buybackDelete}`,{revision:Number(buyback.dataset.revision)},'DELETE');toast('Buyback request deleted.');});
   return;
  }
  if(buyback) { loadBuybackPrices(buyback.closest('[data-buyback-prices]')); return; }
  const button = event.target.closest('[data-service-view],[data-service-offset]');
  if(!button) return;
  const view = views[button.dataset.pluginId];
  if(button.dataset.serviceView) { if(button.dataset.pluginId==='buyback') paymentView.open=false; Object.assign(view,{queue:button.dataset.serviceView==='queue',offset:0}); }
  else view.offset=Math.max(0,view.offset+Number(button.dataset.serviceOffset));
  run(button,()=>{});
 });
 return {render,focus(page,action){if(!views[page])return;if(page==='logistics')logistics.reset();paymentView.open=page==='buyback'&&action.startsWith('payment');paymentView.queue=action==='payment-review';paymentView.status='pending';paymentView.offset=0;Object.assign(views[page],{queue:action==='review',status:['quoted','accepted'].includes(action)?action:'requested',offset:0});}};
}
