import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCategory,groupsDirectoryView} from '../public/groups-directory-view.mjs';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const groups=[{id:1,name:'<Members>',icon:'◇',mode:'auto-enrol',status:'approved',rules:[],eligible:true},{id:2,name:'Fleet',mode:'approval',status:'pending',rules:[]},{id:3,name:'Open',mode:'auto',rules:[]},{id:4,name:'Skills',mode:'restricted',rules:[{}],eligible:false}];
const options={me:{name:'Pilot'},esc,ruleLabel:()=> 'Skill requirement'};
test('membership overview and tabs separate membership methods without losing restricted groups',()=>{
 assert.deepEqual(groups.map(groupCategory),['automatic','approval','open','open']);
 const html=groupsDirectoryView(groups,options);assert.match(html,/Your Memberships/);assert.match(html,/&lt;Members&gt;/);assert.doesNotMatch(html,/<Members>/);assert.match(html,/Pending requests: Fleet/);
 assert.match(html,/data-group-apply="3"/);assert.match(html,/data-group-apply="4" disabled/);assert.doesNotMatch(html,/data-group-apply="2"/);
});
test('automatic groups never offer an application and inspection disables joining',()=>{
 const automatic=groupsDirectoryView(groups,{...options,tab:'automatic'});assert.doesNotMatch(automatic,/data-group-apply/);
 const inspect=groupsDirectoryView(groups,{...options,me:{name:'Pilot',inspect:{}}});assert.match(inspect,/data-group-apply="3" disabled/);
 const approval=groupsDirectoryView(groups,{...options,tab:'approval'});assert.match(approval,/data-group-apply="2" disabled/);
});
