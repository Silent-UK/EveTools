import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarOccurrences} from '../public/operation-recurrence.mjs';

test('calendar recurrence keeps the original UTC time and clamps short months independently',()=>{
 const starts=Date.parse('2027-01-31T18:45:00Z');
 const from=Date.parse('2027-02-01'),until=Date.parse('2027-04-01');
 const dates=recurrence=>calendarOccurrences([{id:1,manual:true,starts,recurrence}],from,until).map(e=>new Date(e.starts).toISOString());
 assert.deepEqual(dates('monthly'),['2027-02-28T18:45:00.000Z','2027-03-31T18:45:00.000Z']);
 assert.equal(dates('weekly')[0],'2027-02-07T18:45:00.000Z');
 assert.equal(dates('biweekly')[0],'2027-02-14T18:45:00.000Z');
 assert.equal(dates('none')[0],'2027-01-31T18:45:00.000Z');
});
