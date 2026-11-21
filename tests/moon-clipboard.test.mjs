import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseMoonClipboard,moonScanStore} from '../lib/moon-scan-upload.mjs';

const cat={type:id=>({name:({45490:'Zeolites',45492:'Bitumens'})[id]})};
const tarta='Tarta VI - Moon 1\tBitumens\t0.4\t45492\t30005205\t40329101\t40329103\r\n\tZeolites\t0.6\t45490\t30005205\t40329101\t40329103';
const header='Moon\tMoon Product\tQuantity\tOre TypeID\tSolarSystemID\tPlanetID\tMoonID\r\n';
test('moon clipboard resolves real IDs and accepts continuation rows',()=>{
 const [moon]=parseMoonClipboard(header+tarta,cat);
 assert.equal(moon.key,'Tarta|6|1');
 assert.deepEqual(moon.ores.map(o=>[o.name,o.fraction]),[['Bitumens',.4],['Zeolites',.6]]);
 assert.throws(()=>parseMoonClipboard(tarta.replace('40329101','40329102'),cat),/IDs do not match/);
 assert.throws(()=>parseMoonClipboard(tarta.replace('Moon 1','Moon 2'),cat),/name does not match/);
 assert.throws(()=>parseMoonClipboard(tarta.replace('0.6','0.7'),cat),/100%/);
 assert.throws(()=>parseMoonClipboard(tarta.replace('45490','123'),cat),/Unknown moon ore/);
});
test('preview does not write, saves are idempotent and existing compositions are protected',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1);');
 const original=parseMoonClipboard(tarta,cat)[0];
 const base={rows:[{...original,ores:original.ores.map(o=>({...o,fraction:null})),sources:[],drill_observation:{cycle_seconds:3600}}]};
 const store=moonScanStore(db,cat,{base:()=>base});
 assert.equal(store.submit(tarta,1).rows[0].action,'complete');
 assert.equal(store.dataset().rows[0].ores[0].fraction,null);
 assert.equal(store.submit(tarta,1,true).addable,1);
 const [merged]=store.dataset().rows;
 assert.equal(merged.ores[0].fraction,.4);
 assert.equal(merged.drill_observation.cycle_seconds,3600);
 assert.equal(store.submit(tarta,1,true).rows[0].action,'duplicate');
 assert.equal(store.submit(tarta.replace('0.4','0.5').replace('0.6','0.5'),1,true).rows[0].action,'existing');
 assert.equal(store.dataset().rows[0].ores[0].fraction,.4);
});
test('moon clipboard accepts standalone moon headings and preserves totals below 100%',()=>{
 const grouped=tarta.replace('Tarta VI - Moon 1\t','Tarta VI - Moon 1\r\n\t');
 assert.deepEqual(parseMoonClipboard(header+grouped,cat)[0].ores,parseMoonClipboard(tarta,cat)[0].ores);
 assert.throws(()=>parseMoonClipboard(grouped.replace('Moon 1','Moon 2'),cat),/name does not match/);
 assert.deepEqual(parseMoonClipboard(grouped.replace('0.6','0.2'),cat)[0].ores.map(o=>o.fraction),[.4,.2]);
});
