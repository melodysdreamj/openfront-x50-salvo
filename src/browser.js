  // Predictive I/HUD integration. The old manual H/J/Z/etc. remain available.
  const plannerSettings = {maxAtoms:2000,maxHydros:1,minAtomHits:1,budgetMs:1800,maxTicks:1200,
    adaptiveBudgetMs:350,maxReplans:Infinity,details:false};
  const plannerState = {worker:null,job:0,pending:null,tile:null,game:null,result:null,
    snapshot:null,display:null,error:'',updated:0,stableAt:0,run:null,timer:null,lastExecution:'',advice:null};
  const plannerPaths=new WeakMap();
  const plannerPrices=createPriceReader({onUpdate:()=>{plannerState.updated=0;}});

  function plannerSnapshot(tile) {
    const g=getGameView(), me=g?.myPlayer();
    if(!g||!me||tile===null||tile===undefined) throw Error('게임에서 목표 위치에 커서를 올리세요');
    const cfg=g.config(), tick=g.ticks();
    const prices=plannerPrices.read(g,me);
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
    // GameView.units filters the whole unit map on every call. Enumerate once
    // and preserve game order inside each type for all snapshot consumers.
    const unitsByType=new Map();
    for(const u of g.units()) {
      if(!u.isActive())continue;
      const type=u.type();let group=unitsByType.get(type);
      if(!group)unitsByType.set(type,group=[]);group.push(u);
    }
    const units=type=>unitsByType.get(type)??[];
    const structural=u=>({id:u.id(),x:g.x(u.tile()),y:g.y(u.tile()),level:u.level(),
      queue:[...read(u,'missileTimerQueue')],building:u.isUnderConstruction(),owner:u.owner().smallID()});
    const silos=units('Missile Silo').filter(u=>u.isActive()&&isOwnedByMe(u,me)).map(structural);
    const sams=[];
    for(const u of units('SAM Launcher')) {
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
    const price=type=>prices[type];
    const structures=['City','Factory','Port','Missile Silo','SAM Launcher','Defense Post'];
    const teamStructures=structures.flatMap(type=>units(type)).filter(u=>u.isActive()&&me.isOnSameTeam(u.owner()));
    const owner=g.owner(tile), ownTeam=owner?.isPlayer?.()&&me.isOnSameTeam(owner);
    const allowedFor=type=>!cfg.isUnitDisabled(type)&&!ownTeam&&!teamStructures.some(u=>dist2(target,{x:g.x(u.tile()),y:g.y(u.tile())})<=cfg.nukeMagnitudes(type).outer**2);
    const allowed={atomic:allowedFor(ATOM),mixed:allowedFor(HYDRO)};
    const inflight=[];
    const samTargets=new Set(units('SAM Missile').filter(u=>u.isActive()).map(u=>u.state?.targetUnitId??u.targetUnit?.()?.id?.()));
    for(const type of [ATOM,HYDRO,'MIRV Warhead']) for(const u of units(type)) {
      if(!u.isActive()) continue;
      // Only confirmed launches from this operation are credited during adaptation.
      let ns; try{ns=u.nukeState();}catch{continue;}
      const p=ns.trajectory??[];
      let path=plannerPaths.get(p);
      if(!path){path=p.map(v=>({tile:{x:g.x(v.tile),y:g.y(v.tile)},targetable:v.targetable}));plannerPaths.set(p,path);}
      const targetTile=u.targetTile();let progress=null,progressError='';
      try{progress=flightProgress(path,{x:g.x(u.tile()),y:g.y(u.tile())},ns,g.motionPlans?.().get(u.id()),tick);}catch(e){progressError=e.message;}
      inflight.push({id:u.id(),type,owner:u.owner().smallID(),targeted:!!ns.targetedBySam||samTargets.has(u.id()),
        index:progress?.index??0,waitTicks:progress?.waitTicks??0,progressError,
        targetTile,target:{x:g.x(targetTile),y:g.y(targetTile)},path});
    }
    const s={tick,game,tile,target,width:g.width(),height:g.height(),me:me.smallID(),rules,silos,sams,inflight,
      gold:BigInt(me.gold()),atomCost:price(ATOM),hydroCost:price(HYDRO),allowed,preferredUp:getRocketDirectionUp(),
      intentBudget:Math.max(0,RL.perMinute-10-RL.minWindow.filter(t=>Date.now()-t<60000).length)};
    validateSnapshot(s); return s;
  }

  function plannerStop(reason='사용자가 남은 발사를 중단했습니다') {
    plannerCancelJob();
    if(plannerState.timer!==null) clearTimeout(plannerState.timer);
    const run=plannerState.run;
    if(run)plannerState.report={sentAtoms:run.sentAtoms,sentHydros:run.sentHydros,hitAtoms:run.hitAtoms,hitHydros:run.hitHydros,replans:run.replans,history:[...run.history]};
    plannerState.run=null;plannerState.timer=null;
    plannerState.lastExecution=reason;
    if(run) toast(reason+' · 이미 발사한 미사일은 유지됩니다','#ffd166');
  }
  function plannerCancelJob() {
    plannerState.worker?.terminate();plannerState.worker=null;
    if(plannerState.pending) clearTimeout(plannerState.pending.timeout);
    plannerState.pending=null; plannerState.job++;
  }
  // Long worker jobs may outlive the price cache. Refresh before reading the
  // latest snapshot, retaining the same cancellation generation across await.
  async function plannerFreshPrices(id) {
    const game=getGameView(),me=game?.myPlayer();
    plannerState.pending={id,execute:true,kind:'prices',timeout:null};
    try {
      if(!game||!me)throw Error('게임 정보를 읽을 수 없습니다');
      await plannerPrices.refresh(game,me,true);
      if(id!==plannerState.job)return false;
      plannerState.pending=null;
      return !document.hidden&&getGameView()===game;
    }catch(e){
      if(id===plannerState.job){plannerState.pending=null;plannerState.error=e.message;}
      return false;
    }
  }

  function plannerCompute(snapshot,execute=false,validationLead=10) {
    if(plannerState.run)return;
    plannerCancelJob();
    const id=plannerState.job;
    plannerState.error='';plannerState.result=null;plannerState.snapshot=snapshot;
    if(plannerState.display?.snapshot.game!==snapshot.game)plannerState.display=null;
    plannerState.tile=snapshot.tile;plannerState.game=snapshot.game;
    const blob=new Blob([PLANNER_WORKER_SOURCE],{type:'text/javascript'}), url=URL.createObjectURL(blob);
    let worker;
    try {worker=new Worker(url);}catch(e){URL.revokeObjectURL(url);plannerState.error='계산 작업을 시작할 수 없습니다: '+e.message;return;}
    URL.revokeObjectURL(url);plannerState.worker=worker;
    const budgetMs=execute?Math.max(4000,plannerSettings.budgetMs):plannerSettings.budgetMs;
    const fail=message=>{if(id!==plannerState.job)return;plannerCancelJob();plannerState.error=message;plannerState.updated=Date.now();};
    plannerState.pending={id,execute,kind:'search',started:Date.now(),tested:0,timeout:execute?null:setTimeout(()=>fail('미리보기 계산이 지연됐습니다. I로 끝까지 분석할 수 있습니다'),budgetMs+2000)};
    worker.onerror=e=>fail('계산 오류: '+e.message);
    worker.onmessage=async event=>{
      if(id!==plannerState.job)return;
      const {result,error,progress}=event.data;
      if(progress){Object.assign(plannerState.pending,progress);return;}
      clearTimeout(plannerState.pending.timeout);plannerState.pending=null;
      worker.terminate();plannerState.worker=null;
      if(error){plannerState.error='판정 불가: '+error;plannerState.updated=Date.now();return;}
      if(execute&&!(await plannerFreshPrices(id)))return;
      if(getGameView()?.gameID()!==snapshot.game || (!execute&&computeCursorTile()!==snapshot.tile)) return;
      if(execute)result.validationLead=validationLead;
      plannerState.result=result;plannerState.updated=Date.now();
      plannerState.display={result,snapshot,updated:plannerState.updated};
      if(execute) {
        if(!result.chosen) {
          let fresh;try{fresh=plannerSnapshot(snapshot.tile);}catch(e){plannerState.error=e.message;return;}
          if(fresh.game!==snapshot.game||fresh.me!==snapshot.me)return;
          if(planningStructureKey(fresh)!==planningStructureKey(snapshot,fresh.tick)) {
            plannerRetry(snapshot,null,'계산 중 상태 변경 · 최신 상태에서 후보를 다시 탐색합니다',100,validationLead);return;
          }
          toast(result.reason,'#ffd166');return;
        }
        plannerExecute(snapshot,result);
      }
    };
    worker.postMessage({id,snapshot:workerSnapshot(snapshot),options:{...plannerSettings,budgetMs,continuous:execute,initialTicks:execute?validationLead:3,allowNewHydro:plannerSettings.maxHydros>0}});
  }

  function plannerJob(kind,data,budget,done,fail) {
    plannerCancelJob();
    const id=plannerState.job,url=URL.createObjectURL(new Blob([PLANNER_WORKER_SOURCE],{type:'text/javascript'}));
    let worker;
    try{worker=new Worker(url);}catch(e){URL.revokeObjectURL(url);fail(e.message);return;}
    URL.revokeObjectURL(url);plannerState.worker=worker;
    const failed=message=>{if(id!==plannerState.job)return;plannerCancelJob();fail(message);};
    plannerState.pending={id,execute:true,kind,started:Date.now(),timeout:Number.isFinite(budget)?setTimeout(()=>failed('계산 시간 초과'),budget+1500):null};
    worker.onerror=e=>failed(e.message);
    worker.onmessage=async e=>{
      if(id!==plannerState.job)return;
      clearTimeout(plannerState.pending.timeout);plannerState.pending=null;plannerState.worker=null;worker.terminate();
      if(e.data.error){fail(e.data.error);return;}
      if(kind==='assess'&&!(await plannerFreshPrices(id)))return;
      done(e.data.result);
    };
    worker.postMessage({id,kind,...data,snapshot:workerSnapshot(data.snapshot)});
  }

  // I can use all ten requests in the shared second window. Other shortcut
  // queues retain their own reserve policy; every send still records in RL.
  function plannerRateDelay(now=Date.now()) {
    RL.secWindow=RL.secWindow.filter(t=>now-t<1000);
    RL.minWindow=RL.minWindow.filter(t=>now-t<60000);
    return strikeRateDelay(RL,now);
  }

  // Retry the fixed I target without allowing a late response to resurrect an
  // Esc-cancelled operation. A state change is a revalidation, not a user error.
  function plannerRetry(snapshot,result,message,delay=100,validationLead=10) {
    plannerCancelJob();const id=plannerState.job;
    plannerState.pending={id,execute:true,kind:'retry',message,started:Date.now(),timeout:setTimeout(()=>{
      if(id!==plannerState.job)return;
      plannerState.pending=null;
      try {
        const fresh=plannerSnapshot(snapshot.tile);
        if(document.hidden||fresh.game!==snapshot.game||fresh.me!==snapshot.me)return;
        if(result)plannerExecute(fresh,result);else plannerCompute(fresh,true,validationLead);
      }catch(e){plannerState.error=e.message;}
    },delay)};
  }

  // Freeze limits for the whole operation, including every later revision.
  function plannerExecute(snapshot,result) {
    let fresh;
    try{fresh=plannerSnapshot(snapshot.tile);}catch(e){plannerState.error=e.message;return;}
    if(document.hidden||fresh.game!==snapshot.game||fresh.me!==snapshot.me)return;
    if(result.chosen.actions.some(a=>a.type===HYDRO?fresh.allowed.mixed===false:fresh.allowed.atomic===false)){plannerRetry(snapshot,null,'목표의 발사 제한 변경 · 가능한 공격을 다시 확인합니다');return;}
    const planToCheck=scheduledCandidate(result.chosen,result.validationLead??10);
    plannerJob('assess',{snapshot:fresh,plan:planToCheck,options:{minAtomHits:plannerSettings.minAtomHits,maxTicks:plannerSettings.maxTicks,budgetMs:Infinity}},Infinity,check=>{
      let current;try{current=plannerSnapshot(snapshot.tile);}catch(e){plannerState.error=e.message;return;}
      if(document.hidden||current.game!==snapshot.game||current.me!==snapshot.me)return;
      if(planningStructureKey(current)!==planningStructureKey(fresh,current.tick)||!ownQueuesFollowClock(fresh,current)) {
        plannerRetry(snapshot,result,'구조물·내 발사관 변경 · 기존 후보를 유지하며 재검증합니다');return;
      }
      if(!check.ok){
        const alternative=[result.mixed,result.atomic].find(p=>p&&p!==result.chosen);
        if(alternative){plannerRetry(snapshot,{...result,mixed:null,atomic:null,chosen:alternative},'기존의 다른 후보를 재검증합니다');return;}
        plannerRetry(snapshot,null,'기존 후보의 검증 실패 · 변경된 방어에 맞는 대안을 탐색합니다',100,result.validationLead??10);return;
      }
      if(planToCheck.actions[0]&&fresh.tick+planToCheck.actions[0].tick<=current.tick) {
        plannerRetry(snapshot,{...result,validationLead:Math.max(result.validationLead??10,(current.tick-fresh.tick)*2+3)},'기존 후보 유지 · 계산 시간에 맞춰 발사 시각만 조정합니다');return;
      }
      const plan={...planToCheck,...check.result},bus=getEventBus(),ctor=findNukeEventCtor();
      if(current.gold<plan.cost){plannerState.error='계획을 실행할 골드가 부족합니다';return;}
      const rateWait=plannerRateDelay();
      if(rateWait>0||plan.actions.length>current.intentBudget) {
        plannerRetry(snapshot,result,'명령 한도 회복 대기 · 회복 후 최신 상태로 재검증합니다',1000);return;
      }
      if(!bus||!ctor){plannerState.error='게임 발사 이벤트를 찾지 못했습니다';return;}
      const ids=new Set(getGameView().units(ATOM,HYDRO).map(u=>u.id()));
      const run={plan,tile:snapshot.tile,game:snapshot.game,me:snapshot.me,rules:JSON.stringify(current.rules),
        baseTick:fresh.tick,index:0,sent:0,sentAtoms:0,sentHydros:0,confirmed:0,ids,tracked:new Map(),outbox:[],
        atomLimit:Math.min(5000,Math.max(0,plannerSettings.maxAtoms)),hydroLimit:Math.max(0,plannerSettings.maxHydros),
        minHits:Math.max(1,plannerSettings.minAtomHits),goal:plan.goal??(plan.hydros?'hydro':'atomic'),
        hitAtoms:0,hitHydros:0,replans:0,phase:'firing',reason:'검증된 계획 실행',needsReplan:false,
        startedTick:current.tick,lastTick:current.tick,lastTickAt:Date.now(),bus,ctor,current,
        signature:defenseSignature(current),candidate:null,history:[]};
      plannerState.run=run;plannerState.lastExecution='';plannerState.advice=null;plannerState.report=null;
      plannerPump();
    },message=>{plannerState.error='발사 검증 오류: '+message;});
  }

  function plannerObserve(run,current) {
    const g=getGameView(),records=new Map();
    for(const u of g.units(ATOM,HYDRO))records.set(u.id(),{id:u.id(),unitType:u.type(),ownerID:u.owner().smallID(),
      targetTile:u.targetTile(),isActive:u.isActive(),reachedTarget:u.reachedTarget?.()??false});
    // Capture terminal states even when the active-unit list already dropped it.
    for(const entries of Object.values(g.updatesSinceLastTick?.()??{}))if(Array.isArray(entries))
      for(const u of entries)if([ATOM,HYDRO].includes(u.unitType))records.set(u.id,u);
    for(const [id] of run.tracked)if(!records.has(id)) {
      const u=g.unit?.(id);
      if(u)records.set(id,{id,unitType:u.type(),ownerID:u.owner().smallID(),targetTile:u.targetTile(),isActive:u.isActive(),reachedTarget:u.reachedTarget?.()??false});
    }
    for(const u of records.values()) {
      if(run.ids.has(u.id)||u.ownerID!==run.me)continue;
      if(!run.tracked.has(u.id)) {
        const request=run.outbox.find(v=>v.type===u.unitType&&v.acked<v.amount);
        if(u.targetTile!==run.tile||!request)throw Error('계획 외 발사가 감지되었습니다');
        request.acked++;run.confirmed++;
        run.tracked.set(u.id,{id:u.id,type:u.unitType,active:true,hit:false,missing:false});
      }
      const entry=run.tracked.get(u.id);
      entry.active=u.isActive;
      if(u.reachedTarget&&!entry.hit){entry.hit=true;if(entry.type===HYDRO)run.hitHydros++;else run.hitAtoms++;}
    }
    const activeIds=new Set(current.inflight.map(b=>b.id));
    for(const entry of run.tracked.values())if(entry.active&&!activeIds.has(entry.id)) {
      entry.active=false;entry.missing=true; // disappearance is never a confirmed hit
    }
    for(const b of current.inflight) {
      b.committed=run.tracked.has(b.id)&&b.owner===run.me&&b.targetTile===run.tile;
      if(b.committed&&b.progressError)throw Error(b.progressError);
    }
    current.includeCommitted=true;current.confirmedAtomHits=run.hitAtoms;current.confirmedHydroHits=run.hitHydros;
    run.current=current;
    const pending=run.outbox.find(v=>v.acked<v.amount);
    if(pending&&current.tick-pending.tick>12)throw Error('발사 요청의 게임 반영을 확인하지 못했습니다');
  }
  function plannerFinish(reason,s,advice=false) {
    const run=plannerState.run;
    plannerStop(reason);
    if(!advice||!run)return;
    plannerState.advice='다음 공격에 필요한 조건을 확인 중…';
    plannerJob('advice',{snapshot:s,options:{maxAtoms:run.atomLimit,minAtomHits:run.minHits,budgetMs:800,allowNewHydro:run.hydroLimit>0}},800,result=>{
      plannerState.advice=result.text;
    },message=>{plannerState.advice='구체적인 레벨업 조건을 확인하지 못했습니다: '+message;});
  }
  function plannerReplan(run,s) {
    if(run.sent!==run.confirmed){run.phase='waiting-ack';return;}
    if(run.replans>=plannerSettings.maxReplans)return plannerFinish('방어 변화가 반복되어 재계산 한도에 도달했습니다',s,true);
    run.replans++;run.phase='adapting';run.needsReplan=false;
    const timeLeft=(plannerSettings.maxTicks-(s.tick-run.startedTick)-3)*100;
    if(timeLeft<50)return plannerFinish('공격 관측 시간 안에 남은 계획을 검증할 시간이 없습니다',s,false);
    const budget=Math.max(50,Math.min(timeLeft,run.adaptiveBudget??plannerSettings.adaptiveBudgetMs)),lead=Math.ceil(budget/100)+2;
    const continueComputing=()=>{
      if(plannerState.run!==run)return;
      // A timed-out candidate search is unknown, not an impossible attack.
      // Keep the cumulative weapon caps and observe flights while trying again.
      run.adaptiveBudget=budget*2;run.replans--;
      run.phase='waiting-ack';run.needsReplan=true;
      run.reason='재계산 시간이 더 필요해 계산 시간을 늘려 다시 확인합니다 · 남은 발사 보류';
    };
    const signature=defenseSignature(s);
    const candidate=run.candidate;
    const remaining=candidate?remainingPlan(candidate.plan,0,candidate.baseTick,s.tick,lead):remainingPlan(run.plan,run.index,run.baseTick,s.tick,lead);
    plannerJob('adapt',{snapshot:s,request:{remaining,goal:candidate?.plan.goal??run.goal,atomLimit:run.atomLimit,hydroLimit:run.hydroLimit,
      sentAtoms:run.sentAtoms,sentHydros:run.sentHydros},options:{minAtomHits:run.minHits,maxTicks:plannerSettings.maxTicks,budgetMs:budget,initialTicks:lead}},budget,result=>{
      if(plannerState.run!==run)return;
      let fresh;
      try{fresh=plannerSnapshot(run.tile);plannerObserve(run,fresh);}catch(e){return plannerFinish(e.message,run.current,false);}
      const first=result.chosen?.actions[0];
      if(result.limited&&!result.chosen){continueComputing();return;}
      if(signature!==defenseSignature(fresh)||newHydrogenThreat(s,fresh)||(first&&s.tick+first.tick<=fresh.tick)||fresh.tick-s.tick>lead) {
        if(result.chosen)run.candidate={plan:result.chosen,baseTick:s.tick};
        run.phase='waiting-ack';run.needsReplan=true;run.reason='변경 사항 확인 · 기존 후보를 유지하며 재검증';return;
      }
      if(!result.chosen)return plannerFinish('남은 발사 중단: '+result.reason,fresh,true);
      run.plan=result.chosen;run.baseTick=s.tick;run.index=0;run.signature=signature;
      run.goal=run.plan.goal??(run.plan.hydros?'hydro':'atomic');
      run.phase=run.plan.actions.length?'firing':'observing';run.reason=result.reason;
      run.history.push({tick:fresh.tick,decision:result.decision,atoms:run.plan.atoms,hydros:run.plan.hydros,reason:result.reason});
      run.needsReplan=false;run.candidate=null;run.adaptiveBudget=plannerSettings.adaptiveBudgetMs;
    },message=>{
      if(plannerState.run!==run)return;
      if(message==='계산 시간 초과'){continueComputing();return;}
      plannerFinish('재계산 실패로 남은 발사 중단: '+message,run.current,true);
    });
  }

  function plannerPump() {
    plannerState.timer=null;
    const run=plannerState.run;if(!run)return;
    try {
      if(document.hidden)return plannerStop('탭이 숨겨져 남은 발사를 중단했습니다');
      if(getGameView()?.ticks()===run.sampledTick&&run.rateWaitingTick!==run.sampledTick) {
        if(Date.now()-run.lastTickAt>2000)return plannerStop('게임 진행이 멈춰 남은 발사를 중단했습니다');
        plannerState.timer=setTimeout(plannerPump,40);return;
      }
      const current=plannerSnapshot(run.tile),tick=current.tick;
      run.sampledTick=tick;
      if(current.game!==run.game||current.me!==run.me||JSON.stringify(current.rules)!==run.rules)
        return plannerStop('게임·플레이어·규칙이 바뀌어 남은 발사를 중단했습니다');
      if(tick!==run.lastTick){run.lastTick=tick;run.lastTickAt=Date.now();}
      if(Date.now()-run.lastTickAt>2000)return plannerStop('게임 진행이 멈춰 남은 발사를 중단했습니다');
      if(tick-run.startedTick>plannerSettings.maxTicks)return plannerFinish('공격 관측 제한 시간에 도달했습니다',current,false);
      plannerObserve(run,current);
      if(run.hitHydros>=1||(run.goal==='atomic'&&run.hitAtoms>=run.minHits))
        return plannerFinish(`목표 도달 확인: 수소 ${run.hitHydros}발 · 원자 ${run.hitAtoms}발`,current,false);
      const signature=defenseSignature(current);
      if(signature!==run.signature){run.needsReplan=true;run.reason='SAM·사일로 변화 감지 — 남은 발사 보류';}
      for(const b of current.inflight)if(b.committed&&b.type===HYDRO&&b.targeted&&!run.tracked.get(b.id).targeted) {
        run.tracked.get(b.id).targeted=true;run.needsReplan=true;run.reason='수소탄에 요격 미사일 배정 감지';
      }
      if(run.phase!=='adapting') {
        const action=run.plan.actions[run.index];
        if(action&&tick>run.baseTick+action.tick){run.needsReplan=true;run.reason='예정 발사 시각을 놓쳐 일정 재검증';}
        if(run.needsReplan)plannerReplan(run,current);
        else if(action&&tick>=run.baseTick+action.tick) {
          const hydro=action.type===HYDRO;
          if((hydro?run.sentHydros+action.amount>run.hydroLimit:run.sentAtoms+action.amount>run.atomLimit))
            return plannerFinish('이번 공격의 누적 발사 한도에 도달했습니다',current,true);
          const cost=(hydro?current.hydroCost:current.atomCost)*BigInt(action.amount);
          const ready=current.silos.reduce((sum,s)=>sum+(s.building?0:Math.max(0,s.level-s.queue.length)),0);
          const rateWait=plannerRateDelay();
          if(rateWait>0) {
            // A 40ms poll can reach the next game tick just before the wall-clock
            // second expires. Retry WITHIN this tick instead of wasting a replan.
            // If the due tick passes, the normal missed-deadline guard revalidates.
            run.rateWaitingTick=tick;run.reason='명령 한도 회복 대기 · 같은 틱 안에서 재확인';
            plannerState.timer=setTimeout(plannerPump,Math.max(1,Math.min(40,Math.ceil(rateWait))));return;
          }
          run.rateWaitingTick=null;
          if(current.gold<cost||ready-(run.sent-run.confirmed)<action.amount||
            (hydro?current.allowed.mixed===false:current.allowed.atomic===false)) {
            run.needsReplan=true;run.reason='골드·발사관·명령 한도 변경 — 남은 발사 보류';plannerReplan(run,current);
          }else {
            // Reserve before emit so a synchronous test adapter cannot race ACK.
            run.outbox.push({type:action.type,amount:action.amount,acked:0,tick});
            run.bus.emit(new run.ctor(action.type,run.tile,run.plan.up,action.amount));rateUse();
            run.reason='검증된 일정으로 발사 중 · 원자 최대 50발 × 초당 10건';
            run.sent+=action.amount;run.index++;
            if(hydro)run.sentHydros+=action.amount;else run.sentAtoms+=action.amount;
          }
        }else if(!action) {
          run.phase=run.sent===run.confirmed?'observing':'waiting-ack';
          if(run.sent===run.confirmed&&!current.inflight.some(b=>b.committed))
            return plannerFinish(`비행 종료 · 목표 도달 확인 부족 (수소 ${run.hitHydros}, 원자 ${run.hitAtoms})`,current,true);
        }
      }
    }catch(e){return plannerStop('상태 확인 실패로 중단: '+e.message);}
    if(plannerState.run===run)plannerState.timer=setTimeout(plannerPump,40);
  }

  function startStrike() {
    if(plannerState.run){toast('계획 실행 중입니다. Esc로 남은 발사를 중단할 수 있습니다','#ffd166');return;}
    if(plannerState.pending?.execute){toast('선택한 위치의 발사 계획을 검증 중입니다. Esc로 취소할 수 있습니다','#ffd166');return;}
    if(warshipQueue.length||upgradeJobs.size||upgradeSelectionPending||salvoQueue.length||salvoTimer!==null||salvoFollow!==null||armed){toast('기존 작업을 Esc로 끝낸 뒤 I를 누르세요','#ffd166');return;}
    const game=getGameView(),me=game?.myPlayer(),tile=computeCursorTile();
    if(!game||!me||tile===null){plannerState.error='게임에서 목표 위치에 커서를 올리세요';return;}
    plannerCancelJob();const id=plannerState.job;
    plannerState.error='';
    plannerState.pending={id,execute:true,kind:'prices',timeout:null};
    plannerPrices.refresh(game,me,true).then(()=>{
      if(id!==plannerState.job)return;
      plannerState.pending=null;
      if(document.hidden||getGameView()!==game)return;
      plannerCompute(plannerSnapshot(tile),true);
    }).catch(e=>{
      if(id!==plannerState.job)return;
      plannerState.pending=null;plannerState.error=e.message;toast('공격 준비 중단 · 표시창의 원인을 확인하세요','#ffd166');
    });
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

  // Background refresh never removes the last completed display. The engine
  // still receives a fresh snapshot and I still independently revalidates it.
  function plannerRefreshPreview() {
    const p=plannerState,now=Date.now(),tile=computeCursorTile(),g=getGameView();
    if(p.run||warshipQueue.length||(armed&&armedMode==='warship'))return;
    if(!g?.myPlayer()){p.display=null;p.error='';return;}
    if(!p.pending?.execute&&(tile!==p.tile||g.gameID()!==p.game)) {
      const differentGame=g.gameID()!==p.game;
      plannerCancelJob();p.tile=tile;p.game=g.gameID();p.result=null;p.error='';p.stableAt=now;p.updated=0;
      if(differentGame){p.display=null;p.lastExecution='';p.advice=null;}
    }
    if(!p.pending&&!document.hidden&&now-p.stableAt>350&&now-p.updated>2500) {
      try{plannerCompute(plannerSnapshot(tile));}catch(e){p.error=e.message;p.updated=now;}
    }
  }
  function hudTargetLine() {
    return hudEl?.innerText??'게임 지도에 커서를 잠시 멈추세요.';
  }
  const plannerDebug={settings:plannerSettings,snapshot:()=>plannerSnapshot(computeCursorTile()),
    result:()=>plannerState.result,stop:()=>{plannerCancelJob();plannerStop();},
    analyze:()=>plannerCompute(plannerSnapshot(computeCursorTile())),execute:startStrike,simulate,search,trajectory,state:()=>({pending:!!plannerState.pending,running:!!plannerState.run,error:plannerState.error,phase:plannerState.run?.phase,reason:plannerState.run?.reason,lastExecution:plannerState.lastExecution,advice:plannerState.advice,report:plannerState.report,replans:plannerState.run?.replans,history:plannerState.run?.history}),
    inspect:()=>({snapshot:plannerState.snapshot,result:plannerState.result})};
