export function discordUI({api,esc,intro,date,refresh,toast,context}){
 const tabs={setup:'Setup',notifications:'Notifications',timerboard:'Timerboard'};
 let tab='setup';
 function publishingForm(data,active){
  const board=active==='timerboard';
  const keys=board?['timerboard']:Object.keys(data.labels).filter(key=>key!=='timerboard');
  const destinations=keys.map(key=>{
   const row=data.destinations[key];
   return `<div class="discord-destination"><label><input class="slide-toggle" type="checkbox" role="switch" name="${key}-enabled" ${row.enabled?'checked':''}> <strong>${esc(data.labels[key])}</strong></label><label>Channel ID <input name="${key}-channel" inputmode="numeric" maxlength="20" value="${esc(row.channel)}" placeholder="Discord channel ID"></label>${data.errors[key]?`<small role="status">${esc(data.errors[key])}</small>`:''}</div>`;
  }).join('');
  const fields=board?`<label class="setting-row"><span><strong>Include Den timers</strong><small>Add active reinforcements from pilots covered by Discord Den alerts.</small></span><input class="slide-toggle" type="checkbox" role="switch" name="includeDens" ${data.includeDens?'checked':''}></label>`:`<div class="ops-form-grid"><label>Low fuel or gas threshold (hours)<input name="threshold" type="number" min="1" max="168" required value="${Number(data.threshold)}"></label><label>Daily report time (UTC)<input name="dailyTime" type="time" required value="${esc(data.dailyTime)}"></label></div>`;
  return `<section class="panel compact"><form class="management-form discord-publishing-form" id="discord-publishing" data-tab="${active}">
   <p>${board?'Keep one message updated with upcoming corporation and manual Timerboard timers. Enable the Timerboard plugin to publish.':'Choose which events to publish and where. Den alerts cover verified Discord-linked accounts and the admin who saves this tab. A verified account is tagged for its main and alts.'}</p>
   <small>Everyone with access to the channel can read these posts. Give the bot View Channel, Send Messages, and Embed Links.</small>
   ${!data.connected?'<p class="notice">Complete the Discord connection test in Setup before publishing.</p>':''}
   ${destinations}${fields}
   <div class="actions"><button class="primary">Save ${tabs[active]}</button></div>
  </form></section>`;
 }
 function pilotMatches(data){
  if(!data.connected)return '';
  const {matches,scan,running}=data.pilotSync??{matches:[]};
  const status=scan?`<small>Last scan ${esc(date(scan.checked))} · ${scan.scanned} Discord members · ${matches.length} matches · ${scan.ambiguous} ambiguous</small>`:'';
  const rows=matches.map(row=>`<div class="production"><strong>${esc(row.pilot)}</strong><span>${esc(row.discord_name)} <small>@${esc(row.discord_username)} · matched ${esc(row.matched_pilot)}</small></span><button type="button" data-discord-approve-pilot="${Number(row.user_id)}" data-discord-id="${esc(row.discord_id)}" data-discord-pilot="${esc(row.pilot)}" data-discord-username="${esc(row.discord_username)}">Approve Link</button></div>`).join('');
  return `<section class="panel compact"><div class="panelhead"><h2>Pilot Name Matches</h2><button type="button" data-discord-sync-pilots ${running?'disabled':''}>${running?'Scanning…':'Sync Pilots'}</button></div>
   <p>Scan the Discord server for exact matches to registered mains and alts. Enable Server Members Intent in the Discord Developer Portal for this scan. Approve a match once you recognise both accounts.</p>
   ${status}${rows||'<p>No saved name matches.</p>'}</section>`;
 }
 async function render(page){
  if(page==='admin-discord'&&context().me.admin&&!context().me.inspect){
   const heading=intro('Discord','','<button data-nav="admin-plugins">Back to Plugins</button>');
   const active=tab;
   const navigation=`<div class="discord-tabs" role="tablist" aria-label="Discord administration">${Object.entries(tabs).map(([id,label])=>`<button type="button" id="discord-tab-${id}" role="tab" data-discord-tab="${id}" aria-selected="${active===id}" aria-controls="discord-panel-${id}" tabindex="${active===id?0:-1}">${label}</button>`).join('')}</div>`;
   const workspace=content=>heading+navigation+Object.keys(tabs).map(id=>`<div id="discord-panel-${id}" role="tabpanel" aria-labelledby="discord-tab-${id}" ${active===id?'tabindex="0"':'hidden'}>${active===id?content:''}</div>`).join('');
   if(active!=='setup')return workspace(publishingForm(await api('/admin/discord/publishing'),active));
   const d=await api('/admin/discord');
   const policies=[['none','Do nothing'],['kick','Remove from Server'],['remove_roles','Remove all roles'],['assign_role','Assign role']];
   const nonCorpPolicy=`<div class="management-form"><label>Non-Corp Members<select name="non_corp_action">${policies.map(([value,label])=>`<option value="${value}" ${(d.non_corp_action||'none')===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Role ID for Assign role<input name="non_corp_role" inputmode="numeric" maxlength="20" value="${esc(d.non_corp_role||'')}"></label><small>Applies to verified Discord links whose Tools main is confirmed outside the corporation. Runs only when Manage Discord roles is on. Remove from Server needs Kick Members. Discord-managed roles and roles above the bot are protected.</small></div>`;
   return workspace(`<section class="panel compact settings-list"><form id="discord-config"><label class="setting-row"><span><strong>Discord Integration</strong><small>Enable account linking and configured Discord publishing.</small></span><input class="slide-toggle" name="enabled" type="checkbox" role="switch" ${d.enabled?'checked':''}></label><label class="setting-row"><span><strong>Manage Discord roles</strong><small>When enabled, approved Groups can add and remove their mapped roles.</small></span><input class="slide-toggle" name="manage_roles" type="checkbox" role="switch" ${d.manage_roles?'checked':''}></label>${nonCorpPolicy}<div class="management-form"><label>Application ID<input name="client_id" inputmode="numeric" value="${esc(d.client_id)}" required></label><label>Server ID<input name="guild_id" inputmode="numeric" value="${esc(d.guild_id)}" required></label><label>Bot Token<input name="bot_token" type="password" autocomplete="new-password" placeholder="${d.has_bot_token?'Saved · leave blank to keep':'Paste Bot Token'}"></label><label>OAuth2 Client Secret<input name="client_secret" type="password" autocomplete="new-password" placeholder="${d.has_client_secret?'Saved · leave blank to keep':'Paste Client Secret'}"></label><small>Secrets are encrypted on the server and never returned to this page.</small><button class="primary">Save Discord Settings</button></div></form></section><section class="panel compact"><div class="panelhead"><strong>${d.connected?'Connected · '+esc(d.bot_name):'Not Connected'}</strong><div class="actions">${d.invite?`<a class="button" href="${esc(d.invite)}" target="_blank" rel="noopener noreferrer">Invite Bot to Server ↗</a>`:''}<button data-discord-test>Test Connection</button></div></div><small>${d.connected?'Last successful test: '+date(d.connected):'Save settings, install the bot, then test the connection.'}</small>${d.error?`<p class="notice">${esc(d.error)}</p>`:''}</section>${!d.guide_hidden?`<section class="notice discord-setup" role="status"><div class="panelhead"><h2>Discord Bot Setup · Start Here</h2>${d.connected?'<button data-discord-hide>Hide Setup Instructions</button>':''}</div>${guide(d)}<small>Instructions can be hidden after a successful connection test. Editing credentials shows them again.</small></section>`:`<details class="panel compact"><summary>Discord Setup Instructions</summary>${guide(d)}</details>`}<section class="panel compact"><h2>Linked Accounts</h2><small>${d.manage_roles?'Mapped role changes are checked in the background, usually within five minutes.':'Role management is off. Existing roles stay in place.'}</small>${d.accounts.map(a=>`<div class="production"><strong>${esc(a.pilot)}</strong><span>${esc(a.name)} · ${a.error?esc(a.error):a.checked?'Last checked '+date(a.checked):'Awaiting role sync'}</span></div>`).join('')||'<p>No accounts linked yet.</p>'}</section>`+pilotMatches(d));
  }
  if(page==='settings'&&!context().me.inspect){const d=await api('/discord');return d.enabled||d.account?`<section class="panel compact"><h2>Discord</h2><p>${d.account?'Linked as '+esc(d.account.name):'Link your Discord account after joining the server.'+(d.manage_roles?' Approved site Groups can then assign their mapped roles.':'')+''}</p>${d.account?.error?`<small>${esc(d.account.error)}</small>`:''}${d.account?'<button data-discord-unlink>Unlink Discord & Remove Managed Roles</button>':d.enabled?'<button data-discord-connect>Link Discord Account</button>':''}</section>`:'';}
  return null;
 }
 function guide(d){return `<ol><li>Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">Discord Developer Portal</a>, sign in and choose New Application. Give it a name such as Tools.</li><li>Under General Information, copy the Application ID. Under OAuth2, copy or reset the Client Secret. Put both into the fields above.</li><li>Under Bot, create the bot if needed, then reset/copy its token. Paste it into Bot Token above. Keep both secrets private.</li><li>In Discord, enable User Settings → Advanced → Developer Mode. Right-click your server and Copy Server ID, then paste it above.</li><li>Under OAuth2 → Redirects, add this exact callback: <code>${esc(d.callback)}</code>. Save the portal changes.</li><li>Enable Discord Integration and save this page. Under Installation, enable Guild Install if necessary. Choose Invite Bot to Server in the connection panel. Enable Manage Discord roles only if you want the bot to sync Group roles.</li><li>If role management is enabled, move the bot's role above the mapped roles in Discord Server Settings → Roles. Role sync does not require Administrator permission or privileged Gateway intents. Mapped roles cannot grant Administrator, Manage Server or Manage Roles.</li><li>Run Test Connection here. This verifies bot credentials and server access, plus Manage Roles when role management is enabled. The integration uses the REST API; the bot may appear offline in Discord.</li><li>In Admin → Groups, enter an optional Discord Role ID. Right-click the role in Discord and choose Copy Role ID. This is a Role ID, not a channel, server or user ID.</li><li>Players join the server and use Settings → Link Discord Account. Approved Groups grant their mapped roles; revoked/deleted Groups remove managed roles. Restricted Groups must still meet their requirements.</li></ol>`;}
 async function selectTab(id,focus){
  if(!Object.hasOwn(tabs,id)||id===tab)return;
  tab=id;
  await refresh();
  if(focus&&tab===id)document.getElementById('discord-tab-'+id)?.focus();
 }
 document.addEventListener('click',e=>{
  const button=e.target.closest('button[data-discord-tab]');
  if(button)return selectTab(button.dataset.discordTab,true);
 });
 document.addEventListener('keydown',e=>{
  const button=e.target.closest('button[data-discord-tab]');
  if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();
  const ids=Object.keys(tabs),index=ids.indexOf(button.dataset.discordTab);
  const next=e.key==='Home'?0:e.key==='End'?ids.length-1:(index+(e.key==='ArrowRight'?1:-1)+ids.length)%ids.length;
  return selectTab(ids[next],true);
 });
 document.addEventListener('submit',async e=>{
  const form=e.target;
  if(form.id!=='discord-publishing')return;
  e.preventDefault();
  const button=e.submitter||form.querySelector('button'),values=new FormData(form),current=form.dataset.tab;
  const destinations=Object.fromEntries([...values.keys()].filter(key=>key.endsWith('-channel')).map(field=>{
   const key=field.slice(0,-8);
   return [key,{enabled:values.has(key+'-enabled'),channel:values.get(field).trim()}];
  }));
  button.disabled=true;
  try{
   await api('/admin/discord/publishing',{tab:current,destinations,dailyTime:values.get('dailyTime'),threshold:Number(values.get('threshold')),includeDens:values.has('includeDens')});
   toast('Discord '+tabs[current]+' saved.');
   await refresh();
  }catch(error){toast(error.message);}finally{button.disabled=false;}
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest('button[data-discord-sync-pilots]');
  if(!button||button.disabled)return;
  button.disabled=true;
  button.textContent='Scanning…';
  try{
   const result=await api('/admin/discord/sync-pilots',{});
   toast(`Matched ${result.matched} of ${result.scanned} Discord members · ${result.ambiguous} ambiguous`);
   await refresh();
  }catch(error){toast(error.message);}finally{
   button.disabled=false;
   button.textContent='Sync Pilots';
  }
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest('button[data-discord-approve-pilot]');
  if(!button||button.disabled)return;
  const {discordApprovePilot,discordId,discordPilot,discordUsername}=button.dataset;
  if(!confirm(`Link ${discordPilot} to @${discordUsername} on Discord?`))return;
  button.disabled=true;
  try{
   await api('/admin/discord/approve-pilot',{user_id:Number(discordApprovePilot),discord_id:discordId});
   toast('Discord link approved.');
   await refresh();
  }catch(error){toast(error.message);}finally{button.disabled=false;}
 });
 document.addEventListener('submit',async e=>{if(e.target.id!=='discord-config')return;e.preventDefault();const form=new FormData(e.target),button=e.target.querySelector('button');button.disabled=true;try{await api('/admin/discord',{...Object.fromEntries(form),enabled:form.has('enabled'),manage_roles:form.has('manage_roles')});await refresh();toast('Discord settings saved.');}catch(error){toast(error.message);}finally{button.disabled=false;}});
 document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const action=['test','hide','connect','unlink'].find(a=>b.hasAttribute('data-discord-'+a));if(!action)return;if(action==='unlink'&&!confirm('Unlink Discord and remove the roles managed by Tools?'))return;b.disabled=true;try{const path={test:'/admin/discord/test',hide:'/admin/discord/hide-guide',connect:'/discord/connect',unlink:'/discord/unlink'}[action],r=await api(path,{});if(action==='connect'){location.assign(r.url);return;}await refresh();}catch(error){toast(error.message);}finally{b.disabled=false;}});
 return {render};
}
