import test from 'node:test';
import assert from 'node:assert/strict';
import * as before from './reference/planner-v4.1.2.mjs';
import * as after from '../src/planner.mjs';
import {defenseSignature as oldSignature} from './reference/adaptive-v4.1.2.mjs';
import {defenseSignature,workerSnapshot} from '../src/adaptive.mjs';
import {scenario,variants} from './performance-fixtures.mjs';

test('exact full simulation output equals v4.1.2 across 160 seeded maps and four timing variants',()=>{
  for(let seed=1;seed<=160;seed++) {
    const {snapshot:s,plan}=scenario(seed);
    for(const base of variants)for(const conservative of [false,true]) {const variant={...base,conservative};assert.deepEqual(after.simulate(s,plan,variant),before.simulate(s,plan,variant),'seed '+seed+' '+JSON.stringify(variant));}
  }
});
test('completed searches preserve candidate order and every non-clock result',()=>{
  for(let seed=1;seed<=12;seed++) {
    const {snapshot:s}=scenario(seed);s.sams=s.sams.slice(0,3);s.silos.forEach(u=>{u.level=100;u.queue=[];});
    const opt={budgetMs:Infinity,maxAtoms:40,maxTicks:500};
    const a=before.search(s,opt),b=after.search(s,opt);delete a.elapsedMs;delete b.elapsedMs;
    assert.deepEqual(b,a,'search seed '+seed);
  }
});
test('path cache remains correct across changed map heights, speeds, targets and ranges',()=>{
  const cache=new Map();
  for(let seed=1;seed<=30;seed++) {
    const {snapshot:s,plan}=scenario(seed);
    assert.deepEqual(after.simulate(s,plan,{pathCache:cache}),before.simulate(s,plan));
  }
});
test('observer signature equals old full path scans at every remaining path index',()=>{
  for(let seed=1;seed<=40;seed++) {
    const {snapshot:s}=scenario(seed);
    for(let index=0;index<s.inflight[0].path.length;index++) {
      s.inflight[0].index=index;
      assert.equal(defenseSignature(s),oldSignature(s),'signature '+seed+' index '+index);
    }
  }
});

test('Worker payload thinning preserves every conservative assessment and flight counts',()=>{
  for(let seed=1;seed<=60;seed++) {
    const {snapshot:s,plan}=scenario(seed),compact=workerSnapshot(s);
    assert.deepEqual(after.assess(compact,plan),after.assess(s,plan));
    assert.equal(compact.observedFlights,s.inflight.length);
    assert.equal(workerSnapshot(compact).observedFlights,s.inflight.length);
    if(seed<=6) {
      s.sams=[];compact.sams=[];
      const options={budgetMs:Infinity,maxAtoms:10};
      const a=after.search(s,options),b=after.search(compact,options);delete a.elapsedMs;delete b.elapsedMs;
      assert.deepEqual(b,a);
    }
  }
});
