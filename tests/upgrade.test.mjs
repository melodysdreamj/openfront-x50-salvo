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
  const game={unit:()=>unit,units:()=>[unit],myPlayer:()=>me,manhattanDist:()=>0};
  class Upgrade{constructor(unitId,unitType,amount){Object.assign(this,{unitId,unitType,amount});}}
  const bus={emit:e=>sent.push(e)};
  const context=vm.createContext({CFG:cfg,console,Date:{now:()=>now},window:{addEventListener(){}},document:{addEventListener(){}},
    setTimeout(fn,delay){const id=next++;timers.set(id,{fn,due:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    getGameView:()=>game,getEventBus:()=>bus,findUpgradeEventCtor:()=>Upgrade,computeCursorTile:()=>0,
    isOwnedByMe:()=>true,koName:t=>t,toast:t=>messages.push(t),lastBlockToast:0});
  vm.runInContext(core+'\n'+rates+'\n'+selection+'\nthis.api={fire:(big=true)=>fireUpgrade(7,"'+type+'",null,getGameView().myPlayer(),getEventBus(),findUpgradeEventCtor(),big),request:requestUpgrade,cancel:cancelUpgrades,jobs:upgradeJobs,RL};',context);
  const advance=ms=>{const until=now+ms;for(;;){const job=[...timers].filter(([,j])=>j.due<=until).sort((a,b)=>a[1].due-b[1].due)[0];if(!job)break;const [id,j]=job;timers.delete(id);now=j.due;j.fn();}now=until;};
  return {api:context.api,sent,advance,cfg,me,messages,level:n=>level=n};
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
test('rapid clicks share one pending target lookup',async()=>{
  const h=setup();let resolve,calls=0;h.me.buildables=()=>{calls++;return new Promise(r=>resolve=r);};
  h.api.request(true);h.api.request(true);resolve([{canUpgrade:7,type:'City'}]);
  await new Promise(r=>setImmediate(r));h.advance(1100);
  assert.equal(calls,1);assert.equal(h.sent.length,10);
});
