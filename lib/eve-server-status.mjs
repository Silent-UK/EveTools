const minute=60000;
export function eveServerStatus(network=fetch){
 let saved=null,pending=null;
 async function read(){
  const now=Date.now();
  if(saved&&now-saved.checked<minute)return saved;
  if(pending)return pending;
  pending=(async()=>{
   const request=async url=>{
    const response=await network(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('Status service unavailable');
    return response.json();
   };
   const [server,summary]=await Promise.allSettled([
    request('https://esi.evetech.net/status/'),
    request('https://status.eveonline.com/api/v2/summary.json')
   ]);
   const components=summary.status==='fulfilled'?summary.value.components:[];
   const relevant=Array.isArray(components)?components.filter(row=>/Tranquility|EVE Swagger Interface|Login/i.test(row.name||'')):[];
   const offline=relevant.some(row=>/Tranquility/i.test(row.name||'')&&row.status==='major_outage')||
    server.status==='fulfilled'&&server.value.vip===true;
   const healthy=server.status==='fulfilled'&&server.value.vip===false&&Number.isFinite(server.value.players);
   const issues=relevant.filter(row=>row.status!=='operational');
   const complete=summary.status==='fulfilled'&&relevant.length>0;
   const state=offline?'offline':healthy&&complete&&!issues.length?'online':'issues';
   const message=state==='offline'?'Tranquility is offline or closed to players':
    state==='online'?'Tranquility is online':
    issues.length?'Reported issues: '+issues.map(row=>row.name+' · '+String(row.status).replaceAll('_',' ')).join(', '):
    'Server status could not be fully verified';
   saved={state,message,players:healthy?server.value.players:null,checked:Date.now()};
   return saved;
  })().finally(()=>pending=null);
  return pending;
 }
 return {read};
}
