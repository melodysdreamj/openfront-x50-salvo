  // Predictive I/HUD integration. The old manual H/J/Z/etc. remain available.
  const plannerSettings = {maxAtoms:2000,minAtomHits:1,budgetMs:1800,maxTicks:1200,details:false};
  const plannerState = {worker:null,job:0,pending:null,tile:null,game:null,result:null,
    snapshot:null,error:'',updated:0,stableAt:0,run:null,timer:null,lastExecution:''};

  function plannerSnapshot(tile) {
    const g=getGameView(), me=g?.myPlayer();
    if(!g||!me||tile===null||tile===undefined) throw Error('게임에서 목표 위치에 커서를 올리세요');
    const cfg=g.config(), tick=g.ticks();
    if(typeof cfg.isReplay==='function'&&cfg.isReplay()) throw Error('리플레이에서는 공격을 실행하지 않습니다');
    if(g.inSpawnPhase()||g.isSpawnImmunityActive()) throw Error('시작 보호 시간이 끝난 후 분석합니다');
    if(g.isImpassable(tile)) throw Error('이 지형에는 핵무기를 발사할 수 없습니다');
    if(!me.isAlive()) throw Error('관전 중에는 발사할 수 없습니다');
    const target={x:g.x(tile),y:g.y(tile)}, game=g.gameID();
    const read=(obj,name)=>{if(typeof obj[name]!=='function')throw Error('현재 게임에서 '+name+' 정보를 제공하지 않습니다');return obj[name]();};
    const rules={tickMs:read(cfg,'msPerTick'),samCooldown:read(cfg,'SAMCooldown'),siloCooldown:read(cfg,'SiloCooldown'),
      atomSpeed:cfg.nukeSpeed(ATOM),hydroSpeed:cfg.nukeSpeed(HYDRO),samSpeed:read(cfg,'defaultSamMissileSpeed'),
      targetRange:read(cfg,'defaultNukeTargetableRange'),maxSamRange:read(cfg,'maxSamRange')};
    if(rules.tickMs!==100||![rules.atomSpeed,rules.hydroSpeed,rules.samSpeed].every(v=>Number.isInteger(v)&&v>0))
      throw Error('틱·미사일 속도 규칙이 변경되어 계산기 업데이트가 필요합니다');
    // Fail visibly when the pinned curve/targeting model's range law changes.
    if([1,5,20].some(l=>Math.abs(cfg.samRange(l)-(rules.maxSamRange-480/(l+5)))>1e-7))
      throw Error('SAM 사거리 규칙이 변경되어 계산기 업데이트가 필요합니다');
    const structural=u=>({id:u.id(),x:g.x(u.tile()),y:g.y(u.tile()),level:u.level(),
      queue:[...read(u,'missileTimerQueue')],building:u.isUnderConstruction(),owner:u.owner().smallID()});
    const silos=g.units('Missile Silo').filter(u=>u.isActive()&&isOwnedByMe(u,me)).map(structural);
    const sams=[];
    for(const u of g.units('SAM Launcher')) {
      if(!u.isActive()||isOwnedByMe(u,me)||me.isOnSameTeam(u.owner())) continue;
      const sam=structural(u), state=u.state;
      // Include allies as potential defenders; nuclear blasts can break alliances.
      // SAMs anywhere on the map are considered, not only the target's 150 tiles.
      if(typeof u.samLauncherState==='function') {
        const z=u.samLauncherState();
        sam.upgrade=z?.upgradeStartTick===undefined?null:{startTick:z.upgradeStartTick,startRange:z.startRange,targetLevel:z.targetLevel,duration:z.duration??cfg.samUpgradeDuration()};
      } else if(state&&'samUpgradeStartTick' in state) {
        sam.upgrade=state.samUpgradeStartTick===null?null:{startTick:state.samUpgradeStartTick,startRange:state.samUpgradeStartRange,
          targetLevel:state.samUpgradeTargetLevel,duration:state.samUpgradeDuration??cfg.samUpgradeDuration()};
      } else throw Error('SAM 업그레이드 상태를 읽을 수 없습니다. 현재 클라이언트는 지원되지 않습니다');
      sams.push(sam);
    }
    const price=type=>{
      const value=cfg.unitInfo(type).cost(g,me);
      if(typeof value!=='bigint'&&!(typeof value==='number'&&Number.isSafeInteger(value))) throw Error('무기 가격을 읽을 수 없습니다');
      return BigInt(value);
    };
    const structures=['City','Factory','Port','Missile Silo','SAM Launcher','Defense Post'];
    const teamStructures=structures.flatMap(type=>g.units(type)).filter(u=>u.isActive()&&me.isOnSameTeam(u.owner()));
    const owner=g.owner(tile), ownTeam=owner?.isPlayer?.()&&me.isOnSameTeam(owner);
    const allowedFor=type=>!cfg.isUnitDisabled(type)&&!ownTeam&&!teamStructures.some(u=>dist2(target,{x:g.x(u.tile()),y:g.y(u.tile())})<=cfg.nukeMagnitudes(type).outer**2);
    const allowed={atomic:allowedFor(ATOM),mixed:allowedFor(HYDRO)};
    const inflight=[];
    for(const type of [ATOM,HYDRO,'MIRV Warhead']) for(const u of g.units(type)) {
      if(!u.isActive()) continue;
      // Flight state is recorded for diagnostics. Validation does not depend on
      // these missiles draining enemy SAM slots; only observed cooldowns count.
      let ns; try{ns=u.nukeState();}catch{continue;}
      const p=ns.trajectory??[];
      inflight.push({id:u.id(),type,owner:u.owner().smallID(),targeted:!!ns.targetedBySam,
        index:ns.trajectoryIndex??0,waitTicks:ns.waitTicks??0,target:target,
        path:p.map(v=>({tile:{x:g.x(v.tile),y:g.y(v.tile)},targetable:v.targetable}))});
    }
    const s={tick,game,tile,target,width:g.width(),height:g.height(),me:me.smallID(),rules,silos,sams,inflight,
      gold:BigInt(me.gold()),atomCost:price(ATOM),hydroCost:price(HYDRO),allowed,preferredUp:getRocketDirectionUp(),
      intentBudget:Math.max(0,RL.perMinute-10-RL.minWindow.filter(t=>Date.now()-t<60000).length)};
    validateSnapshot(s); return s;
  }

  function plannerFingerprint(s) {
    return JSON.stringify([s.game,s.me,s.target,s.rules,s.atomCost.toString(),s.hydroCost.toString(),s.allowed,
      s.silos.map(u=>[u.id,u.x,u.y,u.level,u.building]),s.sams.map(u=>[u.id,u.x,u.y,u.level,u.building,u.upgrade])]);
  }
  function plannerStop(reason='사용자가 남은 발사를 중단했습니다') {
    if(plannerState.timer!==null) clearTimeout(plannerState.timer);
    const run=plannerState.run;
    plannerState.run=null;plannerState.timer=null;
    plannerState.lastExecution=reason;
    if(run) toast(reason+' · 이미 발사한 미사일은 유지됩니다','#ffd166');
  }
  function plannerCancelJob() {
    plannerState.worker?.terminate();plannerState.worker=null;
    if(plannerState.pending) clearTimeout(plannerState.pending.timeout);
    plannerState.pending=null; plannerState.job++;
  }
  function plannerCompute(snapshot,execute=false) {
    plannerCancelJob();
    const id=plannerState.job;
    plannerState.error='';plannerState.result=null;plannerState.snapshot=snapshot;
    plannerState.tile=snapshot.tile;plannerState.game=snapshot.game;
    const blob=new Blob([PLANNER_WORKER_SOURCE],{type:'text/javascript'}), url=URL.createObjectURL(blob);
    let worker;
    try {worker=new Worker(url);}catch(e){URL.revokeObjectURL(url);plannerState.error='계산 작업을 시작할 수 없습니다: '+e.message;return;}
    URL.revokeObjectURL(url);plannerState.worker=worker;
    const budgetMs=execute?Math.max(4000,plannerSettings.budgetMs):plannerSettings.budgetMs;
    const fail=message=>{if(id!==plannerState.job)return;plannerCancelJob();plannerState.error=message;plannerState.updated=Date.now();};
    plannerState.pending={id,execute,timeout:setTimeout(()=>fail('계산 시간이 초과되었습니다. I로 다시 분석하세요'),budgetMs+2000)};
    worker.onerror=e=>fail('계산 오류: '+e.message);
    worker.onmessage=event=>{
      if(id!==plannerState.job)return;
      const {result,error}=event.data;
      clearTimeout(plannerState.pending.timeout);plannerState.pending=null;
      worker.terminate();plannerState.worker=null;
      if(error){plannerState.error='판정 불가: '+error;plannerState.updated=Date.now();return;}
      if(getGameView()?.gameID()!==snapshot.game || (!execute&&computeCursorTile()!==snapshot.tile)) return;
      plannerState.result=result;plannerState.updated=Date.now();
      if(execute) {
        if(!result.chosen) {toast(result.reason,'#ffd166');return;}
        plannerExecute(snapshot,result);
      }
    };
    worker.postMessage({id,snapshot,options:{...plannerSettings,budgetMs}});
  }

  // A plan is revalidated from a fresh snapshot immediately before the first
  // intent. It then follows game ticks, never delayed wall-clock catch-up bursts.
  function plannerExecute(snapshot,result) {
    let fresh;
    try { fresh=plannerSnapshot(snapshot.tile); }catch(e){plannerState.error=e.message;return;}
    if(plannerFingerprint(fresh)!==plannerFingerprint(snapshot)) {
      plannerState.error='계산 중 구조물·규칙이 바뀌었습니다. I로 다시 분석하세요';return;
    }
    // Exact simulation is expensive; run this last validation off the UI thread.
    const blob=new Blob([PLANNER_WORKER_SOURCE.replace(/self\.onmessage = e =>[\s\S]*$/,
      'self.onmessage = e => {try { self.postMessage(assess(e.data.snapshot,e.data.plan,{minAtomHits:e.data.minHits,deadline:performance.now()+2500})); } catch(e){self.postMessage({ok:false,error:e.message});}};')],{type:'text/javascript'});
    const url=URL.createObjectURL(blob);let worker;
    try{worker=new Worker(url);}catch(e){URL.revokeObjectURL(url);plannerState.error='발사 검증을 시작할 수 없습니다: '+e.message;return;}
    URL.revokeObjectURL(url);
    const id=++plannerState.job;plannerState.worker=worker;
    const timeout=setTimeout(()=>{if(id===plannerState.job){plannerCancelJob();plannerState.error='발사 직전 검증 시간 초과 — 발사하지 않았습니다';}},3500);
    plannerState.pending={id,execute:true,timeout};
    worker.onerror=e=>{if(id===plannerState.job){plannerCancelJob();plannerState.error='발사 검증 오류: '+e.message;}};
    worker.onmessage=e=>{
      if(id!==plannerState.job)return;
      clearTimeout(timeout);worker.terminate();plannerState.worker=null;plannerState.pending=null;
      if(!e.data.ok){plannerState.error='현재 상태에서 계획이 유효하지 않습니다. I로 다시 분석하세요';return;}
      let current;try{current=plannerSnapshot(snapshot.tile);}catch(err){plannerState.error=err.message;return;}
      if(current.tick-fresh.tick>2||plannerFingerprint(current)!==plannerFingerprint(fresh)||
        JSON.stringify(current.silos.map(s=>s.queue))!==JSON.stringify(fresh.silos.map(s=>s.queue))||
        JSON.stringify(current.sams.map(s=>s.queue))!==JSON.stringify(fresh.sams.map(s=>s.queue))) {
        plannerState.error='발사 직전 상태가 변했습니다. I로 다시 분석하세요';return;
      }
      const plan=result.chosen;
      if(current.gold<plan.cost||rateGate()>0){plannerState.error='골드 또는 명령 한도가 부족합니다. 회복 후 I로 다시 분석하세요';return;}
      const bus=getEventBus(),ctor=findNukeEventCtor();
      if(!bus||!ctor){plannerState.error='게임 발사 이벤트를 찾지 못했습니다';return;}
      const ids=new Set(getGameView().units(ATOM,HYDRO).map(u=>u.id()));
      plannerState.run={plan,tile:snapshot.tile,game:snapshot.game,me:snapshot.me,fingerprint:plannerFingerprint(current),
        baseTick:current.tick,index:0,sent:0,sentAtoms:0,sentHydros:0,confirmed:0,ids,observed:new Set(),lastSendTick:0,
        startedAt:Date.now(),lastTick:current.tick,lastTickAt:Date.now(),bus,ctor};
      plannerState.lastExecution='';
      plannerPump();
    };
    worker.postMessage({snapshot:fresh,plan:result.chosen,minHits:plannerSettings.minAtomHits});
  }

  function plannerPump() {
    plannerState.timer=null;
    const run=plannerState.run;if(!run)return;
    try {
      if(document.hidden) return plannerStop('탭이 숨겨져 남은 발사를 중단했습니다');
      const current=plannerSnapshot(run.tile),tick=current.tick;
      if(current.game!==run.game||current.me!==run.me||plannerFingerprint(current)!==run.fingerprint)
        return plannerStop('구조물·소유권·발사 조건이 바뀌어 남은 발사를 중단했습니다');
      if(tick!==run.lastTick){run.lastTick=tick;run.lastTickAt=Date.now();}
      if(Date.now()-run.lastTickAt>2000)return plannerStop('게임 진행이 멈춰 남은 발사를 중단했습니다');
      for(const u of getGameView().units(ATOM,HYDRO)) {
        if(run.ids.has(u.id())||run.observed.has(u.id())||u.owner().smallID()!==run.me)continue;
        run.observed.add(u.id());
        if(u.targetTile()!==run.tile)return plannerStop('다른 위치의 발사를 감지해 계획을 중단했습니다');
        run.confirmed++;
      }
      if(run.confirmed>run.sent)return plannerStop('계획 외 발사를 감지해 남은 발사를 중단했습니다');
      if(run.sent>run.confirmed&&tick-run.lastSendTick>12)return plannerStop('발사 요청의 게임 반영을 확인하지 못해 중단했습니다');
      const action=run.plan.actions[run.index];
      if(!action) {
        if(run.confirmed===run.sent) {
          plannerState.lastExecution=`발사 반영 확인: 원자 ${run.sentAtoms}발 · 수소 ${run.sentHydros}발 (명중 확인 아님)`;
          plannerState.run=null;plannerState.updated=0;return;
        }
      } else {
        const due=run.baseTick+action.tick;
        if(tick>due)return plannerStop('예정 시각을 놓쳐 남은 발사를 중단했습니다');
        if(tick>=due) {
          if(rateGate()>0)return plannerStop('명령 한도에 도달해 남은 발사를 중단했습니다');
          const cost=(action.type===HYDRO?current.hydroCost:current.atomCost)*BigInt(action.amount);
          const ready=current.silos.reduce((sum,s)=>sum+(s.building?0:Math.max(0,s.level-s.queue.length)),0);
          // Reserve sent but not yet acknowledged requests to prevent overbooking.
          if(current.gold<cost||ready-(run.sent-run.confirmed)<action.amount)return plannerStop('골드·준비된 발사관이 계획보다 부족해 중단했습니다');
          run.bus.emit(new run.ctor(action.type,run.tile,run.plan.up,action.amount));rateUse();
          run.sent+=action.amount;run.index++;run.lastSendTick=tick;
          if(action.type===HYDRO)run.sentHydros+=action.amount;else run.sentAtoms+=action.amount;
        }
      }
    }catch(e){return plannerStop('상태 확인 실패로 중단: '+e.message);}
    plannerState.timer=setTimeout(plannerPump,40);
  }

  function startStrike() {
    if(plannerState.run){toast('계획 실행 중입니다. Esc로 남은 발사를 중단할 수 있습니다','#ffd166');return;}
    if(plannerState.pending?.execute){toast('선택한 위치의 발사 계획을 검증 중입니다. Esc로 취소할 수 있습니다','#ffd166');return;}
    if(salvoQueue.length||salvoTimer!==null||salvoFollow!==null||armed){toast('기존 작업을 Esc로 끝낸 뒤 I를 누르세요','#ffd166');return;}
    try{plannerCompute(plannerSnapshot(computeCursorTile()),true);}catch(e){plannerState.error=e.message;toast(e.message,'#ffd166');}
  }
  function plannerKeyGuard(e) {
    if(e.code==='F8'&&!e.repeat){plannerSettings.details=!plannerSettings.details;e.preventDefault();return true;}
    const executing=plannerState.run||plannerState.pending?.execute;
    if(e.code==='Escape'&&(executing||plannerState.pending)) {
      plannerCancelJob();plannerStop('남은 계획을 취소했습니다');e.preventDefault();e.stopPropagation();return true;
    }
    if(executing&&[CFG.hotkey,CFG.hotkeyMax,CFG.hotkeyHydro,CFG.hotkeyMirv,CFG.hotkeySalvo,CFG.hotkeyStrike,CFG.hotkeyUpgrade,CFG.hotkeyUpgradeBig,CFG.hotkeyWarship].includes(e.code)) {
      e.preventDefault();e.stopPropagation();if(!e.repeat)toast('계획 실행 중 · Esc로 중단','#ffd166');return true;
    }
    return false;
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden){plannerCancelJob();plannerStop('탭을 전환해 계획을 중단했습니다');}});
  window.addEventListener('pagehide',()=>{plannerCancelJob();plannerStop('게임 화면을 떠나 계획을 중단했습니다');});

  function plannerPlanText(label,p,minHits) {
    if(!p)return label+': 검증된 계획 없음';
    return `${label}: 원자 ${p.atoms} + 수소 ${p.hydros} → 수소 ${p.hydroHits} / 원자 ${p.atomHits}발 예상\n`+
      `  ${p.up?'위쪽':'아래쪽'} 궤적 · 비용 ${p.cost.toLocaleString()} · 약 ${(p.lastArrival/10).toFixed(1)}초`;
  }
  function hudTargetLine() {
    const p=plannerState,now=Date.now(),tile=computeCursorTile(),g=getGameView();
    if(p.run)return `공격 실행 중 · Esc: 남은 발사 중단\n원자 ${p.run.sentAtoms}/${p.run.plan.atoms} · 수소 ${p.run.sentHydros}/${p.run.plan.hydros}\n게임 반영 ${p.run.confirmed}/${p.run.sent}발\n목표 고정: (${p.snapshot.target.x}, ${p.snapshot.target.y})`;
    if(!g?.myPlayer())return '공격 분석 · 게임에서 목표에 커서를 올리세요';
    if(!p.pending?.execute&&(tile!==p.tile||g.gameID()!==p.game)) {
      plannerCancelJob();p.tile=tile;p.game=g.gameID();p.result=null;p.error='';p.stableAt=now;p.updated=0;
    }
    if(!p.pending && !document.hidden && now-p.stableAt>350 && now-p.updated>2500) {
      try{plannerCompute(plannerSnapshot(tile));}catch(e){p.error=e.message;p.updated=now;}
    }
    if(p.pending)return `${p.pending.execute?'발사 전 검증':'공격 분석'} 중…\n${p.pending.execute?'선택한 목표 고정 · Esc로 취소':'커서를 잠시 멈추면 두 공격 방식을 비교합니다'}`;
    if(p.error)return '판정 불가 · '+p.error;
    const r=p.result;
    if(!r)return '공격 분석 · 목표에 커서를 잠시 멈추세요';
    const title=r.chosen?(r.mode==='mixed'?'수소 혼합 추천':'원자 집중 추천'):(r.limited?'계산 미완료':'현재 탐색 범위에서 돌파 어려움');
    const used=r.chosen?.usedSilos.length??0;
    const lines=[title+' · 현재 상태 기준 예측',
      `목표: 수소 1발 / 원자 ${r.minAtomHits}발 · 원자 최대 ${r.maxAtoms.toLocaleString()}발 탐색`,
      `사일로 ${r.silos.length}기 · 준비 ${r.ready}관 · 계획 사용 ${used}기`,
      `SAM ${r.sams.length}기 검토 · 요격 참여 ${r.chosen?.participating.length??'—'}기`,
      plannerPlanText('수소 혼합',r.mixed,r.minAtomHits),plannerPlanText('원자 집중',r.atomic,r.minAtomHits)];
    if(r.reason)lines.push(r.reason);
    if(r.diagnostics?.length)lines.push(...r.diagnostics);
    if(r.chosen)lines.push('I: 재검증 후 추천 공격 · Esc: 취소');
    if(r.limited&&r.chosen)lines.push('시간 제한 내 찾은 계획 · 최적해 보장 없음');
    lines.push(`비행 중 ${r.existingFlights}발 관측 · 타 미사일의 방어 소모·SAM 파괴 효과 제외`);
    if(plannerSettings.details) {
      const usedIds=new Set(r.chosen?.usedSilos??[]),samIds=new Set(r.chosen?.participating??[]);
      lines.push('사일로 배치 (＊계획 사용)');
      for(const u of r.silos)lines.push(`${usedIds.has(u.id)?'＊':'·'} (${u.x}, ${u.y}) Lv${u.level} · 준비 ${u.ready}`);
      lines.push('SAM 배치 (＊요격 참여)');
      for(const u of r.sams)lines.push(`${samIds.has(u.id)?'＊':'·'} (${u.x}, ${u.y}) Lv${u.level} · 준비 ${u.ready}`);
    }
    lines.push('F8: 배치 상세 '+(plannerSettings.details?'접기':'보기'));
    if(hudEl){hudEl.style.pointerEvents=plannerSettings.details?'auto':'none';hudEl.style.overflowY=plannerSettings.details?'auto':'hidden';}
    if(p.lastExecution)lines.push(p.lastExecution);
    return lines.join('\n');
  }
  const plannerDebug={settings:plannerSettings,snapshot:()=>plannerSnapshot(computeCursorTile()),
    result:()=>plannerState.result,stop:()=>{plannerCancelJob();plannerStop();},
    analyze:()=>plannerCompute(plannerSnapshot(computeCursorTile())),execute:startStrike,simulate,search,state:()=>({pending:!!plannerState.pending,running:!!plannerState.run,error:plannerState.error}),
    inspect:()=>({snapshot:plannerState.snapshot,result:plannerState.result})};
