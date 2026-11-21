import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {exchange,eveClient} from '../lib/eve.mjs';
import {verifyCorporation} from '../lib/corp.mjs';

test('SSO outages and rate limits are distinct from invalid refresh credentials',async()=>{
 const previous=globalThis.fetch;
 try {
  for(const status of [500,503,420,429,400,401]){
   globalThis.fetch=async()=>({ok:false,status});
   await assert.rejects(exchange({client:'id',secret:'secret'},{}),error=>error.status===([400,401].includes(status)?401:503)&&error.transient===![400,401].includes(status));
  }
 } finally {globalThis.fetch=previous;}
});
test('incomplete ESI membership does not become confirmed role loss',async()=>{
 await assert.rejects(verifyCorporation('token',100,async()=>({ok:true,json:async()=>[]})),error=>error.status===502&&!error.corporationRoleDenied);
 for(const status of [401,403,503,429]){
  await assert.rejects(verifyCorporation('token',100,async url=>url.includes('/affiliation')?{ok:true,json:async()=>[{character_id:100,corporation_id:300}]}:{ok:false,status}),error=>error.status===([401,403].includes(status)?401:503));
 }
});

test('temporary token failures preserve reconnect state while revoked credentials require reconnect',async()=>{
 const previous=globalThis.fetch;
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE characters(id INTEGER PRIMARY KEY,tokens TEXT,expires INTEGER,owner_hash TEXT,scopes TEXT,reconnect INTEGER); INSERT INTO characters VALUES(1,'saved',0,'owner','[]',0)");
  const box={open:()=>({refresh_token:'test-only'})};
  const client=eveClient(db,box,{client:'test',secret:'test',trace:false});
  for(const failure of [503,429,new TypeError('fetch failed'),Object.assign(Error('Timeout'),{name:'TimeoutError'})]){
   globalThis.fetch=async()=>{if(typeof failure==='number')return {ok:false,status:failure};throw failure;};
   await assert.rejects(client.token({id:1}));
   assert.equal(db.prepare('SELECT reconnect FROM characters WHERE id=1').get().reconnect,0);
  }
  globalThis.fetch=async()=>({ok:false,status:400});
  await assert.rejects(client.token({id:1}));
  assert.equal(db.prepare('SELECT reconnect FROM characters WHERE id=1').get().reconnect,1);
 }finally{globalThis.fetch=previous;db.close();}
});
