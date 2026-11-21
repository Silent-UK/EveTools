export const REINFORCEMENT_GRACE=2*3600000;

function verifiedOnline(state){
 return /^(online|(?:shield|armor|hull)_vulnerable)$/i.test(state||'');
}

export function structureReinforcementEnd(row){
 if(verifiedOnline(row.state))return undefined;
 const active=/reinforc/i.test(row.state||'')?Date.parse(row.timer):NaN;
 return Number.isFinite(active)?active:row.recent_reinforcement_end;
}

export function retainStructureReinforcement(row,prior,now){
 if(!prior||verifiedOnline(row.state)||/reinforc/i.test(row.state||''))return;
 const end=structureReinforcementEnd(prior);
 if(end<=now&&end+REINFORCEMENT_GRACE>now)row.recent_reinforcement_end=end;
}
