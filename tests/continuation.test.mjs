import test from 'node:test';
import assert from 'node:assert/strict';
import {search,searchSteps,preflightKey,assess,makePlan} from '../src/planner.mjs';
const fixture=()=>({tick:1000,game:'test',me:1,tile:500700,target:{x:700,y:500},height:1000,width:1000,
 rules:{tickMs:100,samCooldown:90,siloCooldown:90,atomSpeed:10,hydroSpeed:10,samSpeed:12,targetRange:150,maxSamRange:150},
 silos:[{id:1,x:100,y:500,level:50,queue:[],building:false}],sams:[{id:2,x:695,y:500,level:1,queue:[],building:false}],
 inflight:[],gold:10000000000n,atomCost:750000n,hydroCost:5000000n,allowed:{atomic:true,mixed:true}});
test('resumed candidate traversal keeps counts, exact outputs and ordering',async()=>{
 const s=fixture(),options={budgetMs:Infinity,maxAtoms:100};
 const expected=search(s,options),steps=searchSteps(s,options);let result,prev=-1,yields=0;
 while(true){const step=steps.next();if(step.done){result=step.value;break;}
   assert.ok(step.value.tested>=prev);prev=step.value.tested;yields++;
   await new Promise(resolve=>setImmediate(resolve));
 }
 assert.ok(yields>1);delete expected.elapsedMs;delete result.elapsedMs;assert.deepEqual(result,expected);
});
test('explicit continuous search is not truncated by elapsed wall time between steps',async()=>{
 const steps=searchSteps(fixture(),{budgetMs:Infinity,maxAtoms:50});steps.next();
 await new Promise(resolve=>setTimeout(resolve,30));
 let step;do{step=steps.next();}while(!step.done);
 assert.equal(step.value.limited,false);assert.ok(step.value.chosen);
 assert.equal(search(fixture(),{budgetMs:-1}).limited,true);
});
test('idle prelaunch state is time invariant even after a long calculation',()=>{
 const a=fixture(),b={...a,tick:a.tick+500};assert.equal(preflightKey(a),preflightKey(b));
 const plan=makePlan(2,2);assert.equal(assess(a,plan).ok,assess(b,plan).ok);
 assert.deepEqual(assess(a,plan).result.interceptions,assess(b,plan).result.interceptions);
});
test('time-relative queues and progressing upgrades invalidate prelaunch results',()=>{
 for(const type of ['silos','sams']) {
   const a=fixture();a[type][0].queue=[990];const b=structuredClone(a);b.tick++;
   assert.notEqual(preflightKey(a),preflightKey(b));b[type][0].queue[0]++;
   assert.equal(preflightKey(a),preflightKey(b));
 }
 const a=fixture();a.sams[0].upgrade={startTick:990,startRange:70,targetLevel:3,duration:45};
 const b=structuredClone(a);b.tick++;assert.notEqual(preflightKey(a),preflightKey(b));
 a.tick=1100;b.tick=1200;assert.equal(preflightKey(a),preflightKey(b));
});
test('target, geometry, ownership, rules and permissions cannot reuse a prelaunch check',()=>{
 const a=fixture();for(const change of [b=>b.target.x++,b=>b.silos[0].level++,b=>b.sams[0].x++,b=>b.me++,b=>b.rules.atomSpeed++,b=>b.allowed.mixed=false,b=>b.atomCost++]) {
   const b=structuredClone(a);change(b);assert.notEqual(preflightKey(a),preflightKey(b));
 }
});
