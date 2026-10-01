import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/legacy.js',import.meta.url),'utf8');
const core=source.slice(source.indexOf('  const warshipQueue=[];'),source.indexOf('  function requestUpgrade(big)'));
const flush=()=>new Promise(r=>setImmediate(r));
function setup({ack=true,ackDelay=180}={}) {
 let now=1000,next=1,id=1,cursor=101,gold=10000000n;const timers=new Map(),sent=[],ships=[],messages=[];
 const later=(fn,delay)=>{const id=next++;timers.set(id,{fn,due:now+delay});return id;};
 const me={gold:()=>gold,isAlive:()=>true,buildables:async()=>[{type:'Warship',cost:10n,canBuild:0}]};
 const port={isActive:()=>true,isUnderConstruction:()=>false,owner:()=>me};
 const game={myPlayer:()=>me,isLand:()=>false,units:t=>t==='Port'?[port]:ships};let current=game;
 class Build{constructor(unit,tile,direction,amount){Object.assign(this,{unit,tile,amount});}}
 const bus={emit(e){sent.push({at:now,...e});if(ack)later(()=>{gold-=10n;const uid=id++;ships.push({id:()=>uid,isActive:()=>true,owner:()=>me,warshipState:()=>({patrolTile:e.tile})});},ackDelay);}};
 const doc={hidden:false,addEventListener(){}};
 const context=vm.createContext({CFG:{warshipCount:10,warshipMaxCount:50,warshipDelayMs:120},Date:{now:()=>now},console,
  setTimeout:later,clearTimeout:id=>timers.delete(id),document:doc,window:{addEventListener(){}},
  getGameView:()=>current,getEventBus:()=>bus,findNukeEventCtor:()=>Build,computeCursorTile:()=>cursor,isOwnedByMe:(u,m)=>u.owner()===m,toast:s=>messages.push(s)});
 vm.runInContext(core+'\nthis.api={request:requestWarships,cancel:cancelWarships,state:warshipStatus,RL};',context);
 async function advance(ms) {await flush();const end=now+ms;
  for(;;){const entry=[...timers].filter(([,v])=>v.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!entry)break;
   const [id,t]=entry;timers.delete(id);now=t.due;t.fn();await flush();}now=end;await flush();
 }
 return {api:context.api,sent,ships,messages,me,game,doc,advance,cursor:t=>cursor=t,gold:n=>gold=n,changeGame:()=>current={...game}};
}
test('five rapid clicks queue all fifty ships FIFO, retain target, and respect rolling limits',async()=>{
 const h=setup();for(let i=0;i<5;i++){h.cursor(100+i);h.api.request();}h.cursor(999);await h.advance(20000);
 assert.equal(h.sent.length,50);assert.equal(h.api.state().confirmed,50);assert.equal(h.api.state().running,false);
 assert.deepEqual(h.sent.map(e=>e.tile),Array.from({length:50},(_,i)=>100+Math.floor(i/10)));
 assert.ok(h.sent.every(e=>e.amount===1));
 for(const e of h.sent)assert.ok(h.sent.filter(x=>x.at<=e.at&&x.at>e.at-1000).length<=9);
});
test('minute capacity pause preserves full counts and captured positions',async()=>{
 const h=setup();h.api.RL.minWindow.push(...Array(143).fill(1000));h.api.request();h.cursor(202);h.api.request();h.cursor(999);
 await h.advance(4000);assert.equal(h.sent.length,2);assert.equal(h.api.state().remaining,18);assert.equal(h.api.state().phase,'rate-wait');
 await h.advance(70000);assert.equal(h.sent.length,20);assert.equal(h.api.state().confirmed,20);
 assert.deepEqual(h.sent.map(e=>e.tile),[...Array(10).fill(101),...Array(10).fill(202)]);
 for(const e of h.sent)assert.ok(h.sent.filter(x=>x.at<=e.at&&x.at>e.at-60000).length<=145);
});
test('unacknowledged build stops, is not called complete, and is never blindly resent',async()=>{
 const h=setup({ack:false});h.api.request();h.api.request();await h.advance(8000);
 assert.equal(h.sent.length,1);assert.equal(h.api.state().confirmed,0);assert.equal(h.api.state().running,false);assert.match(h.api.state().message,/반영을 확인하지 못/);
});
test('Esc-style cancellation discards unsent work but permits an already sent ship to appear',async()=>{
 const h=setup();h.api.request();h.api.request();await h.advance(50);h.api.cancel();await h.advance(8000);
 assert.equal(h.sent.length,1);assert.equal(h.ships.length,1);assert.equal(h.api.state().running,false);
});
test('cancelled async preflight cannot send or disturb a newly started queue',async()=>{
 const h=setup();let resolve;h.me.buildables=()=>new Promise(r=>resolve=r);h.api.request();h.api.cancel();
 h.me.buildables=async()=>[{type:'Warship',cost:10n,canBuild:0}];h.cursor(300);h.api.request();
 resolve([{type:'Warship',cost:10n,canBuild:0}]);await h.advance(6000);
 assert.equal(h.sent.length,10);assert.ok(h.sent.every(e=>e.tile===300));assert.equal(h.api.state().confirmed,10);
});
test('capacity consumed while preflight is pending is rechecked before sending',async()=>{
 const h=setup();let resolve;h.me.buildables=()=>new Promise(r=>resolve=r);h.api.request();h.api.RL.secWindow.push(...Array(9).fill(1000));
 resolve([{type:'Warship',cost:10n,canBuild:0}]);await h.advance(100);assert.equal(h.sent.length,0);
 h.me.buildables=async()=>[{type:'Warship',cost:10n,canBuild:0}];await h.advance(6000);assert.equal(h.sent.length,10);
});
test('no usable port in this water or unavailable official data cannot create requests',async()=>{
 for(const row of [{type:'Warship',cost:10n,canBuild:false},{type:'Warship',canBuild:0}]){
  const h=setup();h.me.buildables=async()=>[row];h.api.request();await h.advance(6000);assert.equal(h.sent.length,0);assert.equal(h.api.state().running,false);
 }
});
test('gold shortage midway stops with an accurate partial count',async()=>{
 const h=setup();h.gold(20n);h.api.request();await h.advance(6000);assert.equal(h.sent.length,2);assert.equal(h.api.state().confirmed,2);assert.match(h.api.state().message,/골드 부족/);
});
test('game changes and hidden tabs stop before further commands',async()=>{
 for(const stop of [h=>h.changeGame(),h=>h.doc.hidden=true]){
  const h=setup();h.api.request();await h.advance(50);stop(h);await h.advance(6000);assert.equal(h.sent.length,1);assert.equal(h.api.state().running,false);
 }
});
test('stalled official query times out without filling timers with independent bursts',async()=>{
 const h=setup();h.me.buildables=()=>new Promise(()=>{});for(let i=0;i<10;i++)h.api.request();await h.advance(2000);
 assert.equal(h.sent.length,0);assert.equal(h.api.state().running,false);assert.match(h.api.state().message,/시간 초과/);
});
