import test from 'node:test';
import assert from 'node:assert/strict';
import {moonSurveyData,surveyList,surveyBrowser,refinedSurvey} from '../lib/moon-surveys.mjs';
test('public installations ship an empty moon catalogue without corporation intelligence',()=>{
 const data=moonSurveyData();assert.deepEqual(data.rows,[]);assert.deepEqual(data.supplemental_imports,[]);assert.deepEqual(data.tabs,{});assert.equal(surveyList().total,0);assert.equal(surveyBrowser().total,0);
});
test('complete probe scans below 100% retain proportions and use composition over drill observations',()=>{
 const moon={key:'Example|1|1',name:'Example I - Moon 1',system:'Example',region:'Example region',constellation:'Example',planet:1,moon:1,probe_scan:true,ores:[{name:'Ytterbite',tier:'R64',fraction:.6}],sources:[],issues:[],drill_observation:{cycle_seconds:3600,products:[{name:'Thulium',units_per_cycle:22}]}};
 const data={...moonSurveyData(),rows:[moon]};
 assert.equal(surveyList({q:'Example'},data).total,1);assert.equal(surveyBrowser({kind:'probe'},data).total,1);assert.equal(surveyBrowser({kind:'incomplete'},data).total,0);
 const result=refinedSurvey(moon,{athanor:{Ytterbite:{batch_m3:1000,materials:[{name:'Tritanium',quantity:1000}]}},metenox:{}},[],{});
 assert.equal(result.ores[0].m3,720000*30*.6);assert.ok(!result.recorded_production);
});
