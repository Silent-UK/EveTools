export const timerStages=['Armor','Final','Anchoring'];
export const timerStances=['Friendly','Hostile','Neutral'];
export const timerTypes=[
 'Astrahus','Fortizar','Keepstar','Athanor','Tatara','Raitaru','Azbel','Sotiyo',
 'Moreau Fortizar','Draccous Fortizar','Horizon Fortizar','Marginis Fortizar','Prometheus Fortizar','Upwell Palatine Keepstar','Metenox Moon Drill','Skyhook','Customs Office',
 'Mercenary Den','POS','Cyno Jammer','Cyno Beacon'
];

export function parseTimerDetail(detail, systemOverride = ""){
 if(typeof detail!=='string'||detail.length>1500)return null;
 const lines=detail.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const name=lines[0],typedSystem=typeof systemOverride==='string'?systemOverride.trim():'';
 const system=typedSystem
  ? (/^[\w-]{1,64}$/.test(typedSystem)?typedSystem.toUpperCase():'')
  : name?.match(/^([\w-]+)\s+-\s+\S/)?.[1]||'';
 const end=lines.at(-1)?.match(/^(Reinforced until|Anchoring until) (\d{4})\.(\d{2})\.(\d{2}) (\d{2}:\d{2}:\d{2})$/i);
 if(lines.length<2||name.length>200||!end)return null;
 const iso=`${end[2]}-${end[3]}-${end[4]}T${end[5]}.000Z`;
 const at=Date.parse(iso);
 if(!Number.isFinite(at)||new Date(at).toISOString()!==iso)return null;
 return {name,system,at,anchoring:end[1].toLowerCase()==='anchoring until'};
}


export function timerDiscordCommand(timer){
 if(!timer||!Number.isFinite(timer.at))return null;
 const clean=value=>String(value??'').replace(/[\r\n]+/g,' ').trim();
 const date=new Date(timer.at);if(!Number.isFinite(date.getTime()))return null;
 const stamp=date.toISOString().slice(0,19).replaceAll('-','.').replace('T',' ');
 const type=/\bcontrol tower\b/i.test(timer.type||'')?'POS':({'Orbital Skyhook':'Skyhook','Customs Office':'POCO','Customs office':'POCO','Player Owned Customs Office':'POCO'})[timer.type]||timer.type;
 let detail=clean(timer.name);
 if(type==='POCO'){
  if(!/^Customs Office\s*\(/i.test(detail)){
   const owner=clean(timer.ownerName)||clean(timer.ticker).split('/')[0];
   detail=`Customs Office (${detail})${owner?' ['+owner+']':''}`;
  }else if(!/\[[^\]]+\]\s*$/.test(detail)&&clean(timer.ownerName))detail+=' ['+clean(timer.ownerName)+']';
 }
 // Range is a clipboard-format placeholder; it is not used to calculate the timer.
 return `/add_timer stage:${clean(timer.stage)} type:${clean(type)} stance:${clean(timer.stance)} detail:${detail}\n15 km\n${timer.stage==='Anchoring'?'Anchoring until':'Reinforced until'} ${stamp} owner_ticker:${clean(timer.ticker)}`;
}
