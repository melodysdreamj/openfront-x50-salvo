import test from 'node:test';
import assert from 'node:assert/strict';
import {createPriceReader} from '../src/prices.mjs';
const rows=(atom=750000n,hydro=5000000n)=>[{type:'Atom Bomb',cost:atom},{type:'Hydrogen Bomb',cost:hydro}];
test('prices come from PlayerView buildables without engine-only unitsOwned',async()=>{
  let calls=0;const game={},player={buildables:async(tile,types)=>{calls++;assert.equal(tile,undefined);assert.deepEqual(types,['Atom Bomb','Hydrogen Bomb']);return rows();}};
  const reader=createPriceReader();assert.throws(()=>reader.read(game,player),/조회 중/);
  await reader.refresh(game,player);assert.equal(reader.read(game,player)['Atom Bomb'],750000n);
  assert.equal(calls,1);assert.equal(player.unitsOwned,undefined);
});
test('free prices remain zero, and forced pre-strike refresh reads changed costs',async()=>{
  let values=rows(0n,0n);const g={},p={buildables:async()=>values},r=createPriceReader();
  await r.refresh(g,p);assert.equal(r.read(g,p)['Hydrogen Bomb'],0n);
  values=rows();await r.refresh(g,p,true);assert.equal(r.read(g,p)['Hydrogen Bomb'],5000000n);
});
test('missing or malformed prices cannot silently become fixed or free costs',async()=>{
  for(const response of [[],rows(-1n),rows('750000'),rows(NaN)]) {
    const g={},p={buildables:async()=>response},r=createPriceReader();
    await assert.rejects(r.refresh(g,p),/価格|가격/);assert.throws(()=>r.read(g,p),/확인 실패/);
  }
});
test('stale cached prices are unavailable while refresh is pending',async()=>{
  let time=0,resolve;const g={},p={buildables:async()=>rows()},r=createPriceReader({now:()=>time});
  await r.refresh(g,p);time=6000;p.buildables=()=>new Promise(done=>resolve=done);
  assert.throws(()=>r.read(g,p),/조회 중/);await Promise.resolve();resolve(rows(100n,200n));
  await r.refresh(g,p);assert.equal(r.read(g,p)['Atom Bomb'],100n);
});
test('price cache is separated by game and player',async()=>{
  const r=createPriceReader(),a={},b={},p={buildables:async()=>rows(10n)},q={buildables:async()=>rows(20n)};
  await r.refresh(a,p);await r.refresh(b,q);assert.equal(r.read(a,p)['Atom Bomb'],10n);assert.equal(r.read(b,q)['Atom Bomb'],20n);
  await r.refresh(a,q);assert.equal(r.read(a,q)['Atom Bomb'],20n);
});
test('interaction API works and a timed-out late response cannot populate prices',async()=>{
  const r=createPriceReader({timeoutMs:10}),g={},p={actions:async()=>({buildableUnits:rows()})};
  await r.refresh(g,p);assert.equal(r.read(g,p)['Atom Bomb'],750000n);
  let resolve;const other={},slow={buildables:()=>new Promise(done=>resolve=done)};
  await assert.rejects(r.refresh(other,slow),/시간 초과/);resolve(rows());await Promise.resolve();
  assert.throws(()=>r.read(other,slow),/시간 초과/);
});
