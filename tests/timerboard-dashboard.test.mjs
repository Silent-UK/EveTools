import test from 'node:test';
import assert from 'node:assert/strict';
import {unmatchedDashboardTimers} from '../lib/timerboard.mjs';

test('Dashboard keeps manual reinforcements as a fallback for displayed structure timers',()=>{
 const at=Date.parse('2026-11-17T10:40:03Z');
 const tower={name:'Stevestar 1',system:'VSJ-PP',type:'POS',typeId:16213,ticker:'STEMP',stance:'Friendly',at};
 const synced={structureName:'O-VWPB IV - Moon 1',structureKind:'POS',typeId:16213,at:at+1000};
 const office={name:'O-VWPB II',type:'Customs Office',stance:'Friendly',at:at+60000};
 const officeRow={structureName:'o-vwpb ii',structureKind:'Customs Office',at:office.at};
 const hostile={...tower,stance:'Hostile'};
 const otherTicker={...tower,ticker:'OTHER'};
 const otherTime={...tower,at:at+120000};
 const unmatched=(timers,rows)=>unmatchedDashboardTimers(timers,rows,'STEMP/FRT');

 assert.deepEqual(unmatched([tower,office,hostile,otherTicker,otherTime],[synced,officeRow]),[hostile,otherTicker,otherTime]);
 assert.deepEqual(unmatched([tower,office],[]),[tower,office]);
 assert.deepEqual(unmatched([tower],[synced,{...synced,structureName:'Another tower'}]),[tower]);
 const otherManual={...tower,name:'Another manual tower'};
 assert.deepEqual(unmatched([tower,otherManual],[synced]),[tower,otherManual]);
});
