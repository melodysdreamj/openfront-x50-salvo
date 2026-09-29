// PlayerView intentionally lacks Player.unitsOwned / unitsConstructed. Prices
// must come from the engine worker's buildables query, as the game's UI does.
export function createPriceReader({now=()=>Date.now(),refreshMs=2000,maxAgeMs=5000,timeoutMs=1500,onUpdate=()=>{}}={}) {
  const cache=new WeakMap(),types=['Atom Bomb','Hydrogen Bomb'];
  function entry(game,player) {
    let e=cache.get(game);
    if(!e||e.player!==player){e={player,at:-Infinity,retryAt:0,values:null,error:null,pending:null};cache.set(game,e);}
    return e;
  }
  function refresh(game,player,force=false) {
    const e=entry(game,player);
    if(e.pending)return e.pending;
    if(!force&&e.values&&!e.error&&now()-e.at<refreshMs)return Promise.resolve(e.values);
    if(!force&&now()<e.retryAt)return Promise.reject(e.error??Error('무기 가격 조회 대기 중'));
    let timer;
    e.pending=Promise.race([
      Promise.resolve().then(()=>{
        if(typeof player.buildables==='function')return player.buildables(undefined,types);
        if(typeof player.actions==='function')return player.actions(undefined,types);
        throw Error('클라이언트에 무기 가격 조회 API가 없습니다');
      }),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('무기 가격 조회 시간 초과')),timeoutMs);}),
    ]).then(result=>{
      const rows=Array.isArray(result)?result:result?.buildableUnits;
      if(!Array.isArray(rows))throw Error('무기 가격 응답 형식을 확인할 수 없습니다');
      const values={};
      for(const type of types){
        const v=rows.find(row=>row.type===type)?.cost;
        if(!((typeof v==='bigint'&&v>=0n)||(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)))
          throw Error(type+' 가격 정보가 없거나 올바르지 않습니다');
        values[type]=BigInt(v);
      }
      e.values=values;e.at=now();e.error=null;return values;
    }).catch(error=>{e.error=error;e.retryAt=now()+1000;throw error;})
      .finally(()=>{clearTimeout(timer);e.pending=null;onUpdate();});
    return e.pending;
  }
  function read(game,player) {
    const e=entry(game,player);
    if(now()-e.at>=refreshMs&&!e.pending&&now()>=e.retryAt)refresh(game,player).catch(()=>{});
    if(e.error)throw Error('무기 가격 확인 실패: '+e.error.message);
    if(!e.values||now()-e.at>maxAgeMs)throw Error('게임에서 무기 가격을 조회 중입니다');
    return e.values;
  }
  return {read,refresh};
}
