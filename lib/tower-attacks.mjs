export const TOWER_ATTACK_RETENTION=12*3600000;
const number=(text,key)=>Number(text.match(new RegExp('^'+key+':[ \\t]*(?:&[\\w-]+[ \\t]+)?([0-9]+)[ \\t]*\\r?$','m'))?.[1]);
const positive=value=>Number.isSafeInteger(value)&&value>0;
function health(text,key){
 const raw=text.match(new RegExp('^'+key+':[ \\t]*([^\\r\\n]+)[ \\t]*\\r?$','m'))?.[1]?.trim();
 if(!raw||!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw))return null;
 const value=Number(raw);return Number.isFinite(value)&&value>=0&&value<=1?Math.round(value*10000)/100:null;
}
export function towerAttackNotices(notices,previous=[],now=Date.now()){
 const recent=at=>Number.isFinite(at)&&at>=now-TOWER_ATTACK_RETENTION&&at<=now;
 const key=row=>row.moonId?['moon',row.moonId,row.typeId||'',row.at].join(':'):['id',row.id,row.at].join(':');
 const rows=new Map(previous.filter(row=>recent(row.at)).map(row=>[key(row),row]));
 for(const notice of notices){
  if(notice?.type!=='TowerAlertMsg'||typeof notice.text!=='string'||notice.text.length>20000)continue;
  const at=Date.parse(notice.timestamp),moonId=number(notice.text,'moonID'),systemId=number(notice.text,'solarSystemID'),typeId=number(notice.text,'typeID');
  const id=number(notice.text,'towerID')||number(notice.text,'itemID')||number(notice.text,'structureID');
  if(!recent(at)||(!positive(id)&&!(positive(moonId)&&positive(systemId)&&positive(typeId))))continue;
  const row={at,...(positive(id)?{id}:{}),...(positive(moonId)?{moonId}:{}),...(positive(systemId)?{systemId}:{}),...(positive(typeId)?{typeId}:{}),shield:health(notice.text,'shieldValue'),armor:health(notice.text,'armorValue'),hull:health(notice.text,'hullValue')};
  rows.set(key(row),{...rows.get(key(row)),...row});
 }
 return [...rows.values()].sort((a,b)=>a.at-b.at);
}
