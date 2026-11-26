import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createApp} from '../server.mjs';import {openStore} from '../lib/store.mjs';import {hash} from '../lib/security.mjs';import {corpDataService} from '../lib/corp-data.mjs';
const base='http://127.0.0.1';
async function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'tools-102-')),db=openStore(dir);
 const {app}=createApp({client:'example-client',secret:'example-secret',exchange:async()=>({access_token:'example-token'}),verifyToken:async(_token,_client,scopes)=>({id:100,name:'Owner',owner:'owner-100',expires:Date.now()+3600000,scopes}),verifyCorporation:async()=>({id:99000001,role:'Director'}),db,data:dir,cat:{type:()=>null,search:()=>[]},key:'ab'.repeat(32),base,owner:100,corporationId:99000001,corporationName:'Example Corp',corporationTicker:'EX',membershipLookup:async()=>({corporation_id:99000001}),eve:{publicGet:async()=>({})}});
 const user=(id,name)=>{const uid=Number(db.prepare('INSERT INTO users(main_id,name) VALUES(?,?)').run(id,name).lastInsertRowid);db.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)').run(id,uid,name,'owner-'+id,'PRIVATE-TOKEN','[]',Date.now()+3600000);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('s-'+id),uid,Date.now()+3600000);return uid;};
 const owner=user(100,'Owner'),member=user(200,'Member');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=(path,actor=100,method='GET',body,extraCookies='')=>fetch(base+':'+server.address().port+'/api'+path,{method,redirect:'manual',headers:{cookie:'tools_session=s-'+actor+(extraCookies?'; '+extraCookies:''),...(body!==undefined?{origin:base,'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 try{await fn({db,request,owner,member,user});}finally{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
}
test('Removing an alt stops sync, removes credentials and sharing, and queues only retained snapshots for admin purge',()=>fixture(async({db,request,member})=>{
 db.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)').run(201,member,'Removed Alt','owner-alt','PRIVATE-ALT-TOKEN','[]',Date.now()+3600000);
 db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,NULL)').run(201,'wallet-history',JSON.stringify({journal:[{description:'PRIVATE-SNAPSHOT'}]}),Date.now(),Date.now()+3600000);
 db.prepare("INSERT INTO jobs(character_id,status) VALUES(201,'queued')").run();
 const response=await request('/characters/201',200,'DELETE',{});assert.equal(response.status,200);
 for(const table of ['characters','snapshots','jobs','esi_cache'])assert.equal(db.prepare('SELECT count(*) n FROM '+table+' WHERE '+(table==='characters'?'id':'character_id')+'=201').get().n,0,table);
 const saved=db.prepare('SELECT * FROM character_removals').get();assert.equal(saved.name,'Removed Alt');assert.ok(saved.snapshots.includes('PRIVATE-SNAPSHOT'));assert.ok(!JSON.stringify(saved).includes('TOKEN'));
 assert.equal((await request('/admin/removals',200)).status,403);
 const listed=await(await request('/admin/removals')).json();assert.equal(listed.rows.length,1);assert.equal(listed.rows[0].datasets,1);assert.ok(!JSON.stringify(listed).includes('PRIVATE-SNAPSHOT'));
 assert.equal((await request('/admin/removals/'+saved.id,200,'DELETE',{character_id:201})).status,403);
 assert.equal((await request('/admin/removals/'+saved.id,100,'DELETE',{character_id:999})).status,400);
 // An old archive must never delete a newly linked live character with the same ID.
 db.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,0)').run(201,member,'Relinked Alt','owner-alt','NEW-TOKEN','[]',Date.now()+3600000);
 assert.equal((await request('/admin/removals/'+saved.id,100,'DELETE',{character_id:201})).status,200);
 assert.equal(db.prepare('SELECT count(*) n FROM character_removals').get().n,0);assert.equal(db.prepare('SELECT tokens FROM characters WHERE id=201').get().tokens,'NEW-TOKEN');
 assert.equal((await request('/characters/200',200,'DELETE',{})).status,400);
}));
test('Audit filters combine names, types and whole UTC dates; activity and ESI transitions do not flood logs',()=>fixture(async({db,request})=>{
 const insert=db.prepare('INSERT INTO audit_events(at,actor_id,actor,action,target,type) VALUES(?,?,?,?,?,?)');
 for(const [date,type,name]of [['2026-11-25T23:59:59.999Z','groups','Member'],['2026-11-26T00:00:00Z','groups','Member'],['2026-11-26T23:59:59.999Z','groups','Member'],['2026-11-27T00:00:00Z','groups','Member'],['2026-11-26T12:00:00Z','discord','Member']])insert.run(Date.parse(date),200,name,'Example action','Example group',type);
 let result=await(await request('/admin/audit?q=Member&type=groups&from=2026-11-26&to=2026-11-26')).json();assert.equal(result.rows.length,2);
 for(const dates of ['from=2026-02-30','from=2026-11-27&to=2026-11-26','type=made-up'])assert.equal((await request('/admin/audit?'+dates)).status,400);
 assert.equal((await request('/admin/audit',200)).status,403);
 for(let i=0;i<3;i++)assert.equal((await request('/activity',200,'POST',{})).status,200);
 assert.equal(db.prepare("SELECT count(*) n FROM audit_events WHERE action='User active'").get().n,1);
 db.prepare("INSERT INTO sync_errors VALUES(200,'skills','SECRET-UPSTREAM-ERROR')").run();db.prepare("INSERT INTO sync_errors VALUES(200,'skills','OTHER-SECRET') ON CONFLICT(character_id,kind) DO UPDATE SET message=excluded.message").run();
 db.prepare("DELETE FROM sync_errors WHERE character_id=200 AND kind='skills'").run();
 result=db.prepare("SELECT * FROM audit_events WHERE type='esi' ORDER BY id").all();assert.deepEqual(result.map(r=>r.action),['ESI issue','ESI recovered']);assert.ok(!JSON.stringify(result).includes('SECRET'));
}));
test('Group application, group leave and timer actions identify the actor and target',()=>fixture(async({db,request,member})=>{
 const gid=Number(db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages) VALUES('Example Group','◇','','auto','[]','[]')").run().lastInsertRowid);
 assert.equal((await request('/groups/'+gid+'/apply',200,'POST',{})).status,200);assert.equal((await request('/groups/'+gid+'/leave',200,'POST',{})).status,200);
 const rows=db.prepare("SELECT * FROM audit_events WHERE type='groups' ORDER BY id").all();assert.deepEqual(rows.map(r=>r.action),['Group application','Group left']);assert.ok(rows.every(r=>r.actor==='Member'&&r.target.includes('Example Group')));
}));
test('Corporation contacts preserve NPC standings, paginate separately and retain prior contact data on failure',()=>fixture(async({db})=>{
 const id=99000001,scopes=['esi-corporations.read_standings.v1','esi-corporations.read_contacts.v1'];db.prepare('INSERT INTO corp_authorizations VALUES(1,100,?,?,?,?,?,?,?,?)').run('Owner','owner-100',id,'sealed',JSON.stringify(scopes),Date.now()+3600000,'Director',Date.now());
 let fail=false,contacts=0;const service=corpDataService({db,id,cat:{},access:async()=>true,request:async()=>({data:[{from_id:500001,from_type:'faction',standing:3}]}),pages:async(path,row,key)=>{assert.equal(key,'contact_id');contacts++;if(fail)throw Error('Temporary contacts issue');return {data:[{contact_id:99000002,contact_type:'corporation',standing:5},{contact_id:99000003,contact_type:'alliance',standing:-5}]};},eve:{request:async(_p,_c,_m,ids)=>({data:ids.map(id=>({id,name:'Entity '+id}))})}});
 let result=await service.standings();assert.deepEqual(result.rows.map(r=>r.from_type),['faction','corporation','alliance']);assert.equal(contacts,1);
 await service.standings();assert.equal(contacts,1);
 db.prepare("UPDATE public_cache SET expires=0 WHERE path='/tools/corp-data/contact-standings'").run();fail=true;result=await service.standings();assert.equal(result.rows.length,3);assert.match(result.contacts_error,/Temporary/);
 db.prepare('UPDATE corp_authorizations SET scopes=?').run(JSON.stringify(scopes.slice(0,1)));result=await service.standings();assert.ok(result.rows.some(r=>r.from_type==='faction'));assert.match(result.contacts_error,/read_contacts/);
}));
import {collectContracts} from '../lib/contracts.mjs';
import {personalWalletView} from '../public/personal-wallet-view.mjs';
import {walletPreferences} from '../public/personal-wallet-model.mjs';
import {collectWalletHistory} from '../lib/wallet-history.mjs';
test('Corporation view never enriches alliance contract items; alliance details load only on request',async()=>{
 const list=[{contract_id:1,availability:'corporation',status:'outstanding',type:'item_exchange'},{contract_id:2,availability:'alliance',status:'outstanding',type:'item_exchange'}],calls=[];
 const eve={request:async(path)=>{calls.push(path);if(path.includes('/items'))return {data:[]};return {pages:1,data:list};}},pilot={id:99000001,scopes:JSON.stringify(['esi-contracts.read_corporation_contracts.v1'])};
 const corp=await collectContracts(pilot,eve,{},null,{corporation:true,view:'corporation'});assert.deepEqual(corp.contracts.map(r=>r.contract_id),[1]);assert.ok(!calls.some(p=>p.endsWith('/2/items')));
 const alliance=await collectContracts(pilot,eve,{},null,{corporation:true,view:'alliance'});assert.deepEqual(alliance.contracts.map(r=>r.contract_id),[2]);assert.ok(calls.some(p=>p.endsWith('/2/items')));
});
test('Market journal details show resolved pilot/from/to names with safe ID fallback and escaped names',()=>{
 const now=Date.now(),pilot={id:200,name:'Example Pilot',updated:now,data:{journal:[{id:1,date:new Date(now).toISOString(),ref_type:'market_escrow',amount:123,first_party_id:200,second_party_id:300,description:'Market escrow release'}],transactions:[],names:{300:'Other <Pilot>'}}};
 const html=personalWalletView([pilot],[{id:200,name:'Example Pilot'}],walletPreferences({days:'all'}),0,[],now);assert.match(html,/<dt>Pilot<\/dt><dd>Example Pilot<small>ID 200/);assert.match(html,/<dt>From<\/dt><dd>Example Pilot/);assert.match(html,/<dt>To<\/dt><dd>Other &lt;Pilot&gt;/);assert.ok(!html.includes('Other <Pilot>'));
});
test('Wallet name resolution also covers retained entries outside the latest ESI response',async()=>{
 let requested=[];const previous={journal:[{id:1,date:'2026-01-01T00:00:00Z',first_party_id:300,second_party_id:400}],transactions:[],names:{}};
 const eve={request:async(path,_c,_m,ids)=>{if(path==='/universe/names'){requested=ids;return {data:ids.map(id=>({id,name:'Resolved '+id}))};}return {data:[],pages:1};}};
 const result=await collectWalletHistory({id:200,name:'Example Pilot',scopes:JSON.stringify(['esi-wallet.read_character_wallet.v1'])},eve,{},previous);assert.deepEqual(requested,[300,400]);assert.equal(result.names[300],'Resolved 300');assert.equal(result.names[200],'Example Pilot');
});
import {CONTACT_SCOPE} from '../lib/corp.mjs';
import {corporationWorkspace} from '../public/corp-workspace.mjs';
test('Contact standings scope is opt-in for corporation reconnect and does not change ordinary login',()=>fixture(async({db,request})=>{
 const normal=await request('/../auth/login',200);assert.equal(normal.status,302);assert.ok(!new URL(normal.headers.get('location')).searchParams.get('scope').split(' ').includes(CONTACT_SCOPE));
 const contact=await request('/../auth/login?corporation=1&contacts=1',200);assert.equal(contact.status,302);const auth=new URL(contact.headers.get('location'));assert.ok(auth.searchParams.get('scope').split(' ').includes(CONTACT_SCOPE));
 assert.ok(db.prepare('SELECT 1 FROM oauth_corporation_contacts WHERE state=?').get(hash(auth.searchParams.get('state'))));
}));
test('Standings render one type at a time and use the supported faction logo route',async()=>{
 const previous=globalThis.document,clicks=[];globalThis.document={addEventListener:(type,handler)=>{if(type==='click')clicks.push(handler);},hidden:false};
 try{
  let html='',workspace;const rows=[{from_id:500001,from_type:'faction',name:'Example Faction',standing:3},{from_id:99000003,from_type:'alliance',name:'Example Alliance',standing:5}];
  workspace=corporationWorkspace({api:async()=>({rows,updated:Date.now()}),intro:()=>'',context:()=>({me:{main_id:100,admin:true},chars:[],page:'corp-standings'}),refresh:async()=>{html=await workspace.render('corp-standings');},toast(){}});
  html=await workspace.render('corp-standings');assert.match(html,/role="tablist"/);assert.match(html,/images.evetech.net\/corporations\/500001\/logo/);assert.doesNotMatch(html,/images.evetech.net\/factions\//);assert.doesNotMatch(html,/images.evetech.net\/alliances\/99000003\/logo/);
  const button={dataset:{cwStanding:'alliance'},closest:()=>({})};await clicks[0]({target:{closest:()=>button}});assert.match(html,/images.evetech.net\/alliances\/99000003\/logo/);assert.doesNotMatch(html,/images.evetech.net\/corporations\/500001\/logo/);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('Normal director login preserves an existing optional corporation contacts grant',()=>fixture(async({db,request,owner})=>{
 db.prepare('INSERT INTO corp_authorizations VALUES(?,?,?,?,?,?,?,?,?,?)').run(owner,100,'Owner','owner-100',99000001,'KEEP-CONTACTS-GRANT',JSON.stringify([CONTACT_SCOPE]),Date.now()+3600000,'Director',Date.now());
 const auth=await request('/../auth/login',100),url=new URL(auth.headers.get('location')),cookie=auth.headers.get('set-cookie').split(';')[0];
 const callback=await request('/../auth/callback?code=example&state='+url.searchParams.get('state'),100,'GET',undefined,cookie);assert.equal(callback.status,302);
 const grant=db.prepare('SELECT tokens,scopes FROM corp_authorizations WHERE user_id=?').get(owner);assert.equal(grant.tokens,'KEEP-CONTACTS-GRANT');assert.ok(JSON.parse(grant.scopes).includes(CONTACT_SCOPE));
 assert.ok(db.prepare("SELECT 1 FROM audit_events WHERE action='User signed in' AND type='activity'").get());
}));

test('Contracts open on Corporation, load Alliance only on click and reset on the next visit',async()=>{
 const previous=globalThis.document,clicks=[],calls=[];globalThis.document={addEventListener:(type,handler)=>{if(type==='click')clicks.push(handler);},hidden:false};
 try{
  let workspace;workspace=corporationWorkspace({api:async path=>{calls.push(path);return {contracts:[],updated:Date.now(),names:{},locations:{}};},intro:()=>'',context:()=>({me:{main_id:100,admin:true},chars:[],page:'corp-contracts'}),refresh:async()=>{await workspace.render('corp-contracts');},toast(){}});
  await workspace.render('corp-contracts');assert.deepEqual(calls,['/corporation/contracts?view=corporation']);
  const button={dataset:{cwContractView:'alliance'},closest:()=>({})};await clicks[0]({target:{closest:()=>button}});assert.equal(calls.at(-1),'/corporation/contracts?view=alliance');
  workspace.navigated('home');await workspace.render('corp-contracts');assert.equal(calls.at(-1),'/corporation/contracts?view=corporation');
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
