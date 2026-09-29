// Paired full-output comparisons, no deadlines or candidate thinning in fixed
// workloads. Timings are Node CPU microbenchmarks, not in-game FPS guarantees.
import assert from 'node:assert/strict';
import * as before from '../tests/reference/planner-v4.1.2.mjs';
import * as after from '../src/planner.mjs';
import {defenseSignature as oldSignature} from '../tests/reference/adaptive-v4.1.2.mjs';
import {defenseSignature} from '../src/adaptive.mjs';
import {stress} from '../tests/performance-fixtures.mjs';
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const rows=[];
for(const [silos,sams,atoms] of [[4,20,100],[20,100,500],[80,400,2000]]) {
 const {snapshot:s,plan:p}=stress(silos,sams,atoms),old=[],next=[];
 before.simulate(stress(4,20,100).snapshot,stress(4,20,100).plan);after.simulate(s,p);
 for(let i=0;i<5;i++) {
  let a,b,t;
  const runOld=()=>{t=performance.now();a=before.simulate(s,p);old.push(performance.now()-t);};
  const runNew=()=>{t=performance.now();b=after.simulate(s,p);next.push(performance.now()-t);};
  if(i%2){runNew();runOld();}else{runOld();runNew();}assert.deepEqual(b,a);
 }
 rows.push({silos,sams,atoms,beforeMs:+median(old).toFixed(2),afterMs:+median(next).toFixed(2),speedup:+(median(old)/median(next)).toFixed(2),fullOutputEqual:true});
}
console.table(rows);
console.log('Dense search, unchanged 350 ms budget (candidate breadth may differ):');
for(const [silos,sams,atoms] of [[4,20,100],[20,100,500],[80,400,2000]]) {
 const {snapshot:s}=stress(silos,sams,atoms,true),runs={};
 for(const [name,module] of [['before',before],['after',after]]) {
  const r=module.search(s,{budgetMs:350,maxAtoms:2000});runs[name]={elapsedMs:r.elapsedMs,tested:r.tested,mode:r.mode,limited:r.limited};
 }
 console.log(JSON.stringify({silos,sams,...runs}));
}
const {snapshot:s}=stress(20,100,500),path=after.trajectory(s.silos[0],s.target,s.height,true,10,150);
s.inflight=Array.from({length:2000},(_,i)=>({committed:true,path,index:i%path.length}));
const signature=[];
for(const [name,fn] of [['before',oldSignature],['after',defenseSignature]]) {
 assert.equal(fn(s),oldSignature(s));fn(s);
 const t=performance.now();for(let i=0;i<50;i++)fn(s);
 signature.push({name,observerMs:(performance.now()-t)/50});
}
console.table(signature);
