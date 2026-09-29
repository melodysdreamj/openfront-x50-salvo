import {defenseSignature} from './adaptive.mjs';

// Compare structures at the SAME absolute tick. An upgrade completing naturally
// is predicted by the simulator, not a new upgrade. Flight positions and SAM
// cooldown activity from other battles deliberately do not restart planning.
export function planningStructureKey(s,at=s.tick) {
  const state={...s,inflight:[],sams:s.sams.map(u=>u.upgrade&&at>=u.upgrade.startTick+u.upgrade.duration?
    {...u,level:u.upgrade.targetLevel,upgrade:null}:u)};
  return JSON.stringify([s.game,s.me,s.tile,s.target,s.width,s.height,s.rules,
    s.atomCost.toString(),s.hydroCost.toString(),defenseSignature(state)]);
}

// Exact idle expiry of our own launch queues (one slot per tick). A new shot
// or any other queue mutation must still be validated; ordinary aging must not.
export function ownQueuesFollowClock(before,after) {
  if(after.tick<before.tick)return false;
  const units=new Map(after.silos.map(u=>[u.id,u]));
  return before.silos.every(u=>{
    const current=units.get(u.id);if(!current)return false;
    let next=before.tick+1,index=0;
    for(const t of u.queue) {
      next=Math.max(next,t+before.rules.siloCooldown);
      if(next>after.tick)break;
      index++;next++;
    }
    return JSON.stringify(u.queue.slice(index))===JSON.stringify(current.queue);
  });
}

// Preserve relative gaps and choose an absolute launch appointment in the
// future. The caller uses the original snapshot tick as base, never completion.
export function scheduledCandidate(plan,lead) {
  const shift=Math.max(0,lead-(plan.actions[0]?.tick??lead));
  return {...plan,actions:plan.actions.map(a=>({...a,tick:a.tick+shift}))};
}

// Ordinary movement, successful arrivals and expected atom interceptions are
// not reasons to throw out a computed candidate. A newly targeted hydrogen is.
export function newHydrogenThreat(before,after) {
  const safe=new Set((before.inflight??[]).filter(b=>b.committed&&b.type==='Hydrogen Bomb'&&!b.targeted).map(b=>b.id));
  return (after.inflight??[]).some(b=>b.committed&&b.type==='Hydrogen Bomb'&&b.targeted&&safe.has(b.id));
}
