import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog} from '../lib/catalog.mjs';
import {demoServer} from '../lib/demo-server.mjs';
const directory=process.env.DEMO_TEST_CATALOG;
test('Public demo has isolated admin workspaces, no SSO, and reset', {skip:!directory},async()=>{
 const cat=catalog(directory);let demo;
 try{
  demo=demoServer({cat,base:'http://localhost',secure:false,maxVisitors:3});
  await new Promise(resolve=>demo.server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+demo.server.address().port;
  const read=async(path,cookie)=>fetch(url+path,{headers:cookie?{cookie}:{}});
  let r=await read('/api/me');assert.equal(r.status,200);const a=r.headers.get('set-cookie').split(';')[0];
  assert.match(a,/^evetools_demo=/);assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));
  const me=await r.json();assert.equal(me.admin,true);assert.equal(me.owner,true);assert.equal(me.installation.siteName,'EveTools Demo');
  r=await read('/api/me');const b=r.headers.get('set-cookie').split(';')[0];assert.notEqual(a,b);
  for(const path of ['/api/home','/api/characters','/api/notifications','/api/admin/users','/api/admin/plugins','/api/admin/installation','/api/admin/audit','/api/admin/announcements','/api/admin/discord','/api/timerboard','/api/calendar','/api/corporation/overview','/api/corporation/contracts','/api/corporation/market','/api/corporation/blueprints','/api/corporation/standings','/api/corporation/wallet','/api/corporation/pilots','/api/corporation/harvest','/api/srp','/api/corporation/structures','/api/corporation/industry','/api/corporation/projects','/api/admin/service-plugins','/api/admin/groups','/api/admin/pages','/api/recruitment','/api/service-plugins/buyback','/api/service-plugins/logistics','/api/skills/overview','/api/pi/dashboard','/api/assets','/api/documents?kind=fitting','/api/settings']){
   r=await read(path,a);assert.equal(r.status,200,path+': '+(r.status!==200?await r.text():''));assert.match(r.headers.get('content-type'),/json/);
  }
  const post=async(path,body,cookie,origin='http://localhost')=>fetch(url+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)});
  r=await post('/api/admin/announcements',{title:'Private visitor change',body:'Fictional',audience:'all',expires:Date.now()+86400000},a);assert.equal(r.status,200);
  assert.ok((await(await read('/api/admin/announcements',a)).json()).rows.some(v=>v.title==='Private visitor change'));
  assert.ok(!(await(await read('/api/admin/announcements',b)).json()).rows.some(v=>v.title==='Private visitor change'));
  r=await post('/api/demo/reset',{},a,'https://evil.example');assert.equal(r.status,403);
  r=await post('/api/corporation/sync',{},a);assert.equal(r.status,409);
  r=await fetch(url+'/auth/login',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),' /#home'.trim());
  r=await read('/');assert.match(await r.text(),/demo-view.mjs/);
  r=await read('/app.js');assert.match(r.headers.get('content-type'),/javascript/);assert.ok((await r.text()).includes('/demo/images/characters/'));
  r=await post('/api/demo/reset',{},a);assert.equal(r.status,200);
  r=await read('/api/admin/announcements',a);assert.ok(!(await r.json()).rows.some(v=>v.title==='Private visitor change'));
 }finally{if(demo)await demo.close();cat.close();}
});

test('Public assets and authentication redirects do not allocate a workspace',async()=>{
 const demo=demoServer({cat:{},base:'http://localhost',secure:false});
 try{
  await new Promise(resolve=>demo.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+demo.server.address().port;
  for(const path of ['/health','/','/demo.css','/demo-view.mjs','/demo/images/characters/123/portrait']){
   const response=await fetch(base+path);assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
  }
  const response=await fetch(base+'/auth/login',{redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/#home');
  assert.equal(demo.visitors.size,0);
 }finally{await demo.close();}
});
