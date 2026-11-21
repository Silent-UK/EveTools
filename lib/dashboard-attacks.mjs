const lifetime=12*3600000;

export function dashboardAttacks(db,snapshot,events,now=Date.now()){
 const dismissed=new Map();
 for(const row of db.prepare('SELECT attack_key FROM dashboard_attack_dismissals').all()){const [id,at]=row.attack_key.split(':').map(Number);dismissed.set(id,Math.max(dismissed.get(id)||0,at));}
 const destroyed=new Set((snapshot.customsOffices?.destroyed||[]).map(([id])=>id));
 const reinforced=new Set(events.filter(event=>event.kind==='reinforcement'&&event.source==='corp-structures').map(event=>event.id));
 for(const timer of snapshot.customsOffices?.reinforced||[])if(timer.started<=now)reinforced.add('reinforcement-'+timer.id);
 const rows=new Map((snapshot.structures||[]).map(row=>[row.id,row]));
 const latest=new Map();
 for(const attack of snapshot.customsOffices?.attacks||[]){
  const row=rows.get(attack.id),key=attack.id+':'+attack.at;
  if(!row||attack.at<=now-lifetime||attack.at>now||destroyed.has(attack.id)||(dismissed.get(attack.id)||0)>=attack.at||reinforced.has('reinforcement-'+attack.id))continue;
  if((latest.get(attack.id)?.at||0)>=attack.at)continue;
  latest.set(attack.id,{title:row.name||'Structure under attack',detail:[row.system,row.region,row.kind].filter(Boolean).join(' · '),at:attack.at,timeLabel:'Attacked',typeId:row.type_id,page:'corp-structures',attackKey:key});
 }
 return [...latest.values()].sort((a,b)=>b.at-a.at);
}
