import {ownedCharacter,transaction} from './store.mjs';
import {parseFitting} from './plans.mjs';
import {random,hash} from './security.mjs';
import {fittingToEFT} from './saved-fittings.mjs';
export function fittingImportRoutes(app,{db,eve,cat}){
 db.exec(`CREATE TABLE IF NOT EXISTS corp_fitting_imports(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest TEXT NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id,digest))`);
 app.post('/api/fittings/corporation-import',(req,res)=>{
  if(req.inspect||req.recruit)return res.sendStatus(403);
  const rows=req.body?.fittings;
  if(!Array.isArray(rows)||!rows.length||rows.length>50)
   return res.status(400).json({error:'Choose between 1 and 50 fittings.'});
  const valid=[],errors=[];
  for(const [index,fit] of rows.entries()){
   if(typeof fit?.name!=='string'||!fit.name.trim()||fit.name.length>150)
    return res.status(400).json({error:'Each fitting needs a name up to 150 characters.'});
   // CCP renamed this legacy neutralizer in the December 2015 release.
   const body=typeof fit.body==='string'?fit.body.replace(/^Small Unstable Power Fluctuator I(?=\r?$| x\d+\r?$)/gm,'Small Gremlin Compact Energy Neutralizer'):fit.body;
   try{parseFitting(body,cat);valid.push({...fit,body,index});}catch(error){
    errors.push({index,name:fit.name,error:error.message});
   }
  }
  const imported=transaction(db,()=>valid.map(fit=>{
   const digest=hash(JSON.stringify([fit.name.trim(),fit.body]));
   const existing=db.prepare('SELECT document_id FROM corp_fitting_imports WHERE user_id=? AND digest=?').get(req.session.user_id,digest);
   if(existing)return {id:existing.document_id,name:fit.name,index:fit.index,existing:true};
   const id=random();
   db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run(id,req.session.user_id,'fitting',fit.name.trim(),JSON.stringify(fit.body),1,Date.now());
   db.prepare('INSERT INTO document_tags VALUES(?,?)').run(id,'Corp');
   db.prepare('INSERT INTO corp_fitting_imports VALUES(?,?,?)').run(req.session.user_id,digest,id);
   return {id,name:fit.name,index:fit.index,existing:false};
  }));
  res.json({imported,errors});
 });
 async function saved(req){
  const c=ownedCharacter(db,req.session.user_id,req.params.id);
  if(!JSON.parse(c.scopes).includes('esi-fittings.read_fittings.v1'))throw Object.assign(Error('Reconnect this pilot to grant saved fitting access.'),{status:403});
  const rows=await eve.get('/characters/'+c.id+'/fittings',c);
  if(!Array.isArray(rows)||rows.length>10000||rows.some(f=>!Number.isSafeInteger(f.fitting_id)))throw Error('Invalid saved fittings response');
  return {c,rows};
 }
 app.get('/api/characters/:id/saved-fittings',async(req,res)=>{
  const {c,rows}=await saved(req);res.json(rows.map(f=>({id:f.fitting_id,name:f.name,description:f.description,ship:cat.type(f.ship_type_id)?.name||'Type '+f.ship_type_id,ship_type_id:f.ship_type_id,document_id:db.prepare('SELECT document_id FROM fitting_imports WHERE user_id=? AND character_id=? AND fitting_id=?').get(req.session.user_id,c.id,f.fitting_id)?.document_id||null})));
 });
 app.post('/api/characters/:id/saved-fittings/:fitting/import',async(req,res)=>{
  const {c,rows}=await saved(req),fit=rows.find(f=>f.fitting_id===Number(req.params.fitting));if(!fit)return res.sendStatus(404);
  const body=fittingToEFT(fit,cat);
  const document=transaction(db,()=>{
   const old=db.prepare('SELECT document_id FROM fitting_imports WHERE user_id=? AND character_id=? AND fitting_id=?').get(req.session.user_id,c.id,fit.fitting_id);if(old)return old.document_id;
   const id=random();db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run(id,req.session.user_id,'fitting',String(fit.name||'Imported Fitting').slice(0,150),JSON.stringify(body),0,Date.now());
   db.prepare('INSERT INTO document_tags VALUES(?,?)').run(id,'Personal');
   db.prepare('INSERT INTO fitting_imports VALUES(?,?,?,?,?)').run(req.session.user_id,c.id,fit.fitting_id,id,String(fit.description||''));return id;
  });res.json({id:document});
 });
}
