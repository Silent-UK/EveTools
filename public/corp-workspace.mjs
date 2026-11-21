import {moonGooView} from './moon-goo-view.mjs';
import {corpPages,csv,DAY,matches,inDates,validateDates,expiry,marketOrders,filterMembers,memberBand,stockAt,runway,structureReasons,fuelPlan,transferRow} from './corp-workspace-model.mjs';
import {walletRows,walletBreakdown} from './wallet-view.mjs';
import {contractPreferences} from './contracts-model.mjs';
import {contractsView,contractRows} from './contracts-view.mjs';
import {contractsCSV} from './contracts-model.mjs';
import {stackAssetRows} from './asset-tree.mjs';
import {moonExtractions} from './moon-extractions.mjs';
import {moonIncomeView} from './moon-income-view.mjs';
import {activities,jobState,jobTime,industryJobIcon} from './corp-industry-view.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null||!Number.isFinite(Number(v))?'Unavailable':Number(v).toLocaleString('en-GB',{maximumFractionDigits:2});
const utc=v=>{const d=new Date(v??NaN);return Number.isFinite(d.getTime())?d.toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC':'Unavailable';};
const compactIsk=value=>Number.isFinite(value)?value.toLocaleString('en-GB',{notation:'compact',maximumFractionDigits:1})+' ISK':'Unavailable';
const text=v=>String(v||'').replaceAll('_',' ');
const sum=(rows,key)=>rows.reduce((n,r)=>n+(Number(r[key])||0),0);
const table=(heads,rows)=>`<div class="cw-scroll"><table><thead><tr>${heads.map(h=>'<th>'+esc(h)+'</th>').join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>${rows.length?'':'<p>No records match these filters.</p>'}</div>`;
const td=(...values)=>'<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
const details=(title,body,open=false)=>`<details class="panel compact" ${open?'open':''}><summary>${esc(title)}</summary>${body}</details>`;
function structureIdentity(structure,showType=false){
 const type=Number(structure.type_id);
 const art=Number.isSafeInteger(type)&&type>0
  ?`<img class="cw-structure-icon" src="https://images.evetech.net/types/${type}/icon?size=64" width="26" height="26" loading="lazy" alt="">`
  :'<span class="cw-structure-icon" aria-hidden="true">▥</span>';
 return `<span class="cw-structure-identity">${art}<span><strong>${esc(structure.name)}</strong>${showType?`<small>${esc(structure.system)} · ${esc(structure.type_name)}</small>`:''}</span></span>`;
}
const stats=values=>'<div class="cw-stats">'+values.map(([label,value])=>`<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('')+'</div>';
const defaults={
 'corp-members':{q:'',registration:'',activity:'',sort:'active',group:'account'},
 'corp-pilots':{q:'',quick:'',title:'',role:'',roleKind:'assigned',hangar:'',wallet:'',matrix:false},
 'corp-assets':{q:'',region:'',location:'',category:'',exact:false},
 'corp-search-pilots':{q:'',type:'',name:'',location:'',category:'',exact:false,group:'account'},
 'corp-wallet':{q:'',division:'',mode:'journal',days:'30',type:'',direction:'',from:'',to:'',flows:'all'},
 'corp-market':{q:'',side:'',state:'',expiry:'',sort:'expiry',from:'',to:'',history:false},
 'corp-contracts':contractPreferences(),
 'corp-standings':{q:'',kind:'',sign:'',sort:'low'},
 'corp-industry':{q:'',status:'',activity:'',installer:'',location:'',group:'facility'},
 'corp-structures':{q:'',region:'',kind:'',attention:false,sort:'runway',days:'7'},
 'corp-moons':{q:'',region:'',system:'',state:'',sort:'value',days:'7'}
};
export function corporationWorkspace({api,intro,context,refresh,toast}){
 let refreshTimer=null,page='',scope='',f={},offset=0,exportData=[],copyText='',fuelText='',remoteExport=null,planCatalog=null,batch=[],planResult=null,contractExport=null;
 function load(next){
  const {me}=context(),key='tools-corporation:'+me.main_id+':'+(me.inspect?.main_id||'self')+':'+next;
  if(scope===key)return;page=next;scope=key;offset=0;exportData=[];remoteExport=null;contractExport=null;copyText='';
  f={...(defaults[page]||{})};
  try{const saved=JSON.parse(localStorage.getItem(scope)||'{}');for(const key of Object.keys(f))if(typeof saved[key]===typeof f[key])f[key]=typeof saved[key]==='string'?saved[key].slice(0,200):saved[key];validateDates(f);}catch{f={...(defaults[page]||{})};}
 }
 function save(){try{localStorage.setItem(scope,JSON.stringify(f));}catch{}}
 const button=(action,label)=>`<button type="button" data-cw-action="${action}">${label}</button>`;
 const input=(name,label,type='search')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(f[name]||'')}" ${type==='number'?'min="1"':''}></label>`;
 const pick=(name,label,options)=>`<label>${esc(label)}<select name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${String(f[name]??'')===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
 const check=(name,label)=>`<label class="inline"><input type="checkbox" name="${name}" ${f[name]?'checked':''}> ${esc(label)}</label>`;
 const options=(rows,key)=>[['','All'],...[...new Set(rows.map(r=>r[key]).filter(Boolean))].sort().map(v=>[v,v])];
 function toolbar(fields='',{copy=false,groups=false,exportable=true}={}){return `<form id="cw-filter" class="cw-filters">${fields}<button class="primary">Apply</button>${button('clear','Clear Filters')}${exportable?button('export','Export CSV'):''}${copy?button('copy','Copy List'):''}${groups?button('expand','Expand All')+button('collapse','Collapse All'):''}</form>`;}
 const freshness=d=>`<section class="cw-status" aria-label="Data status"><span>Last successful sync: <strong>${utc(d.updated)}</strong></span>${d.updated&&Date.now()-d.updated>7200000?'<span class="cw-warning">Saved data is over two hours old.</span>':''}${d.error||d.job?.error?`<span class="cw-warning">${esc(d.error||d.job.error)} · Saved results may be incomplete.</span>`:!d.updated?'<span>Data has not been collected yet.</span>':''}${d.refreshing?'<span>Refreshing in the background · saved results remain available.</span>':''}${(d.warnings||[]).map(w=>'<span class="cw-warning">'+esc(w)+'</span>').join('')}</section>`;
 const pageStart=(name,note,d)=>intro(name,note,'<div class="actions"><button data-action="update-view">Update view</button>'+(['corp-industry','corp-structures','corp-moons'].includes(page)&&(context().me.director||context().me.admin)&&!context().me.inspect?'<button data-action="corp-sync">Sync Corporation</button>':'')+'</div>')+(d?freshness(d):'');
 function paginate(rows,render,heads,size=100){
  offset=Math.min(Math.max(0,offset),Math.max(0,Math.floor((rows.length-1)/size)*size));
  return table(heads,rows.slice(offset,offset+size).map(render))+pager(rows.length,size);
 }
 function pager(total,size=100){return `<div class="cw-pagination"><button data-cw-offset="${Math.max(0,offset-size)}" ${offset===0?'disabled':''}>Previous</button><small>${total?offset+1:0}–${Math.min(offset+size,total)} of ${total}</small><button data-cw-offset="${offset+size}" ${offset+size>=total?'disabled':''}>Next</button></div>`;}
 function setExport(heads,rows){exportData=[heads,...rows];}
 function download(value){const url=URL.createObjectURL(new Blob([value],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='tools-'+page+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function overview(){
  const d=await api('/corporation/overview'),c=d.corporation;
  const a=d.attention||{rows:[],coverage:[]};
  const attention=`<section class="panel compact cw-attention"><h2>Needs Attention</h2>${a.rows.length?table(['Section','Saved count','Last successful sync'],a.rows.map(r=>td(`<button data-nav="${esc(r.page)}">${esc(r.label)}</button>`,num(r.count),utc(r.updated)+(r.stale?'<small>Saved data · confirm current state</small>':'')))):'<p>No attention items in the available saved data.</p>'}<small>Only sections you can access are included. Unavailable data is not counted as zero.</small>${details('Coverage',table(['Page','Data available'],a.coverage.map(r=>td(esc(r.page.replace('corp-','')),r.updated?utc(r.updated)+(r.error?' · Latest check failed':''):'Not collected yet'))))}</section>`;
  const id=Number(d.corporationId);
  const taxRate=(percent,fraction,fallback='Unavailable')=>Number.isFinite(percent)?num(percent)+'%':Number.isFinite(fraction)?num(fraction*100)+'%':fallback;
  const sourceLink=(url,label)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  const panel=(title,data,body,link,kind='')=>`<section class="panel compact cw-overview-card ${kind}">
   <header><h2>${esc(title)}</h2>${link}</header>
   ${data?.data?body(data.data):'<p>Data unavailable.</p>'}
   ${data?.error?'<small class="cw-warning">'+esc(data.error)+'</small>':''}
   ${data?.checked?'<small>Checked '+utc(data.checked)+'</small>':''}
  </section>`;
  const membership=(title,data,kind)=>panel(title,data,rows=>{
   const items=rows.map(r=>`<li><img src="https://images.evetech.net/characters/${Number(r.id)}/portrait?size=32" width="24" height="24" loading="lazy" alt=""><span>${sourceLink('https://evewho.com/character/'+Number(r.id),r.name)}</span><small>${esc(r.detail)}</small></li>`);
   return items.length?`<ul class="cw-membership-list">${items.slice(0,5).join('')}</ul>${items.length>5?`<details><summary>Show ${items.length-5} more</summary><ul class="cw-membership-list">${items.slice(5).join('')}</ul></details>`:''}`:'<p>No recent changes reported.</p>';
  },sourceLink('https://evewho.com/corporation/'+id,'EVE Who'),kind);
  const identity=c?.name?`<section class="panel compact cw-corp-identity">
   <div><img src="https://images.evetech.net/corporations/${id}/logo?size=64" width="42" height="42" alt=""><h2>${esc(c.name)} <small>[${esc(c.ticker)}]</small></h2></div>
   ${stats([['Members · ESI',num(c.member_count)],['Founded',utc(c.date_founded).replace(/,? \\d{2}:\\d{2} UTC$/,'')]])}
  </section>`:'';
  return pageStart('Corporation Overview','')+identity+attention+`<div class="cw-overview-grid">
   ${membership('Recent joiners',d.evewho?.joiners,'cw-joiners')}
   ${membership('Recent leavers',d.evewho?.leavers,'cw-leavers')}
   ${panel('Corporation profile',{...d.dotlan,data:d.dotlan?.data||{}},x=>stats([['Members',num(x.members)],['Alliance',x.alliance||'Unavailable'],['CEO',x.ceo||'Unavailable'],['ISK tax',taxRate(c?.tax_rates?.isk,c?.tax_rate,x.tax||'Unavailable')],['LP tax',taxRate(c?.tax_rates?.loyalty_point,c?.lp_tax_rate)]]),sourceLink('https://evemaps.dotlan.net/corp/'+(c?.name?encodeURIComponent(c.name.replaceAll(' ','_')):id),'DOTLAN'))}
   ${panel('Combat record',d.zkill,x=>stats([['Ships destroyed',num(x.shipsDestroyed)],['Ships lost',num(x.shipsLost)],['ISK destroyed',compactIsk(x.iskDestroyed)],['ISK lost',compactIsk(x.iskLost)]])+'<small>All-time totals from reported killmails.</small>',sourceLink('https://zkillboard.com/corporation/'+id+'/','zKillboard'))}
  </div>`;
 }
 async function members(){
  const d=await api('/corporation/members'),rows=filterMembers(d.rows||[],f),people=new Set((d.rows||[]).map(r=>r.account_main_id).filter(Boolean)).size;
  setExport(['Pilot','Registered account','Activity band','Last active UTC','Ship','Location','Registered'],rows.map(r=>[r.name,r.account_main_name,memberBand(r),r.last_active,r.ship,r.location,r.signed_up?'Yes':'No']));
  const record=r=>td(esc(r.name)+(r.account_main_name?'<small>'+esc(r.account_main_name)+'</small>':''),utc(r.last_active),esc(({recent:'Under 7 days',7:'7–29 days',30:'30–89 days',90:'90+ days',unknown:'Unavailable'})[memberBand(r)]),esc(r.ship||'Unavailable'),esc(r.location||'Unavailable'),r.signed_up?'Registered':'Not registered');
  let list;
  if(f.group==='account'){
   const groups=new Map();for(const r of rows){const key=r.account_main_id?'account:'+r.account_main_id:'pilot:'+r.id;if(!groups.has(key))groups.set(key,{name:r.account_main_name||r.name,rows:[]});groups.get(key).rows.push(r);}
   list=[...groups.values()].map(g=>details(g.name+' · '+g.rows.length+' pilots',table(['Pilot','Last active · UTC','Inactivity','Ship','Location','Site'],g.rows.map(record)))).join('')||'<p>No matching pilots.</p>';
  }else list=paginate(rows,record,['Pilot','Last active · UTC','Inactivity','Ship','Location','Site']);
  return pageStart('Memberlist','Latest recorded EVE activity. Unknown activity is kept separate from inactivity.',d)+stats([['Corporation pilots',num(d.rows?.length||0)],['Registered people',num(people)],['Unregistered',num((d.rows||[]).filter(r=>!r.signed_up).length)],['Matching pilots',num(rows.length)]])+
   toolbar(input('q','Search')+pick('registration','Registration',[['','All'],['yes','Registered'],['no','Unregistered']])+pick('activity','Activity',[['','All'],['recent','Under 7 days'],['7','Inactive 7+ days'],['30','Inactive 30+ days'],['90','Inactive 90+ days'],['unknown','Activity unavailable']])+pick('sort','Sort',[['active','Last active · newest'],['inactive','Inactivity · oldest'],['name','Name']])+pick('group','Group',[['account','Registered account'],['none','Flat list']]),{groups:true})+list;
 }
 async function pilots(){
  const d=await api('/corporation/pilots'),all=d.rows||[],rights=r=>Object.values(r.rights?.[f.roleKind]||{}).flat();
  const rows=all.filter(r=>matches(f.q,r.name,r.titles?.map(t=>t.name),rights(r))&&(!f.quick||(f.quick==='directors'?r.rights?.all:f.quick==='financial'?r.rights?.financial_roles?.length:f.quick==='grantable'?Object.values(r.rights?.grantable||{}).some(v=>v.length):!r.rights||r.titles_available===false))&&(!f.title||r.titles?.some(t=>String(t.id)===f.title))&&(!f.role||rights(r).includes(f.role))&&(!f.hangar||r.rights?.all||r.rights?.access?.some(a=>a.kind==='hangar'&&String(a.division)===f.hangar))&&(!f.wallet||r.rights?.all||r.rights?.access?.some(a=>a.kind==='wallet'&&String(a.division)===f.wallet)));
  const divisions=kind=>[['','All'],...Array.from({length:7},(_,i)=>[String(i+1),d.divisions?.[kind]?.find(a=>a.division===i+1)?.name||kind+' '+(i+1)])];
  const access=(r,kind,n)=>!r.rights?'Unavailable':r.rights.all?'All':(r.rights.access||[]).filter(a=>a.kind===kind&&a.division===n).map(a=>a.where+': '+a.rights.join('/')).join('; ')||'—';
  setExport(['Pilot','Titles','Assigned roles','Grantable roles',...Array.from({length:7},(_,i)=>'Hangar '+(i+1)),...Array.from({length:7},(_,i)=>'Wallet '+(i+1))],rows.map(r=>[r.name,r.titles?.map(t=>t.name).join('; '),Object.values(r.rights?.assigned||{}).flat().join('; '),Object.values(r.rights?.grantable||{}).flat().join('; '),...Array.from({length:7},(_,i)=>access(r,'hangar',i+1)),...Array.from({length:7},(_,i)=>access(r,'wallet',i+1))]));
  const heads=f.matrix?['Pilot',...Array.from({length:7},(_,i)=>'Hangar '+(i+1)),...Array.from({length:7},(_,i)=>'Wallet '+(i+1))]:['Pilot','Titles','Assigned / grantable roles','Hangar & wallet access'];
  return pageStart('Roles and Access','Compare reported access. Grantable roles are permission to assign roles, not personal access.',d)+
   toolbar(input('q','Search')+pick('quick','Quick filter',[['','All pilots'],['directors','CEO / Directors'],['financial','Financial roles'],['grantable','Can grant roles'],['unavailable','Role / title data unavailable']])+pick('roleKind','Role type',[['assigned','Assigned'],['grantable','Grantable']])+pick('role','Role',[['','All'],...[...new Set(all.flatMap(rights))].sort().map(r=>[r,text(r)])])+pick('title','Title',[['','All'],...(d.titles||[]).map(t=>[t.id,t.name.replace(/<[^>]*>/g,'')])])+pick('hangar','Hangar',divisions('hangar'))+pick('wallet','Wallet',divisions('wallet'))+check('matrix','Access matrix'))+
   stats([['Matching pilots',num(rows.length)],['Directors',num(rows.filter(r=>r.rights?.all).length)],['Missing role data',num(rows.filter(r=>!r.rights).length)]])+
   paginate(rows,r=>f.matrix?td(esc(r.name),...Array.from({length:7},(_,i)=>esc(access(r,'hangar',i+1))),...Array.from({length:7},(_,i)=>esc(access(r,'wallet',i+1)))):
    td(esc(r.name),r.titles_available===false?'Unavailable':esc(r.titles?.map(t=>t.name.replace(/<[^>]*>/g,'')).join(' · ')||'None reported'),details('Assigned roles',esc(Object.values(r.rights?.assigned||{}).flat().join(', ')||'None / unavailable'))+details('Grantable roles',esc(Object.values(r.rights?.grantable||{}).flat().join(', ')||'None / unavailable')),r.rights?.all?'CEO / Director · all divisions':(r.rights?.access||[]).map(a=>'<small>'+esc(a.name+' · '+a.where+' · '+a.rights.join('/'))+'</small>').join('')||'None / unavailable'),heads)+
   '<small>Structure ACLs, container locks, location scopes and base assignments may affect actual access.</small>';
 }
 async function wallet(){
  const d=await api('/corporation/wallet'),divisions=d.rows||[],selected=f.division?divisions.filter(r=>String(r.division)===f.division):divisions;
  const raw=walletRows(selected.map(r=>({id:r.division,name:r.name,data:{journal:r.journal,transactions:r.transactions,names:d.names||{}}})),{...f,type:'',days:f.from||f.to?'all':f.days}).filter(r=>inDates(r.date,f));
  const rows=raw.filter(r=>(!f.type||r.transaction_type===f.type)&&(f.flows==='all'||(f.flows==='transfers')===transferRow(r))),incoming=rows.reduce((n,r)=>n+Math.max(0,r.amount||0),0),outgoing=rows.reduce((n,r)=>n-Math.min(0,r.amount||0),0);
  const types=options(raw,'transaction_type');
  setExport(['Date UTC','Division','Type','Detail','Counterparty','Quantity','Unit price ISK','Amount ISK','Balance ISK'],rows.map(r=>[r.date,r.pilot,r.transaction_type,r.detail,r.parties,r.quantity,r.unit_price,r.amount,r.balance]));
  return pageStart('Corporation Wallet','Journal and transactions overlap; view them separately. Net cash flow is not profit.',d)+stats([['Corporation balance · ISK',divisions.length?num(divisions.reduce((n,r)=>n+r.balance,0)):'Unavailable'],['Recorded in · ISK',num(incoming)],['Recorded out · ISK',num(outgoing)],['Net cash flow · ISK',num(incoming-outgoing)]])+
   toolbar(input('q','Search')+pick('division','Division',[['','All divisions'],...divisions.map(r=>[r.division,r.name])])+pick('mode','View',[['journal','Journal'],['transactions','Market transactions']])+pick('days','Period · dates override',[['7','7 days'],['30','30 days'],['90','90 days'],['all','All retained']])+input('from','From · UTC','date')+input('to','To · UTC','date')+pick('direction','Direction',[['','All'],['in','ISK in'],['out','ISK out']])+pick('type','Category',types)+(f.mode==='journal'?pick('flows','Cash flow',[['all','All'],['transfers','Transfers / donations'],['operating','Other cash flow']]):''))+
   details('Wallet divisions',table(['Division','Balance · ISK'],divisions.map(r=>td(esc(r.name),num(r.balance)))))+
   details('Breakdown · current filters',table(['Category','Entries','In · ISK','Out · ISK','Net · ISK'],walletBreakdown(rows).map(r=>td(esc(text(r.type)),num(r.count),num(r.income),num(r.expense),num(r.income-r.expense)))))+
   paginate(rows,r=>td(utc(r.date),esc(r.pilot),esc(text(r.transaction_type)),esc(r.detail),esc(r.parties),f.mode==='transactions'?num(r.quantity)+' × '+num(r.unit_price):num(r.balance),num(r.amount)),['Date · UTC','Division','Category','Description / item','Parties',f.mode==='transactions'?'Quantity × price':'Balance after','Amount · ISK'])+
   '<small>Transfers / donations groups known donation and corporation payment categories; it does not prove the destination is another wallet division. History is limited to imported snapshots.</small>';
 }
 async function contracts(){
  const d=await api('/corporation/contracts'),pilots=[{name:'Corporation',data:d,updated:d.updated,error:d.error}],filters={...contractPreferences(f),direction:'',availability:''};
  if(d.refreshing){const currentScope=scope;refreshTimer=setTimeout(()=>{if(page==='corp-contracts'&&(!context().page||context().page==='corp-contracts')&&scope===currentScope&&!document.hidden)refresh();},10000);refreshTimer.unref?.();}
  const rows=contractRows(pilots,filters);contractExport=()=>contractsCSV(rows);
  return pageStart('Corporation Contracts','Review deadlines, courier deliveries and retained contract history.',d)+
   contractsView(pilots,filters,offset,true).replace('id="contracts-filter"','id="cw-filter"').replaceAll('data-contract-action','data-cw-action').replaceAll('data-contract-offset','data-cw-offset').replaceAll('data-contracts-offset','data-cw-offset').replace('Unique contracts across selected pilots','Unique corporation contracts').replace('Some pilots have missing, stale or failed snapshots.','Corporation contract data is missing, stale or its last refresh failed.').replace(/<label>Direction[\s\S]*?<\/label>/,'').replace(/<label>Availability[\s\S]*?<\/label>/,'');
 }
 async function market(){
  const d=await api('/corporation/market'),rows=marketOrders(d,f),active=rows.filter(r=>r.status==='active');
  setExport(['Order ID','Item','Side','Status','Remaining','Total','Price ISK','Remaining value ISK','Location','Issued UTC','Scheduled expiry UTC'],rows.map(r=>[r.order_id,r.name,r.is_buy_order?'Buy':'Sell',r.status,r.volume_remain,r.volume_total,r.price,r.price*r.volume_remain,d.locations?.[r.location_id]||r.location_id,r.issued,expiry(r)?new Date(expiry(r)).toISOString():'']));
  return pageStart('Corporation Market','Scheduled expiry is based on the issued date and duration. Orders may close earlier.',d)+stats([['Matching orders',num(rows.length)],['Active buys · ISK',num(active.filter(r=>r.is_buy_order).reduce((n,r)=>n+r.price*r.volume_remain,0))],['Active sells · ISK',num(active.filter(r=>!r.is_buy_order).reduce((n,r)=>n+r.price*r.volume_remain,0))],['Expiring within 24h',num(active.filter(r=>expiry(r)>Date.now()&&expiry(r)-Date.now()<=DAY).length)]])+
   toolbar(input('q','Search')+pick('side','Orders',[['','Buy & sell'],['buy','Buy'],['sell','Sell']])+pick('state','Status',[['','All'],['active','Active'],['fulfilled','Fulfilled'],['cancelled','Cancelled'],['expired','Expired']])+pick('expiry','Expiry',[['','Any'],['1','Within 24 hours'],['7','Within 7 days']])+pick('sort','Sort',[['expiry','Expiry · soonest'],['issued','Issued · newest'],['value','Remaining value · highest']])+input('from','Issued from','date')+input('to','Issued to','date')+check('history','Include closed orders'))+
   paginate(rows,r=>`<tr class="${r.status==='active'&&expiry(r)>Date.now()&&expiry(r)-Date.now()<=DAY?'cw-urgent':''}"><td>${esc(r.name)}</td><td>${r.is_buy_order?'Buy':'Sell'}</td><td>${esc(text(r.status))}</td><td>${num(r.volume_remain)} / ${num(r.volume_total)}</td><td>${num(r.price)}</td><td>${num(r.price*r.volume_remain)}</td><td>${esc(d.locations?.[r.location_id]||'Location '+r.location_id)}</td><td>${utc(r.issued)}</td><td>${utc(expiry(r))}</td></tr>`,['Item','Side','Status','Remaining / total','Unit price · ISK','Remaining value · ISK','Location','Issued · UTC','Scheduled expiry · UTC']);
 }
 async function assets(){
  const query=new URLSearchParams({...f,offset}),d=await api('/corporation/assets?'+query);
  const exportRows=rows=>[['Item','Type ID','Quantity','Location','Container ID','Flag'],...rows.map(r=>[r.name,r.type_id,r.quantity,r.location,r.location_id,r.location_flag])];
  remoteExport=async()=>{const all=await api('/corporation/assets?'+new URLSearchParams({...f,export:'1'}));if(all.truncated)throw Error('More than 100,000 matches. Narrow the filters before exporting.');return exportRows(all.exportRows||[]);};
  const visible=d.locations.flatMap(l=>l.items.filter(r=>!r.context&&!r.empty_office));
  copyText=visible.map(r=>r.name+'\t'+r.quantity).join('\n');
  return pageStart('Corporation Assets','Filter saved stock. Matching items retain their container and ship context.',d)+stats([['Matching stacks',num(d.total)],['Locations',num(d.locationCount)]])+
   toolbar(input('q','Item / custom name')+check('exact','Search Exact')+pick('category','Category',[['','All'],['ships','Ships'],['modules','Modules'],['charges','Charges'],['blueprints','Blueprints'],['drones','Drones'],['structures','Structures']])+pick('region','Region',[['','All'],...(d.regions||[]).map(r=>[r,r]),...(d.hasUnknownRegion?[['__unknown','Unknown region']]:[])])+input('location','Location'),{copy:true,groups:true})+
   '<small>Copy List covers matching items on the displayed location page. Export CSV includes all matching locations.</small>'+
   (d.locations||[]).map(l=>details(l.name+' · '+(l.region||'Unknown region')+' · '+l.items.filter(a=>!a.context).length+' stacks',table(['Item','Quantity','Container / flag'],stackAssetRows(l.items).map(r=>td((r.depth?'↳ '.repeat(Math.min(r.depth,5)):'')+esc(r.name)+(r.context?'<small>Container / ship context</small>':''),num(r.quantity),esc(r.location_flag)+(r.location_id!==r.root_location_id?'<small>Container '+esc(r.location_id)+'</small>':'')))))).join('')+pager(d.locationCount,20);
 }
 async function searchPilots(){
  const params=()=>({...f,exact:f.exact?'1':'0',offset}),d=await api('/corporation/pilot-assets?'+new URLSearchParams(params()));
  const head=['Account main ID','Pilot','Item','Type','Quantity','Location','Container','Inventory UTC'];
  const cells=r=>[r.account,r.character,r.name,r.type,r.quantity,r.location,r.container,utc(r.updated)];
  remoteExport=async()=>{const all=await api('/corporation/pilot-assets?'+new URLSearchParams({...params(),export:'1'}));if(all.truncated)throw Error('More than 100,000 matches. Narrow the filters.');return [head,...all.rows.map(cells)];};
  const groupLabel=r=>f.group==='account'?r.account_name||'Account main '+r.account:f.group==='item'?r.type:r.location;
  const groups=new Map();for(const r of d.rows){const key=groupLabel(r);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  return pageStart('Search Pilots','Saved personal inventories across registered accounts. Other administrators remain protected.')+
   stats([['Matches',num(d.total)],['Pilots with inventory',num(d.sources.filter(s=>s.updated).length)+' / '+d.sources.length],['Custom names pending',num(d.sources.filter(s=>s.names_status!=='complete').length)]])+
   toolbar(input('q','Search')+input('type','Item type')+input('name','Custom name')+check('exact','Exact custom name')+input('location','Location')+pick('category','Category',[['','All'],['ships','Ships'],['modules','Modules']])+pick('group','Group by',[['account','Account'],['item','Item type'],['location','Location']]),{groups:true})+
   (d.protected_pilots?'<p class="cw-warning">Other administrators are excluded.</p>':'')+(!d.searching?'<p>Enter at least one search filter, then Apply.</p>':!d.rows.length?'<p>No matching assets in the saved inventories.</p>':'')+
   [...groups].map(([label,rows])=>details(label,table(['Pilot','Item / custom name','Quantity','Location','Snapshot'],rows.map(r=>td(esc(r.character),esc(r.type)+'<small>'+esc(r.name)+'</small>',num(r.quantity),esc(r.location)+(r.container?'<small>'+esc(r.container)+'</small>':''),utc(r.updated)+(r.error?'<small>Latest sync failed</small>':'')))),true)).join('')+pager(d.total)+
   details('Inventory coverage',table(['Pilot','Last successful sync','Custom names'],d.sources.map(s=>td(esc(s.name),utc(s.updated),esc(s.names_status)+(s.error?'<small>Latest sync failed</small>':'')))))+
   '<small>Groups may continue on the next page. Missing or incomplete snapshots cannot prove that a pilot has no matching assets.</small>';
 }
 async function standings(){
  const d=await api('/corporation/standings'),rows=(d.rows||[]).filter(r=>matches(f.q,r.name)&&(!f.kind||r.from_type===f.kind)&&(!f.sign||(f.sign==='positive'?r.standing>0:f.sign==='negative'?r.standing<0:r.standing===0))).sort((a,b)=>f.sort==='name'?a.name.localeCompare(b.name):f.sort==='high'?b.standing-a.standing:a.standing-b.standing);
  const standingName=r=>{
   const kind={npc_corp:'corporations',corporation:'corporations',alliance:'alliances',faction:'factions',agent:'characters'}[r.from_type];
   const id=Number(r.from_id);
   return `<span class="cw-standing-name">${kind&&Number.isSafeInteger(id)&&id>0?`<img src="https://images.evetech.net/${kind}/${id}/${kind==='characters'?'portrait':'logo'}?size=32" width="24" height="24" alt="" loading="lazy">`:''}${esc(r.name)}</span>`;
  };
  setExport(['Name','Type','Standing'],rows.map(r=>[r.name,r.from_type,r.standing]));
  return pageStart('Corporation Standings','Faction, corporation and agent standings are grouped separately.',d)+toolbar(input('q','Search')+pick('kind','Type',options(d.rows||[],'from_type'))+pick('sign','Standing',[['','All'],['positive','Positive'],['neutral','Neutral'],['negative','Negative']])+pick('sort','Sort',[['low','Standing · lowest'],['high','Standing · highest'],['name','Name']]))+
   stats([['Positive',num(rows.filter(r=>r.standing>0).length)],['Neutral',num(rows.filter(r=>r.standing===0).length)],['Negative',num(rows.filter(r=>r.standing<0).length)]])+
   [...new Set(['faction','npc_corp','agent','corporation','alliance',...rows.map(r=>r.from_type)])].map(kind=>{const group=rows.filter(r=>r.from_type===kind);return group.length?details(text(kind)+' · '+group.length,table(['Name','Standing'],group.map(r=>td(standingName(r),`<strong class="cw-standing-tone ${r.standing<0?'wallet-out':r.standing>0?'wallet-in':'muted'}">${r.standing>0?'+':''}${esc(r.standing)}</strong>`))),true):'';}).join('')+
   (rows.length?'':'<p>No matching standings.</p>');
 }
 async function industry(){
  const d=await api('/corporation/industry'),all=d.rows||[],rows=all.filter(r=>matches(f.q,r.name,r.installer,r.location)&&(!f.status||(f.status==='ready'?jobState(r).startsWith('ready'):jobState(r)===f.status))&&(!f.activity||String(r.activity_id)===f.activity)&&(!f.installer||r.installer===f.installer)&&(!f.location||r.location===f.location)).sort((a,b)=>Number(!jobState(a).startsWith('ready'))-Number(!jobState(b).startsWith('ready'))||Date.parse(a.end_date)-Date.parse(b.end_date));
  setExport(['Product','Activity','Runs','Installer','Facility','Status','Completion UTC'],rows.map(r=>[r.name,activities[r.activity_id],r.runs,r.installer,r.location,jobState(r),r.end_date]));
  offset=Math.min(offset,Math.max(0,Math.floor((rows.length-1)/100)*100));const groups=new Map();
  for(const r of rows.slice(offset,offset+100)){const label=f.group==='installer'?r.installer:f.group==='facility'?r.location:'Outstanding jobs';if(!groups.has(label))groups.set(label,[]);groups.get(label).push(r);}
  return pageStart('Corporation Industry','Completion timers are estimates until ESI confirms that a job is ready. Deliver jobs in EVE.',d)+stats([['Running',num(all.filter(r=>jobState(r)==='active').length)],['Ready',num(all.filter(r=>jobState(r).startsWith('ready')).length)],['Paused',num(all.filter(r=>r.status==='paused').length)]])+
   toolbar(input('q','Search')+pick('status','Status',[['','All outstanding'],['active','Running'],['ready','Ready to deliver'],['paused','Paused']])+pick('activity','Activity',[['','All'],...[...new Set(all.map(r=>r.activity_id))].map(v=>[v,activities[v]||v])])+pick('installer','Installer',options(all,'installer'))+pick('location','Facility',options(all,'location'))+pick('group','Group',[['facility','Facility'],['installer','Installer'],['none','Flat list']]),{groups:true})+
   [...groups].map(([label,list])=>details(label,table(['Product','Activity','Runs','Installer','Facility','Status','Completion · UTC'],list.map(r=>td(industryJobIcon(r)+esc(r.name),esc(activities[r.activity_id]||r.activity_id),num(r.runs),esc(r.installer),esc(r.location),esc(({active:'Running',ready:'Ready to deliver','ready-estimated':'Ready (estimated)',paused:'Paused'})[jobState(r)]||text(r.status)),utc(r.end_date)+'<small>'+(r.status==='paused'?'Completion may change while paused':r.status==='ready'?'Confirmed ready':jobTime(r.end_date))+'</small>'))),true)).join('')+pager(rows.length)+batchPlanner();
 }
 function batchPlanner(){
  return details('Manufacturing · combined shopping list',`<small>Select up to 50 jobs. Requirements are rounded per job. Inventory across corporation locations is counted once and is not reserved.</small>${button('load-planner','Load Blueprints')}${planCatalog?`<form id="cw-batch-add" class="cw-filters"><label>Blueprint<select name="blueprint">${planCatalog.blueprints.map(bp=>`<option value="${esc(bp.selection)}">${esc(bp.name)} · ME ${bp.material_efficiency}${bp.quantity===-2?' · '+bp.runs+' runs left':''}</option>`).join('')}</select></label><label>Runs<input type="number" name="runs" value="1" min="1" max="100000" required></label><button>Add Job</button></form>${table(['Blueprint','Runs',''],batch.map((line,i)=>td(esc(planCatalog.blueprints.find(bp=>bp.selection===line.blueprint)?.name),num(line.runs),`<button data-cw-remove-job="${i}">Remove</button>`)))}<form id="cw-batch-calculate" class="cw-filters"><label>Facility reduction %<input name="facility" type="number" min="0" max="50" step=".01" value="0"></label><label>Rig reduction %<input name="rig" type="number" min="0" max="50" step=".01" value="0"></label><button ${batch.length?'':'disabled'}>Calculate Combined Materials</button></form>${planResult?freshness(planResult)+table(['Material','Required','Saved stock','To buy'],planResult.materials.map(m=>td(esc(m.name),num(m.required),num(m.available),num(m.missing))))+button('copy-materials','Copy Shopping List')+'<small>'+esc(planResult.note)+'</small>':''}`:'<p>Load the saved manufacturing blueprint inventory to begin.</p>'}`,!!planCatalog);
 }
 function structureFitting(s,detailId){
  const expandable=s.fitting||/^(?:Astrahus|Fortizar|Keepstar|Raitaru|Azbel|Sotiyo|Athanor|Tatara)$|(?:Fortizar|Keepstar)$/i.test(s.type_name);
  if(!expandable)return {identity:structureIdentity(s,true),detail:""};
  const items=s.fitting?.items||[],groups=[
   ['High slots',/^HiSlot/,'HiSlot'],['Mid slots',/^MedSlot/,'MedSlot'],['Low slots',/^LoSlot/,'LoSlot'],
   ['Rigs',/^RigSlot/,'RigSlot'],['Service slots',/^ServiceSlot/,'ServiceSlot'],['Ammunition',/Ammo/],['Fighters',/^Fighter/,'FighterTube'],['Drones',/^DroneBay$/],['Quantum core',/^QuantumCoreRoom$/]
  ];
  const sections=groups.map(([label,pattern,prefix])=>{
   const fitted=items.filter(item=>pattern.test(item.slot));
   const occupied=new Set(fitted.map(item=>item.slot));
   const empty=Array.from({length:s.fitting?.slots?.[prefix]||0},(_,index)=>prefix+index)
    .filter(slot=>!occupied.has(slot)).map(slot=>({slot}));
   const slots=[...fitted,...empty]
    .sort((a,b)=>a.slot.localeCompare(b.slot,undefined,{numeric:true})||a.name.localeCompare(b.name));
   if(!slots.length)return '';
   return `<section><h4>${esc(label)}</h4><ul>${slots.map(item=>item.type_id?`<li><img class="eve-icon" src="https://images.evetech.net/types/${Number(item.type_id)}/icon?size=32" alt="" loading="lazy"><span>${esc(item.name)}</span><strong>${num(item.quantity)}</strong></li>`:`<li class="cw-empty-slot"><span aria-hidden="true">○</span><span>Empty ${prefix==='FighterTube'?'tube':'slot'} ${Number(item.slot.slice(prefix.length))+1}</span></li>`).join('')}</ul></section>`;
  }).join('');
  const content=s.fitting
   ?`<small>Fittings synced ${utc(s.fitting.updated)}</small>${sections?`<div class="cw-fitting-groups">${sections}</div>`:'<small>No fitting items reported.</small>'}`
   :'<small>Fittings will appear after the next successful corporation sync.</small>';
  return {
   identity:`<details class="cw-structure-fitting"><summary aria-controls="${detailId}">${structureIdentity(s,true)}<span class="cw-fitting-label">Fittings</span></summary></details>`,
   detail:`<tr class="cw-fitting-row"><td colspan="5"><div class="cw-fitting-content" id="${detailId}">${content}</div></td></tr>`
  };
 }
 function structureTable(rows,moon=false,section="all"){
  if(moon)
   return table(['Structure / system','Region','State','Timer · UTC','Fuel stock / days','Gas stock / days',moon?'Stored value · ISK':'Services'],rows.map(s=>td(structureIdentity(s,true),esc(s.region||'Unknown'),esc(moon?s.mining:text(s.state))+(structureReasons(s).length?'<small class="cw-warning">'+esc(structureReasons(s).join(' · '))+'</small>':''),s.timer?utc(s.timer):'—',num(stockAt(s))+'<small>'+num(runway(s))+' days</small>',s.kind==='Moon Drill'?num(stockAt(s,'gas'))+'<small>'+num(runway(s,'gas'))+' days</small>':'—',moon?num(s.total_value):esc((s.services||[]).map(v=>v.name+' · '+v.state).join(', ')||'Not reported'))));
  return `<div class="cw-structures-table">${table(['Structure / system','Region','State','Fuel stock / days','Services'],rows.map((s,index)=>{
   const reasons=structureReasons(s);
   const fuel=`<strong>${num(stockAt(s))}</strong><small>${num(runway(s))} days</small>`;
   const gas=s.kind==='Moon Drill'?`<small class="cw-drill-gas">Gas ${num(stockAt(s,'gas'))} · ${num(runway(s,'gas'))} days</small>`:'';
   const state=`<span class="cw-structure-state${reasons.length?' cw-warning':''}">${esc(text(s.state))}</span>${reasons.length?'<small class="cw-warning">'+esc(reasons.join(' · '))+'</small>':''}`;
   const fitting=structureFitting(s,'cw-fitting-'+section+'-'+index);
   return td(fitting.identity,esc(s.region||'Unknown'),state,fuel+gas,esc((s.services||[]).map(v=>v.name+' · '+v.state).join(', ')||'Not reported'))+fitting.detail;
  }))}</div>`;
 }
 async function structures(moon=false){
  const d=await api(moon?'/corporation/harvest':'/corporation/structures'),all=d.structures||[],eligible=moon?all.filter(s=>s.kind==='Moon Drill'):all;
  let rows=eligible.filter(s=>matches(f.q,s.name,s.system,s.type_name)&&(!f.region||s.region===f.region)&&(!f.system||s.system===f.system)&&(!f.kind||s.kind===f.kind)&&(!f.state||s.mining===f.state)&&(!f.attention||structureReasons(s).length));
  const valueMap=new Map((d.income||[]).flatMap(r=>r.drills.map(drill=>[drill.id,drill.monthly])));
  rows=rows.sort((a,b)=>f.sort==='name'?a.name.localeCompare(b.name):f.sort==='value'?(valueMap.get(b.id)??-1)-(valueMap.get(a.id)??-1):(Math.min(runway(a)??Infinity,runway(a,'gas')??Infinity))-(Math.min(runway(b)??Infinity,runway(b,'gas')??Infinity)));
  setExport(['Structure','System','Region','Type','State','Mining','Timer UTC','Fuel blocks','Fuel days','Gas','Gas days','Inventory UTC'],rows.map(s=>[s.name,s.system,s.region,s.type_name,s.state,s.mining,s.timer,stockAt(s),runway(s),stockAt(s,'gas'),runway(s,'gas'),utc(s.inventory_at)]));
  const plan=fuelPlan(rows,Number(f.days)||7);fuelText=plan.items.map(r=>r.name+'\t'+r.quantity).join('\n');copyText=fuelText;
  const attention=eligible.filter(s=>structureReasons(s).length);
  const fields=input('q','Search')+pick('region','Region',options(eligible,'region'))+(moon?pick('system','System',options(eligible,'system'))+pick('state','Harvesting',[['','All'],['online','Harvesting'],['offline','Not harvesting'],['unknown','Unknown']]):pick('kind','Type',options(eligible,'kind'))+check('attention','Needs attention'))+pick('sort','Sort',moon?[['value','Production value · highest'],['runway','Fuel / gas · lowest'],['name','Name']]:[['runway','Fuel / gas · lowest'],['name','Name']])+pick('days','Fuel planning',[['7','7 days'],['30','30 days']]);
  let body=pageStart(moon?'Moon Mining':'Structures',moon?'Production, extraction schedules and collections by region. Estimates exclude operating costs.':'Operational status, fuel runway and saved citadel fittings.',{...d,error:d.job?.error})+
   (moon?moonExtractions({...d.extractions,rows:(d.extractions?.rows||[]).filter(e=>{const s=(d.refineries||[]).find(s=>s.id===e.structure_id);return s&&matches(f.q,s.name,s.system)&&(!f.region||s.region===f.region)&&(!f.system||s.system===f.system);})},d.refineries||[]):'')+
   (attention.length?details('Attention Required · '+attention.length,structureTable(attention,moon,"attention"),true):'')+toolbar(fields,{copy:true,groups:true})+
   stats([['Shown',num(rows.length)+' / '+eligible.length],['Attention',num(attention.length)],['Unknown fuel rate',num(rows.filter(s=>runway(s)==null).length)]])+
   details('Fuel shopping list · filtered structures · '+(Number(f.days)||7)+' days',table(['Item','To buy'],plan.items.map(r=>td(esc(r.name),num(r.quantity))))+button('copy-fuel','Copy Fuel Shopping List')+(plan.unknown.length?'<small class="cw-warning">Excluded unknown amounts/types: '+esc(plan.unknown.join('; '))+'</small>':'')+'<small>Consumption is projected. Offline services may consume no fuel. No stock is reserved.</small>')+
   (moon?'':structureTable(rows,moon));
  if(moon){
   setExport(['Drill','System','Region','Mining','Material','Stored quantity','Unit price ISK','Stored value ISK','Production value per 30 days ISK','Inventory UTC'],rows.flatMap(s=>(s.materials?.length?s.materials:[{}]).map(m=>[s.name,s.system,s.region,s.mining,m.name||'Empty',m.quantity??0,m.unit_price,m.value,valueMap.get(s.id),utc(s.inventory_at)])));
   const ids=new Set(rows.map(s=>s.id)),regions=(d.income||[]).map(r=>{const drills=r.drills.filter(x=>ids.has(x.id)),live=drills.filter(x=>x.state==='online'),known=live.filter(x=>x.monthly!=null);return {...r,drills,online:live.length,known:known.length,unknown:live.length-known.length,partial:known.filter(x=>x.partial).length,monthly:known.length?known.reduce((n,x)=>n+x.monthly,0):null};}).filter(r=>r.drills.length);
   body+=moonGooView(rows,regions,{esc,num})+structureTable(rows,moon)+moonIncomeView(regions,{esc,num});
   const collections=new Map();for(const s of rows){const region=s.region||'Unknown';if(!collections.has(region))collections.set(region,[]);collections.get(region).push(s);}
   copyText=rows.map(s=>[s.region||'Unknown',s.system,s.name,...(s.materials||[]).map(m=>m.name+' '+m.quantity)].join('\t')).join('\n');
   body+=details('Collection list · filtered drills',button('copy-collections','Copy Collection List')+[...collections].map(([region,drills])=>details(region,drills.map(s=>details(s.name,table(['Material','Stored units','Value · ISK'],(s.materials||[]).map(m=>td(esc(m.name),num(m.quantity),num(m.value)))))+details('Observed collection history',table(['From · UTC','To · UTC','Emptied','Minimum removed'],(s.history||[]).map(h=>td(utc(h.from),utc(h.to),h.emptied?'Yes':'No',esc((h.items||[]).map(m=>m.name+' '+m.quantity).join('; '))))))).join(''))).join(''));
   body+='<small>Collection history records minimum decreases between snapshots, not lifetime production. Income totals distinguish valued, partial and unavailable surveys.</small>';
  }else{
   const detailRows=rows.map(s=>{
    const stock=table(['Resource','Reported stock'],(s.fuels||[]).map(i=>td(esc(i.name),num(i.quantity))));
    const services=table(['Service','State'],(s.services||[]).map(v=>td(esc(v.name),esc(v.state))));
    return `<details class="panel compact"><summary>${structureIdentity(s)}</summary>${stock}${services}<small>Unanchors: ${utc(s.unanchors_at)} · Reinforcement hour: ${esc(s.reinforce_hour??'Unknown')}</small></details>`;
   });
   body+=details('Structure details & top-ups',detailRows.join(''));
  }
  return body;
 }
 async function render(next){
  clearTimeout(refreshTimer);if(!corpPages.includes(next))return null;load(next);remoteExport=null;contractExport=null;
  const functions={'corp-overview':overview,'corp-members':members,'corp-pilots':pilots,'corp-wallet':wallet,'corp-contracts':contracts,'corp-market':market,'corp-assets':assets,'corp-search-pilots':searchPilots,'corp-standings':standings,'corp-industry':industry,'corp-structures':()=>structures(false),'corp-moons':()=>structures(true)};
  return '<div class="corp-workspace">'+await functions[next]()+'</div>';
 }
 document.addEventListener('change',e=>{if(e.target.name==='roleKind'&&e.target.closest('#cw-filter')){e.target.form.elements.role.value='';e.target.form.requestSubmit();}});
 document.addEventListener('submit',async e=>{
  if(!['cw-filter','cw-batch-add','cw-batch-calculate'].includes(e.target.id))return;e.preventDefault();
  try{
   const form=new FormData(e.target);
   if(e.target.id==='cw-filter'){
    const next={...(defaults[page]||{}),...Object.fromEntries(form)};
    for(const [key,value] of Object.entries(defaults[page]||{}))if(typeof value==='boolean')next[key]=form.has(key);
    validateDates(next);f=next;offset=0;save();
   }else if(e.target.id==='cw-batch-add'){
    const runs=Number(form.get('runs'));if(!Number.isSafeInteger(runs)||runs<1||runs>100000||batch.length>=50)throw Error('Choose 1–100,000 runs, up to 50 jobs.');
    batch.push({blueprint:String(form.get('blueprint')),runs});planResult=null;
   }else{planResult=await api('/material-planner/corporation/batch',{jobs:batch,facility:Number(form.get('facility')),rig:Number(form.get('rig'))});}
   await refresh();
  }catch(error){toast(error.message);}
 });
 document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||!b.closest('.corp-workspace'))return;
  try{
   const action=b.dataset.cwAction;
   if(action==='clear'){f={...(defaults[page]||{})};offset=0;save();await refresh();}
   if(action==='export'){b.disabled=true;download(contractExport?contractExport():csv(remoteExport?await remoteExport():exportData));b.disabled=false;}
   if(action==='copy'||action==='copy-collections'||action==='copy-materials'||action==='copy-fuel'){
    const value=action==='copy-fuel'?fuelText:action==='copy-materials'?planResult?.materials.filter(m=>m.missing).map(m=>m.name+'\t'+m.missing).join('\n'):copyText;
    if(!value)throw Error('No items in this list.');await navigator.clipboard.writeText(value);toast('List copied.');
   }
   if(action==='expand'||action==='collapse')for(const d of document.querySelectorAll('.corp-workspace details'))d.open=action==='expand';
   if(action==='load-planner'){planCatalog=await api('/material-planner/corporation');await refresh();}
   if(b.dataset.cwOffset!==undefined){offset=Math.max(0,Number(b.dataset.cwOffset)||0);await refresh();}
   if(b.dataset.cwRemoveJob!==undefined){batch.splice(Number(b.dataset.cwRemoveJob),1);planResult=null;await refresh();}
  }catch(error){b.disabled=false;toast(error.message);}
 });
 return {render,handles:next=>corpPages.includes(next)};
}
