// Record direct interaction, rather than background refreshes, at a bounded rate.
export function trackUserActivity(api,visible=()=>!document.hidden){
 let next=0,pending=false;
 const active=async()=>{if(!visible()||pending||Date.now()<next)return;pending=true;try{await api('/activity',{});next=Date.now()+10*60000;}catch{next=Date.now()+60000;}finally{pending=false;}};
 document.addEventListener('pointerdown',active,{passive:true});document.addEventListener('keydown',active,{passive:true});
}
