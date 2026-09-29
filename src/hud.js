  // Stable DOM: update only changed text, retaining the detail scroll position.
  function plannerHudEnsure(el) {
    if(el._plannerHud)return el._plannerHud;
    el.id='of-strike-hud';el.setAttribute('role','region');el.setAttribute('aria-label','공격 분석');
    Object.assign(el.style,{padding:'16px',borderRadius:'12px',width:'370px',maxWidth:'calc(100vw - 16px)',
      maxHeight:'min(80vh,680px)',boxSizing:'border-box',background:'#101820',color:'#edf3f8',
      border:'1px solid #53616e',textShadow:'none',whiteSpace:'normal',wordBreak:'keep-all',font:'400 14px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif',overflow:'hidden'});
    const style=document.createElement('style');style.textContent=`
      #of-strike-hud *{box-sizing:border-box}
      #of-strike-hud p{margin:0} #of-strike-hud [hidden]{display:none!important}
      #of-strike-hud .of-title{font-size:18px;font-weight:700;line-height:1.4;overflow-wrap:anywhere}
      #of-strike-hud[data-tone="ready"] .of-title{color:#a6e4bf}
      #of-strike-hud[data-tone="caution"] .of-title{color:#f4d49a}
      #of-strike-hud[data-tone="error"] .of-title{color:#ffc1b9}
      #of-strike-hud .of-reason{margin-top:6px;color:#d5e0e9;overflow-wrap:anywhere}
      #of-strike-hud .of-action{margin-top:10px;font-weight:600;overflow-wrap:anywhere}
      #of-strike-hud .of-options{margin:14px 0 12px;border-top:1px solid #354450}
      #of-strike-hud .of-option{display:grid;grid-template-columns:86px minmax(0,1fr);gap:8px;padding:8px 0;border-bottom:1px solid #354450}
      #of-strike-hud .of-label{color:#b9cbd9} #of-strike-hud .of-value{font-weight:600;overflow-wrap:anywhere}
      #of-strike-hud .of-note{color:#b9cbd9;font-size:12px}
      #of-strike-hud .of-meta{color:#b9cbd9;font-size:12px;margin-top:3px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
      #of-strike-hud .of-refresh{min-height:38px;color:#b9cbd9;font-size:12px;margin-top:10px;overflow-wrap:anywhere}
      #of-strike-hud .of-keys{margin-top:10px;padding-top:9px;border-top:1px solid #354450;color:#d5e0e9;font-size:12px}
      #of-strike-hud .of-details{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#d5e0e9;max-height:220px;overflow-y:auto;margin-top:12px;padding-right:4px;overscroll-behavior:contain}
      #of-strike-hud .of-report{margin-top:10px;color:#f4d49a;font-size:12px;white-space:pre-line;overflow-wrap:anywhere}
      #of-strike-hud .of-details:focus-visible{outline:2px solid #b9cbd9;outline-offset:2px}
      @media(max-height:600px){#of-strike-hud{max-height:calc(100vh - 16px)!important}}
    `;document.head.appendChild(style);
    el.replaceChildren();
    const add=(tag,cls,parent=el)=>{const node=document.createElement(tag);node.className=cls;parent.appendChild(node);return node;};
    const title=add('p','of-title');title.setAttribute('aria-live','polite');title.setAttribute('aria-atomic','true');
    const reason=add('p','of-reason'),action=add('p','of-action'),options=add('div','of-options');
    const rows=[0,1].map(()=>{const row=add('div','of-option',options),label=add('span','of-label',row),body=add('div','',row);return {label,value:add('p','of-value',body),note:add('p','of-note',body)};});
    const resources=add('p','of-meta'),defense=add('p','of-meta'),position=add('p','of-meta'),refresh=add('p','of-refresh'),report=add('p','of-report'),keys=add('p','of-keys'),rate=add('p','of-meta'),details=add('div','of-details');
    details.tabIndex=0;details.setAttribute('role','region');details.setAttribute('aria-label','계산 근거와 사일로·SAM 배치 상세');
    return el._plannerHud={title,reason,action,options,rows,resources,defense,position,refresh,report,keys,rate,details};
  }

  function plannerDetails(display,error='') {
    const lines=[];
    if(error)lines.push('오류 상세: '+error);
    if(!display)return lines.join('\n');
    const {result:r,snapshot:s}=display;
    lines.push(`분석 위치 (${s.target.x}, ${s.target.y})`,
      `성공 조건: 수소 1발 또는 원자 ${r.minAtomHits}발 도달`,
      `원자 최대 ${r.maxAtoms.toLocaleString()}발까지 후보를 계산합니다. 최대 수량을 항상 발사한다는 뜻은 아닙니다.`,
      '재장전 완료 1발분 = 지금 비어 있는 미사일 발사관 1개.',
      'SAM 수는 지도 전체의 아군 외 검토 대상입니다. 목표 주변에 모두 있다는 뜻은 아닙니다.',
      `비행 중 ${r.existingFlights}발 관측. 다른 공격의 방어 소모·SAM 파괴 효과는 성공 근거에서 제외합니다.`);
    if(r.reason)lines.push('계산 결과: '+r.reason);
    if(r.diagnostics?.length)lines.push(...r.diagnostics);
    for(const [name,plan] of [['수소 + 원자',r.mixed],['원자만',r.atomic]])if(plan) {
      lines.push(`${name}: 비용 ${plan.cost.toLocaleString()}골드 · ${plan.up?'위쪽':'아래쪽'} 궤적 · 계획 기준 약 ${(plan.lastArrival/10).toFixed(1)}초 후 도달`,
        `사용 사일로 ${plan.usedSilos.length}기 · 이 계획에서 요격하는 SAM ${plan.participating.length}기`);
    }
    const used=new Set(r.chosen?.usedSilos??[]),sams=new Set(r.chosen?.participating??[]);
    lines.push('','사일로 배치');
    for(const u of r.silos)lines.push(`(${u.x}, ${u.y}) Lv${u.level} · 재장전 완료 ${u.ready}발분${used.has(u.id)?' · 추천 계획에 사용':''}`);
    lines.push('','SAM 배치');
    for(const u of r.sams)lines.push(`(${u.x}, ${u.y}) Lv${u.level} · 요격 준비 ${u.ready}발분${sams.has(u.id)?' · 추천 계획에서 요격':''}`);
    lines.push('','현재 상태의 예측입니다. 명중이나 최소 필요 레벨을 보장하지 않습니다.');
    return lines.join('\n');
  }

  function plannerRenderHud(el,rate) {
    plannerRefreshPreview();
    const dom=plannerHudEnsure(el),p=plannerState,g=getGameView(),tile=computeCursorTile(),d=p.display,run=p.run;
    let model={title:'목표 위치를 선택하세요',tone:'idle',reason:'게임 지도에 커서를 잠시 멈추세요.',action:'',options:[],resources:'',defense:''};
    let refresh='',position='',report='';
    const changed=!!d&&(d.snapshot.tile!==tile||d.snapshot.game!==g?.gameID());
    if(d) {
      model=resultPresentation(d.result,d.snapshot);
      position=`${changed?'이전 분석 위치':'목표 위치'} (${d.snapshot.target.x}, ${d.snapshot.target.y})`;
      refresh=changed?'커서를 멈추면 새 위치를 분석합니다.':p.pending?'재계산 중 · 직전 결과를 표시하고 있습니다.':`${Math.max(0,Math.floor((Date.now()-d.updated)/1000))}초 전 계산 · 현재 상태의 예측`;
      if(changed){model={...model,title:'이전 위치 · '+model.title,tone:'idle',action:'새 위치를 확인한 뒤 I로 분석·발사하세요.'};}
    } else if(p.pending) {model.title='공격 방법을 계산하고 있습니다';model.reason='이 위치에 도달할 수 있는 원자·수소 공격을 비교합니다.';model.action='Esc로 계산을 취소할 수 있습니다.';}
    if(p.pending?.execute&&!run) {refresh=p.pending.kind==='prices'?'발사 준비 · 가격 확인 중':p.pending.kind==='advice'?'다음 공격에 필요한 조건 확인 중':'발사 전 최신 상태 확인 중 · Esc로 취소';model.action='선택한 목표를 확인 중입니다. 아직 발사하지 않았습니다.';}
    if(p.error&&!run) {
      const loading=/가격.*조회 중/.test(p.error);
      model={...model,title:loading?'무기 가격을 확인하고 있습니다':'지금은 분석할 수 없습니다',tone:loading?'idle':'error',
        reason:/not a function|undefined|TypeError/.test(p.error)?'게임 정보를 읽는 중 오류가 발생했습니다.':p.error,
        action:loading?'가격을 받으면 자동으로 분석합니다.':'원인을 확인한 뒤 I로 다시 분석하세요. 오류 상세는 F8에 있습니다.',options:[]};
      refresh=d?'이전 계산은 현재 상태의 추천으로 사용하지 않습니다.':'';
    }
    if(run) {
      const phase={firing:'계획대로 발사 중',adapting:'방어가 바뀌어 계획 수정 중',observing:'발사 완료 · 도달 확인 중','waiting-ack':'게임의 발사 반영을 기다리는 중'}[run.phase];
      model={title:phase,tone:run.phase==='adapting'?'caution':'ready',reason:run.reason,
        action:'Esc를 누르면 아직 보내지 않은 발사를 멈춥니다.',options:[
          {name:'발사한 수량',value:`원자 ${run.sentAtoms}발 + 수소 ${run.sentHydros}발`,note:`공격 전체 한도: 원자 ${run.atomLimit}발 · 수소 ${run.hydroLimit}발`},
          {name:'도달 확인',value:`원자 ${run.hitAtoms}발 · 수소 ${run.hitHydros}발`,note:`게임에 반영된 발사 ${run.confirmed}/${run.sent}발 · 계획 수정 ${run.replans}회`}],resources:'',defense:''};
      position=`고정 목표 (${run.current.target.x}, ${run.current.target.y})`;refresh='이미 발사한 미사일은 취소되지 않습니다.';
    } else if(warshipQueue.length||(armed&&armedMode==='warship')) {
      const ships=warshipStatus();
      model={title:ships.running?(ships.phase==='rate-wait'?'군함 건조 · 한도 대기':'군함을 순서대로 건조 중'):'군함 배치 모드',
        tone:ships.phase==='stopped'?'caution':'ready',reason:ships.message||`바다를 클릭할 때마다 군함 ${CFG.warshipCount}척을 대기열에 추가합니다.`,
        action:'연속 클릭도 순서대로 처리합니다. Esc로 남은 요청을 취소합니다.',
        options:[{name:'건조 반영',value:`${ships.confirmed}척 확인 / ${ships.sent}척 요청`,note:'요청 전송과 게임 생성 확인을 구분합니다.'},
          {name:'남은 수량',value:`${ships.remaining}척 · ${ships.batches}묶음`,note:'클릭한 위치를 저장해 순서대로 처리합니다.'}],resources:'',defense:''};
      position=ships.tile===null?'':`현재 배치 목표 (${g.x(ships.tile)}, ${g.y(ships.tile)})`;
      refresh='N: 배치 모드 전환 · Esc: 남은 대기열 취소';
    } else if(p.lastExecution)report=[p.lastExecution,p.advice].filter(Boolean).join('\n');
    const set=(node,text)=>{text=String(text??'');if(node.textContent!==text)node.textContent=text;node.hidden=!text;};
    el.dataset.tone=model.tone;
    set(dom.title,model.title);set(dom.reason,model.reason);set(dom.action,model.action);
    dom.options.hidden=!model.options.length;
    dom.rows.forEach((row,i)=>{const value=model.options[i]??{};set(row.label,value.name);set(row.value,value.value);set(row.note,value.note);});
    set(dom.resources,model.resources);set(dom.defense,model.defense);set(dom.position,position);set(dom.refresh,refresh);set(dom.report,report);
    set(dom.keys,`F8 상세 ${plannerSettings.details?'닫기':'보기'}${p.pending||run?' · Esc 취소':''}`);
    set(dom.rate,`명령 전송: 최근 1초 ${rate.secUsed}/${rate.secCap}건 · 1분 ${rate.minUsed}/${rate.minCap}건${rate.ok?'':` · 한도 여유 회복까지 ${Math.ceil(rate.left)}초`}`);
    const detailKey=[d,p.error,plannerSettings.details];
    if(!dom.detailKey||detailKey.some((v,i)=>v!==dom.detailKey[i])) {set(dom.details,plannerSettings.details?plannerDetails(d,p.error):'');dom.detailKey=detailKey;}
    el.style.pointerEvents=plannerSettings.details?'auto':'none';el.style.overflowY='auto';
  }
