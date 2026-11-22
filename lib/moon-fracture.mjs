export const MOON_NOTICE_MAX_AGE=6*3600000;
const phases={MoonminingExtractionFinished:'ready',MoonminingLaserFired:'fractured',MoonminingAutomaticFracture:'fractured'};
const number=(text,key)=>Number(text.match(new RegExp('^'+key+':[ \\t]*(?:&[\\w-]+[ \\t]+)?([0-9]+)[ \\t]*\\r?$','m'))?.[1]);
export function moonFractureNotices(notices,previous=[],now=Date.now()){
 const recent=at=>Number.isFinite(at)&&at>=now-MOON_NOTICE_MAX_AGE&&at<=now;
 const rows=new Map(previous.filter(row=>recent(row.at)&&['ready','fractured'].includes(row.phase)).map(row=>[row.id+':'+row.phase+':'+row.at,row]));
 for(const notice of notices){
  const phase=phases[notice?.type],at=Date.parse(notice?.timestamp);
  if(!phase||!recent(at)||typeof notice.text!=='string'||notice.text.length>20000)continue;
  const id=number(notice.text,'structureID'),moonId=number(notice.text,'moonID');
  if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(moonId)||moonId<=0)continue;
  rows.set(id+':'+phase+':'+at,{id,moonId,at,phase,automatic:notice.type==='MoonminingAutomaticFracture'});
 }
 return [...rows.values()].sort((a,b)=>a.at-b.at||a.id-b.id);
}
