export const DASHBOARD_REFRESH_MS=120000;

// Only the visible Dashboard is refreshed; other workspace checks have their own timer.
export function dashboardAutoRefresh({load,apply,active,visible,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 let timer=null,generation=0,busy=false,last=0;
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 function schedule(delay=DASHBOARD_REFRESH_MS){clear();if(active()&&visible())timer=setTimer(tick,delay);}
 async function tick(){
  timer=null;
  if(!active()||!visible()||busy)return;
  const run=generation;busy=true;
  try{
   const data=await load();
   if(run===generation&&active()&&visible()){apply(data);last=now();}
  }catch{
   // Keep the displayed snapshot on failure and retry at the normal interval.
  }finally{busy=false;if(run===generation)schedule();}
 }
 return {
  start(){generation++;last=now();schedule();},
  stop(){generation++;clear();},
  resume(){clear();if(active()&&visible())schedule(Math.max(0,last+DASHBOARD_REFRESH_MS-now()));}
 };
}

export function replaceDashboardSections(section,html,viewport=window){
 const left=viewport.scrollX,top=viewport.scrollY;
 section.innerHTML=html;
 viewport.scrollTo({left,top,behavior:'instant'});
}
