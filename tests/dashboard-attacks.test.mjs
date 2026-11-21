import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {dashboardAttacks} from '../lib/dashboard-attacks.mjs';

test('Dashboard attacks expire at twelve hours, deduplicate and clear globally',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE dashboard_attack_dismissals(attack_key TEXT PRIMARY KEY,dismissed INTEGER)');
 const now=1800000000000,hour=3600000;
 const snapshot={structures:[{id:1,name:'Tower',kind:'POS',type_id:16213}],customsOffices:{attacks:[{id:1,at:now-hour},{id:1,at:now-2*hour}]}};
 try{
  let alerts=dashboardAttacks(db,snapshot,[],now);
  assert.equal(alerts.length,1);assert.equal(alerts[0].at,now-hour);
  assert.equal(dashboardAttacks(db,snapshot,[],now+11*hour).length,0);
  assert.equal(dashboardAttacks(db,snapshot,[{id:'reinforcement-1',kind:'reinforcement',source:'corp-structures'}],now).length,0);
  db.prepare('INSERT INTO dashboard_attack_dismissals VALUES(?,?)').run(alerts[0].attackKey,now);
  assert.equal(dashboardAttacks(db,snapshot,[],now).length,0);
  snapshot.customsOffices.attacks.push({id:1,at:now});
  assert.equal(dashboardAttacks(db,snapshot,[],now).length,1);
 }finally{db.close();}
});
