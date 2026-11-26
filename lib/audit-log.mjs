export const auditTypes={activity:'Activity',characters:'Characters',groups:'Groups',discord:'Discord',timers:'Timers',calendar:'Calendar',esi:'ESI',links:'Links',pages:'Pages',users:'Users',announcements:'Announcements',settings:'Settings',changes:'Other changes'};
export function auditStore(db){
 if(!db.prepare('PRAGMA table_info(audit_events)').all().some(c=>c.name==='type'))db.exec("ALTER TABLE audit_events ADD COLUMN type TEXT NOT NULL DEFAULT 'changes'");
 db.exec(`CREATE INDEX IF NOT EXISTS audit_event_type_time ON audit_events(type,at DESC,id DESC);
 CREATE TABLE IF NOT EXISTS audit_activity(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_esi_state(character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,kind TEXT,active INTEGER NOT NULL,PRIMARY KEY(character_id,kind));
 CREATE TRIGGER IF NOT EXISTS audit_esi_problem AFTER INSERT ON sync_errors
 WHEN NOT EXISTS(SELECT 1 FROM audit_esi_state WHERE character_id=NEW.character_id AND kind=NEW.kind AND active=1)
 BEGIN
 INSERT INTO audit_events(at,actor_id,actor,action,target,type) SELECT unixepoch()*1000,u.main_id,u.name,'ESI issue',c.name||' · '||NEW.kind,'esi' FROM characters c JOIN users u ON u.id=c.user_id WHERE c.id=NEW.character_id;
 INSERT INTO audit_esi_state VALUES(NEW.character_id,NEW.kind,1) ON CONFLICT(character_id,kind) DO UPDATE SET active=1;
 END;
 CREATE TRIGGER IF NOT EXISTS audit_esi_problem_updated AFTER UPDATE OF message ON sync_errors
 WHEN NOT EXISTS(SELECT 1 FROM audit_esi_state WHERE character_id=NEW.character_id AND kind=NEW.kind AND active=1)
 BEGIN
 INSERT INTO audit_events(at,actor_id,actor,action,target,type) SELECT unixepoch()*1000,u.main_id,u.name,'ESI issue',c.name||' · '||NEW.kind,'esi' FROM characters c JOIN users u ON u.id=c.user_id WHERE c.id=NEW.character_id;
 INSERT INTO audit_esi_state VALUES(NEW.character_id,NEW.kind,1) ON CONFLICT(character_id,kind) DO UPDATE SET active=1;
 END;
 CREATE TRIGGER IF NOT EXISTS audit_esi_recovered AFTER DELETE ON sync_errors
 WHEN EXISTS(SELECT 1 FROM audit_esi_state WHERE character_id=OLD.character_id AND kind=OLD.kind AND active=1)
 BEGIN
 INSERT INTO audit_events(at,actor_id,actor,action,target,type) SELECT unixepoch()*1000,u.main_id,u.name,'ESI recovered',c.name||' · '||OLD.kind,'esi' FROM characters c JOIN users u ON u.id=c.user_id WHERE c.id=OLD.character_id;
 UPDATE audit_esi_state SET active=0 WHERE character_id=OLD.character_id AND kind=OLD.kind;
 END;`);
}
export function writeAudit(db,req,action,target,type='changes'){
 db.prepare('INSERT INTO audit_events(at,actor_id,actor,action,target,type) VALUES(?,?,?,?,?,?)').run(Date.now(),req.session?.main_id||null,req.session?.name||'System',action,String(target||'').slice(0,240),Object.hasOwn(auditTypes,type)?type:'changes');
}
export function detailedAuditMiddleware(db,installation){return(req,res,next)=>{
 if(!req.path.startsWith('/api/')||['GET','HEAD','OPTIONS'].includes(req.method)||req.path==='/api/activity')return next();
 const actor=req.session?{...req.session}:null,path=req.path,method=req.method;
 const rules=[
 [/\/characters\/\d+$/,'characters',method==='DELETE'?'Character removed':'Character changed'],
 [/\/admin\/removals\//,'characters','Removed character data deleted'],
 [/\/groups\/\d+\/apply$/,'groups','Group application'],[/\/groups\/\d+\/leave$/,'groups','Group left'],
 [/\/admin\/groups/,'groups',method==='DELETE'?'Group deleted':'Group settings or membership changed'],
 [/\/discord\/unlink$/,'discord','Discord disconnected'],[/\/discord\/approve-pilot$/,'discord','Discord link approved'],[/\/discord/,'discord','Discord settings changed'],
 [/\/timerboard/,'timers',method==='DELETE'?'Timer removed':/targets/.test(path)?'Target added':'Timer added'],
 [/\/calendar/,'calendar',method==='DELETE'?'Event removed':'Event changed'],[/\/admin\/links/,'links',method==='DELETE'?'Link removed':'Link changed'],
 [/\/admin\/pages/,'pages',method==='DELETE'?'Page removed':'Page changed'],[/\/admin\/announcements/,'announcements','Announcement changed'],
 [/\/admin\/users/,'users','User administration changed'],[/\/admin\/installation/,'settings','Installation updated'],[/\/settings/,'settings','Settings changed']
 ];
 const rule=rules.find(([pattern])=>pattern.test(path))||[null,'changes','Site change'];
 let target=method+' '+path;
 const char=path.match(/\/characters\/(\d+)/),group=path.match(/\/groups\/(\d+)/),timer=path.match(/\/timerboard\/(?:targets\/)?(\d+)/);
 if(char){const row=db.prepare('SELECT name FROM characters WHERE id=?').get(Number(char[1]));if(row)target=row.name+' · '+char[1];}
 if(group){const row=db.prepare('SELECT name FROM access_groups WHERE id=?').get(Number(group[1]));if(row)target=row.name+' · '+group[1];}
 if(timer){const table=path.includes('/targets/')?'timerboard_targets':'timerboard_entries';const row=db.prepare('SELECT name FROM '+table+' WHERE id=?').get(Number(timer[1]));if(row)target=row.name+' · '+timer[1];}
 for(const [pattern,table]of [[/\/admin\/links\/(\d+)/,'external_links'],[/\/admin\/pages\/(\d+)/,'site_pages'],[/\/admin\/users\/(\d+)/,'users']]){
  const match=path.match(pattern);if(match){const row=db.prepare('SELECT name FROM '+table+' WHERE id=?').get(Number(match[1]));if(row)target=row.name+' · '+match[1];}
 }
 if(rule[1]==='groups'&&Number.isSafeInteger(req.body?.user_id)){const user=db.prepare('SELECT name FROM users WHERE id=?').get(req.body.user_id);if(user)target+=' · '+user.name;}
 // Record only explicitly safe display fields, never arbitrary bodies or errors.
 const title=typeof req.body?.title==='string'?req.body.title:typeof req.body?.name==='string'?req.body.name:null;
 if(rule[1]==='timers'&&typeof req.body?.detail==='string')target+=' · '+req.body.detail.split(/[\r\n]/)[0].slice(0,100);
 if(title&&['groups','timers','calendar','links','pages','announcements'].includes(rule[1]))target+=' · '+title.slice(0,100);
 res.once('finish',()=>{if(actor&&!req.inspect&&res.statusCode>=200&&res.statusCode<300){try{installation.audit({session:actor},rule[2],req.auditTarget||target,rule[1]);}catch{console.error('Could not record audit event');}}});next();
};}
