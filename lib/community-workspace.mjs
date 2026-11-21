import {transaction} from './store.mjs';
import {isSiteAdmin} from './admin.mjs';
import {preferences} from './management.mjs';

export function communityWorkspace(app,{db,config,installation,srp,services,recruitment}){
 const admin=req=>!req.inspect&&!req.recruit&&isSiteAdmin(req.session,config.owner);
 const owner=req=>admin(req)&&req.session.main_id===config.owner;
 const visible=(user,now=Date.now())=>db.prepare(`SELECT a.id,a.title,a.body,a.expires,a.created,a.author FROM announcements a
 WHERE a.expires>? AND (a.audience='all' OR a.audience='group' AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=a.group_id AND m.user_id=? AND m.status='approved'))
 AND NOT EXISTS(SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.user_id=?) ORDER BY a.created DESC LIMIT 30`).all(now,user,user);
 app.get('/api/admin/installation',(req,res)=>{
  if(!admin(req))return res.sendStatus(403);
  res.json({settings:installation.read(),canEdit:owner(req),restartRequired:installation.read().corporationId!==config.corporationId,corporationLocked:installation.locked(),owner:config.owner,base:config.base,callback:config.base+'/auth/callback',scopes:installation.scopes,checklist:installation.checklist(),groups:db.prepare('SELECT id,name FROM access_groups ORDER BY name').all()});
 });
 app.post('/api/admin/installation',(req,res)=>{
  if(!owner(req))return res.sendStatus(403);
  res.json({settings:installation.save(req.body)});
 });
 app.post('/api/admin/installation/groups',(req,res)=>{
  if(!owner(req))return res.sendStatus(403);
  const add=db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM access_groups WHERE name=? COLLATE NOCASE)");
  for(const [name,mode,description] of [['Members','auto','General member group. Configure page grants in Group Setup.'],['Leadership','approval','Approval required. Configure leadership page grants in Group Setup.']])add.run(name,'◇',description,mode,'[]','[]',name);
  res.json({ok:true});
 });
 app.get('/api/admin/audit',(req,res)=>{
  if(!admin(req))return res.sendStatus(403);
  const q=String(req.query.q||'').slice(0,120),offset=Math.max(0,Math.min(100000,parseInt(req.query.offset,10)||0));
  const rows=db.prepare(`SELECT * FROM audit_events WHERE actor LIKE ? OR action LIKE ? OR target LIKE ? ORDER BY at DESC,id DESC LIMIT 51 OFFSET ?`).all('%'+q+'%','%'+q+'%','%'+q+'%',offset);
  res.json({rows:rows.slice(0,50),more:rows.length>50,offset});
 });
 app.get('/api/admin/announcements',(req,res)=>{
  if(!admin(req))return res.sendStatus(403);
  res.json({rows:db.prepare('SELECT a.*,g.name group_name FROM announcements a LEFT JOIN access_groups g ON g.id=a.group_id ORDER BY a.created DESC LIMIT 100').all(),groups:db.prepare('SELECT id,name FROM access_groups ORDER BY name').all()});
 });
 app.post(['/api/admin/announcements','/api/admin/announcements/:id'],(req,res)=>{
  if(!admin(req))return res.sendStatus(403);
  const {title,body,audience,groupId,expires}=req.body;
  if(typeof title!=='string'||!title.trim()||title.length>120||typeof body!=='string'||!body.trim()||body.length>4000||!['all','group'].includes(audience)||!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+366*86400000)return res.status(400).json({error:'Enter a title, message, audience and expiry within the next year.'});
  if(audience==='group'&&(!Number.isSafeInteger(groupId)||!db.prepare('SELECT 1 FROM access_groups WHERE id=?').get(groupId)))return res.status(400).json({error:'Choose an existing group.'});
  if(req.params.id!==undefined){
   const id=Number(req.params.id);
   if(!Number.isSafeInteger(id)||id<=0)return res.sendStatus(400);
   const prior=db.prepare('SELECT * FROM announcements WHERE id=?').get(id);
   if(!prior)return res.sendStatus(404);
   const group=audience==='group'?groupId:null;
   const changed=prior.title!==title.trim()||prior.body!==body.trim()||prior.audience!==audience||prior.group_id!==group;
   transaction(db,()=>{
    db.prepare('UPDATE announcements SET title=?,body=?,audience=?,group_id=?,expires=? WHERE id=?').run(title.trim(),body.trim(),audience,group,expires,id);
    if(changed)db.prepare('DELETE FROM announcement_reads WHERE announcement_id=?').run(id);
   });
   return res.json({id});
  }
  const result=db.prepare('INSERT INTO announcements(title,body,audience,group_id,expires,created,author) VALUES(?,?,?,?,?,?,?)').run(title.trim(),body.trim(),audience,audience==='group'?groupId:null,expires,Date.now(),req.session.name);
  res.json({id:Number(result.lastInsertRowid)});
 });
 app.delete('/api/admin/announcements/:id',(req,res)=>{
  if(!admin(req))return res.sendStatus(403);
  db.prepare('DELETE FROM announcements WHERE id=?').run(Number(req.params.id));res.json({ok:true});
 });
 app.post('/api/home/announcements/:id/read',(req,res)=>{
  if(req.inspect||req.recruit)return res.sendStatus(403);
  const id=Number(req.params.id);
  if(!visible(req.session.user_id).some(row=>row.id===id))return res.sendStatus(404);
  db.prepare('INSERT OR IGNORE INTO announcement_reads VALUES(?,?)').run(id,req.session.user_id);res.json({ok:true});
 });
 function dashboard(req,pluginEvents){
  const user=req.session.user_id,prefs=preferences(db,user),tasks=[];
  const add=(page,title,detail='',personal=false,action='')=>{if(prefs[page]!==false)tasks.push({page,title,detail,homeAction:action,...(personal?{accountWide:true,pilotId:req.session.main_id,pilot:req.session.name}:{})});};
  const reconnect=db.prepare('SELECT count(*) count FROM characters WHERE user_id=? AND reconnect=1').get(user).count;
  if(reconnect)add('overview',reconnect+(reconnect===1?' character needs reconnection':' characters need reconnection'),'Open Overview to reconnect affected characters.',true);
  for(const key of ['srp','buyback'])for(const event of pluginEvents[key]||[])if(/to review|requested$|available to request|awaiting|ready for/.test(event.title))add(event.page,event.title,event.detail,Boolean(event.pilotId),key==='srp'?(/payout|available to request/i.test(event.title)?(event.pilotId?'payout':'payout-review'):'review'): /payment|available to request/i.test(event.title)?(event.pilotId?'payment':'payment-review'): /contract/.test(event.title)?'accepted':event.pilotId?'quoted':'review');
  if(services.available(req,'logistics')){
   const mine=db.prepare("SELECT count(*) count FROM service_plugin_requests WHERE plugin='logistics' AND user_id=? AND status='quoted'").get(user).count;
   if(mine)add('logistics',mine+' hauling quotes awaiting your response','',true,'quoted');
   if(services.canManage(req,'logistics')){const count=db.prepare("SELECT count(*) count FROM service_plugin_requests WHERE plugin='logistics' AND status IN ('requested','accepted')").get().count;if(count)add('logistics',count+' logistics requests need attention','',false,'review');}
  }
  if(admin(req)){
   const count=db.prepare("SELECT count(*) count FROM group_members WHERE status='pending'").get().count;
   if(count)add('admin-group-management',count+(count===1?' group request to review':' group requests to review'));
   if(!installation.read().configured)add('admin-installation','Review installation setup','Check branding, corporation identity and connections.');
  }
  if(!req.inspect&&recruitment.canReview(req.session)){
   const count=db.prepare("SELECT count(*) count FROM recruitment_applications WHERE status IN ('applied','reviewing')").get().count;
   if(count)add('recruitment',count+(count===1?' recruitment application to review':' recruitment applications to review'));
  }
  return {needsAction:prefs['home-show-needsAction']===false?[]:tasks,announcements:prefs['home-show-announcements']===false?[]:visible(user).map(row=>({title:row.title,detail:row.body,page:'home',at:row.created,timeLabel:'Posted',announcementId:row.id,author:row.author}))};
 }
 return {dashboard};
}

// Record successful mutations without storing bodies, tokens, query strings or exception text.
export function auditMiddleware(db,installation){return (req,res,next)=>{
 if(req.path.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(req.method)){
  const actor=req.session?{...req.session}:null;
  const labels=[[/\/admin\/installation$/,'Installation updated'],[/\/admin\/announcements/,'Announcement changed'],[/\/admin\/groups/,'Group settings or membership changed'],[/\/srp/,'Ship replacement changed'],[/\/service-plugins/,'Service request changed'],[/\/timerboard/,'Timerboard changed'],[/\/calendar/,'Calendar changed'],[/\/admin\/users/,'User administration changed']];
  const action=labels.find(([pattern])=>pattern.test(req.path))?.[1]||'Site change';
  const allowedStates=new Set(['pending','approved','declined','accepted','rejected','completed','quoted','requested','paid','verified','reviewing','approve','reject']);
  const details=Object.entries(req.body||{}).filter(([key,value])=>['status','decision','action'].includes(key)?allowedStates.has(value):key==='enabled'?typeof value==='boolean':['amount','payout','groupId','user_id'].includes(key)&&Number.isSafeInteger(value)&&value>=0).map(([key,value])=>key+'='+value).join(', ');
  res.once('finish',()=>{if(res.statusCode>=200&&res.statusCode<300&&actor&&!req.inspect){
   try{installation.audit({session:actor},action,req.method+' '+req.path+(details?' · '+details:''));}catch{console.error('Could not record audit event');}
  }});
 }
 next();
};}
