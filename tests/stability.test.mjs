import test from 'node:test';
import assert from 'node:assert/strict';
import {planningStructureKey,ownQueuesFollowClock,scheduledCandidate,newHydrogenThreat} from '../src/stability.mjs';
import {assess,makePlan} from '../src/planner.mjs';
const fixture=()=>({tick:1000,game:'test',me:1,tile:500700,target:{x:700,y:500},height:1000,width:1000,
 rules:{tickMs:100,samCooldown:90,siloCooldown:90,atomSpeed:10,hydroSpeed:10,samSpeed:12,targetRange:150,maxSamRange:150},
 silos:[{id:1,x:100,y:500,level:50,queue:[],owner:1,building:false}],sams:[{id:2,x:695,y:500,level:1,queue:[],owner:2,building:false}],
 inflight:[],gold:10000000000n,atomCost:750000n,hydroCost:5000000n,allowed:{atomic:true,mixed:true}});
test('external flights and SAM firing/reloading do not restart a structural check',()=>{
 const a=fixture(),b=structuredClone(a);b.tick+=7;b.sams[0].queue=[b.tick];
 b.inflight=[{id:99,type:'Atom Bomb',owner:2,index:5,targeted:false}];
 assert.equal(planningStructureKey(a,b.tick),planningStructureKey(b));
 b.sams.push({id:3,x:0,y:0,level:999,queue:[],owner:2});
 assert.equal(planningStructureKey(a,b.tick),planningStructureKey(b));
});
test('relevant SAM upgrades and silo destruction still require candidate validation',()=>{
 const a=fixture();for(const change of [b=>b.sams[0].level++,b=>b.silos=[],b=>b.silos[0].owner=2,b=>b.allowed.mixed=false]) {
  const b=structuredClone(a);change(b);assert.notEqual(planningStructureKey(a,b.tick),planningStructureKey(b));
 }
});
test('normal SAM upgrade progress/completion is compared at one absolute tick',()=>{
 const a=fixture();a.sams[0].level=3;a.sams[0].upgrade={startTick:990,startRange:70,targetLevel:3,duration:45};
 const b=structuredClone(a);b.tick=1050;b.sams[0].upgrade=null;
 assert.equal(planningStructureKey(a,b.tick),planningStructureKey(b));
 b.sams[0].level=4;assert.notEqual(planningStructureKey(a,b.tick),planningStructureKey(b));
});
test('own queues expire only one slot per tick and new own shots remain detectable',()=>{
 const a=fixture();a.silos[0].queue=[905,905,910,970];const b=structuredClone(a);b.tick=1002;b.silos[0].queue=[910,970];
 assert.equal(ownQueuesFollowClock(a,b),true);b.silos[0].queue=[970];assert.equal(ownQueuesFollowClock(a,b),false);
 b.tick=1003;assert.equal(ownQueuesFollowClock(a,b),true);b.silos[0].queue.push(1003);assert.equal(ownQueuesFollowClock(a,b),false);
});
test('an absolute launch appointment preserves idle queue aging and launch timing',()=>{
 const a=fixture();a.silos[0].queue=[909,970];a.sams[0].queue=[975];
 const p=scheduledCandidate(makePlan(4,4,8),20),b=structuredClone(a);b.tick+=5;b.silos[0].queue.shift();
 assert.equal(ownQueuesFollowClock(a,b),true);
 const q={...p,actions:p.actions.map(v=>({...v,tick:v.tick-5}))};
 const x=assess(a,p),y=assess(b,q);
 assert.equal(x.ok,y.ok);assert.equal(x.result.atomHits,y.result.atomHits);assert.equal(x.result.hydroHits,y.result.hydroHits);
 assert.deepEqual(x.result.launches.map(v=>[v.silo,v.spawn+a.tick,v.depart+a.tick]),y.result.launches.map(v=>[v.silo,v.spawn+b.tick,v.depart+b.tick]));
 assert.equal(p.actions[1].tick-p.actions[0].tick,9);
});
test('normal flight progress and completed atoms keep candidates; new hydro interception rechecks',()=>{
 const a={inflight:[{id:1,committed:true,type:'Atom Bomb',targeted:false},{id:2,committed:true,type:'Hydrogen Bomb',targeted:false}]};
 assert.equal(newHydrogenThreat(a,{inflight:[{...a.inflight[1],index:30}]}),false);
 assert.equal(newHydrogenThreat(a,{inflight:[{...a.inflight[1],targeted:true}]}),true);
});
