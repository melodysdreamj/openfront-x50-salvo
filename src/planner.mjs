// The physics and target selector are pinned in src/vendor. No browser objects here.
import {DistanceBasedBezierCurve, SAMTargetingSystem} from './vendor/engine.mjs';

export const ATOM = 'Atom Bomb', HYDRO = 'Hydrogen Bomb';
const manhattan = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const dist2 = (a,b) => (a.x-b.x)**2+(a.y-b.y)**2;
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

export function trajectory(from, to, height, up, speed, targetRange) {
  const dx=to.x-from.x, dy=to.y-from.y;
  const h=Math.max(Math.hypot(dx,dy)/3,50)*(up?-1:1);
  const curve=new DistanceBasedBezierCurve(from,
    {x:from.x+dx/4,y:clamp(from.y+dy/4+h,0,height-1)},
    {x:from.x+dx*3/4,y:clamp(from.y+dy*3/4+h,0,height-1)},to,speed);
  return curve.getAllPoints().map(p => ({tile:p,
    targetable:dist2(p,from)<targetRange**2 || dist2(p,to)<targetRange**2}));
}

// Geometry is independent of silo ID and weapon name; speed, map height and
// targetability are part of the key. Reuse the exact same integer path in search.
function cachedPath(cache,s,silo,up,speed) {
  const key=[silo.x,silo.y,s.target.x,s.target.y,s.height,up,speed,s.rules.targetRange].join(':');
  let path=cache.get(key);
  if(!path) {path=trajectory(silo,s.target,s.height,up,speed,s.rules.targetRange);cache.set(key,path);}
  return path;
}

// Exact broad phase. Rebuild once at the SAM phase, then reuse the sorted
// neighbouring cells for SAMs in the same cell. Insertion order is significant
// for score ties and the original selector's interception cache.
function missileIndex(bombs,now,spawnFirst,cellSize) {
  const cells=new Map(), neighbourhoods=new Map();
  for(const b of bombs) {
    if(b.done||b.targeted||!(b.spawn<now||spawnFirst))continue;
    const tile=b.unit.tile(),x=Math.floor(tile.x/cellSize),y=Math.floor(tile.y/cellSize),key=x+':'+y;
    let cell=cells.get(key);if(!cell)cells.set(key,cell=[]);
    cell.push({b,tile});
  }
  return (tile,range,_types,predicate)=>{
    const x=Math.floor(tile.x/cellSize),y=Math.floor(tile.y/cellSize),span=Math.ceil(range/cellSize),key=x+':'+y+':'+span;
    let nearby=neighbourhoods.get(key);
    if(!nearby) {
      nearby=[];
      for(let dx=-span;dx<=span;dx++)for(let dy=-span;dy<=span;dy++) {
        const cell=cells.get((x+dx)+':'+(y+dy));if(cell)for(const item of cell)nearby.push(item);
      }
      nearby.sort((a,b)=>a.b.id-b.b.id);neighbourhoods.set(key,nearby);
    }
    const found=[],rangeSq=range*range;
    for(const item of nearby) {
      // Earlier SAMs in this very phase may already have assigned the missile.
      if(item.b.targeted)continue;
      const distance=dist2(item.tile,tile);
      if(distance<=rangeSq) {
        const candidate={unit:item.b.unit,distSquared:distance};
        if(predicate(candidate))found.push(candidate);
      }
    }
    return found;
  };
}

export function rangeAt(sam,tick,rules) {
  const range = level => rules.maxSamRange-480/(level+5);
  const u=sam.upgrade;
  if (!u) return range(sam.level);
  const elapsed=tick-u.startTick;
  return elapsed>=u.duration ? range(u.targetLevel) : u.startRange+(range(u.targetLevel)-u.startRange)*elapsed/u.duration;
}

export function validateSnapshot(s) {
  if (!s || !Number.isInteger(s.tick) || !s.target || !s.rules) throw Error('게임 상태가 불완전합니다');
  for (const k of ['tickMs','samCooldown','siloCooldown','atomSpeed','hydroSpeed','samSpeed','targetRange','maxSamRange'])
    if (!(s.rules[k]>0 && Number.isFinite(s.rules[k]))) throw Error('게임 규칙을 읽을 수 없습니다: '+k);
  if (!Array.isArray(s.silos)||!Array.isArray(s.sams)) throw Error('구조물 목록을 읽을 수 없습니다');
  for (const u of [...s.silos,...s.sams]) {
    if (!Number.isInteger(u.level)||u.level<1||!Number.isFinite(u.x)||!Number.isFinite(u.y)||!Array.isArray(u.queue)||u.queue.some(t=>!Number.isInteger(t)))
      throw Error('구조물 레벨 또는 재장전 정보를 읽을 수 없습니다');
    if(u.upgrade&&(!Number.isInteger(u.upgrade.startTick)||!Number.isFinite(u.upgrade.startRange)||
      !Number.isInteger(u.upgrade.targetLevel)||u.upgrade.targetLevel<1||!(u.upgrade.duration>0)))
      throw Error('SAM 업그레이드 진행 정보가 불완전합니다');
  }
  if (typeof s.gold!=='bigint'||typeof s.atomCost!=='bigint'||typeof s.hydroCost!=='bigint') throw Error('골드 또는 가격 정보를 읽을 수 없습니다');
}

// One intent every two ticks, <=50 atoms per intent. Sending more intents per
// second does not remove the per-silo launch queue. Keep explicit timeline data.
export function makePlan(atoms, hydroAfter=null, gap=0, up=true, initial=3) {
  const actions=[]; let left=atoms, sent=0, tick=initial, hydro=false;
  while (left>0 || (hydroAfter!==null&&!hydro)) {
    if (!hydro && hydroAfter!==null && sent>=hydroAfter) {
      tick+=gap;
      actions.push({tick,type:HYDRO,amount:1}); hydro=true; tick+=2;
    } else {
      const count=Math.min(50,left,hydroAfter!==null&&!hydro?hydroAfter-sent:left);
      if (count<=0) break;
      actions.push({tick,type:ATOM,amount:count}); sent+=count; left-=count; tick+=2;
    }
  }
  return {actions,atoms,hydros:hydroAfter===null?0:1,up,hydroAfter,gap};
}

function actor(id) { return {smallID:()=>id,isFriendly:()=>false,isOnSameTeam:()=>false}; }
function bombUnit(b) {
  return {id:()=>b.id,tile:()=>b.path[Math.min(b.index,b.path.length-1)].tile,
    type:()=>b.type,owner:()=>b.owner,targetedBySAM:()=>b.targeted,
    targetTile:()=>b.target,trajectory:()=>b.path,trajectoryIndex:()=>b.index,
    nukeState:()=>({waitTicks:Math.max(0,b.moveAt-b.now-(b.afterMove?1:0))})};
}

// An assigned interceptor counts as a kill immediately. We deliberately keep
// defending SAMs alive after atom impacts: reported hits do not rely on blast
// randomness, third-party damage, or favorable destruction of the launcher.
export function simulate(s,plan,opt={}) {
  validateSnapshot(s);
  const r=s.rules, start=s.tick, deadline=opt.deadline??Infinity;
  const silos=s.silos.filter(u=>!u.building).map(u=>({...u,queue:[...u.queue]}));
  silos.sort((a,b)=>manhattan(a,s.target)-manhattan(b,s.target)); // stable game order
  const sams=s.sams.map(u=>({...u,queue:[...u.queue],interceptions:0}));
  if (opt.reverse) sams.reverse();
  const me=actor(s.me), defenders=actor(-1), bombs=[], cache=opt.pathCache??new Map();
  const traces=[], launches=[], used=new Set(), participating=new Set(), byUnit=new Map();
  let now=start, gold=s.gold, atomHits=s.confirmedAtomHits??0, hydroHits=s.confirmedHydroHits??0,
    committedHydroHits=0,dropped=0,tubeShortage=0,goldShortage=0,lastArrival=0,nextId=1;
  const config={defaultSamMissileSpeed:()=>r.samSpeed,maxSamRange:()=>r.maxSamRange,
    dynamicSamRange:(sam,t)=>rangeAt(sam.data,t,r),gameConfig:()=>({gameType:'Singleplayer'})};
  const game={config:()=>config,getWinner:()=>null,manhattanDist:manhattan,euclideanDistSquared:dist2,
    nearbyUnits:null};
  for (const sam of sams) {
    sam.unit={data:sam,id:()=>sam.id,tile:()=>sam,level:()=>sam.level,owner:()=>defenders};
    sam.selector=new SAMTargetingSystem(game,sam.unit);
  }
  // Only confirmed missiles belonging to this operation may be credited in
  // adaptive mode. They are already paid for and must NOT consume a silo again.
  for (const b of s.inflight??[]) {
    if(opt.conservative&&!(s.includeCommitted&&b.committed&&b.owner===s.me))continue;
    if (b.targeted || !b.path?.length) continue;
    const shift=opt.flightShift??0;
    const waiting=Math.max(0,(b.waitTicks||0)-shift);
    const index=clamp(b.index+Math.max(0,shift-(b.waitTicks||0)),0,b.path.length-1);
    const item={...b,id:nextId++,owner:me,index,ours:!!b.committed,committed:!!b.committed,
      spawn:start-1,now:start,moveAt:start+waiting,done:false};
    item.unit=bombUnit(item); bombs.push(item);byUnit.set(item.unit,item);
  }
  const phase=opt.delay??0;
  const actions=plan.actions.map((a,i)=>({...a,at:start+a.tick+2+phase+(a.type===HYDRO?(opt.hydroDelay??0):0),order:i})).sort((a,b)=>a.at-b.at||a.order-b.order);
  let ai=0;
  const end=start+(opt.maxTicks??1200);
  for (now=start;now<=end;now++) {
    if ((now-start)%8===0 && performance.now()>deadline) throw Error('SEARCH_TIMEOUT');
    // Silo reloads one slot per tick. SAM reloads every expired slot in a tick.
    for (const silo of silos) if(silo.queue.length&&now-silo.queue[0]>=r.siloCooldown) {silo.queue.shift();silo.lastDep=undefined;}
    while (ai<actions.length&&actions[ai].at<=now) {
      const a=actions[ai++];
      for(let n=0;n<a.amount;n++) {
        const silo=silos.find(u=>u.queue.length<u.level);
        const cost=a.type===HYDRO?s.hydroCost:s.atomCost;
        if (!silo||gold<cost) { dropped++;if(!silo)tubeShortage++;if(gold<cost)goldShortage++;continue; }
        gold-=cost; used.add(silo.id);
        if(silo.lastDep===undefined) {
          silo.lastDep=0;
          for(const launchTick of silo.queue)silo.lastDep=Math.max(launchTick+1,silo.lastDep+1);
        }
        const lastDep=silo.lastDep;
        const moveAt=now+Math.max(0,lastDep-now)+1;
        silo.queue.push(now);silo.lastDep=Math.max(now+1,lastDep+1);
        const path=cachedPath(cache,s,silo,plan.up,a.type===HYDRO?r.hydroSpeed:r.atomSpeed);
        const b={id:nextId++,type:a.type,owner:me,path,index:0,spawn:now,now,moveAt,target:s.target,targeted:false,done:false,ours:true,silo:silo.id};
        b.unit=bombUnit(b); bombs.push(b);byUnit.set(b.unit,b);
        launches.push({action:a.order,silo:silo.id,type:a.type,spawn:now-start,depart:moveAt-start});
      }
    }
    for(const b of bombs) {b.now=now;b.afterMove=false;}
    const move=()=>{
      for(const b of bombs) if(!b.done&&now>=b.moveAt) {
        b.index++;
        if(b.index>=b.path.length-1) {
          b.index=b.path.length-1; b.done=true;
          if(b.ours&&!b.targeted) {
            if(b.type===HYDRO) {hydroHits++;if(b.committed)committedHydroHits++;} else atomHits++;
            lastArrival=now-start;
          }
        }
      }
      for(const b of bombs)b.afterMove=true;
    };
    if(opt.moveFirst) move();
    game.nearbyUnits=missileIndex(bombs,now,opt.spawnFirst,r.maxSamRange*4);
    for(const sam of sams) {
      while(sam.queue.length&&now-sam.queue[0]>=r.samCooldown) sam.queue.shift();
      // Treat construction as completed for conservative planning. This avoids
      // promising a hit through a SAM that finishes during the flight.
      if(sam.queue.length>=sam.level) continue;
      for(const target of sam.selector.getValidTargets(now)) {
        if(sam.queue.length>=sam.level) break;
        const b=byUnit.get(target.unit);
        if(!b||b.done||b.targeted) continue;
        b.targeted=true; sam.queue.push(now); sam.interceptions++; participating.add(sam.id);
        if(b.ours&&traces.length<100) traces.push({sam:sam.id,type:b.type,tick:now-start,silo:b.silo});
      }
    }
    if(!opt.moveFirst) move();
    if(ai===actions.length&&bombs.every(b=>b.done||b.targeted)) break;
  }
  const unfinished=bombs.some(b=>b.ours&&!b.done&&!b.targeted);
  return {atomHits,hydroHits,committedHydroHits,dropped,tubeShortage,goldShortage,unfinished,cost:s.gold-gold,lastArrival,launches,traces,
    usedSilos:[...used],participating:[...participating],
    interceptions:sams.map(u=>({id:u.id,count:u.interceptions})),ticks:now-start};
}

function affordable(s,plan) { return BigInt(plan.atoms)*s.atomCost+BigInt(plan.hydros)*s.hydroCost<=s.gold; }
function succeeds(result,plan,minHits) { return !result.dropped&&!result.unfinished&&
  ((plan.goal??(plan.hydros?'hydro':'atomic'))==='hydro'?result.hydroHits>=1:result.atomHits>=minHits); }

export function assess(s,plan,options={}) {
  const cache=options.pathCache??new Map();
  const base={deadline:options.deadline,maxTicks:options.maxTicks,pathCache:cache,conservative:true};
  const cases=[{}, {reverse:true,moveFirst:true,spawnFirst:true,flightShift:1}, {hydroDelay:-2,delay:2,flightShift:-1}, {reverse:true,hydroDelay:2,delay:2}];
  let worst=null;
  for(const variant of cases) {
    const result=simulate(s,plan,{...base,...variant});
    if(!worst||result.hydroHits<worst.hydroHits||result.atomHits<worst.atomHits) worst=result;
    if(!succeeds(result,plan,options.minAtomHits??1)) return {ok:false,result};
  }
  return {ok:true,result:worst};
}

// A resumable candidate traversal. The worker retains this generator and its
// geometry cache between slices; the synchronous API keeps identical ordering.
export function search(s, options={}) {
  const steps=searchSteps(s,options);
  let step; do {step=steps.next();} while(!step.done);
  return step.value;
}

export function* searchSteps(s, options={}) {
  validateSnapshot(s);
  const began=performance.now(),deadline=began+(options.budgetMs??1800),pathCache=new Map();
  const minHits=Math.max(1,options.minAtomHits??1);
  const cap=Math.min(5000,Math.max(0,options.maxAtoms??2000));
  const initial=options.initialTicks??3;
  const committedHydro=s.includeCommitted&&(s.inflight??[]).some(b=>b.committed&&b.owner===s.me&&!b.targeted&&b.type===HYDRO);
  const ready=s.silos.reduce((n,u)=>n+(u.building?0:Math.max(0,u.level-u.queue.length)),0);
  // Estimate capacity only along possible trajectories. Keep all SAMs in the
  // actual simulation; this filter is solely a search-order optimization.
  const paths=s.silos.filter(u=>!u.building).flatMap(u=>[true,false].map(up=>cachedPath(pathCache,s,u,up,s.rules.atomSpeed)));
  const relevant=s.sams.filter(u=>paths.some(path=>path.some(p=>p.targetable&&dist2(p.tile,u)<=s.rules.maxSamRange**2)));
  const slots=relevant.reduce((n,u)=>n+u.level,0);
  const result={mixed:null,atomic:null,chosen:null,tested:0,limited:false,reason:'',
    snapshotTick:s.tick,minAtomHits:minHits,maxAtoms:cap,ready,slots,
    silos:s.silos.map(u=>({id:u.id,x:u.x,y:u.y,level:u.level,ready:u.level-u.queue.length})),
    sams:s.sams.map(u=>({id:u.id,x:u.x,y:u.y,level:u.level,ready:u.level-u.queue.length})),
    existingFlights:s.observedFlights??(s.inflight??[]).length};
  if(!s.includeCommitted&&!s.silos.some(u=>!u.building)) {result.reason='완성된 사일로가 없습니다'; return result;}
  if(!s.includeCommitted&&s.intentBudget===0) {result.reason='남은 명령 한도가 없습니다. 회복 후 다시 분석하세요';return result;}
  if(!s.includeCommitted&&s.gold<s.atomCost&&s.gold<s.hydroCost) {result.reason='원자·수소 1발을 구매할 골드가 부족합니다';return result;}
  const counts=[0,minHits,...[1,1.25,1.5,2,.8,.5,3].map(x=>Math.ceil(slots*x)+minHits),
    ready-1,ready,4,8,16,32,50,100,200,400,800,cap]
    .filter(n=>Number.isInteger(n)&&n>=0&&n<=cap).filter((n,i,a)=>a.indexOf(n)===i);
  const run=plan=>{
    if(!affordable(s,plan)||plan.actions.length>(s.intentBudget??140)) return null;
    result.tested++;
    const a=assess(s,plan,{deadline,pathCache,minAtomHits:minHits,maxTicks:options.maxTicks??1200});
    if(!a.ok) {
      const failure={atoms:plan.atoms,hydros:plan.hydros,up:plan.up,dropped:a.result.dropped,
        tubeShortage:a.result.tubeShortage,goldShortage:a.result.goldShortage,
        blockedBy:a.result.traces.filter(t=>t.type===HYDRO),usedSilos:a.result.usedSilos,
        launchSpan:a.result.launches.length?Math.max(...a.result.launches.map(l=>l.depart))-Math.min(...a.result.launches.map(l=>l.depart)):0,
        interceptions:a.result.interceptions};
      if(!result.failure||failure.dropped<result.failure.dropped||
        (failure.dropped===result.failure.dropped&&failure.atoms>result.failure.atoms)) result.failure=failure;
    }
    return a.ok?{...plan,...a.result}:null;
  };
  try {
    // Interleave modes so an expensive mixed search cannot starve atomic analysis.
    outer: for(const [fraction,gap] of [[1,0],[.75,0],[.5,0],[1,8],[.75,8],[1,30],[1,60],[.5,30]]) {
     for(const atoms of counts) {
      for(const up of [s.preferredUp!==false,s.preferredUp===false]) {
        if(fraction===1&&gap===0&&!result.atomic&&(atoms>=minHits||s.includeCommitted)&&((atoms===0&&s.includeCommitted)||s.allowed?.atomic!==false)) {
          const p=run({...makePlan(atoms,null,0,up,initial),goal:'atomic'}); if(p) result.atomic=p;
          yield {tested:result.tested,mixed:!!result.mixed,atomic:!!result.atomic};
        }
        if(!result.mixed&&options.allowHydroGoal!==false&&(committedHydro||s.allowed?.mixed!==false)&&(atoms===0||s.allowed?.atomic!==false)) {
          if(atoms===0&&(fraction!==1||gap!==0))continue;
          if(committedHydro&&fraction===1&&gap===0) {
            const rescue=run({...makePlan(atoms,null,0,up,initial),goal:'hydro'});
            if(rescue)result.mixed=rescue;
            yield {tested:result.tested,mixed:!!result.mixed,atomic:!!result.atomic};
          }
          if(!result.mixed&&options.allowNewHydro!==false&&s.allowed?.mixed!==false) {
            const p=run({...makePlan(atoms,Math.floor(atoms*fraction),gap,up,initial),goal:'hydro'});
            if(p) result.mixed=p;
            yield {tested:result.tested,mixed:!!result.mixed,atomic:!!result.atomic};
          }
        }
        if(result.mixed&&result.atomic) break outer;
      }
      if(performance.now()>deadline) throw Error('SEARCH_TIMEOUT');
     }
    }
  } catch(e) { if(e.message==='SEARCH_TIMEOUT') result.limited=true; else throw e; }
  result.chosen=result.mixed??result.atomic;
  result.mode=result.mixed?'mixed':result.atomic?'atomic':result.limited?'unknown':'blocked';
  result.diagnostics=[];
  if(!result.chosen&&result.failure) {
    const f=result.failure;
    if(f.tubeShortage)result.diagnostics.push(`시험 공격 ${f.atoms+f.hydros}발 중 ${f.tubeShortage}발이 발사관 부족으로 발사되지 못함`);
    const reloaded=f.interceptions.filter(v=>v.count>(s.sams.find(u=>u.id===v.id)?.level??Infinity));
    if(reloaded.length)result.diagnostics.push(`SAM ${reloaded.length}기가 재장전 후 반복 요격 · 발사 분산 ${(f.launchSpan*s.rules.tickMs/1000).toFixed(1)}초, 사일로 수·배치 검토`);
    for(const b of f.blockedBy.slice(0,1)) {
      const sam=s.sams.find(u=>u.id===b.sam),silo=s.silos.find(u=>u.id===b.silo);
      if(sam&&silo&&dist2(sam,s.target)>s.rules.maxSamRange**2)
        result.diagnostics.push(`목표 주변 밖 SAM (${sam.x}, ${sam.y}) Lv${sam.level}이 사일로 (${silo.x}, ${silo.y})의 수소를 경로에서 요격`);
    }
  }
  if(!result.chosen) {
    if(result.limited) result.reason='계산 시간 내 검증된 계획을 찾지 못했습니다. I로 더 길게 재분석합니다';
    else if(!ready) result.reason='현재 발사관이 재장전 중입니다. 준비 후 다시 분석합니다';
    else if(s.allowed?.mixed===false&&s.allowed?.atomic===false) result.reason='게임 규칙상 이 위치에는 발사할 수 없습니다';
    else if(result.failure?.tubeShortage) result.reason=`시험한 공격에서 발사관 ${result.failure.tubeShortage}발분 부족 — 사일로 레벨·재장전 확인`;
    else if(result.failure?.blockedBy?.length) {
      const b=result.failure.blockedBy[0],sam=s.sams.find(u=>u.id===b.sam);
      result.reason=`시험한 수소 공격은 SAM (${sam.x}, ${sam.y}) Lv${sam.level}이 ${b.tick}틱에 요격 — 발사 배치·간격 개선 필요`;
    } else result.reason='탐색 범위에서 돌파 계획 없음 — 사일로 발사 간격·배치와 SAM 재장전이 병목일 수 있습니다';
  }
  result.elapsedMs=Math.round(performance.now()-began);
  return result;
}

// Before any launch, the model is invariant under a common translation of time.
// Compare relative timers, not wall-clock age. This is deliberately exact: a
// shorter SAM cooldown or progressing range upgrade is NOT assumed harmless.
// This key is only for prelaunch snapshots, never for committed flying missiles.
export function preflightKey(s) {
  const unit=u=>[u.id,u.x,u.y,u.level,u.building,u.owner,u.queue.map(t=>t-s.tick),
    u.upgrade?[u.upgrade.startRange,u.upgrade.targetLevel,u.upgrade.duration,
      Math.min(u.upgrade.duration,s.tick-u.upgrade.startTick)]:null];
  return JSON.stringify([s.game,s.me,s.tile,s.target,s.height,s.width,s.rules,s.allowed,
    s.atomCost.toString(),s.hydroCost.toString(),s.silos.map(unit),s.sams.map(unit)]);
}
