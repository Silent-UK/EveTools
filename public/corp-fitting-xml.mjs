const slotTypes=[
 [/^low slot ([0-7])$/,'Low'],[/^med slot ([0-7])$/,'Mid'],
 [/^hi slot ([0-7])$/,'High'],[/^rig slot ([0-7])$/,'Rig'],
 [/^subsystem slot ([0-7])$/,'Subsystem'],[/^service slot ([0-7])$/,'Service']
];
const clean=value=>String(value||'').replace(/[\r\n\[\]]/g,' ').trim();
export function readCorpFittingsXML(text){
 if(typeof text!=='string'||text.length>2000000)throw Error('Choose an XML export under 2 MB.');
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Choose a fitting XML export from EVE.');
 const parser=new DOMParser();
 let xml=parser.parseFromString(text,'application/xml'),incomplete=false;
 if(xml.querySelector('parsererror')){
  const lastComplete=text.lastIndexOf('</fitting>');
  const tail=lastComplete>=0?text.slice(lastComplete+10).trim():'';
  if(lastComplete>=0&&(tail===''||/^<fitting(?:\s|$)/.test(tail))){
   const recovered=parser.parseFromString(text.slice(0,lastComplete+10)+'\n</fittings>','application/xml');
   if(!recovered.querySelector('parsererror')&&recovered.documentElement?.tagName==='fittings'){
    xml=recovered;incomplete=true;
   }
  }
 }
 if(xml.querySelector('parsererror')||xml.documentElement?.tagName!=='fittings')
  throw Error('This XML is incomplete or malformed. Export the fittings again from EVE.');
 const fits=[...xml.documentElement.children];
 if(!fits.length||fits.length>1000||fits.some(f=>f.tagName!=='fitting'))
  throw Error('Choose an export with between 1 and 1,000 fittings.');
 const seen=new Set();
 const result=fits.map((node,index)=>{
  try{
  const name=clean(node.getAttribute('name')),ships=[...node.children].filter(c=>c.tagName==='shipType');
  const ship=clean(ships[0]?.getAttribute('value'));
  if(!name||name.length>150||ships.length!==1||!ship||ship.includes(','))
   throw Error('Check the ship and name for fitting '+(index+1)+'.');
  const slots=slotTypes.map(()=>new Map()),cargo=[];
  const hardware=[...node.children].filter(c=>c.tagName==='hardware');
  if(hardware.length>1000)throw Error(name+' has too many item entries.');
  for(const item of hardware){
   const type=clean(item.getAttribute('type')),slot=item.getAttribute('slot')||'';
   if(!type||type.includes(','))throw Error(name+' has an invalid item name.');
   const raw=item.getAttribute('qty')??'1',quantity=Number(raw);
   if(!/^\d+$/.test(raw)||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000)
    throw Error(name+' has an invalid item quantity.');
   const group=slotTypes.findIndex(([pattern])=>pattern.test(slot));
   if(group>=0){
    const position=Number(slot.match(slotTypes[group][0])[1]);
    if(quantity!==1)throw Error(name+' has an invalid module quantity.');
    if(slots[group].has(position)){
     if(slots[group].get(position)===type)continue;
     throw Error(name+' has different modules in the same slot.');
    }
    slots[group].set(position,type);
   }else{
    if(!['cargo','drone bay','fighter bay'].includes(slot))throw Error(name+' has an unsupported slot '+slot+'.');
    cargo.push(type+' x'+quantity);
   }
  }
  const lines=['['+ship+', '+name+']'];
  slots.forEach((items,group)=>{
   lines.push('');
   if(items.size)for(let position=0;position<=Math.max(...items.keys());position++)
    lines.push(items.get(position)||'[Empty '+slotTypes[group][1]+' slot]');
  });
  lines.push('',...cargo);
  const body=lines.join('\n');
  if(body.length>30000)throw Error(name+' exceeds the fitting size limit.');
  const key=JSON.stringify([name,body]),duplicate=seen.has(key);
  seen.add(key);
  return {name,ship,body,duplicate,description:node.querySelector('description')?.getAttribute('value')||''};
  }catch(error){
   return {name:clean(node.getAttribute('name'))||'Fitting '+(index+1),
    ship:clean(node.querySelector('shipType')?.getAttribute('value')),error:error.message};
  }
 });
 if(incomplete)result.push({
  name:'Incomplete XML export',ship:'',
  error:'The file ends early. Complete fittings were recovered; re-export from EVE to include the unfinished final fitting.'
 });
 return result;
}
