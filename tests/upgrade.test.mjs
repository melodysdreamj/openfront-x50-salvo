import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/legacy.js',import.meta.url),'utf8');
const core=source.slice(source.indexOf('  function toBig('),source.indexOf('  // 군함 대량 건조'));
const selection=source.slice(source.indexOf('  function requestUpgrade(big)'),source.indexOf('  // ── 무장 상태 클릭 가로채기'));
const rates=source.slice(source.indexOf('  const RL = {'),source.indexOf('  function requestUpgrade(big)'));
function setup(type='City') {
  let now=1000,level=1,next=1;const timers=new Map(),sent=[],messages=[];
  const cfg={mode:'add',addLevels:50,addLevelsBig:500,addLevelsByType:{'Missile Silo':30},addLevelsByTypeBig:{'Missile Silo':300},amount:1,upgradeBurstPerWindow:6,upgradableTypes:[type]};
  const me={gold:()=>10000000000n,id:()=>1},unit={id:()=>7,type:()=>type,tile:()=>0,level:()=>level,owner:()=>me};
  const units=new Map([[7,unit]]);
  const game={unit:id=>units.get(id),units:()=>[...units.values()],myPlayer:()=>me,manhattanDist:()=>0};
  class Upgrade{constructor(unitId,unitType,amount){Object.assign(this,{unitId,unitType,amount});}}
  const bus={emit:e=>sent.push(e)};
  const context=vm.createContext({CFG:cfg,console,Date:{now:()=>now},window:{addEventListener(){}},document:{addEventListener(){}},
    setTimeout(fn,delay){const id=next++;timers.set(id,{fn,due:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    getGameView:()=>game,getEventBus:()=>bus,findUpgradeEventCtor:()=>Upgrade,computeCursorTile:()=>0,
    isOwnedByMe:()=>true,koName:t=>t,toast:t=>messages.push(t),lastBlockToast:0});
  vm.runInContext(core+'\n'+rates+'\n'+selection+'\nthis.api={fire:(big=true)=>fireUpgrade(7,"'+type+'",null,getGameView().myPlayer(),getEventBus(),findUpgradeEventCtor(),big),request:requestUpgrade,cancel:cancelUpgrades,jobs:upgradeJobs,queue:upgradeQueue,status:upgradeStatus,RL};',context);
  const advance=ms=>{const until=now+ms;for(;;){const job=[...timers].filter(([,j])=>j.due<=until).sort((a,b)=>a[1].due-b[1].due)[0];if(!job)break;const [id,j]=job;timers.delete(id);now=j.due;j.fn();}now=until;};
  return {api:context.api,sent,advance,cfg,me,game,units,unit,bus,context,messages,level:n=>level=n};
}
test('X +500 consumes exactly ten 50-level intents independently of atom amount',()=>{
  const h=setup();h.api.fire();assert.equal(h.sent.length,6);h.advance(1100);
  assert.equal(h.sent.length,10);assert.ok(h.sent.every(e=>e.amount===50));assert.equal(h.api.RL.minWindow.length,10);
  h.advance(6000);assert.equal(h.sent.length,10);
});
test('X silo +300 consumes six intents; V silo +30 consumes one',()=>{
  const h=setup('Missile Silo');h.api.fire();h.advance(1100);assert.equal(h.sent.length,6);h.api.cancel();
  h.advance(1100);h.api.fire(false);assert.equal(h.sent.length,7);assert.equal(h.sent.at(-1).amount,30);
});
test('same unit cannot spawn overlapping jobs during send or acknowledgment wait',()=>{
  const h=setup();h.api.fire();h.api.fire();h.advance(1100);h.api.fire();h.advance(1000);
  assert.equal(h.sent.length,10);assert.equal(h.api.jobs.size,1);
  h.level(501);h.advance(200);assert.equal(h.api.jobs.size,0);
  h.api.fire();h.advance(1100);assert.equal(h.sent.length,20);
});
test('cancel clears unsent upgrades instead of firing after Esc',()=>{
  const h=setup();h.api.fire();h.api.cancel();h.advance(10000);
  assert.equal(h.sent.length,6);assert.equal(h.api.jobs.size,0);
});
test('burst respects the exact remaining minute allowance',()=>{
  const h=setup();h.api.RL.minWindow.push(...Array(143).fill(1000));h.api.fire();h.advance(2000);
  assert.equal(h.sent.length,2);assert.equal(h.api.RL.minWindow.length,145);h.api.cancel();
});
test('nonmultiples of fifty use one final partial intent without extra requests',()=>{
  const h=setup();h.cfg.addLevelsBig=525;h.api.fire();h.advance(1100);
  assert.equal(h.sent.length,11);assert.equal(h.sent.at(-1).amount,25);assert.equal(h.sent.reduce((n,e)=>n+e.amount,0),525);
});
test('cancelling during async target lookup prevents the late upgrade',async()=>{
  const h=setup();let resolve;h.me.buildables=()=>new Promise(r=>resolve=r);
  h.api.request(true);h.api.cancel();resolve([{canUpgrade:7,type:'City'}]);
  await new Promise(r=>setImmediate(r));h.advance(2000);assert.equal(h.sent.length,0);
});
test('rapid clicks retain distinct queued jobs while sharing only the active lookup',async()=>{
  const h=setup();let resolve,calls=0;h.me.buildables=()=>{calls++;return new Promise(r=>resolve=r);};
  h.api.request(true);h.api.request(true);resolve([{canUpgrade:7,type:'City'}]);
  await new Promise(r=>setImmediate(r));h.advance(1100);
  assert.equal(calls,1);assert.equal(h.sent.length,10);assert.equal(h.api.queue.length,2);
  h.level(501);h.advance(250);await flush();assert.equal(calls,2);
  resolve([{canUpgrade:7,type:'City'}]);await flush();h.advance(2200);
  assert.equal(h.sent.length,20);
});

const flush=()=>new Promise(r=>setImmediate(r));
async function drive(h,ms) {for(let t=0;t<ms;t+=100){h.advance(100);await flush();}}
function acknowledge(h) {
 h.bus.emit=e=>{h.sent.push(e);const u=h.game.unit(e.unitId);const level=u.level()+e.amount;u.level=()=>level;};
}
test('three queued X clicks apply +1500 as exactly 30 requests, after each batch ACK',async()=>{
 const h=setup();acknowledge(h);
 h.api.request(true);h.api.request(true);h.api.request(true);
 await drive(h,7000);
 assert.equal(h.sent.length,30);assert.equal(h.unit.level(),1501);assert.equal(h.api.queue.length,0);
});
test('V/X mix preserves target, mode and quantity across cursor/config changes',async()=>{
 const h=setup();acknowledge(h);
 const other={...h.unit,id:()=>8,level:()=>1};h.units.set(8,other);
 let target=7;h.game.manhattanDist=(_,tile)=>tile===target?0:99;
 h.unit.tile=()=>7;other.tile=()=>8;
 h.api.request(false);target=8;h.api.request(true);target=7;h.api.request(false);
 h.cfg.addLevels=999;h.cfg.addLevelsBig=999;
 await drive(h,6000);
 assert.deepEqual(h.sent.map(e=>e.unitId),[7,...Array(10).fill(8),7]);
 assert.equal(h.unit.level(),101);assert.equal(other.level(),501);
});
test('no ACK stops the entire FIFO without re-sending or starting the next click',async()=>{
 const h=setup();h.api.request(true);h.api.request(true);await drive(h,8000);
 assert.equal(h.sent.length,10);assert.equal(h.api.queue.length,0);assert.ok(h.messages.some(m=>m.includes('자동 재전송하지')));
});
test('Esc clears queued clicks and a late lookup cannot cancel the new queue',async()=>{
 const h=setup();acknowledge(h);let oldResolve;
 h.me.buildables=()=>new Promise(r=>oldResolve=r);h.api.request(true);h.api.request(true);h.api.cancel();
 h.me.buildables=async()=>[{canUpgrade:7,type:'City'}];h.api.request(false);
 oldResolve([{canUpgrade:7,type:'City'}]);await drive(h,1000);
 assert.equal(h.sent.length,1);assert.equal(h.unit.level(),51);assert.equal(h.api.queue.length,0);
});
test('missing or captured queued target stops without upgrading a replacement',async()=>{
 const h=setup();acknowledge(h);h.api.request(false);h.api.request(true);h.units.delete(7);
 await drive(h,2000);assert.equal(h.sent.length,1);assert.equal(h.api.queue.length,0);
});
test('stalled lookup times out and clears its queued followers',async()=>{
 const h=setup();h.me.buildables=()=>new Promise(()=>{});h.api.request(true);h.api.request(false);
 await drive(h,2000);assert.equal(h.sent.length,0);assert.equal(h.api.queue.length,0);
});
test('absolute target mode is not added again by successive clicks',async()=>{
 const h=setup();acknowledge(h);h.cfg.mode='set';h.cfg.targetLevel=75;
 h.api.request(false);h.api.request(true);await drive(h,2000);
 assert.equal(h.unit.level(),75);assert.equal(h.sent.length,2);assert.equal(h.api.queue.length,0);
});
test('minute limit retains queued work and resumes in order when the window clears',async()=>{
 const h=setup();acknowledge(h);h.api.RL.minWindow.push(...Array(145).fill(1000));
 h.api.request(false);h.api.request(true);await drive(h,2000);
 assert.equal(h.sent.length,0);assert.equal(h.api.queue.length,2);
 await drive(h,62000);assert.equal(h.sent.length,11);assert.equal(h.unit.level(),551);assert.equal(h.api.queue.length,0);
});
test('hidden tab during active transmission prevents remaining batches',async()=>{
 const h=setup();acknowledge(h);h.api.request(true);h.api.request(false);
 h.context.document.hidden=true;await drive(h,5000);
 assert.equal(h.sent.length,6);assert.equal(h.api.queue.length,0);
});

test('negative official upgrade response stops the queue without bypassing restrictions',async()=>{
 const h=setup();h.me.buildables=async()=>[{type:'City',canUpgrade:false}];
 h.api.request(true);h.api.request(false);await drive(h,2000);
 assert.equal(h.sent.length,0);assert.equal(h.api.queue.length,0);
});
