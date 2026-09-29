import {ATOM,HYDRO,assess,search} from './planner.mjs';

// Decode authoritative motion-plan time instead of the nukeState index, which
// may be stale when the client derives motion without per-tick unit updates.
export function flightProgress(path,position,nukeState,motion,tick) {
  if(!path?.length)throw Error('비행 궤적이 없어 재계산할 수 없습니다');
  const matches=i=>path[i]?.tile.x===position.x&&path[i]?.tile.y===position.y;
  if(motion) {
    if(motion.ticksPerStep!==1||!Number.isInteger(motion.startTick))throw Error('지원하지 않는 비행 시간 정보');
    const index=Math.max(0,Math.min(path.length-1,tick-motion.startTick));
    if(!matches(index))throw Error('비행 위치와 시간 정보가 일치하지 않습니다');
    return {index,waitTicks:Math.max(0,motion.startTick-tick)};
  }
  // Older clients are usable only when the observed tile unambiguously resolves
  // the path index; never substitute the stale server index or silently guess.
  const matchesAt=[];path.forEach((_,i)=>{if(matches(i))matchesAt.push(i);});
  if(matchesAt.length!==1||!Number.isInteger(nukeState.waitTicks)||nukeState.waitTicks<0)
    throw Error('미사일의 현재 비행 시점을 확인할 수 없습니다');
  return {index:matchesAt[0],waitTicks:matchesAt[0]===0?nukeState.waitTicks:0};
}

export function remainingPlan(plan,index,baseTick,snapshotTick,leadTicks=6) {
  const actions=plan.actions.slice(index).map(a=>({...a,tick:baseTick+a.tick-snapshotTick}));
  const shift=actions.length?Math.max(0,leadTicks-actions[0].tick):0;
  for(const a of actions)a.tick+=shift;
  return {...plan,actions,atoms:actions.filter(a=>a.type===ATOM).reduce((n,a)=>n+a.amount,0),
    hydros:actions.filter(a=>a.type===HYDRO).reduce((n,a)=>n+a.amount,0)};
}

// Cheap geometric broad phase for the observer. Every potentially relevant SAM
// stays in the simulator. Changes well outside every possible path need not
// interrupt a precisely timed volley.
export function defenseSignature(s) {
  const r=s.rules.maxSamRange, boxes=[];
  for(const silo of s.silos) {
    const h=Math.max(Math.hypot(s.target.x-silo.x,s.target.y-silo.y)/3,50);
    boxes.push([Math.min(silo.x,s.target.x)-r,Math.max(silo.x,s.target.x)+r,
      Math.min(silo.y,s.target.y)-h-r,Math.max(silo.y,s.target.y)+h+r]);
  }
  for(const b of s.inflight??[])if(b.committed&&b.path?.length) {
    const p=b.path.slice(b.index).map(v=>v.tile);
    if(p.length)boxes.push([Math.min(...p.map(v=>v.x))-r,Math.max(...p.map(v=>v.x))+r,
      Math.min(...p.map(v=>v.y))-r,Math.max(...p.map(v=>v.y))+r]);
  }
  return JSON.stringify([
    s.silos.map(u=>[u.id,u.x,u.y,u.level,u.building,u.owner]),s.allowed,
    s.sams.filter(u=>boxes.some(([x0,x1,y0,y1])=>u.x>=x0&&u.x<=x1&&u.y>=y0&&u.y<=y1))
      .map(u=>[u.id,u.x,u.y,u.level,u.building,u.owner,u.upgrade])]);
}

export function adapt(s,request,options={}) {
  const began=performance.now(),budget=options.budgetMs??350,deadline=began+budget;
  const cap=Math.max(0,request.atomLimit-request.sentAtoms);
  const hydroLeft=Math.max(0,request.hydroLimit-request.sentHydros);
  const minHits=options.minAtomHits??1,lead=options.initialTicks??6;
  s={...s,includeCommitted:true};
  const old=request.remaining?{...request.remaining,goal:request.goal}:null;
  const envelope=p=>p&&p.atoms<=cap&&p.hydros<=hydroLeft&&p.actions.length<=(s.intentBudget??140)&&
    p.actions.every(a=>a.type===HYDRO?s.allowed?.mixed!==false:s.allowed?.atomic!==false)&&
    BigInt(p.atoms)*s.atomCost+BigInt(p.hydros)*s.hydroCost<=s.gold;
  // Test the committed goal first. No repeated hydro launch when its per-run
  // allowance has already been spent; a flying hydro can only receive atom help.
  if(envelope(old))try{
    const check=assess(s,old,{deadline,minAtomHits:minHits,maxTicks:options.maxTicks});
    if(check.ok)return {chosen:{...old,...check.result},decision:old.actions.length?'keep':'observe',
      reason:old.actions.length?'변경된 SAM에서도 남은 계획 유효':'추가 발사 없이 현재 비행으로 목표 달성 예상',snapshotTick:s.tick};
  }catch(e){if(e.message!=='SEARCH_TIMEOUT')throw e;}
  const timeLeft=deadline-performance.now();
  if(timeLeft<=0)return {chosen:null,decision:'stop',limited:true,reason:'재계산 시간 내 유효한 계획을 확인하지 못했습니다',snapshotTick:s.tick};
  const result=search(s,{...options,budgetMs:timeLeft,maxAtoms:cap,initialTicks:lead,
    allowHydroGoal:request.goal!=='atomic',allowNewHydro:hydroLeft>0});
  if(!result.chosen)return {...result,decision:'stop',reason:cap===0?'이번 공격의 누적 원자 발사 한도에 도달했습니다':result.reason};
  const goal=result.chosen.goal??(result.chosen.hydros?'hydro':'atomic');
  const decision=!result.chosen.actions.length?'observe':goal==='atomic'?'atomic':request.sentHydros>0?'rescue':'mixed';
  const reason={observe:'현재 관측 상태로 목표 달성 예상 — 추가 발사 보류',
    atomic:request.goal==='atomic'?'변경된 방어에 맞춰 원자 집중 수량·일정 수정':'수소 구출 계획을 찾지 못해 원자 집중으로 전환',rescue:`비행 중 수소 구출을 위해 원자 ${result.chosen.atoms}발 보강`,
    mixed:`원자 ${result.chosen.atoms}발 + 수소 ${result.chosen.hydros}발로 남은 계획 수정`}[decision];
  return {...result,decision,reason};
}

// Advice is a separate, non-executing next-attack experiment. It never mutates
// the live game or pretends an upgrade can finish before a flying hydro arrives.
export function upgradeAdvice(s,options={}) {
  const deadline=performance.now()+(options.budgetMs??800),attempts=[];
  const ready={...s,includeCommitted:false,inflight:[],confirmedAtomHits:0,confirmedHydroHits:0,
    tick:s.tick+s.rules.samCooldown+90,
    silos:s.silos.filter(u=>!u.building).map(u=>({...u,queue:[]})),
    sams:s.sams.map(u=>({...u,queue:[],level:Math.max(u.level,u.upgrade?.targetLevel??u.level),upgrade:null}))};
  if(!ready.silos.length)return {text:'먼저 사일로를 건설하고 완공 후 다시 분석하세요',verified:false};
  const check=state=>search(state,{...options,budgetMs:Math.max(1,Math.min(120,deadline-performance.now())),initialTicks:3});
  if(performance.now()<deadline) {
    const base=check(ready);
    if(base.chosen)return {text:'현재 배치도 재장전 완료 후 다음 공격에서 돌파 계획이 있습니다. 발사관을 충전한 뒤 다시 분석하세요',verified:true,kind:'reload'};
  }
  for(const silo of ready.silos.slice().sort((a,b)=>Math.abs(a.x-s.target.x)+Math.abs(a.y-s.target.y)-Math.abs(b.x-s.target.x)-Math.abs(b.y-s.target.y)).slice(0,3)) {
    for(const add of [10,25,50,100]) {
      if(performance.now()>=deadline)return {text:'현재 탐색 시간 안에 레벨업만으로 해결되는 조건을 확인하지 못했습니다. 사일로 추가·배치 변경도 검토하세요',verified:false,attempts};
      const next={...ready,silos:ready.silos.map(u=>u.id===silo.id?{...u,level:u.level+add}:u)};
      const r=check(next);attempts.push({id:silo.id,add,success:!!r.chosen});
      if(r.chosen)return {text:`다음 공격 후보: 사일로 (${silo.x}, ${silo.y}) Lv${silo.level} → Lv${silo.level+add}. 업그레이드·재장전 완료를 가정하면 돌파 예상 (최소 레벨·업그레이드 비용 검증 아님)`,
        verified:true,kind:'upgrade',silo:silo.id,from:silo.level,to:silo.level+add,plan:r.chosen,attempts};
    }
  }
  return {text:'시험한 레벨업만으로는 돌파를 확인하지 못했습니다. 사일로 수·배치 또는 다음 공격의 발사 한도를 검토하세요',verified:false,attempts};
}
