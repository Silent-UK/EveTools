import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {moonOreTier,moonSurveyData} from './moon-surveys.mjs';
import {transaction} from './store.mjs';

let celestialIndex,regionsBySystemName;
function loadCelestials(){
 if(!celestialIndex){
  const data=JSON.parse(gunzipSync(readFileSync(new URL('./moon-celestials.json.gz',import.meta.url))));
  celestialIndex={systems:data.systems,moons:new Map(data.moons.map(row=>[row[0],row]))};
 }
 return celestialIndex;
}
export function regionForSystem(systemId){
 return Number.isSafeInteger(systemId)&&systemId>0?loadCelestials().systems[systemId]?.[1]??null:null;
}
export function regionForSystemName(name){
 if(typeof name!=='string'||!name.trim())return null;
 regionsBySystemName??=new Map(Object.values(loadCelestials().systems).map(([system,region])=>[system.toUpperCase(),region]));
 return regionsBySystemName.get(name.trim().toUpperCase())??null;
}
const reject=message=>{throw Object.assign(Error(message),{status:400});};
function roman(n){
 let result='';
 for(const [value,token] of [[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(n>=value){result+=token;n-=value;}
 return result;
}
export function parseMoonClipboard(text,cat,index){
 if(typeof text!=='string'||!text.trim()||text.length>48000)reject('Paste up to 48,000 characters from Moon Probe and Analysis.');
 index??=loadCelestials();
 const grouped=new Map(),lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);let productCount=0,moonLabel='';
 for(let i=0;i<lines.length;i++){
  if(!lines[i].trim())continue;
  const fields=lines[i].split('\t').map(v=>v.trim());
  const [label,product,quantity,type,system,planet,moon,...extra]=fields;
  if(/^moon$/i.test(label)&&/^moon product$/i.test(product))continue;
  const fail=message=>reject('Line '+(i+1)+': '+message);
  if(/^\S+ [IVXLCDM]+ - Moon \d+$/i.test(label)&&fields.slice(1).every(value=>!value)){
   moonLabel=label;
   continue;
  }
  if(++productCount>500)reject('Paste no more than 500 ore rows at a time.');
  if(!product||!moon||extra.length||![type,system,planet,moon].every(id=>/^\d+$/.test(id)&&Number.isSafeInteger(Number(id))))fail('Expected seven tab-separated fields from the EVE clipboard.');
  const location=index.moons.get(Number(moon)),meta=index.systems[Number(system)];
  if(!location||!meta||location[1]!==Number(system)||location[2]!==Number(planet))fail('Moon, planet and system IDs do not match.');
  const [name,region,constellation]=meta,planetNumber=location[3],moonNumber=location[4],moonName=name+' '+roman(planetNumber)+' - Moon '+moonNumber;
  if(label)moonLabel=label;
  if(moonLabel&&moonLabel.toLowerCase()!==moonName.toLowerCase())fail('The moon name does not match its ID.');
  const ore=cat.type(Number(type))?.name,tier=moonOreTier(ore);
  if(!tier)fail('Unknown moon ore type.');
  if(!/^\d*(?:[.,]\d+)?$/.test(quantity)||!quantity||!Number.isFinite(Number(quantity.replace(',','.'))))fail('Invalid ore fraction.');
  const amount=Number(quantity.replace(',','.'));
  if(amount<=0||amount>1)fail('Ore fractions must be greater than 0 and at most 1.');
  if(!grouped.has(location[0]))grouped.set(location[0],{key:name+'|'+planetNumber+'|'+moonNumber,name:moonName,system:name,region,constellation,planet:planetNumber,moon:moonNumber,moon_id:location[0],ores:[],issues:[],line:i+1});
  if(grouped.size>100)reject('Paste no more than 100 moons at a time.');
  const row=grouped.get(location[0]);
  if(row.ores.some(o=>o.name===ore))fail('The same ore is listed twice for this moon.');
  row.ores.push({name:ore,tier,fraction:amount});
 }
 if(!grouped.size)reject('No scan results found.');
 for(const row of grouped.values()){
  const total=row.ores.reduce((sum,o)=>sum+o.fraction,0);
  if(total>1.001)reject(`${row.name}: pasted ore fractions add up to ${(total*100).toFixed(2)}%. The total cannot exceed 100%.`);
 }
 return [...grouped.values()];
}

export function moonScanStore(db,cat,{base=moonSurveyData,index}={}){
 db.exec('CREATE TABLE IF NOT EXISTS member_moon_scans (moon_id INTEGER PRIMARY KEY, data TEXT NOT NULL, submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created INTEGER NOT NULL)');
 const canFill=row=>row?.drill_observation&&!row.conflict&&!row.issues?.length&&row.ores.every(o=>o.fraction==null);
 function dataset(){
  const original=base(),records=db.prepare('SELECT data FROM member_moon_scans').all();
  if(!records.length)return original;
  const rows=new Map(original.rows.map(row=>[row.key,row]));
  for(const {data} of records){
   const scan={...JSON.parse(data),probe_scan:true},existing=rows.get(scan.key);
   if(!existing)rows.set(scan.key,scan);
   else if(canFill(existing))rows.set(scan.key,{...existing,probe_scan:true,ores:scan.ores,sources:[...existing.sources,...scan.sources]});
  }
  return {...original,rows:[...rows.values()].sort((a,b)=>a.region.localeCompare(b.region)||a.system.localeCompare(b.system)||a.planet-b.planet||a.moon-b.moon)};
 }
 function submit(text,user,commit=false){
  const incoming=parseMoonClipboard(text,cat,index);
  const digest=commit?createHash('sha256').update(text).digest('hex'):null;
  const process=()=>{
   const existing=new Map(dataset().rows.map(row=>[row.key,row])),date=new Date().toISOString().slice(0,10);
   const result=incoming.map(({line,...row})=>{
    const old=existing.get(row.key),previous=new Map((old?.ores||[]).map(o=>[o.name,o.fraction]));
    const duplicate=old&&!old.conflict&&!old.issues?.length&&previous.size===row.ores.length&&row.ores.every(o=>Number.isFinite(previous.get(o.name))&&Math.abs(previous.get(o.name)-o.fraction)<=.000101);
    const action=!old?'add':canFill(old)?'complete':duplicate?'duplicate':'existing';
    if(commit&&['add','complete'].includes(action)){
     const scan={...row,sources:[{tab:'Member probe scan · '+date,row:line,sha256:digest}]};
     db.prepare('INSERT INTO member_moon_scans VALUES(?,?,?,?)').run(row.moon_id,JSON.stringify(scan),user,Date.now());
    }
    return {...row,action};
   });
   return {rows:result,addable:result.filter(row=>['add','complete'].includes(row.action)).length};
  };
  return commit?transaction(db,process):process();
 }
 return {dataset,submit};
}
