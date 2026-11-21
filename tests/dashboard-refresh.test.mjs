import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dashboardAutoRefresh,DASHBOARD_REFRESH_MS,replaceDashboardSections} from '../public/dashboard-refresh.mjs';

function harness(load=async()=>({fresh:true})){
 let time=0,id=0,on=true,shown=true;const pending=new Map(),applied=[];
 const refresh=dashboardAutoRefresh({load,apply:value=>applied.push(value),active:()=>on,visible:()=>shown,now:()=>time,
  setTimer:(fn,delay)=>{pending.set(++id,{fn,at:time+delay});return id;},clearTimer:key=>pending.delete(key)});
 return {refresh,pending,applied,set active(value){on=value;},set visible(value){shown=value;},
  async advance(ms){time+=ms;for(const [key,value] of [...pending])if(value.at<=time){pending.delete(key);await value.fn();}}
 };
}

test('Dashboard refreshes every two minutes and never refreshes another page',async()=>{
 let reads=0;const h=harness(async()=>++reads);h.refresh.start();
 assert.equal(DASHBOARD_REFRESH_MS,120000);
 await h.advance(119999);assert.equal(reads,0);
 await h.advance(1);assert.equal(reads,1);assert.deepEqual(h.applied,[1]);
 h.active=false;await h.advance(120000);assert.equal(reads,1);assert.equal(h.pending.size,0);
});

test('hidden Dashboard polling pauses and resumes once when overdue',async()=>{
 let reads=0;const h=harness(async()=>++reads);h.refresh.start();h.visible=false;h.refresh.resume();
 await h.advance(300000);assert.equal(reads,0);
 h.visible=true;h.refresh.resume();h.refresh.resume();assert.equal(h.pending.size,1);
 await h.advance(0);assert.equal(reads,1);assert.equal(h.pending.size,1);
});

test('leaving Dashboard discards an in-flight refresh',async()=>{
 let resolve;const h=harness(()=>new Promise(done=>{resolve=done;}));h.refresh.start();
 const [key,task]=[...h.pending][0];h.pending.delete(key);const running=task.fn();
 h.active=false;h.refresh.stop();resolve({old:true});await running;
 assert.deepEqual(h.applied,[]);assert.equal(h.pending.size,0);
});

test('Dashboard section replacement restores the latest viewport position after DOM changes',()=>{
 const viewport={scrollX:12,scrollY:1400,scrollTo(value){this.scrollX=value.left;this.scrollY=value.top;assert.equal(value.behavior,'instant');}};
 let content='old';const section={set innerHTML(value){content=value;viewport.scrollY=0;}};
 replaceDashboardSections(section,'new notices',viewport);
 assert.equal(content,'new notices');assert.equal(viewport.scrollX,12);assert.equal(viewport.scrollY,1400);
});
