import {isSiteAdmin} from './admin.mjs';
export function characterRemovals(db){
 db.exec(`CREATE TABLE IF NOT EXISTS character_removals(id INTEGER PRIMARY KEY AUTOINCREMENT,character_id INTEGER NOT NULL,name TEXT NOT NULL,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,account TEXT NOT NULL,removed INTEGER NOT NULL,snapshots TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS character_removal_time ON character_removals(removed DESC,id DESC);`);
 return {archive(character){
  const account=db.prepare('SELECT name FROM users WHERE id=?').get(character.user_id)?.name||'Unknown account';
  const snapshots=db.prepare('SELECT kind,data,updated FROM snapshots WHERE character_id=?').all(character.id);
  db.prepare('INSERT INTO character_removals(character_id,name,user_id,account,removed,snapshots) VALUES(?,?,?,?,?,?)').run(character.id,character.name,character.user_id,account,Date.now(),JSON.stringify(snapshots));
  // Explicitly clear private datasets/jobs as well as relying on modern FK cascades.
  // Older installations may predate those cascade constraints.
  const tables=['audit_esi_state','jobs','sync_errors','esi_cache','sync_attempts','den_notification_checks','pi_shares','character_subscriptions','character_training_time','group_affiliations','character_order'];
  for(const table of tables)if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))db.prepare('DELETE FROM '+table+' WHERE character_id=?').run(character.id);
  db.prepare('UPDATE character_groups SET parent_id=NULL WHERE parent_id=?').run(character.id);
  db.prepare('DELETE FROM character_groups WHERE character_id=?').run(character.id);
  db.prepare('DELETE FROM snapshots WHERE character_id=?').run(character.id);
  db.prepare('DELETE FROM corp_http_cache WHERE character_id=?').run(character.id);
  for(const path of ['/tools/den-destruction-watch/'+character.id,'/tools/den-location-history/'+character.id])db.prepare('DELETE FROM public_cache WHERE path=?').run(path);
 }};
}
export function removalRoutes(app,{db,config}){
 const admin=(req,res,next)=>!req.inspect&&!req.recruit&&isSiteAdmin(req.session,config.owner)?next():res.sendStatus(403);
 app.get('/api/admin/removals',admin,(req,res)=>{
  const q='%'+String(req.query.q||'').slice(0,120)+'%',offset=Math.max(0,Math.min(100000,parseInt(req.query.offset,10)||0));
  const rows=db.prepare('SELECT id,character_id,name,account,removed,json_array_length(snapshots) datasets FROM character_removals WHERE name LIKE ? OR account LIKE ? OR CAST(character_id AS TEXT) LIKE ? ORDER BY removed DESC,id DESC LIMIT 51 OFFSET ?').all(q,q,q,offset);
  res.json({rows:rows.slice(0,50),more:rows.length>50,offset});
 });
 app.delete('/api/admin/removals/:id',admin,(req,res)=>{
  const row=db.prepare('SELECT id,character_id,name FROM character_removals WHERE id=?').get(Number(req.params.id));
  if(!row)return res.sendStatus(404);
  if(req.body.character_id!==row.character_id)return res.status(400).json({error:'Confirm the removed character before deleting its retained data.'});
  req.auditTarget=row.name+' · '+row.character_id;
  db.prepare('DELETE FROM character_removals WHERE id=?').run(row.id);res.json({ok:true});
 });
}
