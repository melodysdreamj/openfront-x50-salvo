// Presentation only. Never changes a plan, its acceptance, or execution limits.
export function resultPresentation(r,s={}) {
  const n=value=>Number(value??0).toLocaleString('ko-KR');
  let title,tone,reason,action;
  if(r.chosen) {
    title=r.mode==='mixed'?'수소 혼합 공격 추천':'원자 집중 공격 추천';tone='ready';
    reason=r.mode==='mixed'?'원자탄과 수소탄을 섞어 보내는 계획입니다.':'원자탄만 보내는 계획입니다.';
    action='I를 누르면 최신 상태로 확인한 뒤 발사합니다.';
  } else {
    tone='caution';title=r.limited?'미리보기에서 아직 확인 못했습니다':'돌파 계획을 찾지 못했습니다';
    reason='발사 수량·순서를 바꿔 시험했지만 통과를 확인하지 못했습니다.';
    action='사일로 레벨·위치와 재장전 상태를 확인하세요.';
    if(r.limited) {reason='화면 갱신용 짧은 계산에서 결론이 나지 않았습니다. 공격 불가 판정은 아닙니다.';action='I를 누르면 후보를 끝까지 검토합니다. 검증되면 발사합니다. Esc로 취소합니다.';}
    else if(!r.silos.length||s.silos?.every(u=>u.building)) {reason='사용할 수 있는 완성된 사일로가 없습니다.';action='사일로를 건설하거나 완공될 때까지 기다리세요.';}
    else if(s.allowed?.atomic===false&&s.allowed?.mixed===false) {reason='게임 규칙상 이 위치에는 핵무기를 발사할 수 없습니다.';action='목표 위치를 바꿔 다시 확인하세요.';}
    else if(s.gold!==undefined&&s.gold<s.atomCost&&s.gold<s.hydroCost) {reason='원자탄이나 수소탄을 살 골드가 부족합니다.';action='골드를 모은 뒤 다시 확인하세요.';}
    else if(s.intentBudget===0) {reason='이 스크립트의 명령 전송 한도를 사용했습니다.';action='아래의 명령 한도가 회복될 때까지 기다리세요.';}
    else if(!r.ready) {reason='현재 사일로의 발사관이 모두 재장전 중입니다.';action='재장전이 끝난 뒤 다시 확인하세요.';}
    else if(r.failure?.tubeShortage) {reason=`시험한 공격에서 ${n(r.failure.tubeShortage)}발을 발사관 부족으로 보내지 못했습니다.`;action='사일로 레벨업·추가 건설 또는 재장전 대기를 검토하세요.';}
    else if(r.failure?.blockedBy?.length) {reason='시험한 수소탄이 SAM에 요격됐습니다.';action='사일로 레벨·위치를 바꿀 필요가 있는지 상세에서 확인하세요.';}
  }
  const option=(name,plan)=>plan?{name,value:`원자 ${n(plan.atoms)}발${plan.hydros?` + 수소 ${n(plan.hydros)}발`:''}`,
    note:`예상 도달: ${plan.hydroHits?`수소 ${n(plan.hydroHits)}발`:''}${plan.hydroHits&&plan.atomHits?' · ':''}${plan.atomHits?`원자 ${n(plan.atomHits)}발`:''}`,
    chosen:plan===r.chosen}: {name,value:r.limited?'시간 내 확인 못함':'돌파 계획 미확인',note:'',chosen:false};
  return {title,tone,reason,action,options:[option('수소 + 원자',r.mixed),option('원자만',r.atomic)],
    resources:`내 사일로 ${n(r.silos.length)}기 · 재장전 완료 ${n(r.ready)}발분`,
    defense:`지도 전체에서 SAM ${n(r.sams.length)}기 검토`,
    limit:`원자 최대 ${n(r.maxAtoms)}발 범위에서 계산`};
}
