import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {eveClient} from '../lib/eve.mjs';

test('contract item throttling respects Retry-After for one pilot without blocking other syncs',async t=>{
 let now=1000000;
 t.mock.method(Date,'now',()=>now);
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec(`CREATE TABLE esi_cache(character_id INTEGER,path TEXT,data TEXT,expires INTEGER,PRIMARY KEY(character_id,path));
 CREATE TABLE characters(id INTEGER PRIMARY KEY,tokens TEXT,expires INTEGER);
 INSERT INTO characters VALUES(1,'test',9999999),(2,'test',9999999);`);
 const calls=[];
 t.mock.method(globalThis,'fetch',async url=>{
  const path=new URL(url).pathname;calls.push(path);
  if(calls.length===1)return new Response('{}',{status:429,headers:{'x-ratelimit-group':'char-contract','retry-after':'619'}});
  if(path==='/characters/1/clones')return new Response('{}',{status:420,headers:{'x-esi-error-limit-reset':'60'}});
  return new Response('{}');
 });
 const eve=eveClient(db,{open:()=>({access_token:'test'})},{esiTrace:false});
 await assert.rejects(eve.get('/characters/1/contracts/42/items',{id:1}),{status:429});
 now+=618000;
 await assert.rejects(eve.get('/characters/1/contracts?page=1',{id:1}),{status:429});
 assert.equal(calls.length,1);
 await eve.get('/characters/1/skills',{id:1});
 await eve.get('/characters/2/contracts?page=1',{id:2});
 await eve.get('/characters/2/wallet',{id:2});
 assert.equal(calls.length,4);
 now+=1000;
 await eve.get('/characters/1/contracts?page=1',{id:1});
 assert.equal(calls.length,5);
 await assert.rejects(eve.get('/characters/1/clones',{id:1}),{status:420});
 await assert.rejects(eve.get('/characters/2/skills',{id:2}),{status:429});
 assert.equal(calls.length,6);
});
