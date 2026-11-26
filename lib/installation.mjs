import {auditStore,writeAudit} from './audit-log.mjs';
import {SCOPES} from './eve.mjs';
import {STEMP_ID} from './corp.mjs';
import {transaction} from './store.mjs';

export function installationStore(db,config){
 db.exec(`CREATE TABLE IF NOT EXISTS installation_settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,actor_id INTEGER,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS audit_event_time ON audit_events(at DESC,id DESC);
 CREATE INDEX IF NOT EXISTS group_member_status ON group_members(status);
 CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,audience TEXT NOT NULL CHECK(audience IN ('all','group')),group_id INTEGER REFERENCES access_groups(id) ON DELETE SET NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL,author TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS announcement_expiry ON announcements(expires);
 CREATE TABLE IF NOT EXISTS announcement_reads(announcement_id INTEGER REFERENCES announcements(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(announcement_id,user_id));`);
 auditStore(db);
 const saved=db.prepare('SELECT data FROM installation_settings WHERE id=1').get();
 const existing=db.prepare('SELECT 1 FROM users LIMIT 1').get();
 const initial={siteName:config.siteName||'EveTools',corporationId:config.corporationId||STEMP_ID,corporationName:config.corporationName||'Corporation',ticker:config.corporationTicker||'CORP',allianceTicker:config.allianceTicker||'',configured:false};
 const read=()=>JSON.parse(db.prepare('SELECT data FROM installation_settings WHERE id=1').get().data);
 if(!saved){
  db.prepare('INSERT INTO installation_settings VALUES(1,?)').run(JSON.stringify(initial));
  // Fresh installations allow only their own configured corporation.
  if(!existing){db.prepare('DELETE FROM login_whitelist WHERE corporation_id IN (?,?)').run(STEMP_ID,98044257);db.prepare('INSERT OR IGNORE INTO login_whitelist VALUES(?,?)').run(initial.corporationId,initial.corporationName);}
 }
 const pending=read();
 if(pending.previousCorporationId){
  transaction(db,()=>{db.prepare('DELETE FROM login_whitelist WHERE corporation_id=?').run(pending.previousCorporationId);db.prepare('INSERT OR IGNORE INTO login_whitelist VALUES(?,?)').run(pending.corporationId,pending.corporationName);delete pending.previousCorporationId;db.prepare('UPDATE installation_settings SET data=? WHERE id=1').run(JSON.stringify(pending));});
 }
 const apply=()=>{const value=read();config.corporationId=value.corporationId;config.siteName=value.siteName;config.corporationName=value.corporationName;config.corporationTicker=value.ticker;config.allianceTicker=value.allianceTicker;};
 apply();
 const locked=()=>Boolean(db.prepare('SELECT 1 FROM corp_authorizations LIMIT 1').get()||db.prepare('SELECT 1 FROM corp_snapshots LIMIT 1').get()||db.prepare('SELECT 1 FROM corporation_connections LIMIT 1').get());
 function save(value){
  const old=read(),text=(key,max,required=true)=>{const v=value[key];if(typeof v!=='string'||v.trim().length>max||required&&!v.trim())throw Object.assign(Error('Check the '+key+' field.'),{status:400});return v.trim();};
  const next={siteName:text('siteName',80),corporationId:value.corporationId,corporationName:text('corporationName',100),ticker:text('ticker',12),allianceTicker:text('allianceTicker',12,false),configured:true};
  if(!Number.isSafeInteger(next.corporationId)||next.corporationId<=0)throw Object.assign(Error('Enter a valid corporation ID.'),{status:400});
  if(next.corporationId!==old.corporationId&&locked())throw Object.assign(Error('Corporation identity is locked because live corporation connections or snapshots exist. Use a separate installation for another corporation.'),{status:409});
  if(next.corporationId!==old.corporationId)next.previousCorporationId=old.previousCorporationId||old.corporationId;
  else if(old.previousCorporationId)next.previousCorporationId=old.previousCorporationId;
  db.prepare('UPDATE installation_settings SET data=? WHERE id=1').run(JSON.stringify(next));
  const restartRequired=next.corporationId!==config.corporationId;
  config.siteName=next.siteName;config.corporationName=next.corporationName;config.corporationTicker=next.ticker;config.allianceTicker=next.allianceTicker;
  return {...next,restartRequired};
 }
 function audit(req,action,target,type){writeAudit(db,req,action,target,type);}
 function checklist(){
  const value=read();
  return [{label:'Installation identity saved',ready:value.configured},
   {label:'EVE client and encryption key configured',ready:Boolean(config.client&&config.secret&&config.key)},
   {label:'Owner account connected',ready:Boolean(db.prepare('SELECT 1 FROM users WHERE main_id=?').get(config.owner))},
   {label:'Corporation access connected',ready:Boolean(db.prepare('SELECT 1 FROM corp_authorizations WHERE corporation_id=? AND verified>0').get(value.corporationId))},
   {label:'Corporation data synced',ready:Boolean(db.prepare('SELECT 1 FROM corp_snapshots WHERE corporation_id=?').get(value.corporationId))}];
 }
 return {read,save,locked,audit,checklist,scopes:SCOPES};
}
