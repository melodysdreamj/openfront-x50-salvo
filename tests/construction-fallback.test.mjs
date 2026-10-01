import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate,assess,makePlan,atomicSAMTargets,ATOM,HYDRO} from '../src/planner.mjs';
import {adapt} from '../src/adaptive.mjs';
const fixture=()=>({tick:1000,me:1,target:{x:700,y:500},width:1000,height:1000,
 rules:{atomBlastRadius:30,tickMs:100,samCooldown:90,siloCooldown:90,atomSpeed:10,hydroSpeed:10,samSpeed:12,targetRange:150,maxSamRange:150},
 silos:[{id:1,x:100,y:500,level:50,queue:[]}],sams:[{id:10,x:695,y:500,level:3,queue:[]}],
 inflight:[],gold:10000000000n,atomCost:750000n,hydroCost:5000000n,allowed:{atomic:true,mixed:true}});
const request=()=>({remaining:{...makePlan(0),goal:'hydro'},goal:'hydro',atomLimit:50,sentAtoms:0,hydroLimit:1,sentHydros:1});
test('known construction cannot intercept before activation, but unknown start is active conservatively',()=>{
 const s=fixture(),p=makePlan(0,0);s.sams[0].building=true;s.sams[0].readyTick=1400;
 assert.equal(assess(s,p).ok,true);
 s.sams[0].readyTick=1020;assert.equal(assess(s,p).ok,false);
 delete s.sams[0].readyTick;assert.equal(assess(s,p).ok,false);
});
test('activation two ticks earlier is part of worst-case assessment',()=>{
 const s=fixture(),p=makePlan(0,0);s.sams[0].building=true;
 let boundary=null;
 for(let ready=1020;ready<1100;ready++) {
  s.sams[0].readyTick=ready;
  if(simulate(s,p).hydroHits===1&&simulate(s,p,{constructionShift:-2}).hydroHits===0){boundary=ready;break;}
 }
 assert.notEqual(boundary,null);assert.equal(assess(s,p).ok,false);
});
test('atomic structure radius is strict and independent of level',()=>{
 const s=fixture();s.sams=[{id:10,x:729,y:500,level:500,queue:Array(500).fill(1000)},
 {id:11,x:730,y:500,level:1,queue:[1000]}];
 assert.deepEqual(atomicSAMTargets(s),[10]);
 const p={...makePlan(1),goal:'atomic',targetSAMIds:[10]};
 assert.equal(assess(s,p).ok,true);assert.deepEqual(simulate(s,p).atomDestroyedSAMs,[10]);
 p.targetSAMIds=[11];assert.equal(assess(s,p).ok,false);
});
test('hydrogen failure switches only to a verified target SAM destruction plan',()=>{
 const s=fixture(),r=adapt(s,request(),{budgetMs:Infinity});
 assert.equal(r.decision,'atomic');assert.deepEqual(r.chosen.targetSAMIds,[10]);
 assert.ok(r.chosen.atomDestroyedSAMs.includes(10));assert.equal(assess(s,r.chosen).ok,true);
});
test('no SAM in blast radius stops instead of spending atoms on an empty target',()=>{
 const s=fixture();s.sams[0].x=650;
 const r=adapt(s,request(),{budgetMs:Infinity});assert.equal(r.chosen,null);assert.equal(r.decision,'stop');assert.match(r.reason,/목표 SAM이 없어/);
});
test('previous arrival cannot claim destruction of newly constructed SAM',()=>{
 const s=fixture();s.confirmedAtomHits=5;s.sams[0].building=true;s.sams[0].readyTick=1400;
 const p={...makePlan(0),goal:'atomic',targetSAMIds:[10]};
 assert.equal(assess(s,p).ok,false);
 s.confirmedDestroyedSAMs=[10];assert.equal(assess(s,p).ok,true);
});
test('new SAM in the blast radius joins an existing fallback goal',()=>{
 const s=fixture();s.confirmedAtomHits=1;s.confirmedDestroyedSAMs=[10];
 s.sams=[{id:11,x:695,y:500,level:1,queue:[]}];
 const r=adapt(s,{...request(),goal:'atomic',remaining:{...makePlan(0),goal:'atomic',targetSAMIds:[10]}},{budgetMs:Infinity});
 assert.ok(r.chosen.atoms>0);assert.ok(r.chosen.targetSAMIds.includes(11));
});
test('out of ammunition cannot switch to unverified SAM destruction',()=>{
 const s=fixture(),r=adapt(s,{...request(),sentAtoms:50},{budgetMs:Infinity});
 assert.equal(r.chosen,null);assert.equal(r.decision,'stop');assert.match(r.reason,/누적/);
});

test('SAM anywhere strictly inside the actual atomic blast can be the fallback target',()=>{
 const s=fixture();s.sams[0].x=725;
 const r=adapt(s,request(),{budgetMs:Infinity});assert.equal(r.decision,'atomic');assert.deepEqual(r.chosen.targetSAMIds,[10]);
 s.sams[0].x=730;
 const outside=adapt(s,request(),{budgetMs:Infinity});assert.equal(outside.chosen,null);assert.match(outside.reason,/목표 SAM이 없어/);
});
