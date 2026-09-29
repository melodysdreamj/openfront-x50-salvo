import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlan,ATOM,HYDRO,search} from '../src/planner.mjs';
import {strikeRateDelay} from '../src/dispatch.mjs';
const rate=()=>({perSecond:10,perMinute:150,secWindow:[],minWindow:[]});
test('500 atom requests occupy ten consecutive 100ms ticks; 1000 keep the same cadence',()=>{
 const p=makePlan(1000);
 assert.equal(p.actions.length,20);assert.ok(p.actions.every(a=>a.type===ATOM&&a.amount===50));
 assert.deepEqual(p.actions.map(a=>a.tick),Array.from({length:20},(_,i)=>3+i));
 for(let i=0;i<20;i++)assert.ok(p.actions.filter(a=>a.tick>=p.actions[i].tick&&a.tick<p.actions[i].tick+10).length<=10);
});
test('hydrogen consumes its own tick and shared command slot; split atom totals stay exact',()=>{
 const p=makePlan(525,275,8);
 assert.equal(p.actions.filter(a=>a.type===HYDRO).length,1);
 assert.equal(p.actions.filter(a=>a.type===ATOM).reduce((n,a)=>n+a.amount,0),525);
 assert.ok(p.actions.every(a=>a.amount<=50));
 p.actions.slice(1).forEach((a,i)=>assert.equal(a.tick-p.actions[i].tick,a.type===HYDRO?9:1));
});
test('I uses tenth shared second slot but never sends an eleventh before its window expires',()=>{
 const r=rate(),now=10000;r.secWindow=Array.from({length:9},(_,i)=>now-900+i*100);
 assert.equal(strikeRateDelay(r,now),0);r.secWindow.push(now);
 assert.equal(strikeRateDelay(r,now),100);assert.equal(strikeRateDelay(r,now+99),1);assert.equal(strikeRateDelay(r,now+100),0);
});
test('mixed requests and previous script work use the same minute cap with five reserved slots',()=>{
 const r=rate();r.minWindow=Array.from({length:145},(_,i)=>1000+i*110);
 assert.equal(strikeRateDelay(r,50000),11000);assert.equal(strikeRateDelay(r,61000),0);
 r.secWindow=[60999,60999,60999,60999,60999,60999,60999,60999,60999,60999];
 assert.equal(strikeRateDelay(r,61000),999);
});
test('real search emits the fast cadence rather than only changing a display or manual plan',()=>{
 const s={tick:1000,me:1,target:{x:700,y:500},height:1000,width:1000,
 rules:{tickMs:100,samCooldown:90,siloCooldown:90,atomSpeed:10,hydroSpeed:10,samSpeed:12,targetRange:150,maxSamRange:150},
 silos:Array.from({length:50},(_,i)=>({id:i+1,x:100+i,y:500,level:20,queue:[]})),sams:[],
 gold:10000000000n,atomCost:750000n,hydroCost:5000000n,allowed:{atomic:true,mixed:false}};
 const r=search(s,{budgetMs:Infinity,maxAtoms:500,minAtomHits:500,allowNewHydro:false});
 assert.equal(r.chosen.atoms,500);assert.equal(r.chosen.atomHits,500);
 assert.deepEqual(r.chosen.actions.map(a=>a.tick),[3,4,5,6,7,8,9,10,11,12]);
});
