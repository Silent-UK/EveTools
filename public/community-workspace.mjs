const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=at=>new Date(at).toISOString().replace('T',' ').slice(0,16)+' UTC';
export function communityWorkspaceUI({api,intro,refresh,toast,context}){
 let query='',offset=0,editingAnnouncement=null;
 const input=(name,label,value,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
 async function render(page){
  if(!['admin-installation','admin-announcements','admin-audit'].includes(page))return null;
  if(!context().me.admin||context().me.inspect)return intro('Administration','Administrator access is required.');
  if(page==='admin-installation'){
   const d=await api('/admin/installation'),s=d.settings;
   return intro('Installation Setup','Configure this Tools installation and check what is ready.')+`<div class="workspace-columns"><section class="panel compact"><h2>Site identity</h2>${d.restartRequired?'<p class="notice">Corporation identity changed. Restart the Tools service before connecting corporation data.</p>':''}<form id="installation-form"><fieldset ${d.canEdit?'':'disabled'}>
   ${input('siteName','Site name',s.siteName,'text','required maxlength="80"')}
   ${input('corporationId','Corporation ID',s.corporationId,'number',`required min="1" ${d.corporationLocked?'readonly':''}`)}
   ${input('corporationName','Corporation name',s.corporationName,'text','required maxlength="100"')}
   <div class="actions">${input('ticker','Corporation ticker',s.ticker,'text','required maxlength="12"')}${input('allianceTicker','Alliance ticker',s.allianceTicker,'text','maxlength="12"')}</div>
   <p><small>The logo comes from the corporation ID. Corporation changes require a service restart and are locked after a live connection. Only the installation owner can change these settings.</small></p>
   <button class="primary" type="submit">Save installation</button></fieldset></form></section>
   <section class="panel compact"><h2>Readiness</h2>${d.checklist.map(row=>`<p class="installation-check ${row.ready?'ready':'pending'}">${row.ready?'✓':'○'} ${esc(row.label)}</p>`).join('')}
   <dl><dt>Owner character</dt><dd>${d.owner}</dd><dt>Callback URL</dt><dd><code>${esc(d.callback)}</code></dd></dl>
   <p><small>Client secrets and the encryption key stay in the server environment. This page never displays them.</small></p>
   <div class="actions"><button data-nav="admin-corp" ${d.restartRequired?'disabled':''}>Connect corporation</button><button data-nav="admin-whitelist">Allowed organisations</button><button data-nav="admin-plugins">Choose plugins</button><button data-nav="admin-groups">Configure groups</button>${d.canEdit?'<button data-create-starter-groups>Create starter groups</button>':''}</div>
   <details><summary>Required EVE scopes</summary><pre>${esc(d.scopes.join('\n'))}</pre></details></section></div>`;
  }
  if(page==='admin-announcements'){
   const d=await api('/admin/announcements'),draft=d.rows.find(row=>row.id===editingAnnouncement);
   if(!draft)editingAnnouncement=null;
   return intro('Announcements','Post Dashboard notices to all members or an approved group.')+`<section class="panel compact"><h2>${draft?'Edit announcement':'New announcement'}</h2><form id="announcement-form">
   ${input('title','Title',draft?.title||'','text','required maxlength="120"')}
   <label>Message<textarea name="body" required maxlength="4000" rows="3">${esc(draft?.body||'')}</textarea></label>
   <div class="actions"><label>Audience<select name="audience"><option value="all" ${draft?.audience!=='group'?'selected':''}>All members</option><option value="group" ${draft?.audience==='group'?'selected':''}>Approved group members</option></select></label>
   <label>Group<select name="groupId"><option value="">Choose group</option>${d.groups.map(g=>`<option value="${g.id}" ${draft?.group_id===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>
   ${input('expires','Expires · EVE time (UTC)',new Date(draft?.expires||Date.now()+7*86400000).toISOString().slice(0,16),'datetime-local','required')}
   <button type="submit" class="primary">${draft?'Save changes':'Publish announcement'}</button>${draft?'<button type="button" data-cancel-announcement>Cancel</button><small>Changed messages become unread again. Extending expiry alone keeps read status.</small>':''}</div></form></section>
   <section class="panel compact"><h2>Published notices</h2>${d.rows.length?d.rows.map(row=>`<article class="announcement-admin-row"><div><strong>${esc(row.title)}</strong><small>${row.audience==='all'?'All members':esc(row.group_name||'Deleted group · hidden')} · Expires ${date(row.expires)}${row.expires<=Date.now()?' · Expired':''}</small><p class="announcement-message">${esc(row.body)}</p></div><div class="actions"><button data-edit-announcement="${row.id}" aria-label="Edit ${esc(row.title)}">Edit</button><button class="danger" data-delete-announcement="${row.id}" aria-label="Delete ${esc(row.title)}">Delete</button></div></article>`).join(''):'<p>No announcements published.</p>'}</section>`;
  }
  const d=await api('/admin/audit?q='+encodeURIComponent(query)+'&offset='+offset);
  return intro('Audit Log','Successful changes, who made them, and when. Request bodies and credentials are never stored.')+`<section class="panel compact"><form id="audit-search" class="actions">${input('q','Search actor or action',query)}<button type="submit">Search</button></form><div class="table-scroll"><table><thead><tr><th>EVE time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead><tbody>${d.rows.map(row=>`<tr><td>${date(row.at)}</td><td>${esc(row.actor)}</td><td>${esc(row.action)}</td><td>${esc(row.target)}</td></tr>`).join('')}</tbody></table></div>${!d.rows.length?'<p>No matching changes recorded.</p>':''}<div class="actions"><button data-audit-page="-1" ${offset?'':'disabled'}>Previous</button><button data-audit-page="1" ${d.more?'':'disabled'}>Next</button></div></section>`;
 }
 document.addEventListener('submit',async event=>{
  if(!['installation-form','announcement-form','audit-search'].includes(event.target.id))return;
  event.preventDefault();const form=event.target,values=Object.fromEntries(new FormData(form)),button=form.querySelector('button[type="submit"]');
  if(button?.disabled)return;
  if(button)button.disabled=true;
  try{
   if(form.id==='audit-search'){query=values.q;offset=0;await refresh();return;}
   if(form.id==='installation-form'){
    const result=await api('/admin/installation',{...values,corporationId:Number(values.corporationId)});
    toast(result.settings.restartRequired?'Settings saved. Restart the Tools service before connecting this corporation.':'Installation settings saved.');
   }else{await api('/admin/announcements'+(editingAnnouncement?'/'+editingAnnouncement:''),{...values,groupId:Number(values.groupId)||null,expires:Date.parse(values.expires+':00Z')});toast(editingAnnouncement?'Announcement updated.':'Announcement published.');editingAnnouncement=null;}
   await refresh(true);
  }catch(error){toast(error.message);}finally{if(button)button.disabled=false;}
 });
 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-edit-announcement],[data-cancel-announcement],[data-delete-announcement],[data-announcement-read],[data-audit-page],[data-create-starter-groups]');if(!button)return;
  if(button.hasAttribute('data-edit-announcement')||button.hasAttribute('data-cancel-announcement')){editingAnnouncement=button.hasAttribute('data-edit-announcement')?Number(button.dataset.editAnnouncement):null;await refresh();const form=document.getElementById('announcement-form');form?.scrollIntoView({block:'nearest'});form?.querySelector('[name=title]')?.focus();return;}
  if(button.hasAttribute('data-audit-page')){offset=Math.max(0,offset+Number(button.dataset.auditPage)*50);await refresh();return;}
  if(button.hasAttribute('data-delete-announcement')&&!confirm('Delete this announcement for everyone?'))return;
  button.disabled=true;
  try{
   if(button.hasAttribute('data-create-starter-groups')){await api('/admin/installation/groups',{});toast('Starter groups created. Configure their permissions in Group Setup.');}
   else if(button.hasAttribute('data-delete-announcement'))await api('/admin/announcements/'+button.dataset.deleteAnnouncement,{},'DELETE');
   else await api('/home/announcements/'+button.dataset.announcementRead+'/read',{});
   await refresh();
  }catch(error){toast(error.message);}finally{button.disabled=false;}
 });
 return {render};
}
