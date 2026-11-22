// Public demo entry. Intentionally does not load .env or start production workers.
import http from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {random} from './security.mjs';
import {createDemoWorkspace} from './demo-fixtures.mjs';
import {catalog} from './catalog.mjs';
const root=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
export function demoServer({cat,base,maxVisitors=24,idleMs=30*60000,secure=true}={}) {
 if(!cat||!base)throw Error('A public catalogue and demo origin are required.');
 const visitors=new Map(),arrivals=new Map();
 const origin=new URL(base).origin;
 const cookie=(id,age=1800)=>`evetools_demo=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`;
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 function retire(id,entry){visitors.delete(id);entry.retired=true;if(!entry.active)entry.workspace.close();}
 function cleanup(){for(const [id,entry]of visitors)if((Date.now()-entry.seen>idleMs||Date.now()-entry.created>45*60000)&&!entry.active)retire(id,entry);for(const [ip,item]of arrivals)if(Date.now()-item.at>60000)arrivals.delete(ip);}
 const timer=setInterval(cleanup,60000);timer.unref();
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://images.evetech.net data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
  const path=new URL(req.url,origin).pathname;
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method))return json(res,405,{error:'Unsupported method.'});
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)return json(res,403,{error:'Open the demo in its own browser tab before making changes.'});
  if(path==='/health')return json(res,200,{ok:true,demo:true,version:'1.0.0-demo.1'});
  if(path.startsWith('/auth/')){res.writeHead(302,{Location:'/#home'});return res.end();}
  if(path.startsWith('/demo/images/')){res.writeHead(200,{'content-type':'image/svg+xml'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#23364c"/><circle cx="32" cy="23" r="12" fill="#8ccaff"/><path d="M10 60a22 22 0 0144 0" fill="#6699bb"/></svg>');}
  // Intercept only known, flat public assets; never expose arbitrary files.
  if(/^\/[a-zA-Z0-9_.-]+\.(m?js|css)$/.test(path)){
   const file=resolve(root,'.'+path);
   if(file.startsWith(root+sep)&&existsSync(file)){
    let body=readFileSync(file,'utf8');
    if(/\.m?js$/.test(path))body=body.replaceAll('https://images.evetech.net/characters/','/demo/images/characters/').replaceAll('https://images.evetech.net/corporations/','/demo/images/corporations/');
    res.writeHead(200,{'content-type':types[extname(file)]});return res.end(body);
   }
  }
  if(path==='/'||path==='/index.html'){
   const html=readFileSync(resolve(root,'index.html'),'utf8').replace('<title>EveTools</title>','<title>EveTools · Interactive Demo</title>').replace('</head>','<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/demo.css"><script type="module" src="/demo-view.mjs"></script></head>');
   res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(html);
  }
  cleanup();
  let id=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('evetools_demo='))?.slice(14),entry=visitors.get(id);
  if(!entry){
   const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim();
   let arrival=arrivals.get(ip);if(!arrival||Date.now()-arrival.at>60000){if(arrivals.size>=10000)return json(res,503,{error:'Please try again shortly.'});arrival={at:Date.now(),count:0};arrivals.set(ip,arrival);}
   if(++arrival.count>12){res.setHeader('Retry-After','60');return json(res,429,{error:'Please wait a minute before starting another demo.'});}
   if(visitors.size>=maxVisitors)return json(res,503,{error:'The demo is busy. Please try again shortly.'});
   id=random();
   try{entry={workspace:createDemoWorkspace({cat,base:origin}),seen:Date.now(),created:Date.now(),active:0,count:0,window:Date.now()};}catch(error){console.error('Demo fixture failed:',error.message);return json(res,503,{error:'The demo is temporarily unavailable.'});}
   visitors.set(id,entry);res.setHeader('Set-Cookie',cookie(id));
  }
  entry.seen=Date.now();res.setHeader('Set-Cookie',cookie(id));
  if(entry.seen-entry.window>60000){entry.window=entry.seen;entry.count=0;}
  if(++entry.count>300){res.setHeader('Retry-After','60');return json(res,429,{error:'Please slow down and try again in a minute.'});}
  if(path==='/api/demo'&&req.method==='GET')return json(res,200,{demo:true,admin:true,fictional:true,expiresInMinutes:30});
  if(path==='/api/demo/reset'&&req.method==='POST'){retire(id,entry);res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true});}
  if(req.method!=='GET'&&req.method!=='HEAD'&&(/\/(sync|refresh|rebalance|whitelist-review)(\/|$)/.test(path)||/\/discord\/(test|sync-pilots|connect)/.test(path)||path==='/api/admin/installation/groups'||/^\/api\/admin\/discord$/.test(path)))return json(res,409,{error:'Live connections and background syncs are disabled in the demo. Explore the sample data or reset your demo instead.'});
  req.headers.cookie='tools_session='+entry.workspace.sessionToken;
  entry.active++;let finished=false;const done=()=>{if(finished)return;finished=true;entry.active--;if(entry.retired&&!entry.active)entry.workspace.close();};res.once('finish',done);res.once('close',done);
  entry.workspace.app(req,res);
 });
 return {server,visitors,close:async()=>{clearInterval(timer);await new Promise(resolve=>server.close(resolve));for(const [id,entry]of visitors)retire(id,entry);}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const base=process.env.DEMO_BASE_URL||'https://demo.areyouaspy.co.uk';
 const port=Number(process.env.DEMO_PORT||3020);
 // No outgoing requests, tokens or production configuration are used by this process.
 globalThis.fetch=async()=>{throw Error('Outbound requests are disabled in the public demo.');};
 const cat=catalog(process.env.DEMO_CATALOG_DIR||'data');
 const demo=demoServer({cat,base,secure:new URL(base).protocol==='https:'});
 demo.server.listen(port,'127.0.0.1',()=>console.log(`EveTools demo listening on 127.0.0.1:${port}`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await demo.close();cat.close();process.exit(0);});
}
