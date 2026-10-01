import test from 'node:test';
import assert from 'node:assert/strict';
import {resultPresentation} from '../src/hud.mjs';
const blocked={chosen:null,mode:'blocked',limited:false,silos:[{id:1}],sams:Array.from({length:72},()=>({})),ready:1,maxAtoms:2000};
test('blocked preview states uncertainty without inventing a minimum silo level or local SAM count',()=>{
 const p=resultPresentation(blocked);
 assert.match(p.title,/찾지 못/);assert.match(p.resources,/재장전 완료 1발분/);assert.match(p.defense,/지도 전체.*72기/);
 assert.doesNotMatch(p.reason,/불가능|부족|레벨/);assert.ok(p.options.every(o=>o.value==='돌파 계획 미확인'));
});
test('limited search never claims attack is impossible and warns that I may fire',()=>{
 const p=resultPresentation({...blocked,limited:true});assert.match(p.title,/미리보기.*확인 못/);assert.match(p.action,/끝까지/);assert.match(p.action,/검증되면 발사/);assert.ok(p.options.every(o=>o.value==='시간 내 확인 못함'));
});
test('failure explanation uses observed capacity or weapon restrictions instead of a generic bottleneck',()=>{
 assert.match(resultPresentation({...blocked,ready:0}).reason,/재장전 중/);
 assert.match(resultPresentation({...blocked,failure:{tubeShortage:9}}).reason,/9발.*발사관 부족/);
 assert.match(resultPresentation(blocked,{allowed:{atomic:false,mixed:false}}).reason,/게임 규칙/);
 assert.match(resultPresentation(blocked,{gold:0n,atomCost:1n,hydroCost:2n}).reason,/골드가 부족/);
});
test('recommended quantities and hits remain separate; zero-cost weapons are valid',()=>{
 const plan={atoms:20,hydros:1,atomHits:3,hydroHits:1};
 const p=resultPresentation({...blocked,chosen:plan,mixed:plan,mode:'mixed'},{gold:0n,atomCost:0n,hydroCost:0n});
 assert.match(p.title,/추천/);assert.equal(p.options[0].value,'원자 20발 + 수소 1발');assert.equal(p.options[0].note,'예상 도달: 수소 1발 · 원자 3발');
});
