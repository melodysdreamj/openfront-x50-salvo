// Shared rolling-window gate for the I dispatcher. Hydrogen also costs one
// request; counts are intents, not missiles. Return milliseconds until room.
export function strikeRateDelay(rate,now) {
  const delay=(entries,span,cap)=>{
    const active=entries.filter(t=>now-t<span).sort((a,b)=>a-b);
    return active.length<cap?0:Math.max(0,active[active.length-cap]+span-now);
  };
  return Math.max(delay(rate.secWindow,1000,rate.perSecond),
    delay(rate.minWindow,60000,rate.perMinute-5));
}
