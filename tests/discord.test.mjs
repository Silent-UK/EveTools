import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../lib/store.mjs';
import {cryptoBox,hash} from '../lib/security.mjs';
import {discordService} from '../lib/discord.mjs';
const ids={client:'100000000000000001',guild:'100000000000000002',bot:'100000000000000003',user:'100000000000000004',role:'100000000000000005',botRole:'100000000000000006'};
async function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'tools-discord-')),db=openStore(dir),calls=[],assigned=new Set();let allowed=true,fail=null,affiliation=123,botPermissions=268435458;
 db.prepare("INSERT INTO users VALUES(1,100,'Pilot',0)").run();db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('session'),1,Date.now()+600000);
 const network=async(url,options={})=>{const path=new URL(url).pathname,c={path,...options};calls.push(c);if(fail)return new Response(JSON.stringify({retry_after:2}),{status:fail});let body;
  if(path.endsWith('/oauth2/token'))body={access_token:'oauth-access'};
  else if(path.endsWith('/oauth2/applications/@me'))body={id:ids.client};
  else if(path.endsWith('/users/@me'))body=options.headers.Authorization.startsWith('Bearer')?{id:ids.user,username:'Player'}:{id:ids.bot,username:'Tools Bot',bot:true};
  else if(path.endsWith('/roles')&&options.method==='GET')body=[{id:ids.guild,position:0,permissions:'0'},{id:ids.role,position:1,permissions:'0'},{id:ids.botRole,position:3,permissions:String(botPermissions)}];
  else if(path.endsWith('/members/'+ids.bot))body={roles:[ids.botRole]};
  else if(path.endsWith('/members/'+ids.user)){if(options.method==='DELETE')return new Response(null,{status:204});body={roles:[...assigned]};}
  else if(path.endsWith('/roles/'+ids.role)){if(options.method==='PUT')assigned.add(ids.role);else assigned.delete(ids.role);return new Response(null,{status:204});}
  else throw Error('Unexpected Discord request '+path);
  return new Response(JSON.stringify(body),{status:200});
 };
 const service=discordService(db,cryptoBox('ab'.repeat(32)),{base:'https://tools.test',discordNetwork:network},{check:async()=>{if(!allowed)throw Object.assign(Error('Not a member'),{status:403});}},{corporationId:123,lookup:async()=>({corporation_id:affiliation})});
 const setup=(manage_roles=true)=>service.save({enabled:true,manage_roles,client_id:ids.client,guild_id:ids.guild,bot_token:'bot-secret',client_secret:'client-secret'});
 const link=async()=>{const state=new URL(service.begin({id:hash('session')})).searchParams.get('state');await service.complete({id:hash('session'),user_id:1},{state,code:'code'});};
 try{await fn({db,service,setup,link,calls,assigned,setAllowed:v=>allowed=v,setFailure:v=>fail=v,setAffiliation:v=>affiliation=v,setBotPermissions:v=>botPermissions=v,ids});}finally{db.close();rmSync(dir,{recursive:true,force:true});}
}
test('Discord settings encrypt secrets, hide them from views, retain blank credentials and reset verification on change',()=>fixture(async({db,service,setup})=>{
 setup();assert.ok(!db.prepare('SELECT data FROM discord_config').get().data.includes('bot-secret'));assert.ok(!JSON.stringify(service.adminView()).includes('client-secret'));assert.equal(service.adminView().connected,0);
 await service.test();assert.ok(service.adminView().connected);assert.equal(service.adminView().bot_name,'Tools Bot');
 service.save({...service.adminView(),bot_token:'',client_secret:''});assert.ok(service.adminView().connected);
 service.save({...service.adminView(),bot_token:'new-secret'});assert.equal(service.adminView().connected,0);assert.equal(service.adminView().guide_hidden,false);
}));
test('Discord linking requires enabled verified integration and binds a single-use OAuth state to the session',()=>fixture(async({service,setup,link})=>{
 assert.throws(()=>service.begin({id:hash('session')}));setup();await service.test();const state=new URL(service.begin({id:hash('session')})).searchParams.get('state');
 await assert.rejects(service.complete({id:'wrong',user_id:1},{state,code:'code'}));await service.complete({id:hash('session'),user_id:1},{state,code:'code'});
 assert.equal(service.self(1).account.name,'Player');await assert.rejects(service.complete({id:hash('session'),user_id:1},{state,code:'code'}));
}));
test('Discord synchronizes approved roles and removes them on revocation, without touching unrelated roles',()=>fixture(async({db,service,setup,link,assigned,calls})=>{
 setup();await service.test();await link();assigned.add('unrelated');db.prepare("INSERT INTO access_groups(name,icon,description,mode,rules,pages,discord_role_id) VALUES('Dreads','◇','','auto','[]','[]',?)").run(ids.role);db.prepare("INSERT INTO group_members VALUES(1,1,'pending')").run();
 await service.syncOne(ids.user);assert.equal(assigned.has(ids.role),false);db.prepare("UPDATE group_members SET status='approved'").run();await service.syncOne(ids.user);assert.ok(assigned.has(ids.role));
 db.prepare("UPDATE group_members SET status='rejected'").run();await service.syncOne(ids.user);assert.equal(assigned.has(ids.role),false);assert.ok(assigned.has('unrelated'));assert.ok(calls.some(c=>c.method==='PUT'));assert.ok(calls.some(c=>c.method==='DELETE'));
}));
test('Discord role cleanup survives deleted groups and deleted accounts',()=>fixture(async({db,service,setup,link,assigned})=>{
 setup();await service.test();await link();assigned.add(ids.role);db.prepare('INSERT INTO discord_roles VALUES(?,?)').run(ids.user,ids.role);db.prepare('DELETE FROM sessions').run();db.prepare('DELETE FROM users WHERE id=1').run();await service.syncOne(ids.user);assert.equal(assigned.has(ids.role),false);assert.equal(db.prepare('SELECT count(*) n FROM discord_roles').get().n,0);
}));
test('Discord pauses when disabled and respects rate limits without granting roles on failure',()=>fixture(async({service,setup,link,setFailure,calls})=>{
 setup();await service.test();await link();service.save({...service.adminView(),enabled:false});const count=calls.length;await service.syncOne(ids.user);assert.equal(calls.length,count);
 service.save({...service.adminView(),enabled:true});setFailure(429);await assert.rejects(service.syncOne(ids.user));const after=calls.length;await assert.rejects(service.syncOne(ids.user));assert.equal(calls.length,after);
}));
test('Discord unlinks only after removing its managed roles',()=>fixture(async({db,service,setup,link,assigned})=>{
 setup();await service.test();await link();assigned.add(ids.role);db.prepare('INSERT INTO discord_roles VALUES(?,?)').run(ids.user,ids.role);await service.unlink(1);assert.equal(service.self(1).account,null);assert.equal(assigned.has(ids.role),false);
}));

test('Discord connects without Manage Roles and leaves all roles untouched while role management is off',()=>fixture(async({db,service,setup,link,assigned,calls})=>{
 setup(false);
 const connected=await service.test();
 assert.ok(connected.connected);
 assert.equal(connected.manage_roles,false);
 assert.equal(new URL(connected.invite).searchParams.get('permissions'),'0');
 assert.ok(!calls.some(call=>call.path.endsWith('/roles')));
 await link();
 assigned.add(ids.role);
 db.prepare('INSERT INTO discord_roles VALUES(?,?)').run(ids.user,ids.role);
 const before=calls.length;
 await service.tick();
 await service.syncOne(ids.user);
 await assert.rejects(service.unlink(1),/enable role management/);
 await assert.rejects(service.request('/guilds/'+ids.guild+'/members/'+ids.user+'/roles/'+ids.role,{method:'DELETE'}),/role management is off/);
 assert.equal(calls.length,before);
 assert.ok(assigned.has(ids.role));
 service.save({...service.adminView(),manage_roles:true});
 await service.syncOne(ids.user);
 assert.equal(assigned.has(ids.role),false);
}));

test('Non-corp policy uses confirmed EVE affiliation and assigns and clears a configured role',()=>fixture(async({service,setup,link,assigned,calls,setAffiliation})=>{
 setup();await service.test();await link();
 assert.throws(()=>service.save({...service.adminView(),non_corp_action:'assign_role',non_corp_role:''}),/role ID/);
 service.save({...service.adminView(),non_corp_action:'assign_role',non_corp_role:ids.role});
 setAffiliation(null);
 const before=calls.length;
 await assert.rejects(service.syncOne(ids.user),/current corporation/);
 assert.equal(calls.length,before);
 setAffiliation(456);
 await service.syncOne(ids.user);
 assert.ok(assigned.has(ids.role));
 setAffiliation(123);
 await service.syncOne(ids.user);
 assert.equal(assigned.has(ids.role),false);
}));

test('Non-corp remove roles respects role hierarchy, and kicking requires the selected policy',()=>fixture(async({service,setup,link,assigned,calls,setAffiliation,setBotPermissions})=>{
 setup();await service.test();await link();
 setAffiliation(456);
 assigned.add(ids.role);assigned.add(ids.botRole);
 service.save({...service.adminView(),non_corp_action:'remove_roles'});
 await assert.rejects(service.syncOne(ids.user),/above the bot/);
 assert.deepEqual([...assigned],[ids.botRole]);
 service.save({...service.adminView(),non_corp_action:'kick',manage_roles:false});
 const before=calls.length;
 await service.syncOne(ids.user);
 assert.equal(calls.length,before);
 service.save({...service.adminView(),manage_roles:true});
 setBotPermissions(268435456);
 await assert.rejects(service.test(),/Kick Members/);
 setBotPermissions(268435458);
 await service.test();
 await service.syncOne(ids.user);
 assert.equal(calls.at(-1).method,'DELETE');
 assert.ok(calls.at(-1).path.endsWith('/members/'+ids.user));
}));
