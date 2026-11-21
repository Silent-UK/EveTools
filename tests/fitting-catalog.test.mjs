import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {catalog} from '../lib/catalog.mjs';

test('fitting search includes category 7 rigs with subsystems and filters before the result cap',t=>{
 const dir=mkdtempSync(join(tmpdir(),'fitting-catalog-'));
 let cat;
 t.after(()=>{cat?.close();rmSync(dir,{recursive:true,force:true});});
 const db=new DatabaseSync(join(dir,'catalog.sqlite'));
 db.exec('CREATE TABLE types(id INTEGER PRIMARY KEY,name TEXT,category_id INTEGER,published INTEGER,attributes TEXT)');
 const add=db.prepare('INSERT INTO types VALUES(?,?,?,?,?)');
 for(let i=1;i<=61;i++)add.run(i,'A module '+i,7,1,'{}');
 add.run(100,'Medium Imperial Navy Synchronizer',7,1,'{"1153":250}');
 add.run(101,'Tengu Core subsystem',32,1,'{}');
 db.close();
 cat=catalog(dir);
 assert.deepEqual(cat.fittingSearch('','rigs').map(r=>r.id),[100,101]);
 assert.equal(cat.fittingSearch('Synchronizer','equipment').length,0);
 assert.equal(cat.fittingSearch('A module','equipment').length,60);
});
