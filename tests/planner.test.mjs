import test from 'node:test';
import assert from 'node:assert/strict';
import {trajectory,simulate,assess,search,makePlan,rangeAt,ATOM,HYDRO} from '../src/planner.mjs';
export function fixture(overrides={}) {
  return {tick:1000,me:1,target:{x:700,y:500},height:1000,width:1000,
    rules:{tickMs:100,samCooldown:90,siloCooldown:90,atomSpeed:10,hydroSpeed:10,samSpeed:12,targetRange:150,maxSamRange:150},
    silos:[{id:1,x:100,y:500,level:50,queue:[],building:false}],sams:[],inflight:[],gold:10_000_000_000n,atomCost:750_000n,hydroCost:5_000_000n,
    allowed:{atomic:true,mixed:true},...overrides};
}
test('unprotected hydrogen reaches target in both directions',()=>{
  for(const up of [true,false]) {
    const r=assess(fixture(),makePlan(0,0,0,up));assert.equal(r.ok,true);assert.equal(r.result.hydroHits,1);
  }
});
test('near-target loaded SAM intercepts hydrogen',()=>{
  const s=fixture({sams:[{id:10,x:695,y:500,level:1,queue:[]}]});
  const r=simulate(s,makePlan(0,0));assert.equal(r.hydroHits,0);assert.deepEqual(r.participating,[10]);
});
test('atom decoy creates a verified hydrogen plan',()=>{
  const s=fixture({sams:[{id:10,x:695,y:500,level:1,queue:[]}]});
  const r=search(s,{budgetMs:3000,maxAtoms:100});assert.ok(r.mixed);assert.equal(r.chosen.hydroHits,1);assert.ok(r.atomic);
});
test('SAM near launch site participates even 600 tiles from target',()=>{
  const s=fixture({sams:[{id:10,x:110,y:500,level:50,queue:[]}]});
  const r=simulate(s,makePlan(0,0));assert.equal(r.hydroHits,0);assert.deepEqual(r.participating,[10]);
});
test('Manhattan ordering differs from Euclidean ordering',()=>{
  const s=fixture({target:{x:500,y:500},silos:[{id:1,x:560,y:560,level:1,queue:[]},{id:2,x:600,y:500,level:1,queue:[]}]});
  assert.equal(simulate(s,makePlan(0,0)).launches[0].silo,2);
});
test('same silo chains by one tick; second silo can launch in parallel',()=>{
  const s=fixture({silos:[{id:1,x:100,y:500,level:2,queue:[]},{id:2,x:90,y:500,level:2,queue:[]}]});
  const shots=simulate(s,makePlan(4)).launches;
  assert.deepEqual(shots.map(a=>a.silo),[1,1,2,2]);
  assert.equal(shots[1].depart-shots[0].depart,1);assert.equal(shots[2].depart,shots[0].depart);
});
test('initial silo cooldown is not treated as empty',()=>{
  const s=fixture({silos:[{id:1,x:100,y:500,level:1,queue:[999]}]});
  assert.equal(simulate(s,makePlan(0,0)).dropped,1);
});
test('simultaneously expired silo slots reload only one per tick',()=>{
  const s=fixture({silos:[{id:1,x:100,y:500,level:2,queue:[915,915]}]});
  const r=simulate(s,makePlan(2));assert.equal(r.launches.length,1);assert.equal(r.dropped,1);
});
test('SAM reloads during flight rather than remaining exhausted',()=>{
  const s=fixture({sams:[{id:10,x:695,y:500,level:1,queue:[920]}]});
  assert.equal(simulate(s,makePlan(0,0)).hydroHits,0);
});
test('distant unrelated SAM cannot intercept through a shared slot pool',()=>{
  const s=fixture({sams:[{id:10,x:695,y:500,level:1,queue:[]},{id:11,x:0,y:0,level:2000,queue:[]}]});
  assert.equal(assess(s,makePlan(30,25,8)).ok,true);
});
test('hydrogen type bonus competes with atom decoys at the same tick',()=>{
  const s=fixture({silos:[{id:1,x:100,y:500,level:1,queue:[]},{id:2,x:100,y:500,level:1,queue:[]}],sams:[{id:10,x:695,y:500,level:1,queue:[]}]});
  const p={...makePlan(1,1),actions:[{tick:3,type:ATOM,amount:1},{tick:3,type:HYDRO,amount:1}]};
  const r=simulate(s,p);assert.equal(r.hydroHits,0);assert.equal(r.atomHits,1);
});
test('gold zero is not treated as infinity; truly free costs work',()=>{
  assert.equal(search(fixture({gold:0n})).chosen,null);
  assert.equal(search(fixture({gold:0n,atomCost:0n,hydroCost:0n})).chosen.hydroHits,1);
});
test('hydrogen unaffordable falls back to atomic',()=>{
  const r=search(fixture({gold:750_000n}));assert.equal(r.mode,'atomic');assert.equal(r.chosen.atoms,1);
});
test('disabled weapons never produce an executable plan',()=>{
  assert.equal(search(fixture({allowed:{atomic:false,mixed:false}})).chosen,null);
});
test('bounded search reports incomplete instead of claiming impossible',()=>{
  const r=search(fixture(),{budgetMs:-1});assert.equal(r.mode,'unknown');assert.equal(r.chosen,null);
});
test('upgrade range evolves over actual game ticks',()=>{
  const s=fixture(),sam={level:10,upgrade:{startTick:1000,startRange:70,targetLevel:10,duration:45}};
  assert.equal(rangeAt(sam,1000,s.rules),70);assert.equal(rangeAt(sam,1045,s.rules),118);assert.equal(rangeAt(sam,1022.5,s.rules),94);
});
test('curves are map-clamped and depend on launch direction',()=>{
  const a=trajectory({x:10,y:5},{x:800,y:5},1000,true,10,150);
  const b=trajectory({x:10,y:5},{x:800,y:5},1000,false,10,150);
  assert.ok(a.every(p=>p.tile.y>=0&&p.tile.y<1000));assert.notDeepEqual(a,b);
});
test('missing queue data is a visible error rather than an optimistic guess',()=>{
  assert.throws(()=>search(fixture({silos:[{id:1,x:100,y:500,level:1}]})),/재장전/);
});
test('incomplete SAM upgrade information cannot produce a recommendation',()=>{
  const s=fixture({sams:[{id:10,x:695,y:500,level:10,queue:[],upgrade:{startTick:1000,startRange:null,targetLevel:10,duration:45}}]});
  assert.throws(()=>search(s),/업그레이드/);
});
