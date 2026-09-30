import test from 'node:test';
import assert from 'node:assert/strict';
import {trajectory,simulate,assess,makePlan,ATOM,HYDRO} from '../src/planner.mjs';
import {adapt,flightProgress,remainingPlan,defenseSignature,upgradeAdvice} from '../src/adaptive.mjs';
function fixture(overrides={}) {
  const s={tick:1000,me:1,target:{x:700,y:500},height:1000,width:1000,
    rules:{atomBlastRadius:30,tickMs:100,samCooldown:90,siloCooldown:90,atomSpeed:10,hydroSpeed:10,samSpeed:12,targetRange:150,maxSamRange:150},
    silos:[{id:1,x:550,y:500,level:50,queue:[]}],sams:[{id:10,x:695,y:500,level:3,queue:[]}],
    gold:100000000n,atomCost:750000n,hydroCost:5000000n,allowed:{atomic:true,mixed:true},includeCommitted:true};
  s.inflight=[{id:99,type:HYDRO,owner:1,committed:true,index:5,waitTicks:0,
    path:trajectory({x:100,y:500},s.target,1000,true,10,150),target:s.target}];
  return {...s,...overrides};
}
const request=(overrides={})=>({remaining:{...makePlan(0),goal:'hydro'},goal:'hydro',atomLimit:50,sentAtoms:0,hydroLimit:1,sentHydros:1,...overrides});
test('supplement from nearer silo rescues the committed hydro without another hydro',()=>{
  const s=fixture(),r=adapt(s,request(),{budgetMs:1500});
  assert.equal(r.decision,'rescue');assert.equal(r.chosen.hydros,0);assert.ok(r.chosen.atoms>0);
  assert.equal(r.chosen.goal,'hydro');assert.equal(assess(s,r.chosen).ok,true);
});
test('too late to save the hydro falls back to atoms and keeps cumulative cap',()=>{
  const s=fixture();s.inflight[0].index=50;
  const r=adapt(s,request({atomLimit:20,sentAtoms:15}),{budgetMs:1500});
  assert.equal(r.decision,'atomic');assert.equal(r.chosen.hydros,0);assert.ok(r.chosen.atoms<=5);
});
test('already targeted hydro is never credited as a surviving payload',()=>{
  const s=fixture();s.inflight[0].targeted=true;
  const r=adapt(s,request(),{budgetMs:1000});assert.equal(r.decision,'atomic');assert.equal(r.chosen.hydroHits,0);
});
test('spent cumulative cap stops rather than resetting the ammo limit',()=>{
  const r=adapt(fixture(),request({sentAtoms:50}),{budgetMs:1000});
  assert.equal(r.decision,'stop');assert.equal(r.chosen,null);assert.match(r.reason,/누적/);
});
test('surviving committed flight needs no gold, silos or remaining ammunition',()=>{
  const s=fixture({sams:[],silos:[],gold:0n,intentBudget:0});
  const r=adapt(s,request({sentAtoms:50}),{budgetMs:1000});
  assert.equal(r.decision,'observe');assert.equal(r.chosen.cost,0n);assert.equal(r.chosen.actions.length,0);
  assert.equal(r.chosen.launches.length,0);assert.equal(r.chosen.committedHydroHits,1);
});
test('unrelated earlier or enemy flights cannot carry the recommendation',()=>{
  for(const flight of [{committed:false},{owner:2}]) {
    const s=fixture({sams:[],silos:[],gold:0n});Object.assign(s.inflight[0],flight);
    assert.equal(assess(s,{...makePlan(0),goal:'hydro'}).ok,false);
  }
});
test('atomic fallback stays atomic even if a new hydrogen plan becomes possible',()=>{
  const s=fixture({sams:[],inflight:[]});
  const r=adapt(s,request({goal:'atomic',sentHydros:0}),{budgetMs:1000});
  assert.equal(r.chosen.goal,'atomic');assert.equal(r.chosen.hydros,0);
});
test('confirmed hits carry forward without paying or relaunching them',()=>{
  const r=simulate(fixture({inflight:[],confirmedAtomHits:2}),makePlan(0),{conservative:true});
  assert.equal(r.atomHits,2);assert.equal(r.cost,0n);assert.deepEqual(r.launches,[]);
});
test('motion timing resolves position independently of stale server trajectoryIndex',()=>{
  const path=fixture().inflight[0].path;
  assert.deepEqual(flightProgress(path,path[5].tile,{trajectoryIndex:0},{startTick:1000,ticksPerStep:1},1005),{index:5,waitTicks:0});
  assert.deepEqual(flightProgress(path,path[0].tile,{}, {startTick:1010,ticksPerStep:1},1005),{index:0,waitTicks:5});
  assert.throws(()=>flightProgress(path,path[6].tile,{}, {startTick:1000,ticksPerStep:1},1005),/일치/);
  assert.throws(()=>flightProgress([path[0],path[0]],path[0].tile,{waitTicks:0},null,1005),/시점/);
});
test('remaining schedule preserves gaps and moves overdue intents beyond compute lead',()=>{
  const p=makePlan(100,100,8),r=remainingPlan(p,1,1000,1010,6);
  assert.equal(r.atoms,50);assert.equal(r.hydros,1);assert.equal(r.actions[0].tick,6);
  assert.equal(r.actions[1].tick-r.actions[0].tick,9);assert.equal(p.actions[1].tick,4);
});
test('faraway SAM changes are irrelevant, path SAM and own silo changes are observed',()=>{
  const s=fixture({inflight:[]});s.sams.push({id:11,x:0,y:0,level:1,queue:[]});
  const original=defenseSignature(s);s.sams[1].level=1000;assert.equal(defenseSignature(s),original);
  s.sams[0].level++;assert.notEqual(defenseSignature(s),original);
});
test('advice distinguishes recharge from missing silos without performing upgrades',()=>{
  const s=fixture({sams:[]}),before=structuredClone(s);
  const r=upgradeAdvice(s,{budgetMs:1000,maxAtoms:50});assert.equal(r.kind,'reload');assert.deepEqual(s,before);
  assert.match(upgradeAdvice(fixture({silos:[]})).text,/건설/);
});

test('specific upgrade advice is backed by a successful hypothetical next attack',()=>{
  const s=fixture({silos:[{id:1,x:100,y:500,level:1,queue:[]}],inflight:[]});
  const r=upgradeAdvice(s,{budgetMs:1500,maxAtoms:50});
  assert.equal(r.kind,'upgrade');assert.equal(r.silo,1);assert.ok(r.to>r.from);
  const upgraded={...s,includeCommitted:false,tick:1180,silos:s.silos.map(u=>({...u,level:r.to,queue:[]}))};
  assert.equal(assess(upgraded,r.plan).ok,true);assert.match(r.text,/최소 레벨.*검증 아님/);
});
