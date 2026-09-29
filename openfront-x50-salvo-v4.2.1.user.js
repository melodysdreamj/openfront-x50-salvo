// ==UserScript==
// @name         OpenFront x50 Nuke + Structure Max (private/사설 로비용)
// @namespace    of-x50-salvo
// @version      4.2.1
// @description  사설·연습 로비 — 커서 공격 예측 / I: 추천 계획 실행 / Esc: 중단
// @author       local build
// @match        https://openfront.io/*
// @match        https://*.openfront.io/*
// @grant        none
// @run-at       document-start
// @license      AGPL-3.0-only
// ==/UserScript==

(function () {
  "use strict";
/**
 *  Precomputes regular curve step points along a cubic Bezier curve.
 */
class DistanceBasedBezierCurve {
    p0;
    p1;
    p2;
    p3;
    static SUB_SCALE = 256;
    cachedPoints = [];
    currentIndex = 0;
    pixelSpacingScaled = 1;
    accumulatedDistanceScaled = 0;
    constructor(p0, p1, p2, p3, distanceIncrement) {
        this.p0 = p0;
        this.p1 = p1;
        this.p2 = p2;
        this.p3 = p3;
        this.computeAllPoints(distanceIncrement);
    }
    /**
     * Statically compute the full length of a bezier curve without allocating any points.
     */
    static getLength(p0, p1, p2, p3) {
        const scale = 256;
        const p0x = Math.round(p0.x) * scale;
        const p0y = Math.round(p0.y) * scale;
        const p3x = Math.round(p3.x) * scale;
        const p3y = Math.round(p3.y) * scale;
        const st = { lastX: p0x, lastY: p0y, accumDist: 0 };
        DistanceBasedBezierCurve.sharedSubdivide(p0x, p0y, Math.round(p1.x) * scale, Math.round(p1.y) * scale, Math.round(p2.x) * scale, Math.round(p2.y) * scale, p3x, p3y, 0, st);
        const edx = p3x - st.lastX;
        const edy = p3y - st.lastY;
        st.accumDist += Math.floor(Math.sqrt(edx * edx + edy * edy));
        return st.accumDist / scale;
    }
    getAllPoints() {
        return this.cachedPoints;
    }
    /**
     * Move forward along the curve by the given distance/speed step.
     * Returns the next cached point, or null if at the end.
     */
    increment(distance = 1) {
        this.accumulatedDistanceScaled += Math.max(1, Math.round(distance * DistanceBasedBezierCurve.SUB_SCALE));
        while (this.currentIndex < this.cachedPoints.length - 1 &&
            this.accumulatedDistanceScaled >= this.pixelSpacingScaled) {
            this.currentIndex++;
            this.accumulatedDistanceScaled -= this.pixelSpacingScaled;
        }
        if (this.currentIndex >= this.cachedPoints.length - 1) {
            return null;
        }
        return this.cachedPoints[this.currentIndex];
    }
    getCurrentIndex() {
        return this.currentIndex;
    }
    /** Control points and progress, for game snapshots. */
    getState() {
        return {
            points: [{ ...this.p0 }, { ...this.p1 }, { ...this.p2 }, { ...this.p3 }],
            currentIndex: this.currentIndex,
            accumulatedDistanceScaled: this.accumulatedDistanceScaled,
        };
    }
    /** Restores progress onto a curve rebuilt from the same control points. */
    setProgress(currentIndex, accumulatedDistanceScaled) {
        this.currentIndex = currentIndex;
        this.accumulatedDistanceScaled = accumulatedDistanceScaled;
    }
    /**
     * Precompute curve points using Single-Pass In-Order Recursive De Casteljau Subdivision.
     * Uses IEEE 754 exact-rounded Math.floor(Math.sqrt(...)) for deterministic integer distance accumulation.
     */
    computeAllPoints(pixelSpacing) {
        this.cachedPoints = [];
        this.currentIndex = 0;
        this.accumulatedDistanceScaled = 0;
        this.pixelSpacingScaled = Math.max(DistanceBasedBezierCurve.SUB_SCALE, Math.round(pixelSpacing * DistanceBasedBezierCurve.SUB_SCALE));
        const scale = DistanceBasedBezierCurve.SUB_SCALE; // 8-bit fixed-point precision
        const stepThreshold = this.pixelSpacingScaled;
        const p0x = Math.round(this.p0.x) * scale;
        const p0y = Math.round(this.p0.y) * scale;
        const p3x = Math.round(this.p3.x) * scale;
        const p3y = Math.round(this.p3.y) * scale;
        const st = {
            lastX: p0x,
            lastY: p0y,
            accumDist: 0,
            stepThreshold,
            cachedPoints: this.cachedPoints,
        };
        this.cachedPoints.push({
            x: (p0x + 128) >> 8,
            y: (p0y + 128) >> 8,
        });
        // Single-pass recursive midpoint subdivision and inline spatial filtering
        DistanceBasedBezierCurve.sharedSubdivide(p0x, p0y, Math.round(this.p1.x) * scale, Math.round(this.p1.y) * scale, Math.round(this.p2.x) * scale, Math.round(this.p2.y) * scale, p3x, p3y, 0, st);
        // Ensure endpoint is included if not already P3
        const lastPt = {
            x: (p3x + 128) >> 8,
            y: (p3y + 128) >> 8,
        };
        const lastIndex = this.cachedPoints.length - 1;
        if (lastIndex >= 0) {
            const endCached = this.cachedPoints[lastIndex];
            if (endCached.x !== lastPt.x || endCached.y !== lastPt.y) {
                this.cachedPoints.push(lastPt);
            }
        }
        else {
            this.cachedPoints.push(lastPt);
        }
    }
    static sharedSubdivide(ax, ay, bx, by, cx, cy, dx, dy, depth, st) {
        const dist = Math.abs(bx - ax) +
            Math.abs(by - ay) +
            Math.abs(cx - bx) +
            Math.abs(cy - by) +
            Math.abs(dx - cx) +
            Math.abs(dy - cy);
        if (dist <= 256 || depth >= 10) {
            const edx = ax - st.lastX;
            const edy = ay - st.lastY;
            st.accumDist += Math.floor(Math.sqrt(edx * edx + edy * edy));
            st.lastX = ax;
            st.lastY = ay;
            if (st.stepThreshold !== undefined && st.cachedPoints !== undefined) {
                while (st.accumDist >= st.stepThreshold) {
                    st.cachedPoints.push({
                        x: (ax + 128) >> 8,
                        y: (ay + 128) >> 8,
                    });
                    st.accumDist -= st.stepThreshold;
                }
            }
            return;
        }
        // De Casteljau midpoints via bitwise right-shift >> 1
        const m01_x = (ax + bx) >> 1;
        const m01_y = (ay + by) >> 1;
        const m12_x = (bx + cx) >> 1;
        const m12_y = (by + cy) >> 1;
        const m23_x = (cx + dx) >> 1;
        const m23_y = (cy + dy) >> 1;
        const m012_x = (m01_x + m12_x) >> 1;
        const m012_y = (m01_y + m12_y) >> 1;
        const m123_x = (m12_x + m23_x) >> 1;
        const m123_y = (m12_y + m23_y) >> 1;
        const mx = (m012_x + m123_x) >> 1;
        const my = (m012_y + m123_y) >> 1;
        // IN-ORDER RECURSION: Left segment first, then Right segment
        DistanceBasedBezierCurve.sharedSubdivide(ax, ay, m01_x, m01_y, m012_x, m012_y, mx, my, depth + 1, st);
        DistanceBasedBezierCurve.sharedSubdivide(mx, my, m123_x, m123_y, m23_x, m23_y, dx, dy, depth + 1, st);
    }
}

// Extracted from OpenFrontIO 5dc09dbd2dde5105d8b403d7b5ddf8d503e04ec2.
// Copyright OpenFront and Contributors. AGPL-3.0-only. See THIRD_PARTY.md.
// Only imports were replaced with the simulation adapter below; targeting is unchanged.
const UnitType = { AtomBomb: "Atom Bomb", HydrogenBomb: "Hydrogen Bomb", MIRVWarhead: "MIRV Warhead" };
const GameType = { Singleplayer: "Singleplayer" };
const isUnit = (u) => !!u && typeof u.targetedBySAM === "function";
/**
 * Smart SAM targeting system preshoting nukes so its range is strictly enforced
 */
class SAMTargetingSystem {
    mg;
    sam;
    // Cached interception states indexed by nuke ID to avoid per-tick recomputation.
    precomputedNukes = new Map();
    missileSpeed;
    constructor(mg, sam) {
        this.mg = mg;
        this.sam = sam;
        this.missileSpeed = this.mg.config().defaultSamMissileSpeed();
        this.isTargetableNearbyUnit = this.isTargetableNearbyUnit.bind(this);
    }
    /** Cached interceptions in insertion order, for game snapshots. */
    getState() {
        return [...this.precomputedNukes].map(([id, c]) => ({
            id,
            tick: c.tick,
            tile: c.tile,
            minDistSq: c.minDistSq,
            lastSeenTick: c.lastSeenTick,
        }));
    }
    setState(s) {
        for (const { id, tick, tile, minDistSq, lastSeenTick } of s) {
            this.precomputedNukes.set(id, { tick, tile, minDistSq, lastSeenTick });
        }
    }
    onLevelUp() {
        for (const [id, cached] of this.precomputedNukes) {
            if (cached.tick === -1) {
                this.precomputedNukes.delete(id);
            }
        }
    }
    updateUnreachableNukes(currentTick) {
        for (const [id, cached] of this.precomputedNukes) {
            if (cached.lastSeenTick !== currentTick) {
                this.precomputedNukes.delete(id);
            }
        }
    }
    tickToReach(currentTile, tile) {
        return Math.ceil(this.mg.manhattanDist(currentTile, tile) / this.missileSpeed);
    }
    checkDetonationInterception(unit, samTile, ticks) {
        const trajectory = unit.trajectory();
        const maxIdx = trajectory.length - 2;
        const finalTile = trajectory[trajectory.length - 1];
        if (!finalTile?.targetable)
            return undefined;
        const curIdx = unit.trajectoryIndex();
        const waitTicks = unit.nukeState().waitTicks ?? 0;
        const expTicks = trajectory.length - 1 - curIdx + waitTicks;
        const range = this.mg.config().dynamicSamRange(this.sam, ticks + expTicks);
        if (this.mg.euclideanDistSquared(samTile, finalTile.tile) > range * range) {
            return undefined;
        }
        const flightTile = trajectory[maxIdx];
        if (!flightTile?.targetable)
            return undefined;
        const nukeTicks = maxIdx - curIdx + waitTicks;
        const samTicks = this.tickToReach(samTile, flightTile.tile);
        const tickBeforeShooting = nukeTicks - samTicks;
        return tickBeforeShooting >= 0
            ? { tick: tickBeforeShooting, tile: flightTile.tile }
            : undefined;
    }
    computeInterceptionTile(unit, samTile, ticks) {
        const trajectory = unit.trajectory();
        const curIdx = unit.trajectoryIndex();
        const waitTicks = unit.nukeState().waitTicks ?? 0;
        const maxIdx = trajectory.length - 2;
        const maxSamRangeSq = this.mg.config().maxSamRange() ** 2;
        let minDistSq = Infinity;
        let closestTile = samTile;
        let incSteps = 0;
        let lastDistSq = -1;
        for (let i = curIdx; i <= maxIdx; i++) {
            const tile = trajectory[i];
            const distSq = this.mg.euclideanDistSquared(samTile, tile.tile);
            if (distSq < minDistSq) {
                minDistSq = distSq;
                closestTile = tile.tile;
            }
            incSteps = lastDistSq !== -1 && distSq > lastDistSq ? incSteps + 1 : 0;
            lastDistSq = distSq;
            const nukeTicks = i - curIdx + waitTicks;
            const samTicks = this.tickToReach(samTile, tile.tile);
            const allowed = this.mg
                .config()
                .dynamicSamRange(this.sam, ticks + nukeTicks);
            if (tile.targetable &&
                distSq <= allowed * allowed &&
                nukeTicks >= samTicks) {
                return {
                    tick: nukeTicks - samTicks,
                    tile: tile.tile,
                    minDistSq,
                    lastSeenTick: ticks,
                };
            }
            if (incSteps > 3 && distSq > maxSamRangeSq)
                break;
        }
        const det = this.checkDetonationInterception(unit, samTile, ticks);
        if (det) {
            return { tick: det.tick, tile: det.tile, minDistSq, lastSeenTick: ticks };
        }
        return {
            tick: minDistSq > maxSamRangeSq ? -2 : -1,
            tile: closestTile,
            minDistSq,
            lastSeenTick: ticks,
        };
    }
    isTargetableNearbyUnit = ({ unit, }) => {
        return this.isValidNukeTarget(unit);
    };
    isValidNukeTarget(unit) {
        if (!isUnit(unit) ||
            unit.targetedBySAM() ||
            unit.owner() === this.sam.owner()) {
            return false;
        }
        const samOwner = this.sam.owner();
        const nukeOwner = unit.owner();
        if (samOwner.isFriendly(nukeOwner)) {
            // Aftergame fun (nuking teammates once the game is over) is disabled in singleplayer.
            const gameOver = this.mg.getWinner() !== null &&
                this.mg.config().gameConfig().gameType !== GameType.Singleplayer;
            return gameOver && samOwner.isOnSameTeam(nukeOwner);
        }
        return true;
    }
    computeTargetScore(target) {
        const samTile = this.sam.tile();
        const unit = target.unit;
        const trajectory = unit.trajectory();
        const currentIndex = unit.trajectoryIndex();
        const timeToExplode = Math.max(1, trajectory.length - currentIndex);
        const targetTile = unit.targetTile() ??
            (trajectory.length > 0
                ? trajectory[trajectory.length - 1].tile
                : samTile);
        const distToSilo = this.mg.manhattanDist(samTile, targetTile);
        // Hydro unit type bonus
        // 70,000 offset balances the distance bonus between Hydro at 100 and Atom at 30
        const typeBonus = unit.type() === UnitType.HydrogenBomb ? 70_001 : 0;
        // Distance bonus: Closer to silo higher score (-1,000 pts per unit distance)
        // due to manhattanDist, distToSilo can exceed 150 diagonally, 200000 starting point.
        const distanceBonus = Math.max(0, 200_000 - distToSilo * 1000);
        // Time based score: +100 pts per tick earlier
        // Since all nukes are already guaranteed to need a SAM response at this tick,
        // this is only a very minor tiebreaker.
        const urgencyBonus = Math.max(0, 10_000 - timeToExplode * 100);
        return typeBonus + distanceBonus + urgencyBonus;
    }
    sortTargets(targets) {
        if (targets.length <= 1)
            return targets;
        for (const target of targets) {
            target.score = this.computeTargetScore(target);
        }
        // Sort by score, js' Timsort guarantees O(n log n)
        return targets.sort((a, b) => b.score - a.score);
    }
    getValidTargets(ticks) {
        const samTile = this.sam.tile();
        const detectionRange = this.mg.config().maxSamRange() * 4;
        const nukes = this.mg.nearbyUnits(samTile, detectionRange, [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRVWarhead], this.isTargetableNearbyUnit);
        const targets = [];
        for (const nuke of nukes) {
            const id = nuke.unit.id();
            const cached = this.precomputedNukes.get(id);
            if (cached !== undefined) {
                cached.lastSeenTick = ticks;
                if (cached.tick === -2 || cached.tick === -1)
                    continue;
                if (cached.tick === ticks || cached.tick === ticks + 1) {
                    targets.push({ tile: cached.tile, unit: nuke.unit });
                    this.precomputedNukes.delete(id);
                    continue;
                }
                if (cached.tick > ticks)
                    continue;
                this.precomputedNukes.delete(id);
            }
            const res = this.computeInterceptionTile(nuke.unit, samTile, ticks);
            if (res.tick >= 0 && res.tick <= 1) {
                targets.push({ unit: nuke.unit, tile: res.tile });
            }
            else {
                this.precomputedNukes.set(id, {
                    tick: res.tick >= 0 ? res.tick + ticks : res.tick,
                    tile: res.tile,
                    minDistSq: res.minDistSq,
                    lastSeenTick: ticks,
                });
            }
        }
        this.updateUnreachableNukes(ticks);
        return this.sortTargets(targets);
    }
}

// The physics and target selector are pinned in src/vendor. No browser objects here.


const ATOM = 'Atom Bomb', HYDRO = 'Hydrogen Bomb';
const manhattan = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const dist2 = (a,b) => (a.x-b.x)**2+(a.y-b.y)**2;
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

function trajectory(from, to, height, up, speed, targetRange) {
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

function rangeAt(sam,tick,rules) {
  const range = level => rules.maxSamRange-480/(level+5);
  const u=sam.upgrade;
  if (!u) return range(sam.level);
  const elapsed=tick-u.startTick;
  return elapsed>=u.duration ? range(u.targetLevel) : u.startRange+(range(u.targetLevel)-u.startRange)*elapsed/u.duration;
}

function validateSnapshot(s) {
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
function makePlan(atoms, hydroAfter=null, gap=0, up=true, initial=3) {
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
function simulate(s,plan,opt={}) {
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

function assess(s,plan,options={}) {
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

function search(s, options={}) {
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
        }
        if(!result.mixed&&options.allowHydroGoal!==false&&(committedHydro||s.allowed?.mixed!==false)&&(atoms===0||s.allowed?.atomic!==false)) {
          if(atoms===0&&(fraction!==1||gap!==0))continue;
          if(committedHydro&&fraction===1&&gap===0) {
            const rescue=run({...makePlan(atoms,null,0,up,initial),goal:'hydro'});
            if(rescue)result.mixed=rescue;
          }
          if(!result.mixed&&options.allowNewHydro!==false&&s.allowed?.mixed!==false) {
            const p=run({...makePlan(atoms,Math.floor(atoms*fraction),gap,up,initial),goal:'hydro'});
            if(p) result.mixed=p;
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



// The conservative planner never credits unrelated flights. Keep them in the
// live observer, but do not repeatedly clone their full paths into each Worker.
function workerSnapshot(s) {
  return {...s,observedFlights:s.observedFlights??(s.inflight??[]).length,
    inflight:(s.inflight??[]).filter(b=>s.includeCommitted&&b.committed&&b.owner===s.me&&!b.targeted)};
}

// Decode authoritative motion-plan time instead of the nukeState index, which
// may be stale when the client derives motion without per-tick unit updates.
function flightProgress(path,position,nukeState,motion,tick) {
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

function remainingPlan(plan,index,baseTick,snapshotTick,leadTicks=6) {
  const actions=plan.actions.slice(index).map(a=>({...a,tick:baseTick+a.tick-snapshotTick}));
  const shift=actions.length?Math.max(0,leadTicks-actions[0].tick):0;
  for(const a of actions)a.tick+=shift;
  return {...plan,actions,atoms:actions.filter(a=>a.type===ATOM).reduce((n,a)=>n+a.amount,0),
    hydros:actions.filter(a=>a.type===HYDRO).reduce((n,a)=>n+a.amount,0)};
}

// Paths are immutable within a snapshot/observer. Retain only weak references;
// one suffix table replaces path slicing and four scans on every game tick.
const suffixBoundsCache=new WeakMap();
function suffixBounds(path,index) {
  let bounds=suffixBoundsCache.get(path);
  if(!bounds) {
    bounds=new Float64Array(path.length*4);
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(let i=path.length-1;i>=0;i--) {
      const p=path[i].tile;
      minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
      bounds.set([minX,maxX,minY,maxY],i*4);
    }
    suffixBoundsCache.set(path,bounds);
  }
  return bounds.subarray(index*4,index*4+4);
}

// Cheap geometric broad phase for the observer. Every potentially relevant SAM
// stays in the simulator. Changes well outside every possible path need not
// interrupt a precisely timed volley.
function defenseSignature(s) {
  const r=s.rules.maxSamRange, boxes=[];
  for(const silo of s.silos) {
    const h=Math.max(Math.hypot(s.target.x-silo.x,s.target.y-silo.y)/3,50);
    boxes.push([Math.min(silo.x,s.target.x)-r,Math.max(silo.x,s.target.x)+r,
      Math.min(silo.y,s.target.y)-h-r,Math.max(silo.y,s.target.y)+h+r]);
  }
  for(const b of s.inflight??[])if(b.committed&&b.path?.length) {
    if(b.index<b.path.length) {
      const [x0,x1,y0,y1]=suffixBounds(b.path,b.index);
      boxes.push([x0-r,x1+r,y0-r,y1+r]);
    }
  }
  return JSON.stringify([
    s.silos.map(u=>[u.id,u.x,u.y,u.level,u.building,u.owner]),s.allowed,
    s.sams.filter(u=>boxes.some(([x0,x1,y0,y1])=>u.x>=x0&&u.x<=x1&&u.y>=y0&&u.y<=y1))
      .map(u=>[u.id,u.x,u.y,u.level,u.building,u.owner,u.upgrade])]);
}

function adapt(s,request,options={}) {
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
function upgradeAdvice(s,options={}) {
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

const PLANNER_WORKER_SOURCE = "/**\n *  Precomputes regular curve step points along a cubic Bezier curve.\n */\nclass DistanceBasedBezierCurve {\n    p0;\n    p1;\n    p2;\n    p3;\n    static SUB_SCALE = 256;\n    cachedPoints = [];\n    currentIndex = 0;\n    pixelSpacingScaled = 1;\n    accumulatedDistanceScaled = 0;\n    constructor(p0, p1, p2, p3, distanceIncrement) {\n        this.p0 = p0;\n        this.p1 = p1;\n        this.p2 = p2;\n        this.p3 = p3;\n        this.computeAllPoints(distanceIncrement);\n    }\n    /**\n     * Statically compute the full length of a bezier curve without allocating any points.\n     */\n    static getLength(p0, p1, p2, p3) {\n        const scale = 256;\n        const p0x = Math.round(p0.x) * scale;\n        const p0y = Math.round(p0.y) * scale;\n        const p3x = Math.round(p3.x) * scale;\n        const p3y = Math.round(p3.y) * scale;\n        const st = { lastX: p0x, lastY: p0y, accumDist: 0 };\n        DistanceBasedBezierCurve.sharedSubdivide(p0x, p0y, Math.round(p1.x) * scale, Math.round(p1.y) * scale, Math.round(p2.x) * scale, Math.round(p2.y) * scale, p3x, p3y, 0, st);\n        const edx = p3x - st.lastX;\n        const edy = p3y - st.lastY;\n        st.accumDist += Math.floor(Math.sqrt(edx * edx + edy * edy));\n        return st.accumDist / scale;\n    }\n    getAllPoints() {\n        return this.cachedPoints;\n    }\n    /**\n     * Move forward along the curve by the given distance/speed step.\n     * Returns the next cached point, or null if at the end.\n     */\n    increment(distance = 1) {\n        this.accumulatedDistanceScaled += Math.max(1, Math.round(distance * DistanceBasedBezierCurve.SUB_SCALE));\n        while (this.currentIndex < this.cachedPoints.length - 1 &&\n            this.accumulatedDistanceScaled >= this.pixelSpacingScaled) {\n            this.currentIndex++;\n            this.accumulatedDistanceScaled -= this.pixelSpacingScaled;\n        }\n        if (this.currentIndex >= this.cachedPoints.length - 1) {\n            return null;\n        }\n        return this.cachedPoints[this.currentIndex];\n    }\n    getCurrentIndex() {\n        return this.currentIndex;\n    }\n    /** Control points and progress, for game snapshots. */\n    getState() {\n        return {\n            points: [{ ...this.p0 }, { ...this.p1 }, { ...this.p2 }, { ...this.p3 }],\n            currentIndex: this.currentIndex,\n            accumulatedDistanceScaled: this.accumulatedDistanceScaled,\n        };\n    }\n    /** Restores progress onto a curve rebuilt from the same control points. */\n    setProgress(currentIndex, accumulatedDistanceScaled) {\n        this.currentIndex = currentIndex;\n        this.accumulatedDistanceScaled = accumulatedDistanceScaled;\n    }\n    /**\n     * Precompute curve points using Single-Pass In-Order Recursive De Casteljau Subdivision.\n     * Uses IEEE 754 exact-rounded Math.floor(Math.sqrt(...)) for deterministic integer distance accumulation.\n     */\n    computeAllPoints(pixelSpacing) {\n        this.cachedPoints = [];\n        this.currentIndex = 0;\n        this.accumulatedDistanceScaled = 0;\n        this.pixelSpacingScaled = Math.max(DistanceBasedBezierCurve.SUB_SCALE, Math.round(pixelSpacing * DistanceBasedBezierCurve.SUB_SCALE));\n        const scale = DistanceBasedBezierCurve.SUB_SCALE; // 8-bit fixed-point precision\n        const stepThreshold = this.pixelSpacingScaled;\n        const p0x = Math.round(this.p0.x) * scale;\n        const p0y = Math.round(this.p0.y) * scale;\n        const p3x = Math.round(this.p3.x) * scale;\n        const p3y = Math.round(this.p3.y) * scale;\n        const st = {\n            lastX: p0x,\n            lastY: p0y,\n            accumDist: 0,\n            stepThreshold,\n            cachedPoints: this.cachedPoints,\n        };\n        this.cachedPoints.push({\n            x: (p0x + 128) >> 8,\n            y: (p0y + 128) >> 8,\n        });\n        // Single-pass recursive midpoint subdivision and inline spatial filtering\n        DistanceBasedBezierCurve.sharedSubdivide(p0x, p0y, Math.round(this.p1.x) * scale, Math.round(this.p1.y) * scale, Math.round(this.p2.x) * scale, Math.round(this.p2.y) * scale, p3x, p3y, 0, st);\n        // Ensure endpoint is included if not already P3\n        const lastPt = {\n            x: (p3x + 128) >> 8,\n            y: (p3y + 128) >> 8,\n        };\n        const lastIndex = this.cachedPoints.length - 1;\n        if (lastIndex >= 0) {\n            const endCached = this.cachedPoints[lastIndex];\n            if (endCached.x !== lastPt.x || endCached.y !== lastPt.y) {\n                this.cachedPoints.push(lastPt);\n            }\n        }\n        else {\n            this.cachedPoints.push(lastPt);\n        }\n    }\n    static sharedSubdivide(ax, ay, bx, by, cx, cy, dx, dy, depth, st) {\n        const dist = Math.abs(bx - ax) +\n            Math.abs(by - ay) +\n            Math.abs(cx - bx) +\n            Math.abs(cy - by) +\n            Math.abs(dx - cx) +\n            Math.abs(dy - cy);\n        if (dist <= 256 || depth >= 10) {\n            const edx = ax - st.lastX;\n            const edy = ay - st.lastY;\n            st.accumDist += Math.floor(Math.sqrt(edx * edx + edy * edy));\n            st.lastX = ax;\n            st.lastY = ay;\n            if (st.stepThreshold !== undefined && st.cachedPoints !== undefined) {\n                while (st.accumDist >= st.stepThreshold) {\n                    st.cachedPoints.push({\n                        x: (ax + 128) >> 8,\n                        y: (ay + 128) >> 8,\n                    });\n                    st.accumDist -= st.stepThreshold;\n                }\n            }\n            return;\n        }\n        // De Casteljau midpoints via bitwise right-shift >> 1\n        const m01_x = (ax + bx) >> 1;\n        const m01_y = (ay + by) >> 1;\n        const m12_x = (bx + cx) >> 1;\n        const m12_y = (by + cy) >> 1;\n        const m23_x = (cx + dx) >> 1;\n        const m23_y = (cy + dy) >> 1;\n        const m012_x = (m01_x + m12_x) >> 1;\n        const m012_y = (m01_y + m12_y) >> 1;\n        const m123_x = (m12_x + m23_x) >> 1;\n        const m123_y = (m12_y + m23_y) >> 1;\n        const mx = (m012_x + m123_x) >> 1;\n        const my = (m012_y + m123_y) >> 1;\n        // IN-ORDER RECURSION: Left segment first, then Right segment\n        DistanceBasedBezierCurve.sharedSubdivide(ax, ay, m01_x, m01_y, m012_x, m012_y, mx, my, depth + 1, st);\n        DistanceBasedBezierCurve.sharedSubdivide(mx, my, m123_x, m123_y, m23_x, m23_y, dx, dy, depth + 1, st);\n    }\n}\n\n// Extracted from OpenFrontIO 5dc09dbd2dde5105d8b403d7b5ddf8d503e04ec2.\n// Copyright OpenFront and Contributors. AGPL-3.0-only. See THIRD_PARTY.md.\n// Only imports were replaced with the simulation adapter below; targeting is unchanged.\nconst UnitType = { AtomBomb: \"Atom Bomb\", HydrogenBomb: \"Hydrogen Bomb\", MIRVWarhead: \"MIRV Warhead\" };\nconst GameType = { Singleplayer: \"Singleplayer\" };\nconst isUnit = (u) => !!u && typeof u.targetedBySAM === \"function\";\n/**\n * Smart SAM targeting system preshoting nukes so its range is strictly enforced\n */\nclass SAMTargetingSystem {\n    mg;\n    sam;\n    // Cached interception states indexed by nuke ID to avoid per-tick recomputation.\n    precomputedNukes = new Map();\n    missileSpeed;\n    constructor(mg, sam) {\n        this.mg = mg;\n        this.sam = sam;\n        this.missileSpeed = this.mg.config().defaultSamMissileSpeed();\n        this.isTargetableNearbyUnit = this.isTargetableNearbyUnit.bind(this);\n    }\n    /** Cached interceptions in insertion order, for game snapshots. */\n    getState() {\n        return [...this.precomputedNukes].map(([id, c]) => ({\n            id,\n            tick: c.tick,\n            tile: c.tile,\n            minDistSq: c.minDistSq,\n            lastSeenTick: c.lastSeenTick,\n        }));\n    }\n    setState(s) {\n        for (const { id, tick, tile, minDistSq, lastSeenTick } of s) {\n            this.precomputedNukes.set(id, { tick, tile, minDistSq, lastSeenTick });\n        }\n    }\n    onLevelUp() {\n        for (const [id, cached] of this.precomputedNukes) {\n            if (cached.tick === -1) {\n                this.precomputedNukes.delete(id);\n            }\n        }\n    }\n    updateUnreachableNukes(currentTick) {\n        for (const [id, cached] of this.precomputedNukes) {\n            if (cached.lastSeenTick !== currentTick) {\n                this.precomputedNukes.delete(id);\n            }\n        }\n    }\n    tickToReach(currentTile, tile) {\n        return Math.ceil(this.mg.manhattanDist(currentTile, tile) / this.missileSpeed);\n    }\n    checkDetonationInterception(unit, samTile, ticks) {\n        const trajectory = unit.trajectory();\n        const maxIdx = trajectory.length - 2;\n        const finalTile = trajectory[trajectory.length - 1];\n        if (!finalTile?.targetable)\n            return undefined;\n        const curIdx = unit.trajectoryIndex();\n        const waitTicks = unit.nukeState().waitTicks ?? 0;\n        const expTicks = trajectory.length - 1 - curIdx + waitTicks;\n        const range = this.mg.config().dynamicSamRange(this.sam, ticks + expTicks);\n        if (this.mg.euclideanDistSquared(samTile, finalTile.tile) > range * range) {\n            return undefined;\n        }\n        const flightTile = trajectory[maxIdx];\n        if (!flightTile?.targetable)\n            return undefined;\n        const nukeTicks = maxIdx - curIdx + waitTicks;\n        const samTicks = this.tickToReach(samTile, flightTile.tile);\n        const tickBeforeShooting = nukeTicks - samTicks;\n        return tickBeforeShooting >= 0\n            ? { tick: tickBeforeShooting, tile: flightTile.tile }\n            : undefined;\n    }\n    computeInterceptionTile(unit, samTile, ticks) {\n        const trajectory = unit.trajectory();\n        const curIdx = unit.trajectoryIndex();\n        const waitTicks = unit.nukeState().waitTicks ?? 0;\n        const maxIdx = trajectory.length - 2;\n        const maxSamRangeSq = this.mg.config().maxSamRange() ** 2;\n        let minDistSq = Infinity;\n        let closestTile = samTile;\n        let incSteps = 0;\n        let lastDistSq = -1;\n        for (let i = curIdx; i <= maxIdx; i++) {\n            const tile = trajectory[i];\n            const distSq = this.mg.euclideanDistSquared(samTile, tile.tile);\n            if (distSq < minDistSq) {\n                minDistSq = distSq;\n                closestTile = tile.tile;\n            }\n            incSteps = lastDistSq !== -1 && distSq > lastDistSq ? incSteps + 1 : 0;\n            lastDistSq = distSq;\n            const nukeTicks = i - curIdx + waitTicks;\n            const samTicks = this.tickToReach(samTile, tile.tile);\n            const allowed = this.mg\n                .config()\n                .dynamicSamRange(this.sam, ticks + nukeTicks);\n            if (tile.targetable &&\n                distSq <= allowed * allowed &&\n                nukeTicks >= samTicks) {\n                return {\n                    tick: nukeTicks - samTicks,\n                    tile: tile.tile,\n                    minDistSq,\n                    lastSeenTick: ticks,\n                };\n            }\n            if (incSteps > 3 && distSq > maxSamRangeSq)\n                break;\n        }\n        const det = this.checkDetonationInterception(unit, samTile, ticks);\n        if (det) {\n            return { tick: det.tick, tile: det.tile, minDistSq, lastSeenTick: ticks };\n        }\n        return {\n            tick: minDistSq > maxSamRangeSq ? -2 : -1,\n            tile: closestTile,\n            minDistSq,\n            lastSeenTick: ticks,\n        };\n    }\n    isTargetableNearbyUnit = ({ unit, }) => {\n        return this.isValidNukeTarget(unit);\n    };\n    isValidNukeTarget(unit) {\n        if (!isUnit(unit) ||\n            unit.targetedBySAM() ||\n            unit.owner() === this.sam.owner()) {\n            return false;\n        }\n        const samOwner = this.sam.owner();\n        const nukeOwner = unit.owner();\n        if (samOwner.isFriendly(nukeOwner)) {\n            // Aftergame fun (nuking teammates once the game is over) is disabled in singleplayer.\n            const gameOver = this.mg.getWinner() !== null &&\n                this.mg.config().gameConfig().gameType !== GameType.Singleplayer;\n            return gameOver && samOwner.isOnSameTeam(nukeOwner);\n        }\n        return true;\n    }\n    computeTargetScore(target) {\n        const samTile = this.sam.tile();\n        const unit = target.unit;\n        const trajectory = unit.trajectory();\n        const currentIndex = unit.trajectoryIndex();\n        const timeToExplode = Math.max(1, trajectory.length - currentIndex);\n        const targetTile = unit.targetTile() ??\n            (trajectory.length > 0\n                ? trajectory[trajectory.length - 1].tile\n                : samTile);\n        const distToSilo = this.mg.manhattanDist(samTile, targetTile);\n        // Hydro unit type bonus\n        // 70,000 offset balances the distance bonus between Hydro at 100 and Atom at 30\n        const typeBonus = unit.type() === UnitType.HydrogenBomb ? 70_001 : 0;\n        // Distance bonus: Closer to silo higher score (-1,000 pts per unit distance)\n        // due to manhattanDist, distToSilo can exceed 150 diagonally, 200000 starting point.\n        const distanceBonus = Math.max(0, 200_000 - distToSilo * 1000);\n        // Time based score: +100 pts per tick earlier\n        // Since all nukes are already guaranteed to need a SAM response at this tick,\n        // this is only a very minor tiebreaker.\n        const urgencyBonus = Math.max(0, 10_000 - timeToExplode * 100);\n        return typeBonus + distanceBonus + urgencyBonus;\n    }\n    sortTargets(targets) {\n        if (targets.length <= 1)\n            return targets;\n        for (const target of targets) {\n            target.score = this.computeTargetScore(target);\n        }\n        // Sort by score, js' Timsort guarantees O(n log n)\n        return targets.sort((a, b) => b.score - a.score);\n    }\n    getValidTargets(ticks) {\n        const samTile = this.sam.tile();\n        const detectionRange = this.mg.config().maxSamRange() * 4;\n        const nukes = this.mg.nearbyUnits(samTile, detectionRange, [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRVWarhead], this.isTargetableNearbyUnit);\n        const targets = [];\n        for (const nuke of nukes) {\n            const id = nuke.unit.id();\n            const cached = this.precomputedNukes.get(id);\n            if (cached !== undefined) {\n                cached.lastSeenTick = ticks;\n                if (cached.tick === -2 || cached.tick === -1)\n                    continue;\n                if (cached.tick === ticks || cached.tick === ticks + 1) {\n                    targets.push({ tile: cached.tile, unit: nuke.unit });\n                    this.precomputedNukes.delete(id);\n                    continue;\n                }\n                if (cached.tick > ticks)\n                    continue;\n                this.precomputedNukes.delete(id);\n            }\n            const res = this.computeInterceptionTile(nuke.unit, samTile, ticks);\n            if (res.tick >= 0 && res.tick <= 1) {\n                targets.push({ unit: nuke.unit, tile: res.tile });\n            }\n            else {\n                this.precomputedNukes.set(id, {\n                    tick: res.tick >= 0 ? res.tick + ticks : res.tick,\n                    tile: res.tile,\n                    minDistSq: res.minDistSq,\n                    lastSeenTick: ticks,\n                });\n            }\n        }\n        this.updateUnreachableNukes(ticks);\n        return this.sortTargets(targets);\n    }\n}\n\n// The physics and target selector are pinned in src/vendor. No browser objects here.\n\n\nconst ATOM = 'Atom Bomb', HYDRO = 'Hydrogen Bomb';\nconst manhattan = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);\nconst dist2 = (a,b) => (a.x-b.x)**2+(a.y-b.y)**2;\nconst clamp = (n,a,b) => Math.max(a,Math.min(b,n));\n\nfunction trajectory(from, to, height, up, speed, targetRange) {\n  const dx=to.x-from.x, dy=to.y-from.y;\n  const h=Math.max(Math.hypot(dx,dy)/3,50)*(up?-1:1);\n  const curve=new DistanceBasedBezierCurve(from,\n    {x:from.x+dx/4,y:clamp(from.y+dy/4+h,0,height-1)},\n    {x:from.x+dx*3/4,y:clamp(from.y+dy*3/4+h,0,height-1)},to,speed);\n  return curve.getAllPoints().map(p => ({tile:p,\n    targetable:dist2(p,from)<targetRange**2 || dist2(p,to)<targetRange**2}));\n}\n\n// Geometry is independent of silo ID and weapon name; speed, map height and\n// targetability are part of the key. Reuse the exact same integer path in search.\nfunction cachedPath(cache,s,silo,up,speed) {\n  const key=[silo.x,silo.y,s.target.x,s.target.y,s.height,up,speed,s.rules.targetRange].join(':');\n  let path=cache.get(key);\n  if(!path) {path=trajectory(silo,s.target,s.height,up,speed,s.rules.targetRange);cache.set(key,path);}\n  return path;\n}\n\n// Exact broad phase. Rebuild once at the SAM phase, then reuse the sorted\n// neighbouring cells for SAMs in the same cell. Insertion order is significant\n// for score ties and the original selector's interception cache.\nfunction missileIndex(bombs,now,spawnFirst,cellSize) {\n  const cells=new Map(), neighbourhoods=new Map();\n  for(const b of bombs) {\n    if(b.done||b.targeted||!(b.spawn<now||spawnFirst))continue;\n    const tile=b.unit.tile(),x=Math.floor(tile.x/cellSize),y=Math.floor(tile.y/cellSize),key=x+':'+y;\n    let cell=cells.get(key);if(!cell)cells.set(key,cell=[]);\n    cell.push({b,tile});\n  }\n  return (tile,range,_types,predicate)=>{\n    const x=Math.floor(tile.x/cellSize),y=Math.floor(tile.y/cellSize),span=Math.ceil(range/cellSize),key=x+':'+y+':'+span;\n    let nearby=neighbourhoods.get(key);\n    if(!nearby) {\n      nearby=[];\n      for(let dx=-span;dx<=span;dx++)for(let dy=-span;dy<=span;dy++) {\n        const cell=cells.get((x+dx)+':'+(y+dy));if(cell)for(const item of cell)nearby.push(item);\n      }\n      nearby.sort((a,b)=>a.b.id-b.b.id);neighbourhoods.set(key,nearby);\n    }\n    const found=[],rangeSq=range*range;\n    for(const item of nearby) {\n      // Earlier SAMs in this very phase may already have assigned the missile.\n      if(item.b.targeted)continue;\n      const distance=dist2(item.tile,tile);\n      if(distance<=rangeSq) {\n        const candidate={unit:item.b.unit,distSquared:distance};\n        if(predicate(candidate))found.push(candidate);\n      }\n    }\n    return found;\n  };\n}\n\nfunction rangeAt(sam,tick,rules) {\n  const range = level => rules.maxSamRange-480/(level+5);\n  const u=sam.upgrade;\n  if (!u) return range(sam.level);\n  const elapsed=tick-u.startTick;\n  return elapsed>=u.duration ? range(u.targetLevel) : u.startRange+(range(u.targetLevel)-u.startRange)*elapsed/u.duration;\n}\n\nfunction validateSnapshot(s) {\n  if (!s || !Number.isInteger(s.tick) || !s.target || !s.rules) throw Error('게임 상태가 불완전합니다');\n  for (const k of ['tickMs','samCooldown','siloCooldown','atomSpeed','hydroSpeed','samSpeed','targetRange','maxSamRange'])\n    if (!(s.rules[k]>0 && Number.isFinite(s.rules[k]))) throw Error('게임 규칙을 읽을 수 없습니다: '+k);\n  if (!Array.isArray(s.silos)||!Array.isArray(s.sams)) throw Error('구조물 목록을 읽을 수 없습니다');\n  for (const u of [...s.silos,...s.sams]) {\n    if (!Number.isInteger(u.level)||u.level<1||!Number.isFinite(u.x)||!Number.isFinite(u.y)||!Array.isArray(u.queue)||u.queue.some(t=>!Number.isInteger(t)))\n      throw Error('구조물 레벨 또는 재장전 정보를 읽을 수 없습니다');\n    if(u.upgrade&&(!Number.isInteger(u.upgrade.startTick)||!Number.isFinite(u.upgrade.startRange)||\n      !Number.isInteger(u.upgrade.targetLevel)||u.upgrade.targetLevel<1||!(u.upgrade.duration>0)))\n      throw Error('SAM 업그레이드 진행 정보가 불완전합니다');\n  }\n  if (typeof s.gold!=='bigint'||typeof s.atomCost!=='bigint'||typeof s.hydroCost!=='bigint') throw Error('골드 또는 가격 정보를 읽을 수 없습니다');\n}\n\n// One intent every two ticks, <=50 atoms per intent. Sending more intents per\n// second does not remove the per-silo launch queue. Keep explicit timeline data.\nfunction makePlan(atoms, hydroAfter=null, gap=0, up=true, initial=3) {\n  const actions=[]; let left=atoms, sent=0, tick=initial, hydro=false;\n  while (left>0 || (hydroAfter!==null&&!hydro)) {\n    if (!hydro && hydroAfter!==null && sent>=hydroAfter) {\n      tick+=gap;\n      actions.push({tick,type:HYDRO,amount:1}); hydro=true; tick+=2;\n    } else {\n      const count=Math.min(50,left,hydroAfter!==null&&!hydro?hydroAfter-sent:left);\n      if (count<=0) break;\n      actions.push({tick,type:ATOM,amount:count}); sent+=count; left-=count; tick+=2;\n    }\n  }\n  return {actions,atoms,hydros:hydroAfter===null?0:1,up,hydroAfter,gap};\n}\n\nfunction actor(id) { return {smallID:()=>id,isFriendly:()=>false,isOnSameTeam:()=>false}; }\nfunction bombUnit(b) {\n  return {id:()=>b.id,tile:()=>b.path[Math.min(b.index,b.path.length-1)].tile,\n    type:()=>b.type,owner:()=>b.owner,targetedBySAM:()=>b.targeted,\n    targetTile:()=>b.target,trajectory:()=>b.path,trajectoryIndex:()=>b.index,\n    nukeState:()=>({waitTicks:Math.max(0,b.moveAt-b.now-(b.afterMove?1:0))})};\n}\n\n// An assigned interceptor counts as a kill immediately. We deliberately keep\n// defending SAMs alive after atom impacts: reported hits do not rely on blast\n// randomness, third-party damage, or favorable destruction of the launcher.\nfunction simulate(s,plan,opt={}) {\n  validateSnapshot(s);\n  const r=s.rules, start=s.tick, deadline=opt.deadline??Infinity;\n  const silos=s.silos.filter(u=>!u.building).map(u=>({...u,queue:[...u.queue]}));\n  silos.sort((a,b)=>manhattan(a,s.target)-manhattan(b,s.target)); // stable game order\n  const sams=s.sams.map(u=>({...u,queue:[...u.queue],interceptions:0}));\n  if (opt.reverse) sams.reverse();\n  const me=actor(s.me), defenders=actor(-1), bombs=[], cache=opt.pathCache??new Map();\n  const traces=[], launches=[], used=new Set(), participating=new Set(), byUnit=new Map();\n  let now=start, gold=s.gold, atomHits=s.confirmedAtomHits??0, hydroHits=s.confirmedHydroHits??0,\n    committedHydroHits=0,dropped=0,tubeShortage=0,goldShortage=0,lastArrival=0,nextId=1;\n  const config={defaultSamMissileSpeed:()=>r.samSpeed,maxSamRange:()=>r.maxSamRange,\n    dynamicSamRange:(sam,t)=>rangeAt(sam.data,t,r),gameConfig:()=>({gameType:'Singleplayer'})};\n  const game={config:()=>config,getWinner:()=>null,manhattanDist:manhattan,euclideanDistSquared:dist2,\n    nearbyUnits:null};\n  for (const sam of sams) {\n    sam.unit={data:sam,id:()=>sam.id,tile:()=>sam,level:()=>sam.level,owner:()=>defenders};\n    sam.selector=new SAMTargetingSystem(game,sam.unit);\n  }\n  // Only confirmed missiles belonging to this operation may be credited in\n  // adaptive mode. They are already paid for and must NOT consume a silo again.\n  for (const b of s.inflight??[]) {\n    if(opt.conservative&&!(s.includeCommitted&&b.committed&&b.owner===s.me))continue;\n    if (b.targeted || !b.path?.length) continue;\n    const shift=opt.flightShift??0;\n    const waiting=Math.max(0,(b.waitTicks||0)-shift);\n    const index=clamp(b.index+Math.max(0,shift-(b.waitTicks||0)),0,b.path.length-1);\n    const item={...b,id:nextId++,owner:me,index,ours:!!b.committed,committed:!!b.committed,\n      spawn:start-1,now:start,moveAt:start+waiting,done:false};\n    item.unit=bombUnit(item); bombs.push(item);byUnit.set(item.unit,item);\n  }\n  const phase=opt.delay??0;\n  const actions=plan.actions.map((a,i)=>({...a,at:start+a.tick+2+phase+(a.type===HYDRO?(opt.hydroDelay??0):0),order:i})).sort((a,b)=>a.at-b.at||a.order-b.order);\n  let ai=0;\n  const end=start+(opt.maxTicks??1200);\n  for (now=start;now<=end;now++) {\n    if ((now-start)%8===0 && performance.now()>deadline) throw Error('SEARCH_TIMEOUT');\n    // Silo reloads one slot per tick. SAM reloads every expired slot in a tick.\n    for (const silo of silos) if(silo.queue.length&&now-silo.queue[0]>=r.siloCooldown) {silo.queue.shift();silo.lastDep=undefined;}\n    while (ai<actions.length&&actions[ai].at<=now) {\n      const a=actions[ai++];\n      for(let n=0;n<a.amount;n++) {\n        const silo=silos.find(u=>u.queue.length<u.level);\n        const cost=a.type===HYDRO?s.hydroCost:s.atomCost;\n        if (!silo||gold<cost) { dropped++;if(!silo)tubeShortage++;if(gold<cost)goldShortage++;continue; }\n        gold-=cost; used.add(silo.id);\n        if(silo.lastDep===undefined) {\n          silo.lastDep=0;\n          for(const launchTick of silo.queue)silo.lastDep=Math.max(launchTick+1,silo.lastDep+1);\n        }\n        const lastDep=silo.lastDep;\n        const moveAt=now+Math.max(0,lastDep-now)+1;\n        silo.queue.push(now);silo.lastDep=Math.max(now+1,lastDep+1);\n        const path=cachedPath(cache,s,silo,plan.up,a.type===HYDRO?r.hydroSpeed:r.atomSpeed);\n        const b={id:nextId++,type:a.type,owner:me,path,index:0,spawn:now,now,moveAt,target:s.target,targeted:false,done:false,ours:true,silo:silo.id};\n        b.unit=bombUnit(b); bombs.push(b);byUnit.set(b.unit,b);\n        launches.push({action:a.order,silo:silo.id,type:a.type,spawn:now-start,depart:moveAt-start});\n      }\n    }\n    for(const b of bombs) {b.now=now;b.afterMove=false;}\n    const move=()=>{\n      for(const b of bombs) if(!b.done&&now>=b.moveAt) {\n        b.index++;\n        if(b.index>=b.path.length-1) {\n          b.index=b.path.length-1; b.done=true;\n          if(b.ours&&!b.targeted) {\n            if(b.type===HYDRO) {hydroHits++;if(b.committed)committedHydroHits++;} else atomHits++;\n            lastArrival=now-start;\n          }\n        }\n      }\n      for(const b of bombs)b.afterMove=true;\n    };\n    if(opt.moveFirst) move();\n    game.nearbyUnits=missileIndex(bombs,now,opt.spawnFirst,r.maxSamRange*4);\n    for(const sam of sams) {\n      while(sam.queue.length&&now-sam.queue[0]>=r.samCooldown) sam.queue.shift();\n      // Treat construction as completed for conservative planning. This avoids\n      // promising a hit through a SAM that finishes during the flight.\n      if(sam.queue.length>=sam.level) continue;\n      for(const target of sam.selector.getValidTargets(now)) {\n        if(sam.queue.length>=sam.level) break;\n        const b=byUnit.get(target.unit);\n        if(!b||b.done||b.targeted) continue;\n        b.targeted=true; sam.queue.push(now); sam.interceptions++; participating.add(sam.id);\n        if(b.ours&&traces.length<100) traces.push({sam:sam.id,type:b.type,tick:now-start,silo:b.silo});\n      }\n    }\n    if(!opt.moveFirst) move();\n    if(ai===actions.length&&bombs.every(b=>b.done||b.targeted)) break;\n  }\n  const unfinished=bombs.some(b=>b.ours&&!b.done&&!b.targeted);\n  return {atomHits,hydroHits,committedHydroHits,dropped,tubeShortage,goldShortage,unfinished,cost:s.gold-gold,lastArrival,launches,traces,\n    usedSilos:[...used],participating:[...participating],\n    interceptions:sams.map(u=>({id:u.id,count:u.interceptions})),ticks:now-start};\n}\n\nfunction affordable(s,plan) { return BigInt(plan.atoms)*s.atomCost+BigInt(plan.hydros)*s.hydroCost<=s.gold; }\nfunction succeeds(result,plan,minHits) { return !result.dropped&&!result.unfinished&&\n  ((plan.goal??(plan.hydros?'hydro':'atomic'))==='hydro'?result.hydroHits>=1:result.atomHits>=minHits); }\n\nfunction assess(s,plan,options={}) {\n  const cache=options.pathCache??new Map();\n  const base={deadline:options.deadline,maxTicks:options.maxTicks,pathCache:cache,conservative:true};\n  const cases=[{}, {reverse:true,moveFirst:true,spawnFirst:true,flightShift:1}, {hydroDelay:-2,delay:2,flightShift:-1}, {reverse:true,hydroDelay:2,delay:2}];\n  let worst=null;\n  for(const variant of cases) {\n    const result=simulate(s,plan,{...base,...variant});\n    if(!worst||result.hydroHits<worst.hydroHits||result.atomHits<worst.atomHits) worst=result;\n    if(!succeeds(result,plan,options.minAtomHits??1)) return {ok:false,result};\n  }\n  return {ok:true,result:worst};\n}\n\nfunction search(s, options={}) {\n  validateSnapshot(s);\n  const began=performance.now(),deadline=began+(options.budgetMs??1800),pathCache=new Map();\n  const minHits=Math.max(1,options.minAtomHits??1);\n  const cap=Math.min(5000,Math.max(0,options.maxAtoms??2000));\n  const initial=options.initialTicks??3;\n  const committedHydro=s.includeCommitted&&(s.inflight??[]).some(b=>b.committed&&b.owner===s.me&&!b.targeted&&b.type===HYDRO);\n  const ready=s.silos.reduce((n,u)=>n+(u.building?0:Math.max(0,u.level-u.queue.length)),0);\n  // Estimate capacity only along possible trajectories. Keep all SAMs in the\n  // actual simulation; this filter is solely a search-order optimization.\n  const paths=s.silos.filter(u=>!u.building).flatMap(u=>[true,false].map(up=>cachedPath(pathCache,s,u,up,s.rules.atomSpeed)));\n  const relevant=s.sams.filter(u=>paths.some(path=>path.some(p=>p.targetable&&dist2(p.tile,u)<=s.rules.maxSamRange**2)));\n  const slots=relevant.reduce((n,u)=>n+u.level,0);\n  const result={mixed:null,atomic:null,chosen:null,tested:0,limited:false,reason:'',\n    snapshotTick:s.tick,minAtomHits:minHits,maxAtoms:cap,ready,slots,\n    silos:s.silos.map(u=>({id:u.id,x:u.x,y:u.y,level:u.level,ready:u.level-u.queue.length})),\n    sams:s.sams.map(u=>({id:u.id,x:u.x,y:u.y,level:u.level,ready:u.level-u.queue.length})),\n    existingFlights:s.observedFlights??(s.inflight??[]).length};\n  if(!s.includeCommitted&&!s.silos.some(u=>!u.building)) {result.reason='완성된 사일로가 없습니다'; return result;}\n  if(!s.includeCommitted&&s.intentBudget===0) {result.reason='남은 명령 한도가 없습니다. 회복 후 다시 분석하세요';return result;}\n  if(!s.includeCommitted&&s.gold<s.atomCost&&s.gold<s.hydroCost) {result.reason='원자·수소 1발을 구매할 골드가 부족합니다';return result;}\n  const counts=[0,minHits,...[1,1.25,1.5,2,.8,.5,3].map(x=>Math.ceil(slots*x)+minHits),\n    ready-1,ready,4,8,16,32,50,100,200,400,800,cap]\n    .filter(n=>Number.isInteger(n)&&n>=0&&n<=cap).filter((n,i,a)=>a.indexOf(n)===i);\n  const run=plan=>{\n    if(!affordable(s,plan)||plan.actions.length>(s.intentBudget??140)) return null;\n    result.tested++;\n    const a=assess(s,plan,{deadline,pathCache,minAtomHits:minHits,maxTicks:options.maxTicks??1200});\n    if(!a.ok) {\n      const failure={atoms:plan.atoms,hydros:plan.hydros,up:plan.up,dropped:a.result.dropped,\n        tubeShortage:a.result.tubeShortage,goldShortage:a.result.goldShortage,\n        blockedBy:a.result.traces.filter(t=>t.type===HYDRO),usedSilos:a.result.usedSilos,\n        launchSpan:a.result.launches.length?Math.max(...a.result.launches.map(l=>l.depart))-Math.min(...a.result.launches.map(l=>l.depart)):0,\n        interceptions:a.result.interceptions};\n      if(!result.failure||failure.dropped<result.failure.dropped||\n        (failure.dropped===result.failure.dropped&&failure.atoms>result.failure.atoms)) result.failure=failure;\n    }\n    return a.ok?{...plan,...a.result}:null;\n  };\n  try {\n    // Interleave modes so an expensive mixed search cannot starve atomic analysis.\n    outer: for(const [fraction,gap] of [[1,0],[.75,0],[.5,0],[1,8],[.75,8],[1,30],[1,60],[.5,30]]) {\n     for(const atoms of counts) {\n      for(const up of [s.preferredUp!==false,s.preferredUp===false]) {\n        if(fraction===1&&gap===0&&!result.atomic&&(atoms>=minHits||s.includeCommitted)&&((atoms===0&&s.includeCommitted)||s.allowed?.atomic!==false)) {\n          const p=run({...makePlan(atoms,null,0,up,initial),goal:'atomic'}); if(p) result.atomic=p;\n        }\n        if(!result.mixed&&options.allowHydroGoal!==false&&(committedHydro||s.allowed?.mixed!==false)&&(atoms===0||s.allowed?.atomic!==false)) {\n          if(atoms===0&&(fraction!==1||gap!==0))continue;\n          if(committedHydro&&fraction===1&&gap===0) {\n            const rescue=run({...makePlan(atoms,null,0,up,initial),goal:'hydro'});\n            if(rescue)result.mixed=rescue;\n          }\n          if(!result.mixed&&options.allowNewHydro!==false&&s.allowed?.mixed!==false) {\n            const p=run({...makePlan(atoms,Math.floor(atoms*fraction),gap,up,initial),goal:'hydro'});\n            if(p) result.mixed=p;\n          }\n        }\n        if(result.mixed&&result.atomic) break outer;\n      }\n      if(performance.now()>deadline) throw Error('SEARCH_TIMEOUT');\n     }\n    }\n  } catch(e) { if(e.message==='SEARCH_TIMEOUT') result.limited=true; else throw e; }\n  result.chosen=result.mixed??result.atomic;\n  result.mode=result.mixed?'mixed':result.atomic?'atomic':result.limited?'unknown':'blocked';\n  result.diagnostics=[];\n  if(!result.chosen&&result.failure) {\n    const f=result.failure;\n    if(f.tubeShortage)result.diagnostics.push(`시험 공격 ${f.atoms+f.hydros}발 중 ${f.tubeShortage}발이 발사관 부족으로 발사되지 못함`);\n    const reloaded=f.interceptions.filter(v=>v.count>(s.sams.find(u=>u.id===v.id)?.level??Infinity));\n    if(reloaded.length)result.diagnostics.push(`SAM ${reloaded.length}기가 재장전 후 반복 요격 · 발사 분산 ${(f.launchSpan*s.rules.tickMs/1000).toFixed(1)}초, 사일로 수·배치 검토`);\n    for(const b of f.blockedBy.slice(0,1)) {\n      const sam=s.sams.find(u=>u.id===b.sam),silo=s.silos.find(u=>u.id===b.silo);\n      if(sam&&silo&&dist2(sam,s.target)>s.rules.maxSamRange**2)\n        result.diagnostics.push(`목표 주변 밖 SAM (${sam.x}, ${sam.y}) Lv${sam.level}이 사일로 (${silo.x}, ${silo.y})의 수소를 경로에서 요격`);\n    }\n  }\n  if(!result.chosen) {\n    if(result.limited) result.reason='계산 시간 내 검증된 계획을 찾지 못했습니다. I로 더 길게 재분석합니다';\n    else if(!ready) result.reason='현재 발사관이 재장전 중입니다. 준비 후 다시 분석합니다';\n    else if(s.allowed?.mixed===false&&s.allowed?.atomic===false) result.reason='게임 규칙상 이 위치에는 발사할 수 없습니다';\n    else if(result.failure?.tubeShortage) result.reason=`시험한 공격에서 발사관 ${result.failure.tubeShortage}발분 부족 — 사일로 레벨·재장전 확인`;\n    else if(result.failure?.blockedBy?.length) {\n      const b=result.failure.blockedBy[0],sam=s.sams.find(u=>u.id===b.sam);\n      result.reason=`시험한 수소 공격은 SAM (${sam.x}, ${sam.y}) Lv${sam.level}이 ${b.tick}틱에 요격 — 발사 배치·간격 개선 필요`;\n    } else result.reason='탐색 범위에서 돌파 계획 없음 — 사일로 발사 간격·배치와 SAM 재장전이 병목일 수 있습니다';\n  }\n  result.elapsedMs=Math.round(performance.now()-began);\n  return result;\n}\n\n\n\n// The conservative planner never credits unrelated flights. Keep them in the\n// live observer, but do not repeatedly clone their full paths into each Worker.\nfunction workerSnapshot(s) {\n  return {...s,observedFlights:s.observedFlights??(s.inflight??[]).length,\n    inflight:(s.inflight??[]).filter(b=>s.includeCommitted&&b.committed&&b.owner===s.me&&!b.targeted)};\n}\n\n// Decode authoritative motion-plan time instead of the nukeState index, which\n// may be stale when the client derives motion without per-tick unit updates.\nfunction flightProgress(path,position,nukeState,motion,tick) {\n  if(!path?.length)throw Error('비행 궤적이 없어 재계산할 수 없습니다');\n  const matches=i=>path[i]?.tile.x===position.x&&path[i]?.tile.y===position.y;\n  if(motion) {\n    if(motion.ticksPerStep!==1||!Number.isInteger(motion.startTick))throw Error('지원하지 않는 비행 시간 정보');\n    const index=Math.max(0,Math.min(path.length-1,tick-motion.startTick));\n    if(!matches(index))throw Error('비행 위치와 시간 정보가 일치하지 않습니다');\n    return {index,waitTicks:Math.max(0,motion.startTick-tick)};\n  }\n  // Older clients are usable only when the observed tile unambiguously resolves\n  // the path index; never substitute the stale server index or silently guess.\n  const matchesAt=[];path.forEach((_,i)=>{if(matches(i))matchesAt.push(i);});\n  if(matchesAt.length!==1||!Number.isInteger(nukeState.waitTicks)||nukeState.waitTicks<0)\n    throw Error('미사일의 현재 비행 시점을 확인할 수 없습니다');\n  return {index:matchesAt[0],waitTicks:matchesAt[0]===0?nukeState.waitTicks:0};\n}\n\nfunction remainingPlan(plan,index,baseTick,snapshotTick,leadTicks=6) {\n  const actions=plan.actions.slice(index).map(a=>({...a,tick:baseTick+a.tick-snapshotTick}));\n  const shift=actions.length?Math.max(0,leadTicks-actions[0].tick):0;\n  for(const a of actions)a.tick+=shift;\n  return {...plan,actions,atoms:actions.filter(a=>a.type===ATOM).reduce((n,a)=>n+a.amount,0),\n    hydros:actions.filter(a=>a.type===HYDRO).reduce((n,a)=>n+a.amount,0)};\n}\n\n// Paths are immutable within a snapshot/observer. Retain only weak references;\n// one suffix table replaces path slicing and four scans on every game tick.\nconst suffixBoundsCache=new WeakMap();\nfunction suffixBounds(path,index) {\n  let bounds=suffixBoundsCache.get(path);\n  if(!bounds) {\n    bounds=new Float64Array(path.length*4);\n    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;\n    for(let i=path.length-1;i>=0;i--) {\n      const p=path[i].tile;\n      minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);\n      bounds.set([minX,maxX,minY,maxY],i*4);\n    }\n    suffixBoundsCache.set(path,bounds);\n  }\n  return bounds.subarray(index*4,index*4+4);\n}\n\n// Cheap geometric broad phase for the observer. Every potentially relevant SAM\n// stays in the simulator. Changes well outside every possible path need not\n// interrupt a precisely timed volley.\nfunction defenseSignature(s) {\n  const r=s.rules.maxSamRange, boxes=[];\n  for(const silo of s.silos) {\n    const h=Math.max(Math.hypot(s.target.x-silo.x,s.target.y-silo.y)/3,50);\n    boxes.push([Math.min(silo.x,s.target.x)-r,Math.max(silo.x,s.target.x)+r,\n      Math.min(silo.y,s.target.y)-h-r,Math.max(silo.y,s.target.y)+h+r]);\n  }\n  for(const b of s.inflight??[])if(b.committed&&b.path?.length) {\n    if(b.index<b.path.length) {\n      const [x0,x1,y0,y1]=suffixBounds(b.path,b.index);\n      boxes.push([x0-r,x1+r,y0-r,y1+r]);\n    }\n  }\n  return JSON.stringify([\n    s.silos.map(u=>[u.id,u.x,u.y,u.level,u.building,u.owner]),s.allowed,\n    s.sams.filter(u=>boxes.some(([x0,x1,y0,y1])=>u.x>=x0&&u.x<=x1&&u.y>=y0&&u.y<=y1))\n      .map(u=>[u.id,u.x,u.y,u.level,u.building,u.owner,u.upgrade])]);\n}\n\nfunction adapt(s,request,options={}) {\n  const began=performance.now(),budget=options.budgetMs??350,deadline=began+budget;\n  const cap=Math.max(0,request.atomLimit-request.sentAtoms);\n  const hydroLeft=Math.max(0,request.hydroLimit-request.sentHydros);\n  const minHits=options.minAtomHits??1,lead=options.initialTicks??6;\n  s={...s,includeCommitted:true};\n  const old=request.remaining?{...request.remaining,goal:request.goal}:null;\n  const envelope=p=>p&&p.atoms<=cap&&p.hydros<=hydroLeft&&p.actions.length<=(s.intentBudget??140)&&\n    p.actions.every(a=>a.type===HYDRO?s.allowed?.mixed!==false:s.allowed?.atomic!==false)&&\n    BigInt(p.atoms)*s.atomCost+BigInt(p.hydros)*s.hydroCost<=s.gold;\n  // Test the committed goal first. No repeated hydro launch when its per-run\n  // allowance has already been spent; a flying hydro can only receive atom help.\n  if(envelope(old))try{\n    const check=assess(s,old,{deadline,minAtomHits:minHits,maxTicks:options.maxTicks});\n    if(check.ok)return {chosen:{...old,...check.result},decision:old.actions.length?'keep':'observe',\n      reason:old.actions.length?'변경된 SAM에서도 남은 계획 유효':'추가 발사 없이 현재 비행으로 목표 달성 예상',snapshotTick:s.tick};\n  }catch(e){if(e.message!=='SEARCH_TIMEOUT')throw e;}\n  const timeLeft=deadline-performance.now();\n  if(timeLeft<=0)return {chosen:null,decision:'stop',limited:true,reason:'재계산 시간 내 유효한 계획을 확인하지 못했습니다',snapshotTick:s.tick};\n  const result=search(s,{...options,budgetMs:timeLeft,maxAtoms:cap,initialTicks:lead,\n    allowHydroGoal:request.goal!=='atomic',allowNewHydro:hydroLeft>0});\n  if(!result.chosen)return {...result,decision:'stop',reason:cap===0?'이번 공격의 누적 원자 발사 한도에 도달했습니다':result.reason};\n  const goal=result.chosen.goal??(result.chosen.hydros?'hydro':'atomic');\n  const decision=!result.chosen.actions.length?'observe':goal==='atomic'?'atomic':request.sentHydros>0?'rescue':'mixed';\n  const reason={observe:'현재 관측 상태로 목표 달성 예상 — 추가 발사 보류',\n    atomic:request.goal==='atomic'?'변경된 방어에 맞춰 원자 집중 수량·일정 수정':'수소 구출 계획을 찾지 못해 원자 집중으로 전환',rescue:`비행 중 수소 구출을 위해 원자 ${result.chosen.atoms}발 보강`,\n    mixed:`원자 ${result.chosen.atoms}발 + 수소 ${result.chosen.hydros}발로 남은 계획 수정`}[decision];\n  return {...result,decision,reason};\n}\n\n// Advice is a separate, non-executing next-attack experiment. It never mutates\n// the live game or pretends an upgrade can finish before a flying hydro arrives.\nfunction upgradeAdvice(s,options={}) {\n  const deadline=performance.now()+(options.budgetMs??800),attempts=[];\n  const ready={...s,includeCommitted:false,inflight:[],confirmedAtomHits:0,confirmedHydroHits:0,\n    tick:s.tick+s.rules.samCooldown+90,\n    silos:s.silos.filter(u=>!u.building).map(u=>({...u,queue:[]})),\n    sams:s.sams.map(u=>({...u,queue:[],level:Math.max(u.level,u.upgrade?.targetLevel??u.level),upgrade:null}))};\n  if(!ready.silos.length)return {text:'먼저 사일로를 건설하고 완공 후 다시 분석하세요',verified:false};\n  const check=state=>search(state,{...options,budgetMs:Math.max(1,Math.min(120,deadline-performance.now())),initialTicks:3});\n  if(performance.now()<deadline) {\n    const base=check(ready);\n    if(base.chosen)return {text:'현재 배치도 재장전 완료 후 다음 공격에서 돌파 계획이 있습니다. 발사관을 충전한 뒤 다시 분석하세요',verified:true,kind:'reload'};\n  }\n  for(const silo of ready.silos.slice().sort((a,b)=>Math.abs(a.x-s.target.x)+Math.abs(a.y-s.target.y)-Math.abs(b.x-s.target.x)-Math.abs(b.y-s.target.y)).slice(0,3)) {\n    for(const add of [10,25,50,100]) {\n      if(performance.now()>=deadline)return {text:'현재 탐색 시간 안에 레벨업만으로 해결되는 조건을 확인하지 못했습니다. 사일로 추가·배치 변경도 검토하세요',verified:false,attempts};\n      const next={...ready,silos:ready.silos.map(u=>u.id===silo.id?{...u,level:u.level+add}:u)};\n      const r=check(next);attempts.push({id:silo.id,add,success:!!r.chosen});\n      if(r.chosen)return {text:`다음 공격 후보: 사일로 (${silo.x}, ${silo.y}) Lv${silo.level} → Lv${silo.level+add}. 업그레이드·재장전 완료를 가정하면 돌파 예상 (최소 레벨·업그레이드 비용 검증 아님)`,\n        verified:true,kind:'upgrade',silo:silo.id,from:silo.level,to:silo.level+add,plan:r.chosen,attempts};\n    }\n  }\n  return {text:'시험한 레벨업만으로는 돌파를 확인하지 못했습니다. 사일로 수·배치 또는 다음 공격의 발사 한도를 검토하세요',verified:false,attempts};\n}\n\nself.onmessage = e => { try { const d=e.data; const result=d.kind===\"adapt\"?adapt(d.snapshot,d.request,d.options):d.kind===\"advice\"?upgradeAdvice(d.snapshot,d.options):d.kind===\"assess\"?assess(d.snapshot,d.plan,{...d.options,deadline:performance.now()+(d.options.budgetMs??2500)}):search(d.snapshot,d.options); self.postMessage({id:d.id,result}); } catch(error) { self.postMessage({id:e.data.id,error:error.message}); }};";


  // ─────────────────────────────────────────────
  // 설정
  // ─────────────────────────────────────────────
  const CFG = {
    // ── 핵 ──
    amount: 50,             // 원자폭탄 인텐트 1개당 발수 (서버 상한 50)
    hotkey: "KeyH",         // 50발 살포 (H)
    hotkeyHydro: "KeyJ",    // 수소폭탄 1발 (J)
    hotkeyMirv: "KeyM",     // MIRV 1발 — 탄두 최대 350발 자동 생성 (M)
    hotkeyMax: "KeyG",      // 준비된 사일로 전부 소진 = xMax (G)

    // ── 대량 살포 (Z) ──
    // 한 번 누르면 원자폭탄을 지정 발수만큼 '서버가 허용하는 최대 속력'으로 쏟아붓는다.
    // 연달아 누르면 누른 위치별로 대기열에 쌓여, 끊김 없이 최대 속력으로 이어서 나간다.
    hotkeySalvo: "KeyZ",        // 1,000발씩 — 연타하면 대기열로 계속
    hotkeyStrike: "KeyI",       // 한큐 수소타격 — SAM 전량 분석 → 필요 원자 전량 → 수소 1발 → 3~5% 추가
    salvoAmount: 1000,          // 1회 발수 (50발 단위로 올림)
    salvoBatch: 10,             // 창당 인텐트 수 (서버 초당 한도 = 10)
    salvoBatchPeriodMs: 1150,   // 창 간격 = 1,000ms(서버 초당 창) + 여유 150ms
    salvoMaxAmount: 50000,      // 1회 발수 안전 상한 (오설정 방지)
    salvoQueueMaxItems: 50,     // 대기열 최대 건수 (연타 상한)
    salvoStopOnGold: true,      // 골드 소진 시 남은 대기열 중단 (버려질 인텐트 방지)
    salvoWaitForReload: false,  // 발사관 소진 시: false=중단 / true=재장전(9초) 대기 후 자동 재개
    // ── v2.9.1: 분당 한도 포화 시 동작 ──
    //   false(기본) = 즉시 중단 (남은 대기열 폐기, 토스트로 알림)
    //   true        = 분 경계까지 대기 후 자동 재개
    salvoWaitForMinute: false,

    // ── SAM 인식 살포 (v2.5) ──
    // 목표를 지키는 '적 SAM'이 있으면 수소타격으로 전환:
    //   ① 시뮬레이터로 필요 원자 C를 계산하고, 거기에 랜덤 5~50발을 가산한
    //      '총량'으로 다시 시뮬레이션한다 (수소 타이밍은 그 총량 기준으로 유지)
    //   ② '회복이 하나도 없는 사각창'에 도착하도록 역산한 시각에 수소 1발
    //      (수소는 SAM 최우선 표적 — 원자와 같이 오면 먼저 요격된다)
    //   ③ 그후 원자 수십발 + 수소 몇발을 랜덤 간격으로 더 뿌린다
    // SAM이 없으면 기존과 동일하게 salvoAmount 대로 원자만 쏜다.
    salvoSamAware: true,    // Z 살포를 SAM 인식 모드로
    // ── v2.8: 단순 모드 ──
    //   복잡한 경로·타이밍 시뮬레이터 대신 '커서 150타일 내 SAM 레벨 합 × 1.2'로 발사량을 정한다.
    //   (Z는 수소를 섞지 않고 예전처럼 최대 속도로 순수 원자 살포 — salvoSamAware 무시)
    samSimpleMode: true,    // true=단순 규칙 / false=기존 정밀 시뮬레이터
    samSimpleRange: 150,    // 커서 기준 SAM 수집 반경 (타일)
    samSimpleMult: 1.5,     // ΣLv × 이 배수 = 발사량 (50% 더)
    samZPure: true,         // Z 살포는 수소 미포함 · 순수 원자 최대속도
    samHydroCount: 1,       // (구) 마지막에 쏘는 수소 수 — samHydroEvery 사용 시 무시
    // ── v2.9: 원자 N발마다 수소를 '섞어' 쏜다 ──
    //   마지막에 한 번만 쏘면 서버 창이 꽉 찼을 때 드롭(짤림)된다.
    //   살포 중간중간 섞으면 창에 여유가 있을 때 나가므로 안전하다.
    samHydroEvery: 200,     // (구) 자동 섞기 주기 — samBlockMode=true면 미사용
    // ── v3.0: 블록 모드 ──
    //   I 한 번 = '원자 samBlockAtoms발 + 수소 1발' 블록을 큐에 넣는다.
    //   연타하면 블록이 쌓여 서버 최대 속력으로 순차 발사된다.
    //   (SAM 계산은 HUD 표시용으로만 — 발사량은 블록이 결정)
    samBlockMode: true,
    samBlockAtoms: 200,     // 블록당 원자 발수
    samBlockHydro: 1,       // 블록 뒤 수소 발수 (0=없음)
    samAfterInBlock: false, // 블록 모드에서 후속 산개(원자 몇발+수소 몇발) 사용 여부
    samHydroEveryJitter: 20,// 발수 지터 (200±20 → 인텐트 경계와 정렬 · 티 제거)
    samRangeExtra: 0,       // SAM 참여 판정 직선 여유 (0 = 경로 판정만. 내 사일로를 못 읽으면 150 안전여유)
    samCap: 20000,          // 시뮬레이터 1회 계획의 원자 상한 (오설정 방지)

    // ── 랜덤성 (v2.6) — '정확히 계산된 발수'는 자동화 티가 난다 ──
    //   게임 리뷰에서 부정 사용으로 보이지 않도록 발수·순서·간격에 무작위성을 준다.
    //   ① 필요 원자에 가산하는 랜덤 폭 (이 총량으로 시뮬 → 수소 타이밍 유지)
    //   ② 수소 발사 후 후속 산개: 원자 수십발 + 수소 몇발 (간격도 랜덤)
    samJitterMin: 5,        // ① 가산 하한 (발) — 랜덤 성분
    samJitterMax: 50,       // ① 가산 상한 (발)
    //   ①-2 여유율 — '날아가는 동안 적이 SAM을 증원(건설·업그레이드)할 가능성' 대비.
    //        여유분 = max(필요량 × 이 %, 랜덤 5~50발)  → 둘 중 큰 쪽을 쓴다.
    //        (작은 규모에선 랜덤이, 큰 규모에선 10%가 지배한다)
    samReservePct: 10,
    samAfterMin: 20,        // ② 후속 원자 하한 (수십발)
    samAfterMax: 90,        // ② 후속 원자 상한 (수십발)
    samAfterHydroMin: 1,    // ② 후속 수소 하한 (몇발)
    samAfterHydroMax: 3,    // ② 후속 수소 상한 (몇발)
    samAfterGapMinMs: 350,  // ② 후속 간격 하한 (ms)
    samAfterGapMaxMs: 1600, // ② 후속 간격 상한 (ms)

    // ── 코너 HUD (v2.5) ──
    // ① 서버 리밋: '초당 한도의 80% 이상'을 쓸 수 있게 되는 시점까지 카운트다운
    // ② 타깃 타격 가능성: 커서 위치 적 SAM 용량 + 내 사일로/골드로
    //    '소진 원자 + 수소 1발 + 추가분'이 가능한지 상시 표기
    hud: true,               // 화면 모서리 상태 패널
    hudCorner: "bottom-left",// top-left | top-right | bottom-left | bottom-right
    hudUsablePct: 80,        // '사용 가능' 기준 — 서버 초당 한도의 이 비율
    hudHover: true,          // 커서 위치 타깃의 타격 가능성 표시

    // ── 구조물 업그레이드 ──
    hotkeyUpgrade: "KeyV",  // 무장 (V) → 구조물 클릭: +50
    addLevels: 50,          // 클릭할 때마다 "현재 레벨 + 이 값"까지 올림
    mode: "add",            // "add" = 현재+addLevels / "set" = 절대 목표
    targetLevel: 50,        // mode:"set" 일 때의 절대 목표 레벨
    // 구조물별 예외 — 지정한 타입은 addLevels 대신 이 값을 쓴다
    // (mode "add" 에서는 addLevelsByType, "set" 에서는 targetLevels 가 적용됨)
    targetLevels: {},
    addLevelsByType: {
      "Missile Silo": 30,   // 사일로는 클릭당 +30 고정 (레벨 = 발사관 수)
    },

    // ── 구조물 업그레이드 大 (X) ─-
    // V(소량)와 같은 방식이지만 한 번에 훨씬 많이 올린다. 50씩 나눠 여러 인텐트로
    // 보내므로 서버 스키마 상한(50)은 그대로 지킨다.
    hotkeyUpgradeBig: "KeyX",   // 무장 (X) → 구조물 클릭: +500
    addLevelsBig: 500,          // 클릭당 레벨 증가 (大)
    // 한 번의 클릭에서 '한 서버창(1초)'에 몰아 보낼 최대 인텐트 수.
    //   서버 초당 한도는 10건인데 X(+500=10건)를 다 몰아쓰면 그 1초 동안
    //   창을 독점해 Z 살포·수소·MIRV·다른 업그레이드가 전부 대기한다.
    //   6으로 두면 창에 4건 여유를 남기고 나머지는 다음 창에서 이어간다
    //   (체감 소요는 +500에 약 1.2초 — 게임 클라이언트도 창을 꽉 채우지 않는다).
    upgradeBurstPerWindow: 6,
    addLevelsByTypeBig: {
      "Missile Silo": 300,      // 사일로는 +300 (발사관 수라 과하면 곤란)
    },

    // 업그레이드 가능한 구조물 (DefensePost는 게임상 업그레이드 불가)
    upgradableTypes: ["City", "Factory", "Port", "Missile Silo", "SAM Launcher"],

    // ── 군함 대량 건조 ──
    // 군함은 서버가 amount 를 무시한다(단일 생성) → 인텐트를 N번 반복 발송한다.
    hotkeyWarship: "KeyN",  // 무장 (N) → 바다 클릭: 설정한 척수만큼 건조
    warshipCount: 10,       // 한 번에 띄울 척수 (최대 warshipMaxCount)
    warshipMaxCount: 50,    // 안전 상한
    warshipDelayMs: 120,    // 인텐트 사이 간격(ms) — 초당 10개 제한 대응

    // 키를 누르고 있을 때 반복 발사 (서버가 감당하는 속도로 자동 제한)
    // true  = 누르고 있으면 한도 내에서 계속 발사
    // false = 한 번 누를 때만 1회 (연타는 직접)
    holdRepeat: true,

    chunkDelayMs: 300,      // (v2.4부터 미사용 — 고속 발송으로 대체. 호환용)
    swallowGameKeys: true,  // H/G/J/V/N 를 게임에 전달하지 않음 (G는 게임 기본 '지상 공격'과 겹침)
    toastMs: 2600,
  };
  // ─────────────────────────────────────────────

  const TYPE_KO = {
    "City": "도시",
    "Factory": "공장",
    "Port": "항구",
    "Missile Silo": "미사일 사일로",
    "SAM Launcher": "SAM 발사대",
    "Defense Post": "디펜스 포스트",
  };
  function koName(type) { return TYPE_KO[type] || type; }

  // ── 상태 ──
  let lastMouse = { x: 0, y: 0 };
  let armed = false;
  let armedMode = null;   // "upgrade" | "upgradeBig" | "warship"
  let idleTimer = null;
  let suppressUp = false;
  let suppressTimer = null;
  let lastBlockToast = 0;   // 한도 안내 토스트 스로틀
  // 대량 살포 상태는 '대량 살포 (Z)' 섹션의 salvoQueue / salvoTimer / salvoDone 참조

  // ── 게임 컨텍스트 획득: DOM에서 직접 읽기 ──
  function getBuildMenu() {
    try { return document.querySelector("build-menu"); } catch (e) { return null; }
  }
  function getOverlay() {
    try { return document.querySelector("player-info-overlay"); } catch (e) { return null; }
  }
  function getGameView() {
    try {
      const bm = getBuildMenu();
      if (bm && bm.game && typeof bm.game.myPlayer === "function") return bm.game;
      const ov = getOverlay();
      if (ov && ov.game && typeof ov.game.myPlayer === "function") return ov.game;
    } catch (e) {}
    return null;
  }
  // ── 소유자 판정 (v2.8.3) ──
  //   게임 내부는 smallID(숫자)로 플레이어를 비교한다. PlayerView.id()는 문자열(클라이언트 ID)이라
  //   직접 비교하면 어긋날 수 있다. 두 값을 모두 시도하고, 판독 실패는 '내 것 아님'으로 본다.
  function isOwnedByMe(u, me) {
    try {
      if (!u || !me) return false;
      const o = (typeof u.owner === "function") ? u.owner() : null;
      if (!o) return false;
      let oS = null, mS = null;
      try { if (typeof o.smallID === "function") oS = o.smallID(); } catch (e) {}
      try { if (typeof me.smallID === "function") mS = me.smallID(); } catch (e) {}
      if (oS !== null && oS !== 0 && mS !== null && oS === mS) return true;
      if (typeof o.id === "function" && typeof me.id === "function") {
        try { return o.id() === me.id(); } catch (e) {}
      }
    } catch (e) {}
    return false;
  }

  function getTransform() {
    try {
      const bm = getBuildMenu();
      if (bm && bm.transformHandler && typeof bm.transformHandler.screenToWorldCoordinates === "function")
        return bm.transformHandler;
      const ov = getOverlay();
      if (ov && ov.transformHandler && typeof ov.transformHandler.screenToWorldCoordinates === "function")
        return ov.transformHandler;
    } catch (e) {}
    return null;
  }
  function getEventBus() {
    try {
      const bm = getBuildMenu();
      if (bm && bm.eventBus && typeof bm.eventBus.emit === "function") return bm.eventBus;
      const ov = getOverlay();
      if (ov && ov.eventBus && typeof ov.eventBus.emit === "function") return ov.eventBus;
    } catch (e) {}
    return null;
  }

  // ── 인텐트 이벤트 클래스 획득 ──
  // 이벤트 버스의 listeners(Map) 키가 곧 실제 이벤트 생성자다.
  // 배포본은 클래스명이 난독화되므로, 이름이 안 맞으면 프로퍼티 구조로 식별한다
  // (프로퍼티명은 minify 후에도 보존된다).
  let cachedNukeCtor = null;
  function findNukeEventCtor() {
    if (cachedNukeCtor) return cachedNukeCtor;
    const bus = getEventBus();
    if (!bus) return null;
    try {
      const lm = bus.listeners;
      if (lm && typeof lm.entries === "function") {
        for (const [ctor] of lm.entries()) {
          try {
            if (typeof ctor !== "function") continue;
            if (ctor.name === "BuildUnitIntentEvent") {
              cachedNukeCtor = ctor;
              console.log("[x50] 핵 인텐트 클래스 확보 (이름 매칭)");
              return cachedNukeCtor;
            }
          } catch (e) {}
        }
        for (const [ctor] of lm.entries()) {
          try {
            if (typeof ctor !== "function") continue;
            const src = String(ctor);
            if (
              src.includes("unit") && src.includes("tile") &&
              (src.includes("amount") || src.includes("rocketDirectionUp")) &&
              src.length < 600
            ) {
              cachedNukeCtor = ctor;
              console.log("[x50] 핵 인텐트 클래스 확보 (구조 매칭)");
              return cachedNukeCtor;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  let cachedUpCtor = null;
  function findUpgradeEventCtor() {
    if (cachedUpCtor) return cachedUpCtor;
    const bus = getEventBus();
    if (!bus) return null;
    try {
      const lm = bus.listeners;
      if (lm && typeof lm.entries === "function") {
        for (const [ctor] of lm.entries()) {
          try {
            if (typeof ctor !== "function") continue;
            if (ctor.name === "SendUpgradeStructureIntentEvent") {
              cachedUpCtor = ctor;
              console.log("[x50] 업그레이드 클래스 확보 (이름 매칭)");
              return cachedUpCtor;
            }
          } catch (e) {}
        }
        for (const [ctor] of lm.entries()) {
          try {
            if (typeof ctor !== "function") continue;
            const src = String(ctor);
            // unitId + unitType 동시 보유는 업그레이드 인텐트 고유
            // (BuildUnit=unit/tile, DeleteUnit=unitId만, MoveWarship=unitIds/tile)
            if (src.includes("unitId") && src.includes("unitType") && src.length < 600) {
              cachedUpCtor = ctor;
              console.log("[x50] 업그레이드 클래스 확보 (구조 매칭)");
              return cachedUpCtor;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  // ── 커서 타일 ──
  let lastMouseMoveAt = 0;
  window.addEventListener(
    "mousemove",
    (e) => { if(hudEl?.contains(e.target))return; lastMouse = { x: e.clientX, y: e.clientY }; lastMouseMoveAt = Date.now(); },
    { passive: true },
  );

  function computeCursorTile() {
    try {
      const game = getGameView();
      const tf = getTransform();
      if (!game || !tf) return null;
      const w = tf.screenToWorldCoordinates(lastMouse.x, lastMouse.y);
      if (!w) return null;
      // 좌표 유효성: 정수화 후 검사 (게임은 정수 타일만 허용)
      const ix = Math.floor(w.x), iy = Math.floor(w.y);
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) return null;
      if (typeof game.isValidCoord === "function" && !game.isValidCoord(ix, iy)) return null;
      let t;
      try { t = game.ref(ix, iy); } catch (e) { return null; }   // ref는 범위 밖이면 예외를 던진다
      if (t === undefined || t === null) return null;
      if (typeof game.isValidRef === "function" && !game.isValidRef(t)) return null;
      return t;
    } catch (e) {
      return null;
    }
  }

  function getRocketDirectionUp() {
    try {
      const bm = getBuildMenu();
      const up = bm && bm.uiState && bm.uiState.rocketDirectionUp;
      return up !== undefined ? !!up : true;
    } catch (e) { return true; }
  }

  // ═════════════════════════════════════════════
  // 핵 발사
  // 정식 UI(라디얼 x1/x5/x50)와 동일한 이벤트 경로만 사용한다.
  // (소켓 직송 금지 — 서버는 바이너리(zbin)만 디코드하며, 디코드 실패 시 즉시 kick)
  // ═════════════════════════════════════════════
  function dispatchNuke(unit, amount) {
    const tile = computeCursorTile();
    if (tile === null) {
      toast("❌ 타깃 위에 커서를 올린 뒤 누르세요", "#ffaa00");
      return;
    }
    const bus = getEventBus();
    const ctor = findNukeEventCtor();
    if (!bus || !ctor) {
      toast("❌ 경로 없음 — 게임 시작 후 다시 시도", "#ff5555");
      return;
    }
    try {
      bus.emit(new ctor(unit, tile, getRocketDirectionUp(), amount));
      rateUse();
      const label = unit === "Atom Bomb" ? `☢️ 원자 ${amount}발` : "💧 수소 1발";
      toast(`✓ ${label}`, "#ffd166");
    } catch (e) {
      console.warn("[x50] 핵 emit 실패:", e);
      toast("❌ 발사 실패 (콘솔 확인)", "#ff5555");
    }
  }

  function fireAtoms(amount) { dispatchNuke("Atom Bomb", amount); }
  function fireHydro() { dispatchNuke("Hydrogen Bomb", undefined); }
  function fireMax() {
    try {
      const game = getGameView();
      const me = game && game.myPlayer ? game.myPlayer() : null;
      if (me && typeof me.readyMissileCount === "function") {
        const n = me.readyMissileCount();
        if (n <= 0) {
          toast("❌ 준비된 발사관 없음", "#ffaa00");
          return;
        }
        // 인텐트 1개당 상한 50발
        let remaining = n;
        const first = Math.min(remaining, CFG.amount);
        fireAtoms(first);
        remaining -= first;
        if (remaining > 0) {
          toast(`☢️ 준비 ${n}발 — ${first}발 발사, 남은 ${remaining}발은 다시 누르세요`, "#ffd166");
        }
        return;
      }
    } catch (e) {}
    fireAtoms(CFG.amount);
  }

  // ═════════════════════════════════════════════
  // 대량 살포 (Z) — 1,000발 × 연타 대기열, 서버 허용 최대 속력으로 끊김 없이
  //
  // 서버 규칙 (src/server/ClientMsgRateLimiter.ts):
  //   인텐트 초당 10건 AND 분당 150건. 초과분은 통보 없이 버려진다.
  //   원자 1건 = amount 50발(스키마 상한) → 이론 최대 초당 500발.
  //
  // 왜 '균등 간격'이 아니라 '배치'인가 (실측 근거):
  //   · limiter 의 초당 창은 고정 창이 아니라 '게으른 창'이다 —
  //     마지막 리셋 이후 첫 요청이 1초를 넘겼을 때만 리셋된다.
  //   · 균등 100ms 간격(초당 10건)은 여유가 0이라 지터에 취약:
  //     실측 5회 중 2회 드롭(1.0%), 소요 6.00초.
  //   · 배치(10건 몰아쏘고 1,150ms 대기)는 실측 드롭 0건, 소요 5.75초.
  //   → 배치가 더 빠르고 안전하다 (마지막 배치는 대기 없이 끝나기 때문).
  //
  // 연타 대기열 (v2.1.0):
  //   Z 를 누를 때마다 '누른 시점의 커서 위치'로 CFG.salvoAmount(기본 1,000발)가
  //   대기열에 쌓인다. 펌프는 대기열이 빌 때까지 창마다 10건씩 계속 내보내므로
  //   건과 건 사이에 빈틈이 없다 → 5곳을 연타하면 5,000발을 한 번에 쏜 것과 같은
  //   속력으로 이어진다. Esc 는 대기열까지 전부 중단한다.
  //
  // 자동 중단 가드 (v2.2.0):
  //   · 골드: 서버는 '폭탄 1발 단위'로 골드를 검사한다(canBuildUnitType: _gold < cost).
  //     1발 값도 없으면 이후 인텐트는 전부 조용히 버려진다
  //     → 남은 대기열을 폐기하고 중단 (💰 골드 소진).
  //   · 발사관: 장전된 관이 0이면 보내는 인텐트가 전부 버려진다
  //     → 기본은 중단 (🧨 발사관 소진).
  //       CFG.salvoWaitForReload=true 면 재장전(9초)을 기다렸다가 자동 재개.
  //   · 서버 분당 한도(150건): 남은 초만큼 대기했다가 자동 재개.
  //     이때 이번 창은 '남은 여유'만큼만 보내 조용한 드롭을 막는다.
  //   ※ 세 검사 모두 '읽을 수 있을 때만' 적용한다 — 못 읽으면 서버 판정에 맡긴다.
  // ═════════════════════════════════════════════
  const SALVO_MAX_PER_INTENT = 50;   // 서버 스키마 상한

  let salvoQueue = [];        // [{tile, total, sent, bus, ctor}] — 누른 순서대로 쌓인다
  let salvoTimer = null;      // 창 간 대기 타이머
  let salvoDone = 0;          // 이번 연속 살포에서 다 나간 원자 누적 (토스트용)
  let salvoHydroDone = 0;     // 이번 연속 살포에서 나간 수소 누적
  let salvoItemsDone = 0;     // 다 나간 건수
  let salvoDryWaits = 0;      // 발사관 재장전 대기 횟수 (salvoWaitForReload 모드)
  let salvoHydro = null;      // 수소타격에서 예약된 수소 1발 {tile, fireTick, fireAt, armedAt, bus, ctor, fired, armed}
  let salvoHydroTimer = null; // 수소 발사 대기 타이머 (armHydroTimer)
  let salvoFollow = null;     // 후속 산개 {tile, bus, ctor, atomsLeft, hydrosLeft, atoms0, hydros0, started, timer}
  let lastStrike = null;      // 마지막 SAM 뚫기 계획 (디버그·HUD용)

  function salvoPending() {
    return salvoQueue.reduce((a, it) => a + (it.total - it.sent), 0);
  }

  function salvoState() {
    if (salvoQueue.length === 0 && salvoHydro === null && salvoFollow === null) return null;
    const fLeft = salvoFollow ? (salvoFollow.atomsLeft + salvoFollow.hydrosLeft) : 0;
    // 블록에 남은 수소 (hTotal - hSent)
    let blkHydroLeft = 0;
    for (let i = 0; i < salvoQueue.length; i++) {
      const it = salvoQueue[i];
      if (it && it.hTotal) blkHydroLeft += Math.max(0, it.hTotal - (it.hSent || 0));
    }
    return {
      items: salvoQueue.length,
      remaining: salvoPending(),
      hydroPending: blkHydroLeft + (salvoHydro ? 1 : 0) + (salvoFollow ? salvoFollow.hydrosLeft : 0),
      hydroFinished: salvoHydroDone,
      finished: salvoDone,
      followLeft: fLeft,
      total: salvoDone + salvoPending() + (salvoHydro ? 1 : 0) + fLeft,
    };
  }

  function salvoClear(msg) {
    // 큐가 비고 타이머도 없어도, 이번 연속 살포에서 이미 발사한 게 있으면
    // '진행 중이던 작업'이므로 완료/중단 토스트를 띄운다.
    const wasRunning = salvoQueue.length > 0 || salvoTimer !== null || salvoDone > 0 || salvoHydro !== null || salvoHydroDone > 0 || salvoFollow !== null;
    if (salvoTimer !== null) { clearTimeout(salvoTimer); salvoTimer = null; }
    if (salvoHydroTimer !== null) { clearTimeout(salvoHydroTimer); salvoHydroTimer = null; }
    let fDrop = 0;
    if (salvoFollow !== null) { if (salvoFollow.timer !== null) clearTimeout(salvoFollow.timer); fDrop = salvoFollow.atomsLeft + salvoFollow.hydrosLeft; salvoFollow = null; }
    if (!wasRunning) return;
    const finished = salvoDone, items = salvoItemsDone, dropped = salvoPending();
    const hFin = salvoHydroDone, hDrop = (salvoHydro ? 1 : 0) + fDrop;
    const hTxt = hFin > 0 ? ` + 수소 ${hFin}발` : "";
    salvoQueue = []; salvoHydro = null;
    salvoDone = 0; salvoItemsDone = 0; salvoDryWaits = 0; salvoHydroDone = 0;
    // lastStrike 는 '직전 계획'으로 남긴다 (HUD·진단이 참조). 새 살포 시작 시 갱신된다.
    if (msg) {
      toast(`${msg} — ${finished.toLocaleString()}발${hTxt} 발사됨${(dropped + hDrop) > 0 ? ` · 대기 ${(dropped + hDrop).toLocaleString()}발 폐기` : ""}`, "#ffaa00");
    } else {
      toast(`☢️ 대량 발사 완료 — ${finished.toLocaleString()}발${hTxt} (${items}건)`, "#7ee787");
    }
  }

  // Esc/중단용 별칭 (기존 이름 유지)
  function salvoStop(msg) { salvoClear(msg); }

  function salvoBatchSize() { return Math.max(1, Math.min(CFG.salvoBatch || 10, RL.perSecond)); }
  function salvoPeriodMs() { return Math.max(1000, CFG.salvoBatchPeriodMs || 1150); }

  // ── 살포 가드용 조회 (골드 / 발사관) ──
  // 전부 '읽기 전용'이다. 읽을 수 없으면 null을 돌려주고 검사를 생략한다
  // (잘못 읽고 멈추는 것보다, 서버 자체 판정에 맡기는 편이 안전).
  function atomCostPerBomb() {
    // 원자폭탄 1발 단가. null = 확인 불가(검사 생략) / 0n = 무료(무한골드 로비)
    try {
      const g = getGameView();
      if (!g) return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      const cfg = typeof g.config === "function" ? g.config() : null;
      if (!me || !cfg) return null;
      try { if (typeof cfg.infiniteGold === "function" && cfg.infiniteGold()) return 0n; } catch (e) {}
      const info = typeof cfg.unitInfo === "function" ? cfg.unitInfo("Atom Bomb") : null;
      if (info && typeof info.cost === "function") {
        try {
          const c = info.cost(g, me);
          if (c !== null && c !== undefined) return toBig(c);
        } catch (e) {}
      }
      return 750000n;   // Config.ts: AtomBomb = 750,000 (표준 단가)
    } catch (e) { return null; }
  }

  function myGold() {
    // 내 골드 (BigInt). 읽기 실패 시 null
    try {
      const g = getGameView();
      const me = g && typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (me && typeof me.gold === "function") return toBig(me.gold());
    } catch (e) {}
    return null;
  }

  function readyTubes() {
    // 지금 장전돼 있는 발사관 수 (사일로 레벨 합 − 재장전 중). 읽기 실패 시 null
    try {
      const g = getGameView();
      const me = g && typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (me && typeof me.readyMissileCount === "function") return me.readyMissileCount();
    } catch (e) {}
    return null;
  }

  function hydroCostPerBomb() {
    // 수소폭탄 1발 단가. null = 확인 불가 / 0n = 무료(무한골드 로비)
    try {
      const g = getGameView();
      if (!g) return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      const cfg = typeof g.config === "function" ? g.config() : null;
      if (!me || !cfg) return null;
      try { if (typeof cfg.infiniteGold === "function" && cfg.infiniteGold()) return 0n; } catch (e) {}
      const info = typeof cfg.unitInfo === "function" ? cfg.unitInfo("Hydrogen Bomb") : null;
      if (info && typeof info.cost === "function") {
        try {
          const c = info.cost(g, me);
          if (c !== null && c !== undefined) return toBig(c);
        } catch (e) {}
      }
      return 5000000n;   // Config.ts: HydrogenBomb = 5,000,000
    } catch (e) { return null; }
  }

  // ═════════════════════════════════════════════
  // SAM 뚫기 시뮬레이터 — 수소타격 계획 (v2.5)
  //
  // 게임 소스로 확정한 모델:
  //  · SAM 슬롯 = 레벨. 요격 후 90틱(9.0초) 점유, 1개씩 회복(FIFO).
  //    → '사각창' = 모든 슬롯이 점유된 채 회복이 없는 구간.
  //      수소가 이 창 안에 도착하면 어떤 슬롯도 요격할 수 없다.
  //  · 폭탄 교전창 = [도착 − 18.333ms×사거리, 도착 − 200ms].
  //    수소는 SAM의 최우선 표적이라 이 창에 빈 슬롯이 '한 번이라도'
  //    생기면 요격된다 → 도착 시각을 사각창 한가운데로 역산한다.
  //  · 사일로 발사관(레벨): 같은 사일로 연속 발사는 1틱씩 밀리고(체인),
  //    배정은 '쿨다운 아닌 가장 가까운 사일로'가 받는다.
  //    → 사일로 기수(=병렬성)가 도착 분산을 좌우한다.
  //  · 전송: 창(1,150ms)당 최대 10건 × 50발. 관 부족분은 부분 발사(드롭 0).
  //
  // 수소타격 3단계 (새 키 I):
  //   ① 목표를 커버하는 모든 SAM을 분석해 필요 원자 C를 시뮬로 계산 → 전량 발사
  //   ② C파동의 사각창에 도착하도록 역산한 시각에 수소 1발
  //   ③ 그후 원자 3~5%(랜덤) 추가 벌크
  // ═════════════════════════════════════════════
  // ── 시뮬 코어 (순수 계산 — 게임 객체 미사용) ──
  //   게임 소스로 확정한 규칙:
  //     · 핵은 사일로→목표를 '3차 베지어(포물선)'로 난다 — 방향 설정(정/역)에 따라
  //       위(-y)로 솟거나 아래(+y)로 처진다. 같은 사일로라도 목표가 다르면 궤적이 다르다.
  //     · SAM이 핵을 격추하려면 그 순간 핵이 ① 목표 150타일 이내 '또는' 발사 사일로
  //       150타일 이내(targetable)이고 ② SAM 사거리 이내이며 ③ SAM 미사일이 먼저 도착해야 한다.
  //     · 따라서 '어느 SAM이 이 타격에 참여하는가'는 직선거리가 아니라 궤적 형상이 결정한다.
  const SIMC = { TICK: 100, CD_T: 90, SPEED_T: 10, SAM_MSL: 12, TGT_R: 150, END_MS: 200, WIN: 1150, PER: 50 };
  let stH2LastGap = null;   // H2가 격추되는 지점 진단 (실패 사유 설명용)

  function samRangeAtLevel(level) {
    try {
      const g = getGameView();
      const cfg = g && typeof g.config === "function" ? g.config() : null;
      if (cfg && typeof cfg.samRange === "function") {
        const r = cfg.samRange(level);
        if (Number.isFinite(r) && r > 0) return r;
      }
    } catch (e) {}
    return 150 - 480 / (Math.max(1, level) + 5);   // Config.ts 폴백
  }

  // 지도 높이 (베지어 제어점 클램프용) — 못 읽으면 0 (클램프 생략)
  function simMapH() {
    try {
      const g = getGameView();
      if (g && typeof g.height === "function") {
        const h = g.height();
        if (Number.isFinite(h) && h > 1) return h;
      }
    } catch (e) {}
    return 0;
  }

  // ── 경로: 사일로→목표 3차 베지어 (게임 getParabolaControlPoints와 동일 규칙) ──
  //   dirUp=true → 위로 솟음 / false → 아래로 처짐.  누적 호장(cum)을 함께 돌려준다.
  function stPath(sx, sy, tx, ty, dirUp, n, mapH) {
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const h = Math.max(dist / 3, 50);          // PARABOLA_MIN_HEIGHT = 50
    const hm = dirUp ? -1 : 1;
    let c1x = sx + dx / 4, c1y = sy + dy / 4 + hm * h;
    let c2x = sx + dx * 3 / 4, c2y = sy + dy * 3 / 4 + hm * h;
    if (mapH > 0) {                            // 게임과 동일하게 제어점을 지도 안으로 클램프
      if (c1y < 0) c1y = 0; else if (c1y > mapH - 1) c1y = mapH - 1;
      if (c2y < 0) c2y = 0; else if (c2y > mapH - 1) c2y = mapH - 1;
    }
    // 샘플링: 요격은 '목표 150 이내 or 사일로 150 이내'에서만 가능하므로
    //   양 끝 구간을 3배 밀집 샘플링한다 (중간 구간은 요격 불가라 듬성해도 무방).
    // 경로 샘플: 기본 3중(촘촘), 대규모에선 호출부가 n을 낮춘다.
    //   (요격 경계는 '목표/사일로 150 이내' 구간에서 결정되므로 그쪽만 촘촘하면 충분)
    const N = n || 48;
    const ts = [0];
    for (let i = 0; i < N; i++) {
      const a = i / N, b = (i + 1) / N;
      ts.push(a + (b - a) / 3);
      ts.push(a + (b - a) * 2 / 3);
      ts.push(b);
    }
    ts.sort((a, b) => a - b);
    const pts = new Array(ts.length);
    let arc = 0, lx = sx, ly = sy;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i], mt = 1 - t;
      const x = mt * mt * mt * sx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tx;
      const y = mt * mt * mt * sy + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ty;
      if (i > 0) { const ax = x - lx, ay = y - ly; arc += Math.sqrt(ax * ax + ay * ay); }
      pts[i] = { x: x, y: y, cum: arc };
      lx = x; ly = y;
    }
    const flightT = Math.max(1, Math.ceil(arc / SIMC.SPEED_T));
    return { pts, arc, flightT, flightMs: flightT * SIMC.TICK, dist };
  }

  // ── SAM별 '격추 가능 구간' (발사 시각=0 기준 상대 ms) ──
  //   경로점 하나하나에 대해 세 조건을 검사해 만족하는 연속 구간을 뽑는다.
  //   out: { samIndex → [{s,e}] }
  // ── SAM별 '격추 가능 구간' (발사 시각=0 기준 상대 ms) ──
  //   게임(SAMLauncherExecution)의 판정을 그대로 옮긴다:
  //     ① computeInterceptionTile: 경로를 따라가며
  //        - 그 지점이 요격 가능(targetable: 목표 150 or 사일로 150 이내)
  //        - SAM 사거리 이내
  //        - nukeTicks(그 지점까지 남은 핵 비행 틱) >= samTicks(SAM 미사일 도달 틱)
  //        이면 그 틱에 발사한다 → 교전 성립.
  //     ② checkDetonationInterception: 마지막 타일(폭발 직전)도 별도로 검사한다
  //        (경로 끝에서 급격히 가까워지는 경우를 잡기 위함).
  //   샘플을 촘촘히(경로 전체를 1타일 간격에 가깝게) 훑어 경계를 놓치지 않는다.
  function stEngage(path, sams, sx, sy, tx, ty, out) {
    const pts = path.pts, arc = path.arc, fT = path.flightT, fMs = path.flightMs;
    const R2 = SIMC.TGT_R * SIMC.TGT_R;
    for (let si = 0; si < sams.length; si++) {
      const S = sams[si];
      const r = (S.rng && S.rng > 0) ? S.rng : 150;
      const r2 = r * r;
      let s0 = -1, e0 = -1, list = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const dT = (p.x - tx) * (p.x - tx) + (p.y - ty) * (p.y - ty);
        const dS = (p.x - sx) * (p.x - sx) + (p.y - sy) * (p.y - sy);
        let ok = false;
        if (dT <= R2 || dS <= R2) {                       // 요격 가능 지점 (targetable)
          const ddx = p.x - S.x, ddy = p.y - S.y;
          if (ddx * ddx + ddy * ddy <= r2) {              // SAM 사거리 이내
            const mdist = Math.abs(ddx) + Math.abs(ddy);
            const samT = Math.ceil(mdist / SIMC.SAM_MSL);
            const nukeT = ((arc - p.cum) / arc) * fT;     // 남은 비행 틱
            // 게임과 동일: 핵의 남은 비행이 SAM 미사일 도달보다 길거나 같아야 발사 가능
            //   (여유 2틱을 둔다 — 폭발 직전엔 판정이 촘촘해 실전 오차를 흡수)
            if (nukeT >= samT - 2) ok = true;
          }
        }
        if (ok) { if (s0 < 0) s0 = p.cum; e0 = p.cum; }
        else if (s0 >= 0) { (list || (list = [])).push({ s: s0, e: e0 }); s0 = -1; }
      }
      if (s0 >= 0) (list || (list = [])).push({ s: s0, e: e0 });
      if (list) {
        const ivs = [];
        for (let k = 0; k < list.length; k++) {
          const a = (list[k].s / arc) * fMs, b = (list[k].e / arc) * fMs;
          if (ivs.length && a <= ivs[ivs.length - 1].e + 200) { if (b > ivs[ivs.length - 1].e) ivs[ivs.length - 1].e = b; }
          else ivs.push({ s: a, e: b });
          // 마지막 지점까지 계속: 구간을 최소 폭(300ms)으로 보정 — 실전 요격은 순간적
        }
        for (let k = 0; k < ivs.length; k++) { if (ivs[k].e - ivs[k].s < 300) ivs[k].e = ivs[k].s + 300; }
        out[si] = ivs;
      }
    }
    return out;
  }

  // 구간 목록 병합 (정렬 + 겹침/근접 병합)
  function stMergeIvs(list) {
    if (!list || !list.length) return null;
    list.sort((a, b) => a.s - b.s);
    const out = [{ s: list[0].s, e: list[0].e }];
    for (let i = 1; i < list.length; i++) {
      const iv = list[i], last = out[out.length - 1];
      if (iv.s <= last.e + 60) { if (iv.e > last.e) last.e = iv.e; }
      else out.push({ s: iv.s, e: iv.e });
    }
    return out;
  }

  // 목표 지역을 '실제로 위협하는' 적 SAM 집계. null = 읽기 불가(계획 생략)
  //   참여 판정 = 목표 근처 직선(사거리) '또는' 내 사일로→목표 궤적상 격추 가능 구간 존재
  function samDefenders(tile) {
    try {
      const g = getGameView();
      if (!g || typeof g.units !== "function" || typeof g.x !== "function" || typeof g.y !== "function") return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (!me || typeof me.id !== "function") return null;
      const t = (tile === undefined || tile === null) ? computeCursorTile() : tile;
      if (t === null || t === undefined) return null;
      let tx, ty;
      try { tx = g.x(t); ty = g.y(t); } catch (e) { return null; }
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      const list = g.units("SAM Launcher");
      if (!list || typeof list.length !== "number") return null;
      // 내 사일로 위치 (궤적 계산용)
      let silPos = [];
      try {
        const sil = mySilos(t);
        if (sil) for (let i = 0; i < sil.length; i++) if (Number.isFinite(sil[i].x) && Number.isFinite(sil[i].y)) silPos.push(sil[i]);
      } catch (e) {}
      // 1차 후보 필터: 궤적·목표 어디에도 닿을 수 없는 SAM은 제외
      const cand = [];
      const rej = [];   // 진단용: 왜 제외됐는지
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        try {
          const o = (typeof u.owner === "function") ? u.owner() : null;
          if (!o || typeof o.id !== "function") continue;
          { let eq = false;
            try { let oS = null, mS = null;
              if (typeof o.smallID === "function") oS = o.smallID();
              if (typeof me.smallID === "function") mS = me.smallID();
              if (oS !== null && oS !== 0 && mS !== null && oS === mS) eq = true;
              if (!eq && typeof o.id === "function" && typeof me.id === "function") eq = (o.id() === me.id());
            } catch (e) {}
            if (eq) continue; }
          if (typeof o.isFriendly === "function" && o.isFriendly(me)) { rej.push({ id: u.id ? u.id() : "?", why: "friendly" }); continue; }
          if (typeof u.isUnderConstruction === "function" && u.isUnderConstruction()) { rej.push({ id: u.id ? u.id() : "?", why: "building" }); continue; }
          const lv = Math.max(1, (typeof u.level === "function" ? (u.level() || 1) : 1));
          const rng = samRangeAtLevel(lv);
          const ut = u.tile();
          const ux = g.x(ut), uy = g.y(ut);
          const dT = Math.sqrt((ux - tx) * (ux - tx) + (uy - ty) * (uy - ty));
          let dS = Infinity;
          for (let si = 0; si < silPos.length; si++) {
            const dd = Math.sqrt((ux - silPos[si].x) * (ux - silPos[si].x) + (uy - silPos[si].y) * (uy - silPos[si].y));
            if (dd < dS) dS = dd;
          }
          // 요격점은 목표 150 or 사일로 150 이내여야 하므로, (rng+150) 밖이면 불가
          const lim = rng + 150 + 60;
          if (dT > lim && dS > lim) { rej.push({ id: u.id ? u.id() : "?", why: "far", dT: Math.round(dT), dS: Math.round(dS), lim: Math.round(lim) }); continue; }
          cand.push({ lv, rng, x: ux, y: uy, dT, dS });
        } catch (e) {}
      }
      const out = [];
      if (!cand.length) return { n: 0, sumLevel: 0, maxRange: 150, defs: [], _diag: { total: list.length, rej, cand: 0, silN: silPos.length, tx, ty } };
      if (silPos.length) {
        // 궤적 기반 참여 판정 — 사일로별로 1회
        const dirUp = getRocketDirectionUp();
        const mapH = simMapH();
        const mask = new Uint8Array(cand.length);
        const sN2 = silPos.length > 40 ? 16 : (silPos.length > 20 ? 24 : 32);
        for (let pi = 0; pi < silPos.length; pi++) {
          const P = stPath(silPos[pi].x, silPos[pi].y, tx, ty, dirUp, sN2, mapH);
          const ivs = stEngage(P, cand, silPos[pi].x, silPos[pi].y, tx, ty, {});
          for (const kk in ivs) mask[kk | 0] = 1;
        }
        for (let i = 0; i < cand.length; i++) {
          if (!mask[i]) continue;
          const c = cand[i];
          out.push({ d: c.dT, lv: c.lv, rng: c.rng, x: c.x, y: c.y, via: c.dT <= c.rng ? "target" : "path" });
        }
      } else {
        // 사일로를 못 읽으면 보수적으로: 목표 기준 사거리 + 여유(150)
        for (let i = 0; i < cand.length; i++) {
          const c = cand[i];
          if (c.dT <= c.rng + 150) out.push({ d: c.dT, lv: c.lv, rng: c.rng, x: c.x, y: c.y, via: "target" });
        }
      }
      if (!out.length) return { n: 0, sumLevel: 0, maxRange: 150, defs: [] };
      let sumLevel = 0, maxRange = 0, nPath = 0;
      for (let k = 0; k < out.length; k++) {
        sumLevel += out[k].lv;
        if (out[k].rng > maxRange) maxRange = out[k].rng;
        if (out[k].via === "path") nPath++;
      }
      return { n: out.length, sumLevel, maxRange: maxRange > 0 ? maxRange : 150, defs: out, nPath };
    } catch (e) { return null; }
  }

  // 내 사일로(발사관) 목록 — [{dist, level, x, y}] · null = 읽기 불가
  function mySilos(tile) {
    try {
      const g = getGameView();
      if (!g || typeof g.units !== "function" || typeof g.x !== "function" || typeof g.y !== "function") return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (!me || typeof me.id !== "function") return null;
      const t = (tile === undefined || tile === null) ? computeCursorTile() : tile;
      if (t === null || t === undefined) return null;
      const tx = g.x(t), ty = g.y(t);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      const list = g.units("Missile Silo") || [];
      const out = [];
      // 게임 내부는 smallID(숫자)로 소유자를 비교한다 — id()는 문자열(클라이언트 ID).
      let mySmall = null, myId = null;
      try { if (typeof me.smallID === "function") mySmall = me.smallID(); } catch (e) {}
      try { if (typeof me.id === "function") myId = me.id(); } catch (e) {}
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        try {
          const o = typeof u.owner === "function" ? u.owner() : null;
          if (!o) continue;
          let ok = false;
          let oSmall = null;
          try { if (typeof o.smallID === "function") oSmall = o.smallID(); } catch (e) {}
          if (oSmall !== null && oSmall !== 0 && mySmall !== null && oSmall === mySmall) ok = true;
          if (!ok && myId !== null) { try { if (typeof o.id === "function" && o.id() === myId) ok = true; } catch (e) {} }
          if (!ok) continue;
          if (typeof u.isUnderConstruction === "function" && u.isUnderConstruction()) continue;
          const ut = u.tile();
          const ux = g.x(ut), uy = g.y(ut);
          const dx = ux - tx, dy = uy - ty;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (!Number.isFinite(d)) continue;
          out.push({ dist: d, level: Math.max(1, (typeof u.level === "function" ? (u.level() || 1) : 1)), x: ux, y: uy });
        } catch (e) {}
      }
      return out;
    } catch (e) { return null; }
  }

  // ═════════════════════════════════════════════
  // v2.8 단순 모드 — 커서 지점 150타일 내 적 SAM 전부 수집
  //
  //   복잡한 경로/타이밍 시뮬 없이 '레벨 합'만 본다:
  //     발사량 = ceil(ΣLv × samSimpleMult)   (기본 1.2 = 20% 더)
  //   수소는 원자 살포 후 1발, 그 뒤 원자·수소 몇 발 더.
  //   ※ 사거리 밖·경로 밖 SAM도 포함한다(보수적 = 더 많이 쏨).
  // ═════════════════════════════════════════════
  function samsNear(tile, range) {
    try {
      const g = getGameView();
      if (!g || typeof g.units !== "function" || typeof g.x !== "function" || typeof g.y !== "function") return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (!me || typeof me.id !== "function") return null;
      const t = (tile === undefined || tile === null) ? computeCursorTile() : tile;
      if (t === null || t === undefined) return null;
      let tx, ty;
      try { tx = g.x(t); ty = g.y(t); } catch (e) { return null; }
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      const R = Number.isFinite(range) && range > 0 ? range : (CFG.samSimpleRange | 0) || 150;
      const R2 = R * R;
      const list = g.units("SAM Launcher") || [];
      const out = [];
      let sumLevel = 0, skipped = 0, mine = 0, building = 0;
      // ── 내 식별자 (게임 내부는 smallID(숫자)로 비교한다 — id()는 문자열) ──
      let mySmall = null, myId = null;
      try { if (typeof me.smallID === "function") mySmall = me.smallID(); } catch (e) {}
      try { if (typeof me.id === "function") myId = me.id(); } catch (e) {}
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        // ── 반경 안이면 '무조건' 카운트한다 (오탐 방지 최우선) ──
        //   제외는 단 두 가지뿐: ① 내 SAM ② 아군 SAM
        //   건설 중·소유자 판독 실패 등은 전부 '포함'(보수적 = 더 많이 쏨)
        let ux = null, uy = null, d = null;
        try {
          const ut = u.tile();
          ux = g.x(ut); uy = g.y(ut);
          if (Number.isFinite(ux) && Number.isFinite(uy)) {
            const dx = ux - tx, dy = uy - ty;
            d = Math.sqrt(dx * dx + dy * dy);
            if (d > R) continue;                        // 반경 밖만 제외
          } else { skipped++; }                          // 좌표 못 읽음 → 포함
        } catch (e) { skipped++; }                       // 타일 못 읽음 → 포함
        // ── 내 것/아군인가? ──
        //   주의: owner()는 ① 무주지(smallID 0)면 TerraNullius를 반환하고
        //         ② 못 찾으면 예외를 던진다. 둘 다 '적 취급'으로 포함해야 한다.
        let isMine = false;
        try {
          const o = typeof u.owner === "function" ? u.owner() : null;
          if (o) {
            // smallID 비교 (게임 내부와 동일 기준)
            let oSmall = null;
            try { if (typeof o.smallID === "function") oSmall = o.smallID(); } catch (e) {}
            if (oSmall !== null && oSmall !== 0 && mySmall !== null && oSmall === mySmall) isMine = true;
            // id() 비교 (문자열) — 둘 다 있을 때만
            if (!isMine && myId !== null) {
              try { if (typeof o.id === "function" && o.id() === myId) isMine = true; } catch (e) {}
            }
            // 아군 판정 — 단, 무주지(ZF)나 isPlayer()가 아닌 객체는 아군이 아니다
            if (!isMine && typeof o.isPlayer === "function") {
              try {
                const pl = o.isPlayer();
                if (pl && typeof o.isFriendly === "function" && o.isFriendly(me)) isMine = true;
              } catch (e) {}
            } else if (!isMine && typeof o.isFriendly === "function") {
              // isPlayer가 없으면 isFriendly만으로 판단 (기존 동작)
              try { if (o.isFriendly(me)) isMine = true; } catch (e) {}
            }
          }
        } catch (e) {}   // 판독 예외 → 포함(적 취급)
        if (isMine) { mine++; continue; }
        try { if (typeof u.isUnderConstruction === "function" && u.isUnderConstruction()) building++; } catch (e) {}
        const lv = Math.max(1, (typeof u.level === "function" ? (u.level() || 1) : 1));
        sumLevel += lv;
        out.push({ lv, x: ux, y: uy, d, rng: samRangeAtLevel(lv) });
      }
      return { n: out.length, sumLevel, defs: out, range: R, tx, ty, skipped, mine, building, total: list.length };
    } catch (e) { return null; }
  }

  // ── 단순 판정 (v2.8.1) ──
  //   ① 9초 내 발사: 사일로 체인(1발/틱=10발/초)으로 다 나가는가 + 관 부족으로 멈추지 않는가
  //   ② 수소 착탄: 원자가 적 SAM 슬롯(ΣLv)을 전부 채우면 수소는 막히지 않는다
  //   ※ 게임 물리: SAM슬롯 1개 = 미사일 1발 = 90틱(9초) 점유. 사일로도 관 1개당 9초 점유.
  function simpleVerdict(ana, shots, tile) {
    if (!ana || !(ana.sumLevel > 0) || !(shots > 0)) return null;
    // ── 내 사일로 (관 수·거리)
    let tubes = 0, siloN = 0, dMin = Infinity, dMax = 0;
    try {
      const silos = mySilos(tile);
      if (silos && silos.length) {
        siloN = silos.length;
        for (let i = 0; i < silos.length; i++) {
          tubes += Math.max(1, silos[i].level | 0);
          const d = silos[i].dist;
          if (Number.isFinite(d)) { if (d < dMin) dMin = d; if (d > dMax) dMax = d; }
        }
      }
    } catch (e) {}
    // ── 게임 발사 규칙: nukeSpawn 은 '가장 가까운 준비된 사일로'를 고른다.
    //   → 관이 충분하면 가까운 사일로 몇 기만 쓰고 먼 사일로는 안 쓴다.
    //   (사일로 목록을 거리순으로 보고, 필요한 만큼만 사용)
    let usedN = siloN, dUsedMin = dMin, dUsedMax = dMin;
    if (siloN > 0) {
      const ds = [];
      try {
        const silos = mySilos(tile) || [];
        for (let i = 0; i < silos.length; i++) {
          const d = silos[i].dist;
          if (Number.isFinite(d)) ds.push({ d, lv: Math.max(1, silos[i].level | 0) });
        }
      } catch (e) {}
      ds.sort((a, b) => a.d - b.d);
      if (ds.length) {
        dUsedMin = ds[0].d;
        // 가까운 사일로부터 관을 채워나가, 발수를 감당할 만큼만 사용
        let acc = 0, k = 0;
        while (k < ds.length && acc < shots) { acc += ds[k].lv; k++; }
        usedN = Math.max(1, k);
        dUsedMax = ds[usedN - 1].d;
      }
    }
    // ── ① 발사(런치) 시간 — 사용 사일로 체인: 1기당 최대 10발/초
    const rate = 10 * Math.max(1, usedN);
    const launchSec = siloN > 0 ? shots / rate : null;
    const tubeOk = siloN > 0 ? shots <= tubes : false;
    // ── ② 도착 분산 — '사용된' 사일로 거리차 ÷ 핵 속도(100타일/초)
    const flySpread = (Number.isFinite(dUsedMin) && dUsedMax > dUsedMin) ? (dUsedMax - dUsedMin) / 100 : 0;
    const flyNear = Number.isFinite(dUsedMin) ? dUsedMin / 100 : 0;
    // 전체 공격 창 = 발사 시간 + 도착 분산 (마지막 폭탄이 떨어지기까지)
    const arriveSpan = (launchSec || 0) + flySpread;
    const in9 = tubeOk && arriveSpan <= 9;
    // ── ③ 수소 착탄 — 게임 물리(단순 모델)
    //   · 적 SAM 총 슬롯 = ΣLv. 미사일 1발이 슬롯 1개를 90틱(9초) 점유한다.
    //   · 원자로 슬롯을 전부 채우면 그 순간 수소는 요격되지 않는다.
    //   · 단 그 '전부 점유' 상태는 9초만 유지된다 → 공격 창이 9초 안이어야 한다.
    const slots = ana.sumLevel;
    const enough = shots >= slots;          // 슬롯을 채울 만큼 원자가 있는가
    const h2Pass = enough && in9;           // 창 안에 다 들어가야 수소가 산다
    return { tubes, siloN, usedN, launchSec, tubeOk, arriveSpan, flySpread, flyNear, in9,
             slots, enough, h2Pass, shots, samSL: ana.sumLevel, samN: ana.n,
             dUsedMin: Number.isFinite(dUsedMin) ? dUsedMin : null,
             dUsedMax: Number.isFinite(dUsedMax) ? dUsedMax : null };
  }

  // 판정 문자열 (HUD·토스트 공용)
  function verdictText(v) {
    if (!v) return "";
    let t9;
    if (v.siloN === 0) t9 = "⏱ 사일로 없음 → 건설 필요";
    else if (!v.tubeOk) t9 = `⏱ 관 부족 ❌ (내관Σ${v.tubes} < ${v.shots.toLocaleString()}발 · 사일로 증설)`;
    else if (v.in9) t9 = `⏱ 9초 내 ✅ (${v.shots.toLocaleString()}발 · 약 ${v.arriveSpan.toFixed(1)}초 · 사일로 ${v.usedN}/${v.siloN}기)`;
    else t9 = `⏱ 9초 초과 ⚠️ (약 ${v.arriveSpan.toFixed(1)}초 — 사일로 기수↑ 또는 가까운 사일로)`;
    let h2;
    if (!v.enough) h2 = `💧 수소 위험 ⚠️ (원자 ${v.shots.toLocaleString()} < 적 슬롯 ${v.slots} · 원자 부족)`;
    else if (!v.in9) h2 = `💧 수소 위험 ⚠️ (슬롯은 채우나 창이 9초 초과)`;
    else h2 = `💧 수소 착탄 ✅ (원자 ${v.shots.toLocaleString()} ≥ 적 슬롯 ${v.slots})`;
    return t9 + "\n" + h2;
  }

  // 단순 모드 발사량: ΣLv × 1.2 (최소 1)
  function simpleShots(ana) {
    if (!ana || !(ana.sumLevel > 0)) return 0;
    const mult = Number.isFinite(CFG.samSimpleMult) && CFG.samSimpleMult > 0 ? CFG.samSimpleMult : 1.2;
    return Math.max(1, Math.ceil(ana.sumLevel * mult));
  }

  // ── 발사 스트림: 원자 (C+E)발 — 창 스케줄·관 회복·체인 정밀 모델 ──
  //   shiftAt = max(발사틱+90, 앞 발사 shiftAt+1) · dep = max(체인, 발사틱+1)
  //   반환 { arr(도착,정렬), arrSilo, arrL(발사ms), h, qs, drops, tMainMs }
  //   최적화: 사일로를 '거리순'으로 미리 정렬하고, 각 사일로의 체인·관 상태를
  //   O(1)로 유지한다(증분 갱신). 발사마다 전 사일로를 다시 훑지 않는다.
  function stStream(silos, C, E, hTick) {
    const st = silos.map((x, idx) => ({ idx, d: x.dist, lv: Math.max(1, x.level | 0), q: [], out: 0, lastLt: -1, lastDep: 0, free: Math.max(1, x.level | 0) }))
                     .sort((a, b) => a.d - b.d);          // 거리 오름차순 = 배정 우선순위
    const NS = st.length;
    const total = C + E, intents = Math.ceil(total / SIMC.PER);
    const rec = [];
    let h = null, hDone = (hTick === undefined || hTick === null || hTick < 0);
    let sent = 0, drops = 0, tMainMs = 0;

    // 회복 반영 (그 사일로만, O(회복 수))
    function refresh(s, t) {
      while (s.out < s.q.length && s.q[s.out].shiftAt <= t) {
        s.out++;
        s.free++;
      }
    }
    function fireAt(si, t) {
      const s = st[si];
      refresh(s, t);
      // 체인: 마지막 발사 이후 1틱 뒤 또는 t+1 중 늦은 것 (큐가 비면 lastDep 유지)
      let dep = s.lastDep + 1 > t + 1 ? s.lastDep + 1 : t + 1;
      s.lastDep = dep;
      s.lastLt = t;
      const prevShift = s.q.length ? s.q[s.q.length - 1].shiftAt : 0;
      s.q.push({ lt: t, shiftAt: Math.max(t + SIMC.CD_T, prevShift + 1) });
      s.free--;
      return { dep: dep, si: s.idx, L: t * SIMC.TICK };
    }
    // 빈 관이 있는 '가장 가까운' 사일로 — 거리순이라 앞에서 첫 히트
    function pickAndFire(t) {
      for (let i = 0; i < NS; i++) {
        const s = st[i];
        if (s.free > 0) return fireAt(i, t);
        if (s.q.length > s.out && s.q[s.out].shiftAt <= t) { refresh(s, t); if (s.free > 0) return fireAt(i, t); }
      }
      return null;
    }
    for (let j = 0; j < intents; j++) {
      const sendMs = Math.floor(j / 10) * SIMC.WIN + (j % 10) * 5;
      const t = Math.floor(sendMs / SIMC.TICK);
      if (!hDone && t >= hTick) {
        const r = pickAndFire(hTick);
        h = r ? { F: hTick * SIMC.TICK, dep: r.dep, si: r.si, L: r.L, fail: false } : { F: hTick * SIMC.TICK, fail: true };
        hDone = true;
      }
      const nB = Math.min(SIMC.PER, total - sent);
      if (sent < C && sent + nB >= C) tMainMs = sendMs;
      for (let b = 0; b < nB; b++) {
        const r = pickAndFire(t);
        if (!r) { drops++; continue; }
        rec.push(r);
      }
      sent += nB;
    }
    if (!hDone) {
      const r = pickAndFire(hTick);
      h = r ? { F: hTick * SIMC.TICK, dep: r.dep, si: r.si, L: r.L, fail: false } : { F: hTick * SIMC.TICK, fail: true };
    }
    rec.sort((a, b) => a.dep - b.dep || a.L - b.L);
    // qs: 원본 silos 인덱스 순으로 재배치 (호출부가 silos[i] / siloData[i]와 짝지어 쓴다)
    const qs = new Array(silos.length);
    for (let i = 0; i < NS; i++) qs[st[i].idx] = st[i].q;
    return {
      rec,
      arr: rec.map((r) => r.dep),
      arrSilo: rec.map((r) => r.si),
      arrL: rec.map((r) => r.L),
      h, qs, drops, tMainMs: tMainMs || 0,
    };
  }

  // dep(틱) → 도착 ms (경로 호장 기반 비행시간)
  function arrMs(depTick, flightMs) { return depTick * SIMC.TICK + flightMs; }

  // ── 틱 스윕: 격추 시뮬 ──
  //   bombs: [{a(도착ms), ivs(절대ms 격추가능구간들)}] — a 오름차순
  //   각 틱: 빈 슬롯이 있고 '격추 가능 구간 중'인 폭탄이 있으면 '가장 임박한(구간끝이 이른)' 것부터 격추.
  //   슬롯은 90틱(9s) 점유 후 1개씩 회복.
  //   반환 { runs(전 슬롯 점유·무회복 구간 = 사각창), maxBusy, kills }
  //   ivsFn(bomb) → 그 폭탄의 절대 격추구간 목록 (필요할 때 계산)
  function stDeadRuns(sams, bombs, ivsFn) {
    const SL = sams.sumLevel, n = bombs.length;
    if (!n || !(SL > 0)) return { runs: [], maxBusy: 0, kills: 0 };
    // 이벤트(진입/이탈) 정렬
    const ivsCache = new Array(n);
    for (let b = 0; b < n; b++) ivsCache[b] = ivsFn ? ivsFn(bombs[b]) : (bombs[b].ivs || null);
    const evs = [];
    for (let b = 0; b < n; b++) {
      const ivs = ivsCache[b];
      if (!ivs) continue;
      for (let k = 0; k < ivs.length; k++) {
        if (ivs[k].e <= ivs[k].s) continue;
        evs.push({ t: ivs[k].s, b, k, ty: 1 });
        evs.push({ t: ivs[k].e, b, k, ty: -1 });
      }
    }
    evs.sort((a, b) => a.t - b.t);
    const tEnd = bombs[n - 1].a + 9000 + 1000;
    const nT = Math.ceil(tEnd / SIMC.TICK) + 2;
    const dead = new Uint8Array(n);
    const curK = new Int32Array(n).fill(-1);
    const heap = [];                          // 최소 힙 {e, b, k}
    function hpush(e, b, k) {
      heap.push({ e, b, k });
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].e <= heap[i].e) break;
        const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p;
      }
    }
    function hpop() {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].e < heap[m].e) m = l;
          if (r < heap.length && heap[r].e < heap[m].e) m = r;
          if (m === i) break;
          const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m;
        }
      }
      return top;
    }
    const ends = new Float64Array(n + 8);
    const runs = [];
    let busy = 0, eHead = 0, eTail = 0, pe = 0, inPool = 0, maxBusy = 0, kills = 0, cur = null;
    for (let i = 0; i <= nT; i++) {
      const t = i * SIMC.TICK;
      while (eHead < eTail && ends[eHead] <= t) { eHead++; busy--; }
      const freeBefore = SL - busy;
      while (pe < evs.length && evs[pe].t <= t) {
        const ev = evs[pe++];
        if (dead[ev.b]) continue;
        if (ev.ty === 1) {
          if (curK[ev.b] < 0) {
            curK[ev.b] = ev.k; inPool++;
            hpush(ivsCache[ev.b][ev.k].e, ev.b, ev.k);
          }
        } else {
          if (curK[ev.b] === ev.k) { curK[ev.b] = -1; inPool--; }
        }
      }
      let k = freeBefore < inPool ? freeBefore : inPool;
      if (k < 0) k = 0;
      while (k > 0) {
        let victim = -1;
        while (heap.length) {
          const top = hpop();
          const b = top.b;
          if (dead[b]) continue;
          if (curK[b] !== top.k) continue;
          if (ivsCache[b][top.k].e < t - SIMC.TICK) continue;
          victim = b; break;
        }
        if (victim < 0) break;
        dead[victim] = 1; inPool--; busy++; kills++; k--;
        ends[eTail++] = t + 9000;
      }
      if (busy > maxBusy) maxBusy = busy;
      if (freeBefore === 0) { if (!cur) cur = { s: t, e: t }; else cur.e = t; }
      else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    return { runs, maxBusy, kills };
  }

  // ── 계획 ──
  //   opt: { tx, ty, dirUp, cap, margin, bonus, bonusScan, bonusMin, bonusMax, maxBonusTry, mults }
  //   ① 필요 원자 C(가산 포함) ② 사각창 안에 '수소 격추구간 전체가 덮이는' 발사틱
  function stPlan(sams, silos, opt) {
    opt = opt || {};
    if (!sams || !sams.n || !sams.sumLevel || !silos || !silos.length) return { ok: false, why: "input" };
    const SL = sams.sumLevel;
    const tx = Number.isFinite(opt.tx) ? opt.tx : null;
    const ty = Number.isFinite(opt.ty) ? opt.ty : null;
    const dirUp = (opt.dirUp !== undefined) ? !!opt.dirUp : getRocketDirectionUp();
    const mapH = simMapH();
    const defs = (sams.defs && sams.defs.length) ? sams.defs : null;
    // ── 사일로별 경로 + 격추구간 (궤적 기반) ──
    //   경로는 '위치'만의 함수 → 좌표 키로 캐시 (같은 타깃 반복 호출 대비)
    const siloData = [];
    for (let i = 0; i < silos.length; i++) {
      const s = silos[i];
      const sx = Number.isFinite(s.x) ? s.x : (tx !== null ? tx + s.dist : null);
      const sy = Number.isFinite(s.y) ? s.y : (ty !== null ? ty : null);
      let P = null, uni = null, nPart = 0;
      if (sx !== null && tx !== null && defs) {
        // 사일로가 많을수록 샘플을 줄인다 (비용 ∝ 사일로수 × 샘플수)
        const sN = silos.length > 40 ? 16 : (silos.length > 20 ? 24 : 36);
        P = stPath(sx, sy, tx, ty, dirUp, sN, mapH);
        const ivs = stEngage(P, defs, sx, sy, tx, ty, {});
        const all = [];
        for (const kk in ivs) { nPart++; const L2 = ivs[kk]; for (let z = 0; z < L2.length; z++) all.push(L2[z]); }
        uni = stMergeIvs(all);
      }
      siloData.push({ sx, sy, P, uni, nPart });
    }
    const usePaths = !!(defs && tx !== null && siloData.length && siloData[0].P);
    // 폴백(경로 불가): 기존 직선 모델 — lead = 18.333×maxRange 단일 구간
    const leadFallback = Math.round(18.333 * (sams.maxRange || 150));
    const cap = Math.min(opt.cap || 20000, 20000);
    const m = (opt.margin === undefined) ? 150 : opt.margin;

    // 폭탄별 격추구간 — 배열을 매번 새로 만들지 않는다.
    //   · usePaths: 사일로별 uni(발사 기준 상대 ms)를 그대로 쓰고, 절대 시각은 소비측에서 더한다
    //     → bombs[]는 {a(도착ms), si(사일로), L(발사ms)}만 (수천 개라도 가볍다)
    //   · 폴백: 사일로별 직선 구간을 1회 만들어 재사용
    const fallbackIvs = {};
    function bombsOf(stream) {
      const rec = stream.rec, n2 = rec.length;
      const out = new Array(n2);
      for (let b = 0; b < n2; b++) {
        const r = rec[b];
        const sd = siloData[r.si];
        const fm = (sd && sd.P) ? sd.P.flightMs : ((silos[r.si] && silos[r.si].dist ? silos[r.si].dist : 300) * 10);
        out[b] = { a: r.dep * SIMC.TICK + fm, si: r.si, L: r.L };
      }
      out.sort((x, y) => x.a - y.a);
      return out;
    }
    // 폭탄의 절대 격추구간 목록 (소비측에서 필요할 때만 계산)
    function ivsOf(bomb) {
      const sd = siloData[bomb.si];
      if (usePaths && sd && sd.uni) {
        const out = new Array(sd.uni.length);
        for (let z = 0; z < sd.uni.length; z++) out[z] = { s: bomb.L + sd.uni[z].s, e: bomb.L + sd.uni[z].e };
        return out;
      }
      const key = bomb.si;
      if (!fallbackIvs[key]) fallbackIvs[key] = [{ s: -leadFallback, e: -SIMC.END_MS }];   // 도착 기준 상대
      const fb = fallbackIvs[key], out = new Array(fb.length);
      for (let z = 0; z < fb.length; z++) out[z] = { s: bomb.a + fb[z].s, e: bomb.a + fb[z].e };
      return out;
    }

    // 규모 적응 배수: 큰 타격일수록 1.0~1.6배면 충분 (4.5배까지 보면 계산이 수십 배로 는다)
    const mults = opt.mults || (SL >= 1500 ? [1.0, 1.4]
                              : SL >= 600 ? [1.0, 1.3, 1.6]
                              : [1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.5]);
    const budgetMs = (opt.budgetMs | 0) || 30;    // 탐색 시간 상한 (프레임 보호)
    const tStart = Date.now();
    const bonusReq = Math.max(0, opt.bonus | 0);
    const bonusList = [bonusReq];
    if (opt.bonusScan !== false) {
      const bLo = Math.max(1, opt.bonusMin | 0 || 5), bHi = Math.max(bLo, opt.bonusMax | 0 || 50);
      for (let b = bLo; b <= bHi; b += (bHi - bLo > 20 ? 7 : 3)) { if (b !== bonusReq) bonusList.push(b); }
      if (bonusList.length > 1) bonusList.push(bLo);
    }
    // 규모 적응: ΣLv가 크면 조합을 줄인다 (계산 시간이 조합 수에 비례).
    //   작은 규모는 촘촘히(정확), 큰 규모는 거칠게(빠르게) — HUD 반응성 우선.
    const scaleCap = SL >= 400 ? 1 : (SL >= 200 ? 2 : (SL >= 90 ? 3 : 99));
    const wantTry = Math.max(1, Math.min(bonusList.length, opt.maxBonusTry | 0 || bonusList.length));
    const bonusTrials = Math.min(wantTry, scaleCap);
    let anyRuns = false, maxRunLen = 0, bestRunAt = null, anyTubeFail = false, firstC = null;
    let lastMaxBusy = 0, lastKills = 0, lastFired = 0, lastDrops = 0, lastH2Gap = null;
    let overBudget = false;
    for (let bi = 0; bi < bonusTrials; bi++) {
      if (Date.now() - tStart > budgetMs) { overBudget = true; break; }
      // 규모가 크면 후보 배수를 줄인다 (비용 ∝ 후보수 × C)
      const useMults = (SL >= 200 && mults.length > 3)
        ? mults.filter((m, i) => i === 0 || i === Math.floor(mults.length / 2) || i === mults.length - 1)
        : mults;
      // C = 필요량 + 여유분,  여유분 = max(필요량의 reservePct%, 랜덤 발수)
      //   · 10%  : 날아가는 동안 적이 SAM을 증원할 가능성 대비 (큰 규모에서 지배)
      //   · 랜덤 : '딱 맞는 발수'는 자동화 티 → 발수에 무작위성 부여 (작은 규모에서 지배)
      const rp = Math.max(0, opt.reservePct === undefined ? (CFG.samReservePct | 0) : (opt.reservePct | 0));
      const Cs = [], seen = {}, resv = {};
      for (let i = 0; i < useMults.length; i++) {
        const need = Math.max(1, Math.ceil(sams.sumLevel * useMults[i]));
        const pctPart = Math.ceil(need * rp / 100);
        const reserve = Math.max(pctPart, bonusList[bi]);
        let v = need + reserve;
        if (v < 5) v = 5;
        if (v > cap) v = cap;
        if (!seen[v]) { seen[v] = 1; Cs.push(v); resv[v] = reserve; }
        if (v >= cap) break;
      }
      if (firstC === null) firstC = Cs[0];
      for (let ci = 0; ci < Cs.length; ci++) {
        if (Date.now() - tStart > budgetMs) { overBudget = true; break; }
        const C = Cs[ci];
        const reserveUse = (resv[C] !== undefined) ? resv[C] : bonusList[bi];
        const base = stStream(silos, C, 0, -1);
        const bombs = bombsOf(base);
        const D = stDeadRuns(sams, bombs, (bm) => ivsOf(bm));
        lastKills = D.kills; lastFired = bombs.length;
        if (base.drops > 0) lastDrops = base.drops;   // 관 부족 → 서버가 버릴 발수
        for (let ri = 0; ri < D.runs.length; ri++) {
          const ln = D.runs[ri].e - D.runs[ri].s;
          if (ln > maxRunLen) { maxRunLen = ln; bestRunAt = { C, run: D.runs[ri] }; }
        }
        if (D.maxBusy > lastMaxBusy) lastMaxBusy = D.maxBusy;
        if (!D.runs.length) continue;
        anyRuns = true;
        // 수소 창 탐색: 사각창 안에서 '수소 격추구간 전체가 덮이는' 발사틱
        const h2 = stFindH2(siloData, silos, base, usePaths, defs, leadFallback, D.runs, m);
        if (!h2) { anyTubeFail = true; if (stH2LastGap) lastH2Gap = stH2LastGap; continue; }
        return { ok: true, C, extra: 0, FT: h2.FT, F: h2.FT * SIMC.TICK, Dh: h2.arr,
                 runS: h2.run.s, runE: h2.run.e, score: h2.score, lead: leadFallback, SL,
                 atomReserve: reserveUse, atomNeed: C - reserveUse, reservePct: rp,
                 maxRunLen, hd: h2.dist, drops: base.drops, bonusUsed: reserveUse,
                 kills: D.kills, fired: bombs.length, passed: bombs.length - D.kills,
                 siloUsed: h2.si, h2Ivs: h2.ivs, usePaths };
      }
    }
    // 실패 사유: 관이 모자라 발사 자체가 안 되면 'tubes'가 가장 먼저다
    let why;
    if (overBudget && !anyRuns) why = "timeout";     // 예산 초과(정밀 재시도 필요)
    else if (lastDrops > 0) why = "tubes";
    else if (anyRuns && maxRunLen >= leadFallback + 2 * m) why = anyTubeFail ? "tubes" : "no-window";
    else if (!anyRuns) why = lastMaxBusy < SL ? "spread" : "no-gap";
    else why = "short-run";
    return { ok: false, why, SL, lead: leadFallback, maxRunLen, maxBusy: lastMaxBusy,
             needLen: leadFallback + 2 * m, bestRunAt, C: firstC || 5, kills: lastKills, fired: lastFired,
             drops: lastDrops, usePaths, nPath: sams.nPath || 0,
             h2Gap: lastH2Gap, defense: stDefenseSummary(sams, silos, siloData, usePaths) };
  }

  // 수소 발사 틱 탐색 — 각 사각창에 대해, H2의 '격추구간 전체'가 그 창에 덮이는 FT를 찾는다.
  //   (격추구간이 겹치면 → 어느 순간엔 빈 슬롯이 있어 격추됨 → 실패)
  function stFindH2(siloData, silos, base, usePaths, defs, leadFallback, runs, m) {
    if (!runs || !runs.length) return null;
    let maxFly = 0;
    for (let i = 0; i < siloData.length; i++) {
      const P = siloData[i].P;
      const fm = P ? P.flightMs : silos[i].dist * 10;
      if (fm > maxFly) maxFly = fm;
    }
    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri];
      if (run.e - run.s < 400) continue;
      // FT 범위: H2 도착이 사각창 안에 (도착 = dep*100+flightMs)
      const lo = Math.max(1, Math.floor((run.s - maxFly) / 100) - 1);
      const hi = Math.floor((run.e) / 100) + 1;
      const hi2 = Math.min(hi, lo + (silos.length > 24 ? 420 : 1200));   // 대규모는 스캔 폭 축소
      // 사일로별 관 회복 포인터 (FT 증가에 따라 전진)
      const qs = base.qs;
      const pIn = new Array(silos.length).fill(0), pOut = new Array(silos.length).fill(0);
      const lastLt = new Array(silos.length).fill(-1);
      for (let i = 0; i < silos.length; i++) {
        const q = qs[i];
        while (pIn[i] < q.length && q[pIn[i]].lt <= lo) { lastLt[i] = q[pIn[i]].lt; pIn[i]++; }
        while (pOut[i] < pIn[i] && q[pOut[i]].shiftAt <= lo) pOut[i]++;
      }
      // 사일로를 거리순으로 미리 정렬 → FT마다 '가장 가까운 빈 관'을 앞에서 찾는다.
      const order = []; for (let i = 0; i < silos.length; i++) order.push(i);
      order.sort((a, b) => silos[a].dist - silos[b].dist);
      // FT 스텝 3틱 (300ms) — 수소 창 정렬은 창 단위(1,150ms)라 이 오차는 무해
      const FT_STEP = (silos.length > 24 ? 3 : 1);
      for (let FT = lo; FT <= hi2; FT += FT_STEP) {
        let bestSi = -1, bestDist = Infinity, bestDep = 0;
        var lastGap = null;   // H2가 격추되는 지점(진단용)
        stH2LastGap = null;
        for (let oi = 0; oi < order.length; oi++) {
          const i = order[oi];
          const q = qs[i], lv = Math.max(1, silos[i].level | 0);
          while (pIn[i] < q.length && q[pIn[i]].lt <= FT) { lastLt[i] = q[pIn[i]].lt; pIn[i]++; }
          while (pOut[i] < pIn[i] && q[pOut[i]].shiftAt <= FT) pOut[i]++;
          if (pIn[i] - pOut[i] >= lv) continue;              // 빈 관 없음
          const dep = ((lastLt[i] + 1 > FT + 1) ? lastLt[i] + 1 : FT + 1);
          bestDist = silos[i].dist; bestSi = i; bestDep = dep;
          break;                                             // 거리순이므로 첫 히트가 최근접
        }
        if (bestSi < 0) continue;
        const sd = siloData[bestSi];
        const fm = (usePaths && sd.P) ? sd.P.flightMs : silos[bestSi].dist * 10;
        const arrT = bestDep * SIMC.TICK + fm;
        if (arrT < run.s || arrT > run.e) continue;
        // ── H2 생존 판정 ──
        //   H2도 SAM의 표적이다(최우선). 격추되려면 'H2의 교전 가능 구간' 중
        //   어느 순간에든 '빈 슬롯'이 있어야 한다(그 순간 발사된다).
        //   → H2의 교전구간 전체가 사각창(전 슬롯 점유·무회복) 안에 들어야 통과.
        let ok = true, ivsAbs = null, h2Gap = null;
        if (usePaths && sd.uni) {
          ivsAbs = [];
          for (let z = 0; z < sd.uni.length; z++) {
            const a = bestDep * SIMC.TICK + sd.uni[z].s, b = bestDep * SIMC.TICK + sd.uni[z].e;
            ivsAbs.push({ s: a, e: b });
            if (a < run.s - 60 || b > run.e + 60) {
              ok = false;
              if (!h2Gap) h2Gap = { s: Math.round(a), e: Math.round(b), why: a < run.s ? "창 이전" : "창 이후" };
              break;
            }
          }
        }
        if (!ok) { lastGap = h2Gap; continue; }
        const score = Math.min(arrT - run.s, run.e - arrT);
        stH2LastGap = null;
        return { FT, dep: bestDep, si: bestSi, arr: arrT, run, score, dist: bestDist, ivs: ivsAbs, gap: null };
      }
    }
    return null;
  }

  // 방어 요약 — 각 SAM의 '방어 가능량'(슬롯 + 비행 중 회복)과 도착 분포를 계산한다.
  //   · 슬롯(Σ레벨) = 동시 요격 가능 수 (버스트 흡수)
  //   · 회복 = 9초마다 1개 → 도착이 길게 늘어질수록 방어량이 커진다
  //   · 창 W초 동안의 격추 상한 = Σ레벨 + SAM수 × floor(W/9s)
  //   반환: { sumLevel, n, capW(창별 상한), defenseCap, arrSpan, verdict }
  function stDefenseSummary(sams, silos, siloData, usePaths) {
    try {
      if (!sams || !sams.n) return null;
      const SL = sams.sumLevel;
      // 도착 스팬 추정: 가장 먼 사일로의 비행시간 + 전송 시간(50발/초 × C)
      let maxFly = 0, minFly = Infinity;
      for (let i = 0; i < siloData.length; i++) {
        const P2 = siloData[i].P;
        const fm = P2 ? P2.flightMs : (silos[i] ? silos[i].dist * 10 : 0);
        if (fm > maxFly) maxFly = fm;
        if (fm < minFly) minFly = fm;
      }
      if (!Number.isFinite(minFly)) minFly = 0;
      // 각 SAM: 슬롯 합 + 9초당 회복 수
      const perSam = [];
      let recovery = 0;
      for (let i = 0; i < sams.defs.length; i++) {
        const d = sams.defs[i];
        perSam.push({ lv: d.lv, rng: d.rng, via: d.via,
                      slots: d.lv, recoveryPer9s: 1 });
        recovery += 1;
      }
      return { sumLevel: SL, n: sams.n, nPath: sams.nPath || 0,
               slots: SL, recoveryPer9s: recovery,
               maxFlyMs: maxFly, minFlyMs: minFly, perSam };
    } catch (e) { return null; }
  }

  // 창 W(초) 동안 방어 상한 = Σ레벨 + SAM수 × floor(W/9)
  function samKillCeiling(sams, Wsec) {
    if (!sams || !sams.n) return 0;
    return sams.sumLevel + sams.n * Math.floor(Wsec / 9);
  }

  // HUD/계획용: 타깃 요약 — 필요 원자·비용·사일로·가능성·경로 분석 결과
  function strikeSummary(tile, light) {
    try {
      const ana = samDefenders(tile);
      if (ana === null) return { k: "na" };
      if (ana.n === 0) {
        return { k: "no-sam" };
      }
      const silos = mySilos(tile);
      let tx = null, ty = null;
      try {
        const g = getGameView();
        const t2 = (tile === undefined || tile === null) ? computeCursorTile() : tile;
        if (g && t2 !== null && t2 !== undefined) { tx = g.x(t2); ty = g.y(t2); }
      } catch (e) {}
      const j0 = Math.max(0, CFG.samJitterMin | 0), j1 = Math.max(j0, CFG.samJitterMax | 0);
      const sum = { k: "plan", samN: ana.n, samSL: ana.sumLevel, maxRange: ana.maxRange,
                    nPath: ana.nPath || 0, jitterMin: j0, jitterMax: j1 };
      if (!silos || !silos.length) {
        return Object.assign(sum, { ok: false, why: "no-silo", C: Math.max(5, Math.ceil(ana.sumLevel * 1.25)) });
      }
      // 여유분 = max(필요량×pct%, 랜덤 발수) — 시뮬레이터가 need에 대해 다시 계산한다.
      //   (경량 HUD는 대표값, I 키는 무작위 — 어느 쪽이든 max 규칙은 stPlan이 적용)
      const bonus = j0 + Math.round(Math.random() * (j1 - j0));
      // 경량(HUD)은 후보 1개·짧은 예산 — 정밀(I 키)은 더 넓게 본다
      // 경량(HUD)도 배수를 3개 보고 예산 18ms — 표시값이 실제와 크게 어긋나지 않게.
      const p = stPlan(ana, silos, { cap: CFG.samCap || 20000, margin: 120, bonus, bonusScan: !light,
                                     bonusMin: j0, bonusMax: j1, maxBonusTry: light ? 1 : 6,
                                     mults: light ? [1.0, 1.25, 1.6] : undefined,
                                     budgetMs: light ? 18 : 80,
                                     tx, ty, dirUp: getRocketDirectionUp() });
      let C, plan = null;
      if (p && p.ok) { C = p.C; plan = p; }
      else { C = Math.max(5, Math.ceil(ana.sumLevel * 1.25 + bonus)); }
      let nd = null;
      if (!(p && p.ok) && !light) {
        try { nd = stSilosNeeded(ana, silos, { cap: Math.min(CFG.samCap || 20000, 8000), tx, ty }); } catch (e) {}
      }
      const c1 = atomCostPerBomb(), c5 = hydroCostPerBomb();
      let need = null, goldOk = null;
      if (c1 !== null && c5 !== null) {
        const fh = Math.max(0, CFG.samAfterHydroMax | 0);
        if (c1 === 0n && c5 === 0n) { need = 0n; goldOk = true; }
        else {
          need = toBig(c1) * BigInt(C) + toBig(c5) * BigInt(1 + fh);
          const gold = myGold();
          if (gold !== null) goldOk = gold >= need;
        }
      }
      let tubesOwned = 0, siloN = silos.length, maxSiloLv = 0;
      for (let i = 0; i < silos.length; i++) {
        tubesOwned += silos[i].level;
        if (silos[i].level > maxSiloLv) maxSiloLv = silos[i].level;
      }
      const ready = readyTubes();
      // 방어량(이 타격에 참여하는 SAM들의 총 격추능력) — 창 9초 기준
      const ceil9 = samKillCeiling(ana, 9);
      return Object.assign(sum, {
        ok: !!(p && p.ok), why: plan ? null : (p ? p.why : "sim"),
        C, plan, bonus,
        atomNeed: plan ? plan.atomNeed : null,       // 수소 사각창에 필요한 최소 원자수
        atomReserve: plan ? plan.atomReserve : null, // 여유분 (max(10%, 랜덤))
        reservePct: plan ? plan.reservePct : null,
        tubesOwned, siloN, ready, maxSiloLv,
        goldNeed: need, goldOk,
        need: nd,
        maxRunLen: plan ? plan.maxRunLen : (p ? p.maxRunLen : null),
        runNeedLen: p ? p.needLen : null,
        maxBusy: p ? p.maxBusy : null,
        kills: p ? p.kills : null, fired: p ? p.fired : null, passed: p ? p.passed : null,
        usePaths: p ? p.usePaths : null,
        // ── 방어/수소 판정 요약 ──
        ceil9,                            // 9초 창 격추 상한 (ΣLv + SAM수)
        h2Gap: p ? p.h2Gap : null,        // 첫 수소가 격추되는 지점(있으면 실패)
        h2Ok: !!(p && p.ok),              // 첫 수소 통과 여부 = 계획 성립 여부
        defense: p ? p.defense : null,
        goldFree: (c1 === 0n && c5 === 0n),
      });
    } catch (e) { return { k: "na" }; }
  }

  // 필요 사일로 추정 — '기수 늘리기(분산)'가 정답인 경우가 많다
  //   한 사일로에 관이 몰리면 같은 사일로 연속 발사가 1틱씩 밀려(체인) 발사가 늘어지고,
  //   도착이 흩어져 사각창이 안 생긴다. → 레벨을 낮추고 기수를 늘리는 방향을 먼저 시도.
  function stSilosNeeded(sams, silos, opt) {
    opt = opt || {};
    if (!silos || !silos.length) return { ok: false };
    const tStart = Date.now();
    const totalBudget = (opt.budgetMs | 0) || 45;      // 전체 예산 (수십 회 시뮬 방지)
    let minLv = Infinity;
    for (let i = 0; i < silos.length; i++) if (silos[i].level < minLv) minLv = silos[i].level;
    const lvCap = Math.max(5, Math.min(minLv === Infinity ? 50 : minLv, 50));
    const lightOpt = { cap: opt.cap || 8000, margin: 150, maxBonusTry: 1, mults: [1.25],
                       budgetMs: 12, tx: opt.tx, ty: opt.ty };
    // 사일로가 많으면 '기수 늘리기' 스캔을 축소 (곱셈 폭발 방지)
    const spreadMults = silos.length > 24 ? [2] : [2, 4];
    for (let sm = 0; sm < spreadMults.length; sm++) {
      if (Date.now() - tStart > totalBudget) return { ok: false, timeout: true };
      const mult = spreadMults[sm];
      const s2 = [];
      let tubes = 0;
      for (let i = 0; i < silos.length; i++) {
        const lv = Math.min(999, Math.max(5, Math.min(silos[i].level, lvCap)));
        for (let r = 0; r < mult; r++) { s2.push({ dist: silos[i].dist, level: lv, x: silos[i].x, y: silos[i].y }); tubes += lv; }
      }
      const p = stPlan(sams, s2, lightOpt, tStart);
      if (p && p.ok) return { ok: true, mode: "spread", mult, siloN: s2.length, lvEach: lvCap, tubes, C: p.C };
    }
    const ladder = opt.ladder || [1.5, 2];
    for (let i = 0; i < ladder.length; i++) {
      if (Date.now() - tStart > totalBudget) return { ok: false, timeout: true };
      const s2 = [];
      let tubes = 0;
      for (let j = 0; j < silos.length; j++) {
        const lv = Math.min(999, Math.ceil(silos[j].level * ladder[i]));
        s2.push({ dist: silos[j].dist, level: lv, x: silos[j].x, y: silos[j].y });
        tubes += lv;
      }
      const p = stPlan(sams, s2, lightOpt, tStart);
      if (p && p.ok) return { ok: true, mode: "level", lvMult: ladder[i], siloN: s2.length, tubes, C: p.C };
    }
    return { ok: false };
  }

  // Z 1회 = CFG.salvoAmount(기본 1,000발)을 대기열에 추가.
  // 이미 돌고 있으면 '이어서' 추가되며, 건과 건 사이에 빈틈이 없다.
  function startSalvo(opts) {
    const tile = computeCursorTile();
    if (tile === null) { toast("❌ 타깃 위에 커서를 올린 뒤 누르세요", "#ffaa00"); return; }
    const bus = getEventBus();
    const ctor = findNukeEventCtor();
    if (!bus || !ctor) { toast("❌ 경로 없음 — 게임 시작 후 다시 시도", "#ff5555"); return; }

    if (salvoQueue.length >= (CFG.salvoQueueMaxItems || 50)) {
      toast(`⚠️ 대기열 가득 (${salvoQueue.length}건) — 조금 기다린 뒤 다시 누르세요`, "#ffaa00");
      return;
    }

    const idle = salvoQueue.length === 0 && salvoTimer === null;

    // 준비된 발사관이 0이고 대기열도 비었을 때만 시작을 거부한다.
    // (이미 돌고 있는 중에는 9초 재장전으로 곧 풀리므로 그대로 받는다)
    if (idle) {
      let ready = null;
      try {
        const g = getGameView();
        const me = g && typeof g.myPlayer === "function" ? g.myPlayer() : null;
        if (me && typeof me.readyMissileCount === "function") ready = me.readyMissileCount();
      } catch (e) {}
      if (ready === 0) {
        toast("❌ 준비된 발사관 없음 (사일로 쿨다운 해제 후 재시도)", "#ffaa00");
        return;
      }
      // 골드가 '원자 1발' 값도 안 되면 시작해도 아무것도 안 나간다 → 시작 거부
      if (CFG.salvoStopOnGold) {
        const c1 = atomCostPerBomb();
        if (c1 && c1 > 0n) {
          const g1 = myGold();
          if (g1 !== null && g1 < c1) {
            toast("❌ 골드 소진 — 원자폭탄을 살 수 없음", "#ffaa00");
            return;
          }
        }
      }
    }

    // 발수 → 인텐트 수 (50발 단위로 올림)
    const per = SALVO_MAX_PER_INTENT;
    const cap = Math.min(CFG.salvoMaxAmount || 50000, 100000);

    // ── SAM 인식: 적 SAM이 목표를 지키면 '수소타격 계획'으로 전환 ──
    //   ① 필요 원자 C + 랜덤 5~50발 = 총량 → '그 총량으로' 시뮬(수소 타이밍 유지)
    //   ② 사각창 도착 수소 1발  ③ 그후 원자 수십발 + 수소 몇발(랜덤 간격) 산개
    // v2.8: Z 살포는 '순수 원자 최대속도' — SAM 인식·수소 혼합을 하지 않는다.
    //   (수소가 섞이면 서버 창·발사관을 나눠 써서 살포 속도가 떨어진다)
    const forceStrike = !!(opts && opts.forceSam) && !CFG.samZPure;   // samZPure=true면 Z는 항상 순수
    let plan0 = null, total = 0;
    if (forceStrike || (CFG.salvoSamAware && !CFG.samZPure)) {
      const ana = samDefenders(tile);
      if (ana && ana.n > 0) {
        const silos = mySilos(tile);
        if (silos && silos.length) {
          // ① 랜덤 가산 — '딱 맞는 발수'는 티가 나므로 5~50발을 얹는다.
          const j0 = Math.max(0, CFG.samJitterMin | 0), j1 = Math.max(j0, CFG.samJitterMax | 0);
          const bonus = j0 + Math.round(Math.random() * (j1 - j0));
          let tx2 = null, ty2 = null;
          try { const g2 = getGameView(); if (g2 && typeof g2.x === "function") { tx2 = g2.x(tile); ty2 = g2.y(tile); } } catch (e) {}
          const rp0 = Math.max(0, CFG.samReservePct | 0);
          const p = stPlan(ana, silos, { cap: CFG.samCap || 20000, margin: 120, bonus: bonus,
                                          bonusMin: j0, bonusMax: j1, reservePct: rp0, tx: tx2, ty: ty2,
                                          dirUp: getRocketDirectionUp() });
          // 폴백(시뮬 실패): 필요량 + max(10%, 랜덤)
          const needF = Math.ceil(ana.sumLevel * 1.25);
          const C = (p && p.ok) ? p.C : Math.max(5, needF + Math.max(Math.ceil(needF * rp0 / 100), bonus));
          const fT = (p && p.ok) ? Math.max(1, p.FT) : Math.ceil((Math.ceil(C / 50) / 10) * 11.5) + 8;
          // ③ 후속 산개량 (이번에 뽑아 고정 — 예약 시 사용)
          const a0 = Math.max(0, CFG.samAfterMin | 0), a1 = Math.max(a0, CFG.samAfterMax | 0);
          const h0 = Math.max(0, CFG.samAfterHydroMin | 0), h1 = Math.max(h0, CFG.samAfterHydroMax | 0);
          const afterAtoms = a0 + Math.round(Math.random() * (a1 - a0));
          const afterHydros = h0 + Math.round(Math.random() * (h1 - h0));
          const g0 = Math.max(120, CFG.samAfterGapMinMs | 0), g1 = Math.max(g0, CFG.samAfterGapMaxMs | 0);
          const gapMs = g0 + Math.round(Math.random() * (g1 - g0));
          plan0 = {
            ok: !!(p && p.ok), why: (p && p.ok) ? null : (p ? p.why : "sim"),
            C: C, bonus: bonus, fireTick: fT,
            atomNeed: (p && p.ok) ? p.atomNeed : null,
            atomReserve: (p && p.ok) ? p.atomReserve : null,
            reservePct: (p && p.ok) ? p.reservePct : null,
            Dh: (p && p.ok) ? p.Dh : null, sumLevel: ana.sumLevel, n: ana.n,
            drops: (p && p.ok) ? p.drops : null, maxRunLen: p ? p.maxRunLen : null,
            kills: p ? p.kills : null, fired: p ? p.fired : null, passed: p ? p.passed : null,
            usePaths: p ? p.usePaths : null, nPath: ana.nPath || 0,
            afterAtoms: afterAtoms, afterHydros: afterHydros, afterGapMs: gapMs,
          };
          total = C;
        }
      }
    }
    if (plan0 === null) {
      total = Math.max(per, Math.min(Math.ceil((CFG.salvoAmount || per) / per) * per, cap));
    } else {
      total = Math.max(per, Math.min(total, cap));
      plan0 = Object.assign({}, plan0, { totalAtoms: total });
      lastStrike = plan0;
    }
    const intents = Math.ceil(total / per);

    // hydroEvery: 원자 N발마다 수소 섞기 — Z 살포(samZPure)는 0(순수 원자)
    const hEvery = CFG.samZPure ? 0 : Math.max(0, CFG.samHydroEvery | 0);
    salvoQueue.push({ tile, total, sent: 0, bus, ctor,
                      hydroEvery: hEvery, hydroSent: 0, hydroJit: 0,
                      hydroMax: hEvery > 0 ? Math.max(1, Math.floor(total / hEvery) - 1) : 0,
                      hTotal: 0, hSent: 0 });

    // 수소타격이면: 수소 1발 + 후속 산개를 '예약'한다.
    //   수소 발사 시각은 '첫 원자 배치가 나간 시점'부터 세는 상대 틱이다
    //   → 발사창 정리 대기(waitMs)로 시작이 밀려도 사각창 정렬이 유지된다.
    //   후속 산개는 수소가 나간 뒤 시작된다 (수소 발사 성공 시 트리거).
    //   이미 예약된 게 있으면 덮어쓰지 않는다 (연타 시 첫 계획 유지).
    if (plan0 && (CFG.samHydroCount | 0) > 0 && (salvoHydro === null || salvoHydro.fired)) {
      salvoHydro = { tile: tile, fireTick: Math.max(0, plan0.fireTick | 0), fireAt: null,
                     bus: bus, ctor: ctor, fired: false, armed: false, armedAt: null };
      // 진행 중인 후속 산개가 있으면 덮어쓰지 않는다 (타이머 유실 방지)
      if (salvoFollow === null) {
        salvoFollow = { tile: tile, bus: bus, ctor: ctor,
                        atomsLeft: Math.max(0, plan0.afterAtoms | 0),
                        hydrosLeft: Math.max(0, plan0.afterHydros | 0),
                        atoms0: Math.max(0, plan0.afterAtoms | 0),
                        hydros0: Math.max(0, plan0.afterHydros | 0),
                        started: false, timer: null };
      }
      const how = plan0.ok ? "사각창 역산" : "근사(사각창 미확보)";
      const waste = (plan0.drops | 0) > 0 ? ` · 관부족 낭비 ${plan0.drops}발` : "";
      const killTxt = (plan0.fired !== null && plan0.fired !== undefined)
        ? ` · 격추예상 ${plan0.kills}/${plan0.fired}발(통과 ${plan0.passed})` : "";
      const pathTxt = plan0.nPath > 0 ? ` · 경로상 SAM ${plan0.nPath}기 포함` : "";
      const aft = (plan0.afterAtoms | 0) + (plan0.afterHydros | 0) > 0
        ? ` → 수소 1발 → 원자 ${plan0.afterAtoms}·수소 ${plan0.afterHydros}발 산개` : "";
      const _n = plan0.atomNeed, _r = plan0.atomReserve, _p = plan0.reservePct;
      const needTxt = (_n !== null && _n !== undefined && _r !== null && _r !== undefined)
        ? `(필요 ${_n.toLocaleString()}+여유 ${_r}${(_p && _r === Math.ceil(_n * _p / 100)) ? `=${_p}%` : ""})`
        : `(필요+여유 ${plan0.bonus})`;
      toast(`🎯 수소타격 — 원자 ${plan0.C.toLocaleString()}발${needTxt}${aft} (${how}${waste}${killTxt}${pathTxt})`, "#7ee787");
    }

    if (!idle) {
      toast(`➕ ${total.toLocaleString()}발 추가 — 대기열 ${salvoQueue.length}건 · 남은 ${salvoPending().toLocaleString()}발`, "#ffd166");
      return;
    }

    const period = salvoPeriodMs();
    const batches = Math.ceil(intents / salvoBatchSize());
    const estSec = ((batches - 1) * period / 1000).toFixed(1);

    // 첫 배치 대기 계산:
    //   서버의 초당 창은 '게으른 창'이라, 마지막 초당 버킷 리셋 뒤 1초가 지나야
    //   새 창이 열린다. 그 리셋 시점이 '창의 첫 요청'이다.
    //   → 마지막으로 보낸 인텐트 시각 + 1초 뒤가 가장 안전하다.
    //   분당 한도(150건)도 함께 본다: 남은 여유가 없으면 분 경계까지 기다린다.
    let waitMs = 0;
    try {
      const now = Date.now();
      RL.secWindow = RL.secWindow.filter((t) => now - t < 1000);
      RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);
      if (RL.secWindow.length > 0) {
        const last = RL.secWindow[RL.secWindow.length - 1];
        waitMs = Math.max(0, (period - 150) - (now - last));
      }
      const minRoom = RL.perMinute - 5 - RL.minWindow.length;
      if (minRoom <= 0) {
        const oldest = RL.minWindow[0];
        waitMs = Math.max(waitMs, 60000 - (now - oldest));
      }
    } catch (e) {}

    if (waitMs > 50) {
      toast(`⏳ 발사창 정리 중 — ${(waitMs / 1000).toFixed(1)}초 후 시작 (총 ${total.toLocaleString()}발)`, "#ffaa00");
      salvoTimer = setTimeout(salvoPump, waitMs);
      return;
    }
    toast(`☢️ 대량 발사 시작 — ${total.toLocaleString()}발 / ${intents}건 · 약 ${estSec}초`, "#ffd166");
    salvoPump();
  }

  // 새 키(I): 한큐 수소타격 — 목표를 커버하는 적 SAM을 전량 분석해
  //   필요 원자 C를 계산하고, C 전량 → 사각창 수소 1발 → 추가 3~5%를 한 번에 건다.
  //   (SAM이 없으면 일반 살포와 동일하게 동작하고 안내 토스트만 띄운다)
  // 새 키(I) — 수소타격 한큐.
  //   발동 조건: '첫 수소가 실제로 들어갈 수 있다'고 계산될 때만 발동한다.
  //   (궤적·발사시각·SAM 충전·방어량을 모두 시뮬해 첫 수소 통과가 확인된 경우)
  //   불가하면 사유를 알려주고 발동하지 않는다 — 격추될 수소를 낭비하지 않는다.
  let lastStrikeCheck = null;
  // ═════════════════════════════════════════════
  // I 키 — 수소타격 (v2.8 단순 규칙)
  //
  //   ① 커서 150타일 내 적 SAM 전부 수집 → ΣLv
  //   ② 발사량 = ΣLv × 1.2 (20% 더)  ← 원자 살포
  //   ③ 그 뒤 수소 1발
  //   ④ 후속: 원자 몇 발 + 수소 몇 발
  //
  //   SAM이 없으면 수소 1발만. 발사관·골드 가드만 확인한다.
  // ═════════════════════════════════════════════
  // ═════════════════════════════════════════════
  // I 키 — 수소타격 (v3.0 블록 모드)
  //
  //   한 번 누름 = '원자 200발 + 수소 1발' 블록을 큐에 넣는다.
  //   연타하면 블록이 쌓여 서버 최대 속력으로 순차 발사된다.
  //   (원자 200발 = 인텐트 4건, 그 뒤 수소 1건 = 5건 → 초당 10건이면 2블록/초)
  //
  //   SAM 계산(samsNear)은 HUD 표시용으로만 쓴다 — 발사량은 블록이 결정한다.
  //   SAM이 전혀 없으면 수소 1발만 쏜다.
  // ═════════════════════════════════════════════
  function legacyStartStrike() {
    let tile = null, ana = null;
    try {
      tile = computeCursorTile();
      if (tile === null) { toast("❌ 타깃 위에 커서를 올린 뒤 누르세요", "#ffaa00"); return; }
      // 지형 제한 없음 — 게임 nukeSpawn 은 산(isImpassable)만 막는다. 바다도 발사 가능.
      ana = samsNear(tile);   // 표시·판정용 (발사량은 블록이 결정)
    } catch (e) {
      toast("⚠️ SAM 정보를 읽을 수 없음 — 확인 실패", "#ffaa00");
      return;
    }
    if (ana === null) { toast("⚠️ SAM 정보를 읽을 수 없음 — 잠시 후 재시도", "#ffaa00"); return; }

    const bus0 = getEventBus(), ctor0 = findNukeEventCtor();
    if (!bus0 || !ctor0) { toast("❌ 경로 없음 — 게임 시작 후 다시 시도", "#ff5555"); return; }

    // 발사관 가드
    let ready0 = null;
    try {
      const g0 = getGameView();
      const me0 = g0 && typeof g0.myPlayer === "function" ? g0.myPlayer() : null;
      if (me0 && typeof me0.readyMissileCount === "function") ready0 = me0.readyMissileCount();
    } catch (e) {}
    if (ready0 === 0) { toast("❌ 준비된 발사관 없음 (사일로 쿨다운 해제 후 재시도)", "#ffaa00"); return; }

    // ── SAM 없음 → 수소 1발만
    if (!(ana.n > 0) || !(ana.sumLevel > 0)) {
      if ((CFG.samHydroCount | 0) <= 0 && (CFG.samBlockHydro | 0) <= 0) {
        toast("ℹ️ 커버하는 적 SAM 없음 — 수소 미사용 설정", "#ffd166"); return;
      }
      try {
        bus0.emit(new ctor0("Hydrogen Bomb", tile, getRocketDirectionUp(), undefined));
        rateUse();
        toast("💧 방어 SAM 없음 — 수소 1발 발사", "#7ee787");
      } catch (e) {
        console.warn("[x50] 수소 emit 실패:", e);
        toast("❌ 수소 발사 실패 (콘솔 확인)", "#ff5555");
      }
      return;
    }

    // ── 블록 1개를 큐에 추가 (연타하면 계속 쌓임) ──
    if (salvoQueue.length >= (CFG.salvoQueueMaxItems || 50)) {
      toast(`⚠️ 대기열 가득 (${salvoQueue.length}건) — 조금 기다린 뒤 다시 누르세요`, "#ffaa00");
      return;
    }
    const blkAtoms = Math.max(1, CFG.samBlockAtoms | 0 || 200);
    const blkHydro = Math.max(0, CFG.samBlockHydro === undefined ? 1 : (CFG.samBlockHydro | 0));
    // 원자 블록 = 1건(50발 단위 아님 — total로 관리), 수소 = hTotal
    salvoQueue.push({ tile, total: blkAtoms, sent: 0, bus: bus0, ctor: ctor0,
                      hydroEvery: 0, hydroSent: 0, hydroJit: 0, hydroMax: 0,
                      hTotal: blkHydro, hSent: 0 });

    // 후속 산개 — 블록 모드에서는 기본 끔 (samAfterInBlock=false)
    //   블록이 이미 원자+수소를 반복하므로 후속 산개가 불필요하고,
    //   켜면 '수소가 몇 발 더' 나가서 블록 구조가 흐려진다.
    const afterOn = (CFG.samAfterInBlock === true);
    if (afterOn && salvoFollow === null) {
      const a0 = Math.max(0, CFG.samAfterMin | 0), a1 = Math.max(a0, CFG.samAfterMax | 0);
      const h0 = Math.max(0, CFG.samAfterHydroMin | 0), h1 = Math.max(h0, CFG.samAfterHydroMax | 0);
      const afterA = a0 + Math.round(Math.random() * (a1 - a0));
      const afterH = h0 + Math.round(Math.random() * (h1 - h0));
      const g0 = Math.max(120, CFG.samAfterGapMinMs | 0), g1 = Math.max(g0, CFG.samAfterGapMaxMs | 0);
      if (afterA + afterH > 0) {
        salvoFollow = { tile: tile, bus: bus0, ctor: ctor0,
                        atomsLeft: afterA, hydrosLeft: afterH,
                        atoms0: afterA, hydros0: afterH,
                        started: false, timer: null,
                        gapMs: g0 + Math.round(Math.random() * (g1 - g0)) };
      }
    }

    const qn = salvoQueue.length;
    const totalQ = salvoPending();
    lastStrike = { mode: "block", tile, blockAtoms: blkAtoms, blockHydro: blkHydro,
                   samN: ana.n, samSL: ana.sumLevel, queued: qn, pending: totalQ };
    toast(`☢️ 수소타격 블록 — 원자 ${blkAtoms}발 + 💧${blkHydro}발  (대기 ${qn}블록 · ${totalQ.toLocaleString()}발)`, "#7ee787");

    // 발사 시작
    if (salvoTimer === null) {
      try { salvoPump(); } catch (e) { console.warn("[x50] 살포 시작 실패:", e); }
    }
  }

  // 수소 발사 예약 — 계획된 틱(fireTick×100ms)에 맞춰 발사한다.
  //   · 기준점(armedAt) = 첫 원자 배치가 나간 시각 (시뮬의 t=0과 동일)
  //   · 발사 시점에 빈 발사관이 없으면 300ms 간격으로 최대 8회(~2.4초) 재시도
  //     (시뮬레이터가 '빈 관이 있는 틱'을 골라줬으므로 보통 즉시 발사된다)
  function armHydroTimer() {
    if (salvoHydroTimer !== null) { clearTimeout(salvoHydroTimer); salvoHydroTimer = null; }
    if (!salvoHydro || salvoHydro.fired) return;
    if (salvoHydro.fireAt === null) {
      const base = salvoHydro.armedAt || Date.now();
      salvoHydro.fireTick = Math.max(0, salvoHydro.fireTick | 0);
      salvoHydro.fireAt = base + salvoHydro.fireTick * 100;
      salvoHydro.armed = true;
    }
    let tries = 0;
    const tick = () => {
      salvoHydroTimer = null;
      if (!salvoHydro || salvoHydro.fired) return;
      // ── 단순 모드: 원자 살포(대기열)가 '전부' 나간 뒤 수소를 쏜다 ──
      //   (원자로 SAM 슬롯을 소진시킨 다음 수소가 들어가야 막히지 않는다)
      if (salvoHydro.afterQueue) {
        if (salvoQueue.length > 0 || salvoTimer !== null) {
          salvoHydroTimer = setTimeout(tick, 120);
          return;
        }
      }
      const now = Date.now();
      if (now < salvoHydro.fireAt) {
        salvoHydroTimer = setTimeout(tick, Math.max(30, Math.min(500, salvoHydro.fireAt - now)));
        return;
      }
      // 서버 초당 창에 여유가 없으면 잠깐 기다린다 (드롭 방지 — 수소는 1건)
      try {
        const now2 = Date.now();
        RL.secWindow = RL.secWindow.filter((x) => now2 - x < 1000);
        if (RL.secWindow.length >= RL.perSecond) {
          tries++;
          if (tries <= 60) { salvoHydroTimer = setTimeout(tick, 120); return; }
          toast("💧 수소 발사 취소 — 서버 창 포화", "#ffaa00");
          salvoHydro = null;
          salvoFollow = null;
          const done1 = salvoQueue.length === 0 && salvoTimer === null;
          if (done1) salvoClear(null);
          return;
        }
      } catch (e) {}
      const ready = readyTubes();
      if (ready === 0) {
        tries++;
        if (tries <= 60) { salvoHydroTimer = setTimeout(tick, 300); return; }
        toast("💧 수소 발사 취소 — 발사관 없음", "#ffaa00");
        salvoHydro = null;
        salvoFollow = null;
        const done0 = salvoQueue.length === 0 && salvoTimer === null;
        if (done0) salvoClear(null);
        return;
      }
      try {
        salvoHydro.bus.emit(new salvoHydro.ctor("Hydrogen Bomb", salvoHydro.tile, getRocketDirectionUp(), undefined));
        rateUse();
        salvoHydro.fired = true;
        salvoHydroDone++;
        const done = salvoQueue.length === 0 && salvoTimer === null;
        if (!done) toast("💧 수소 1발 발사 — 계획 사각창 도착", "#7ee787");
        salvoHydro = null;
        // 수소가 나갔다 → 후속 산개(원자 수십발·수소 몇발) 시작
        try { armFollow(); } catch (e) {}
        if (done && !salvoFollow) { salvoClear(null); return; }
      } catch (e) {
        console.warn("[x50] 수소 emit 실패:", e);
        toast("❌ 수소 발사 실패 (콘솔 확인)", "#ff5555");
        salvoHydro = null;
      }
    };
    const now = Date.now();
    salvoHydroTimer = setTimeout(tick, Math.max(0, Math.min(500, (salvoHydro.fireAt - now))));
  }

    // ── 후속 산개 (v2.6) ──
  // 수소가 사각창에 꽂힌 뒤, 원자 수십발과 수소 몇발을 '랜덤 간격'으로 더 뿌린다.
  //   목적: 딱 계산된 발수·순서로 끝나면 자동화 티가 난다 → 발수·순서·간격에
  //   무작위성을 주어 사람이 두드린 것처럼 보이게 한다.
  //   · 각 발은 서버 창(초당 10건·분당 150건) 여유를 확인하고 보낸다 (드롭 0)
  //   · 원자/수소 순서는 매 스텝 확률적으로 고른다 (완전 고정 순서 회피)
  //   · 마지막 발까지 끝나면 완료 토스트
  function salvoFollowTick() {
    if (salvoFollow) salvoFollow.timer = null;
    const F = salvoFollow;
    if (!F) return;
    // 서버 창에 여유가 없으면 잠깐 쉰다
    try {
      const now = Date.now();
      RL.secWindow = RL.secWindow.filter((x) => now - x < 1000);
      if (RL.secWindow.length >= RL.perSecond - 1) {
        F.timer = setTimeout(salvoFollowTick, 160 + Math.round(Math.random() * 240));
        return;
      }
    } catch (e) {}
    const totalLeft = F.atomsLeft + F.hydrosLeft;
    if (totalLeft <= 0) {
      const done = salvoQueue.length === 0 && salvoTimer === null && salvoHydro === null;
      salvoFollow = null;
      if (done) salvoClear(null);
      return;
    }
    // 골드 가드 — 원자 1발 값도 없으면 이후는 서버가 전부 버린다 (낭비 방지)
    try {
      const c1 = atomCostPerBomb();
      if (c1 && c1 > 0n) {
        const gold = myGold();
        if (gold !== null && gold < c1) { salvoClear("💰 골드 소진"); return; }
      }
    } catch (e) {}
    // 이번 스텝: 원자(50발 단위, 남은 양 이하) 또는 수소 1발을 확률적으로 선택
    const pAtom = F.hydrosLeft <= 0 ? 1 : (F.atomsLeft <= 0 ? 0 : 0.72);
    const pickAtom = Math.random() < pAtom;
    try {
      if (pickAtom) {
        const amt = Math.min(SALVO_MAX_PER_INTENT, Math.max(1, F.atomsLeft));
        F.bus.emit(new F.ctor("Atom Bomb", F.tile, getRocketDirectionUp(), amt));
        rateUse();
        F.atomsLeft -= amt;
        salvoDone += amt;
      } else {
        const ready = readyTubes();
        if (ready === 0) { F.timer = setTimeout(salvoFollowTick, 300); return; }
        F.bus.emit(new F.ctor("Hydrogen Bomb", F.tile, getRocketDirectionUp(), undefined));
        rateUse();
        F.hydrosLeft--;
        salvoHydroDone++;
      }
    } catch (e) {
      console.warn("[x50] 후속 산개 emit 실패:", e);
      salvoFollow = null;
      return;
    }
    const g0 = Math.max(120, CFG.samAfterGapMinMs | 0), g1 = Math.max(g0, CFG.samAfterGapMaxMs | 0);
    const gap = g0 + Math.round(Math.random() * (g1 - g0));
    F.timer = setTimeout(salvoFollowTick, gap);
  }

  // 수소가 나간 직후 호출 — 후속 산개 시작
  function armFollow() {
    if (!salvoFollow || salvoFollow.started) return;
    if (salvoFollow.atomsLeft + salvoFollow.hydrosLeft <= 0) { salvoFollow = null; return; }
    salvoFollow.started = true;
    const g0 = Math.max(120, CFG.samAfterGapMinMs | 0), g1 = Math.max(g0, CFG.samAfterGapMaxMs | 0);
    const first = g0 + Math.round(Math.random() * (g1 - g0));
    salvoFollow.timer = setTimeout(salvoFollowTick, first);
  }

  // 창마다 최대 10건씩 내보낸다. 건이 끝나면 같은 창 안에서 '즉시' 다음 건으로
  // 이어가므로, 연타로 쌓인 대기열도 빈틈 없이 최대 속력으로 소진된다.
  function salvoPump() {
    salvoTimer = null;
    if (salvoQueue.length === 0) return;

    // 분당 한도(150건)에 걸리면 분 경계까지 기다린다.
    // (초당 창만 지키면 1분 뒤 조용히 버려지는 것을 막는다)
    let minuteRoom = null;   // 이번 분 창에서 더 보낼 수 있는 인텐트 수 (null=확인 불가)
    try {
      const now = Date.now();
      RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);
      minuteRoom = RL.perMinute - 5 - RL.minWindow.length;
      if (minuteRoom <= 0) {
        // v3.0.1: 큐를 내부 관리하므로 '중단'하지 않는다.
        //   분당 한도 여유가 없으면 → 분 경계까지 대기 후 자동 재개 (포화 = 드롭 0).
        const wait = Math.max(1000, 60000 - (now - (RL.minWindow[0] || now)) + 80);
        const remain = salvoPending();
        toast(`⏳ 서버 분당 한도(${RL.perMinute}건) — ${Math.ceil(wait / 1000)}초 후 자동 재개 (남은 ${remain.toLocaleString()}발)`, "#ffaa00");
        salvoTimer = setTimeout(salvoPump, wait);
        return;
      }
    } catch (e) {}

    const per = SALVO_MAX_PER_INTENT;

    // ── v3.0.1 창 관리: '여유가 있으면 즉시, 꽉 찼으면 회전 대기' (최대 속력) ──
    //   이전(v2.4)은 창에 1건이라도 있으면 무조건 1050ms를 기다려서 속력이 떨어졌다.
    //   이제는 남은 여유(perSecond - 사용량)만큼 바로 보내고, 꽉 찼을 때만 창 회전을 기다린다.
    let secRoom = null;   // 이번 초 창의 남은 여유 (null=확인 불가)
    try {
      const now2 = Date.now();
      RL.secWindow = RL.secWindow.filter((x) => now2 - x < 1000);
      secRoom = Math.max(0, RL.perSecond - RL.secWindow.length);
      if (secRoom <= 0) {
        // 꽉 찼다 → 가장 오래된 건이 창을 벗어나는 시각까지 대기 (그때 여유가 생긴다)
        const oldest = RL.secWindow[0];
        const wait = Math.max(30, oldest + 1010 - now2);
        salvoTimer = setTimeout(salvoPump, wait);
        return;
      }
    } catch (e) {}

    // ── 발사관 가드 ──
    // 장전된 관이 0이면 지금 보내는 인텐트는 서버에서 전부 버려진다(조용히).
    //   기본(false): 남은 대기열을 폐기하고 중단
    //   salvoWaitForReload=true: 재장전(9초)을 기다렸다가 자동 재개
    const ready = readyTubes();
    if (ready === 0) {
      if (CFG.salvoWaitForReload) {
        salvoDryWaits++;
        if (salvoDryWaits <= 15) {
          if (salvoDryWaits === 1) toast("⏳ 발사관 재장전 대기 — 장전되면 자동 재개", "#ffaa00");
          salvoTimer = setTimeout(salvoPump, 1000);
          return;
        }
        salvoClear("🧨 발사관 재장전 대기 초과");
        return;
      }
      salvoClear("🧨 발사관 소진");
      return;
    }
    salvoDryWaits = 0;

    // 한 창이 관 수보다 많은 인텐트를 보내면 남는 폭탄은 버려진다
    //   → 이번 창은 '관이 감당할 만큼'만 보낸다 (레이트 예산 보존)
    let batch = salvoBatchSize();
    if (ready !== null) batch = Math.min(batch, Math.max(1, Math.ceil(ready / per)));

    // 분당 한도의 '남은 여유'도 이번 창의 상한이다
    //   → 한도 직전에 몰아 보내 조용히 버려지는 것을 막는다
    if (minuteRoom !== null && minuteRoom < batch) batch = Math.max(1, minuteRoom);
    // 초당 창의 잔여 여유만큼만 (넘기면 서버가 버린다 = 포화)
    if (secRoom !== null && secRoom < batch) batch = Math.max(1, secRoom);

    // ── 골드 가드 ──
    // 서버는 폭탄 '1발 단위'로 골드를 검사한다(canBuildUnitType: _gold < cost).
    //   → 보유 골드가 1발 값보다 적으면 앞으로 나갈 폭탄은 전부 무효이므로 중단.
    //   무한골드 로비(cost 0)나 조회 불가(null)면 검사하지 않는다.
    const costPerBomb = CFG.salvoStopOnGold ? atomCostPerBomb() : 0n;

    let n = 0;
    while (n < batch && salvoQueue.length > 0) {
      if (costPerBomb && costPerBomb > 0n) {
        const gold = myGold();
        if (gold !== null && gold < costPerBomb) { salvoClear("💰 골드 소진"); return; }
      }
      const item = salvoQueue[0];
      // 마지막 인텐트는 남은 양만큼만 보낸다 (50발 단위 강제 없음 → 총량 정확)
      const amtSent = Math.min(per, item.total - item.sent);
      if (amtSent <= 0) { salvoQueue.shift(); salvoItemsDone++; continue; }
      try {
        item.bus.emit(new item.ctor("Atom Bomb", item.tile, getRocketDirectionUp(), amtSent));
        rateUse();                  // 수동 발사와 같은 카운터 공유 (서로 간섭 방지)
      } catch (e) {
        console.warn("[x50] 대량 발사 emit 실패:", e);
        salvoClear("❌ 대량 발사 중단 (emit 실패 — 콘솔 확인)");
        return;
      }
      item.sent += amtSent;
      salvoDone += amtSent;
      n++;
      // ── v2.9: 원자 N발마다 수소 1발 섞기 ──
      //   마지막에 몰아 쏘면 서버 창 포화로 드롭되므로 살포 중간에 끼워 넣는다.
      //   · 임계값은 '절대 위치' = (보낸 수소+1) × 간격  → 누적 드리프트 없음, 간격 균일
      //   · 끝자락(잔여 < 간격/2)에는 넣지 않는다 → 마지막에 몰려 짤리는 현상 방지
      //   · 창이 꽉 찼으면 건너뛰지 않고 다음 원자 인텐트에서 재시도 (누락 방지)
      if (item.hydroEvery > 0 && item.hydroSent < item.hydroMax) {
        // 임계값을 '원자 인텐트 경계(50발)'에 맞춘다 → 간격이 균일해진다.
        //   예: 200발마다면 인텐트 4건(=200발)마다 정확히 1발. 지터는 ±소폭.
        const jit = Math.max(0, CFG.samHydroEveryJitter | 0);
        const per50 = 50;
        const base = Math.round(((item.hydroSent + 1) * item.hydroEvery) / per50) * per50;
        const target = base + item.hydroJit;
        const remain = item.total - item.sent;
        if (item.sent >= target && remain >= item.hydroEvery / 2) {
          let room = true;
          try {
            const nw = Date.now();
            RL.secWindow = RL.secWindow.filter((x) => nw - x < 1000);
            if (RL.secWindow.length >= RL.perSecond) room = false;
          } catch (e) {}
          if (room) {
            try {
              item.bus.emit(new item.ctor("Hydrogen Bomb", item.tile, getRocketDirectionUp(), undefined));
              rateUse();
              item.hydroSent++;
              salvoHydroDone++;
              n++;
              // 다음 수소용 지터를 새로 뽑는다 (누적 아님 — 매번 독립)
              //   인텐트 경계와 어긋나지 않게 50 배수로 스냅
              item.hydroJit = jit > 0 ? Math.round(((Math.random() * 2 - 1) * jit) / 50) * 50 : 0;
            } catch (e) {
              console.warn("[x50] 수소 섞기 실패:", e);
            }
          }
          // room === false → 임계값 유지, 다음 인텐트에서 재시도
        }
      }
      // 첫 원자 인텐트가 나간 순간 = 시뮬레이터의 t=0 → 수소 발사 시각의 기준점.
      // (armedAt이 이미 있으면 건드리지 않는다 — 연타/재개 시 첫 기준 유지)
      if (salvoHydro && !salvoHydro.armed && salvoHydro.armedAt === null) {
        salvoHydro.armedAt = Date.now();
        try { armHydroTimer(); } catch (e) {}
      }
      // ── 블록의 수소 (hTotal): 원자가 다 나간 뒤 수소를 1발씩 발사 ──
      //   창에 여유가 있을 때만 (없으면 다음 창에서 재시도)
      if (item.sent >= item.total && item.hSent < item.hTotal) {
        let roomH = true;
        try {
          const nw2 = Date.now();
          RL.secWindow = RL.secWindow.filter((x) => nw2 - x < 1000);
          if (RL.secWindow.length >= RL.perSecond) roomH = false;
        } catch (e) {}
        if (roomH) {
          try {
            item.bus.emit(new item.ctor("Hydrogen Bomb", item.tile, getRocketDirectionUp(), undefined));
            rateUse();
            item.hSent++;
            salvoHydroDone++;
            n++;
          } catch (e) { console.warn("[x50] 블록 수소 emit 실패:", e); }
        }
      }
      if (item.sent >= item.total && item.hSent >= item.hTotal) {   // 이 건 완료 → 다음 건으로 즉시
        salvoQueue.shift();
        salvoItemsDone++;
      }
    }

    if (salvoQueue.length === 0) {
      // (v2.9) 수소는 살포 중간에 섞이므로 '마지막 수소 대기'가 없다.
      //   대신 후속 산개가 아직 시작 안 됐으면 여기서 시작한다 (원자 살포 완료 시점).
      if (salvoFollow && !salvoFollow.started) { try { armFollow(); } catch (e) {} }
      // 후속 산개(원자 수십발·수소 몇발)가 남아 있으면 그쪽 타이머가 마무리한다.
      //   단 'started'가 아니면(아직 시작 전) 지금 시작하고 보류 — 무한 대기 방지.
      if (salvoFollow) {
        if (!salvoFollow.started) { try { armFollow(); } catch (e) {} }
        if (salvoFollow) return;
      }
      salvoClear(null); return;
    }
    toast(`☢️ 대량 발사 누적 ${salvoDone.toLocaleString()}발 · 남은 ${salvoPending().toLocaleString()}발 (대기열 ${salvoQueue.length}건)`, "#ffd166");
    // v3.0.1: 이번 창에 여유가 남았으면 즉시 다음 묶음을 보낸다 (최대 속력).
    //   꽉 찼으면 창 회전까지 대기.
    let nextWait = 40;
    try {
      const now3 = Date.now();
      RL.secWindow = RL.secWindow.filter((x) => now3 - x < 1000);
      const room3 = RL.perSecond - RL.secWindow.length;
      if (room3 <= 0 && RL.secWindow.length > 0) {
        nextWait = Math.max(30, RL.secWindow[0] + 1010 - now3);
      }
    } catch (e) { nextWait = salvoPeriodMs(); }
    salvoTimer = setTimeout(salvoPump, nextWait);
  }

  // ═════════════════════════════════════════════
  // MIRV 발사 (M)
  //
  // 게임/서버 소스 검증 (v1.9.0):
  //   {type:"build_unit", unit:"MIRV"} 인텐트 1건 →
  //   서버 MirvExecution 이 탄두를 스스로 생성한다 (warheadCount = 350).
  //   · 탄두 최대 350발 = 인텐트 1건. 원자 50발(인텐트 1건)의 7배.
  //   · 사일로 슬롯은 1개만 소모 (원자 350발이면 슬롯 350개 필요).
  //   · 탄두는 반경 1500타일에 최소간격 55로 산개 (지역 폭격 — 정밀 조준 불가).
  //   · 비용 = 25M + 15M × (게임 전체 MIRV 발사횟수). 무한골드 치트면 0원.
  //   · 타깃은 '소유자 있는 영토'여야 한다 (바다·무주지 불가).
  // ═════════════════════════════════════════════
  let lastMirvWarn = 0;
  function mirvWarn(msg) {
    const now = Date.now();
    if (now - lastMirvWarn < 1500) return;   // 누르고 있을 때 경고 스팸 방지
    lastMirvWarn = now;
    toast(msg, "#ffaa00");
  }

  function fireMirv() {
    const tile = computeCursorTile();
    if (tile === null) {
      toast("❌ 타깃 위에 커서를 올린 뒤 누르세요", "#ffaa00");
      return;
    }
    const game = getGameView();
    const bus = getEventBus();
    const ctor = findNukeEventCtor();
    const me = game && typeof game.myPlayer === "function" ? game.myPlayer() : null;
    if (!bus || !ctor || !me) {
      toast("❌ 경로 없음 — 게임 시작 후 다시 시도", "#ff5555");
      return;
    }

    // 타깃 검증 — MIRV는 '소유자 있는 영토'에만 떨어진다
    try {
      if (typeof game.hasOwner === "function" && !game.hasOwner(tile)) {
        mirvWarn("❌ MIRV는 영토에만 — 커서를 영토 위로");
        return;
      }
    } catch (e) {}

    // 발사관 검증 — 서버는 '준비된 사일로'(쿨다운 아님)를 요구한다
    try {
      if (typeof me.readyMissileCount === "function" && me.readyMissileCount() <= 0) {
        mirvWarn("❌ 준비된 발사관 없음");
        return;
      }
    } catch (e) {}

    // 골드 검증.
    //   비용 = 25M + 15M × (게임 전체 MIRV 발사횟수), 무한골드 치트면 0원.
    //   주의: 정확한 누적 비용은 game.stats() 를 요구하는데 GameView 엔 그게 없다.
    //   → 정확값을 못 읽으면 '최소 비용(기본 25M)'만 검사한다 (과차단 방지).
    try {
      const cfg = typeof game.config === "function" ? game.config() : null;
      const info = cfg && typeof cfg.unitInfo === "function" ? cfg.unitInfo("MIRV") : null;
      let cost = null;
      if (info && typeof info.cost === "function") {
        try { cost = info.cost(game, me); } catch (e) { cost = null; }   // stats() 없음 → 폴백
      }
      if (cost === null) {
        let ig = false;
        try { ig = !!(cfg && typeof cfg.infiniteGold === "function" && cfg.infiniteGold()); } catch (e) {}
        if (!ig) cost = 25000000n;   // 기본가 — 누적분은 서버가 판정
      }
      if (cost !== null && typeof me.gold === "function" && me.gold() < cost) {
        mirvWarn("❌ 골드 부족 — MIRV 최소 " + Math.round(Number(cost) / 1e6) + "M 필요");
        return;
      }
    } catch (e) {}

    try {
      // 게임 라디얼 메뉴와 동일 규칙: MIRV는 rocketDirectionUp·amount 없이 보낸다
      bus.emit(new ctor("MIRV", tile, undefined, undefined));
      rateUse();
      toast("🚀 MIRV 발사 — 탄두 최대 350발", "#ff8c66");
    } catch (e) {
      console.warn("[x50] MIRV emit 실패:", e);
      toast("❌ MIRV 발사 실패 (콘솔 확인)", "#ff5555");
    }
  }

  // ═════════════════════════════════════════════
  // 구조물 업그레이드 (V 무장 → 구조물 클릭)
  //
  // 게임 소스 검증 경로:
  //   SendUpgradeStructureIntentEvent(unitId, unitType, amount)
  //   → {type:"upgrade_structure", unit, unitId, amount(1~50)}
  //   → 서버 UpgradeStructureExecution: amount회 연속 레벨업.
  //     골드가 바닥나면 그 지점에서 중단(거부 아님), 엔진 레벨 상한 없음.
  //   ※ 정식 라디얼 메뉴(x1/x5/x10/xMax)와 가운데클릭 자동업그레이드가 쓰는 바로 그 경로.
  //
  // 대상 선택은 게임의 공식 판정(buildables → canUpgrade)을 그대로 사용한다
  // → 반경 15타일 내 '업그레이드 가능한' 최근접 구조물 1개 (게임 가운데클릭과 동일 규칙).
  //
  // 발송 속도 (v2.4): 서버는 인텐트 1건(≤50레벨)을 '한 틱에' 전부 적용한다
  //   (UpgradeStructureExecution.init — amount회 동기 실행).
  //   → 유일한 병목은 인텐트 전송 속도(초당 10건)다.
  //
  //   '여유만큼 즉시, 꽉 차면 회전 대기' (v2.4 방식):
  //     · 창에 여유가 있으면 → 그만큼 지금 바로 (여러 번 클릭해도 안 막힘)
  //     · 창이 꽉 찼으면 → 첫 발송 + 1.05초(창 회전 + 여유)까지 대기 후 몰아쓰기
  //   +500 = 10건 = 한 창 → 즉시(네트워크 왕복 수준). +5,000은 창당 500레벨로
  //   서버가 허용하는 최대 속력 그대로. 살포 Z·수동 발사와 창을 나눠 쓴다.
  // ═════════════════════════════════════════════
  function toBig(v) {
    try { return typeof v === "bigint" ? v : BigInt(Math.round(Number(v) || 0)); }
    catch (e) { return BigInt(0); }
  }

  function targetFor(type) {
    try {
      const t = CFG.targetLevels && CFG.targetLevels[type];
      if (typeof t === "number" && t > 0) return t;
    } catch (e) {}
    return CFG.targetLevel;
  }

  // big=true 면 "大" 프리셋(addLevelsByTypeBig / addLevelsBig)을 쓴다.
  function addFor(type, big) {
    try {
      const tbl = big ? CFG.addLevelsByTypeBig : CFG.addLevelsByType;
      const a = tbl && tbl[type];
      if (typeof a === "number" && a > 0) return a;
    } catch (e) {}
    return big ? CFG.addLevelsBig : CFG.addLevels;
  }

  // 이번 클릭의 목표 레벨을 계산한다.
  //   mode "add" → 현재 레벨 + addFor(type[, big])   (예: Lv50에서 눌러도 Lv100까지)
  //   mode "set" → targetFor(type)                    (절대 목표, 이미 넘었으면 그대로)
  function goalLevel(type, currentLevel, big) {
    if (CFG.mode === "set") return targetFor(type);
    return currentLevel + addFor(type, big);
  }

  // 유닛 레벨 조회 — game.unit(id) 우선, 실패 시 전체 유닛 스캔 폴백.
  // (레벨을 못 읽으면 목표를 초과해 업그레이드할 수 있으므로 반드시 확보한다)
  function unitLevel(unitId, type) {
    try {
      const g = getGameView();
      if (!g) return null;
      if (typeof g.unit === "function") {
        const u = g.unit(unitId);
        if (u && typeof u.level === "function") {
          const lv = u.level();
          if (typeof lv === "number") return lv;
        }
      }
      if (typeof g.units === "function") {
        const pool = type ? g.units(type) : g.units();
        for (const u of pool) {
          try {
            if (u.id() === unitId && typeof u.level === "function") {
              const lv = u.level();
              if (typeof lv === "number") return lv;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  // 내 소유 구조물 중 해당 타입, 반경 내 최근접
  function nearestOwn(game, me, tile, types, maxDist) {
    try {
      const list = game.units(...types).filter((u) => {
        try { return isOwnedByMe(u, me); } catch (e) { return false; }
      });
      let best = null, bestD = Infinity;
      for (const u of list) {
        const d = game.manhattanDist(tile, u.tile());
        if (d < bestD) { bestD = d; best = u; }
      }
      if (best && bestD <= maxDist) return { unit: best, dist: bestD };
    } catch (e) {}
    return null;
  }

  // ── 업그레이드 고속 발송 (v2.4) ──
  // 서버는 인텐트 1건(amount≤50레벨)을 '한 틱에' 전부 적용한다:
  //   UpgradeStructureExecution.init() — for(amount회) upgradeUnit() 동기 실행.
  //   → 500레벨의 유일한 병목은 '인텐트 전송 속도 = 서버 초당 10건'이다.
  // (구버전은 청크마다 서버 반영을 기다리며 300ms씩 쉬어 500레벨에 수 초가 걸렸다)
  //
  // 안전 원칙:
  //   · 목표는 '절대 레벨'(클릭 시점 lv0 + N) — 반영 지연 중 겹쳐 눌러도 초과 계산 없음.
  //   · 보낸 총량은 (목표 - lv0)을 넘지 않는다.
  //   · 서버 초당 한도(10건)에 여유 1을 두고 스스로 페이싱한다 (드롭 0).
  //   · 골드로 감당 가능한 만큼만 사전 절단 (최종 판정은 서버).
  //   · 레벨을 못 읽으면 중단 (추측 금지).
  // 이번 서버창(1초)에서 '업그레이드가' 쓴 인텐트 수.
  //   여러 클릭(다중 구조물)이 각자 펌프를 돌려도 합계가 상한을 넘지 않게 한다
  //   → X(+500=10건)를 눌러도 창에 여유가 남아 Z 살포·수소가 굶지 않는다.
  let upSentTimes = [];
  const upgradeJobs = new Map();
  let upgradeEpoch = 0, upgradeSelectionPending = false;
  function cancelUpgrades() {
    upgradeEpoch++;
    upgradeSelectionPending=false;
    for(const job of upgradeJobs.values())job.cancel();
    upgradeJobs.clear();
  }
  window.addEventListener('pagehide',cancelUpgrades);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelUpgrades();});
  function upRoomNow() {
    const now = Date.now();
    while (upSentTimes.length && now - upSentTimes[0] > 1000) upSentTimes.shift();
    const cap = Math.max(1, Math.min(CFG.upgradeBurstPerWindow | 0 || 6, RL.perSecond));
    return Math.max(0, cap - upSentTimes.length);
  }

  function fireUpgrade(unitId, type, row, me, bus, ctor, big) {
    if(upgradeJobs.has(unitId)) {
      toast('업그레이드 진행·반영 대기 중 — 같은 구조물 중복 요청을 생략했습니다', '#ffd166');
      return;
    }
    const lv0 = unitLevel(unitId, type);
    if (lv0 === null) {
      toast(`⚠️ ${koName(type)} 레벨 확인 실패 — 중단 (게임 로드 후 재시도)`, "#ffaa00");
      return;
    }
    const target = goalLevel(type, lv0, big);
    if (target <= lv0) {
      toast(`ℹ️ ${koName(type)} 이미 Lv ${lv0} (목표 ${target})`, "#ffd166");
      return;
    }
    let remaining = target - lv0;
    if(!Number.isSafeInteger(remaining)||remaining<=0){toast('업그레이드 수량 설정을 확인하세요','#ffaa00');return;}
    let cappedByGold = false;

    // 골드 상한 — upgradeCosts[k-1] = k회 연속 업그레이드의 누적 비용
    try {
      const costs = row && row.upgradeCosts;
      if (costs && costs.length > 0) {
        const gold = toBig(me.gold());
        const priceable = Math.min(remaining, costs.length);
        let k = priceable;
        while (k > 0 && toBig(costs[k - 1]) > gold) k--;
        if (k <= 0) {
          toast(`💰 골드 부족 — ${koName(type)} 다음 강화 불가`, "#ff5555");
          return;
        }
        if (k < priceable) { cappedByGold = true; remaining = k; }
      }
    } catch (e) {}

    const perIntent = 50; // 업그레이드는 원자탄 CFG.amount와 독립: +500 = 정확히 10건
    const t0 = lv0;
    const startedAt = Date.now();
    let sent = 0;
    let timer = null;
    const game=getGameView(),epoch=upgradeEpoch;
    const job={cancel(){if(timer!==null)clearTimeout(timer);timer=null;}};
    upgradeJobs.set(unitId,job);
    const cleanup=()=>{job.cancel();if(upgradeJobs.get(unitId)===job)upgradeJobs.delete(unitId);};

    // 발송이 끝난 뒤 반영을 지켜보고 결과를 알린다 (발사 자체는 이미 끝났다)
    function finish() {
      let tries = 0;
      const wantLv = t0 + sent;
      const report = (nowLv) => {
        cleanup();
        const gained = (nowLv === null ? t0 : nowLv) - t0;
        const tail = cappedByGold ? " (골드 한도)" : "";
        if (gained > 0) toast(`✅ ${koName(type)} Lv ${t0} → ${nowLv} (+${gained})${tail}`, "#7ee787");
        else toast(`⚠️ ${koName(type)} 반영 없음 — Lv ${t0} 유지 (골드·건설상태 확인)`, "#ffaa00");
      };
      const poll = () => {
        if(epoch!==upgradeEpoch||getGameView()!==game){cleanup();return;}
        const nowLv = unitLevel(unitId, type);
        if (nowLv !== null && nowLv >= wantLv) { report(nowLv); return; }
        if (++tries >= 25) { report(nowLv); return; }   // 최대 ~5초 대기
        timer = setTimeout(poll, 200);
      };
      poll();
    }

    // 창당 몰아쓰기 발송 (서버 초당 한도 10건을 최대 속력으로)
    function pump() {
      timer = null;
      if(epoch!==upgradeEpoch||getGameView()!==game){cleanup();return;}
      if (sent >= remaining) { finish(); return; }

      const now = Date.now();
      RL.secWindow = RL.secWindow.filter((x) => now - x < 1000);
      RL.minWindow = RL.minWindow.filter((x) => now - x < 60000);

      // 분당 한도(150건)가 바닥이면 분 경계까지 대기
      if (RL.minWindow.length >= RL.perMinute - 5) {
        const waitMs = Math.max(1100, RL.minWindow[0] + 60000 - now + 60);
        const ts = Date.now();
        if (ts - lastBlockToast > 3000) {
          lastBlockToast = ts;
          toast(`⏳ 서버 분당 한도 — ${Math.ceil(waitMs / 1000)}초 후 자동 재개`, "#ffaa00");
        }
        timer = setTimeout(pump, waitMs);
        return;
      }

      // 창에 '남은 여유'만큼 지금 바로 보낸다.
      //   · 창이 비었거나 여유가 있으면 → 즉시 (여러 번 클릭해도 안 막힘)
      //   · 창이 꽉 찼으면 → 그 창이 닫힐 때까지(첫 발송 + 1.05초) 대기 후 몰아쓰기
      //  (살포 Z·수동 발사와 창을 나눠 쓰므로 어느 쪽도 버려지지 않는다)
      const room = RL.perSecond - RL.secWindow.length;
      if (room <= 0) {
        const waitMs = Math.max(40, RL.secWindow[0] + 1050 - now);
        if (Date.now() - startedAt > 180000) {
          toast(`⏳ 서버 한도 대기 초과 — 중단 (남은 ${remaining - sent}레벨)`, "#ffaa00");
          cleanup();return;
        }
        const ts = Date.now();
        if (ts - lastBlockToast > 3000) {
          lastBlockToast = ts;
          toast(`⏳ 서버 초당 한도 — ${Math.ceil(waitMs / 1000)}초 후 자동 재개`, "#ffaa00");
        }
        timer = setTimeout(pump, waitMs);
        return;
      }

      // 이번 창 몫: 서버 여유 · 업그레이드 전용 상한 · 남은 양 중 최소
      const burst = Math.min(room, upRoomNow(), RL.perMinute - 5 - RL.minWindow.length, Math.ceil((remaining - sent)/perIntent));
      let n = 0;
      while (n < burst && sent < remaining) {
        const amt = Math.min(perIntent, remaining - sent);
        if (amt <= 0) break;
        try {
          bus.emit(new ctor(unitId, type, amt));
          rateUse();
          upSentTimes.push(Date.now());
        } catch (e) {
          console.warn("[x50] 업그레이드 emit 실패:", e);
          toast("❌ 업그레이드 발송 실패", "#ff5555");
          cleanup();return;
        }
        sent += amt;
        n++;
      }
      if (sent < remaining) {
        // 이번 창에서 업그레이드 몫을 다 썼다 → 창 회전까지 기다린다.
        //   (60ms 재시도로는 결국 창을 다 먹어 독점이 그대로 재현된다 — 실측 확인)
        const last = upSentTimes.length ? upSentTimes[upSentTimes.length - 1] : Date.now();
        const wait2 = Math.max(60, last + 1050 - Date.now());
        timer = setTimeout(pump, wait2);
        return;
      }
      finish();
    }

    toast(`🚀 ${koName(type)} +${remaining} · ${Math.ceil(remaining/perIntent)}건 요청 (Lv ${t0} → ${t0 + remaining})${cappedByGold ? " — 골드 한도" : ""}`, "#ffd166");
    pump();
  }

  // ═════════════════════════════════════════════
  // 군함 대량 건조 (N 무장 → 바다 클릭)
  //
  // 게임 소스 검증:
  //   ConstructionExecution 의 amount 루프는 핵(AtomBomb/HydrogenBomb)에만 있다.
  //   Warship 케이스는 `new WarshipExecution(...)` 한 번만 호출 → amount 무시됨.
  //   따라서 여러 척을 띄우려면 build_unit 인텐트를 N번 반복 발송해야 한다.
  //   건조 위치는 서버가 정한다(warshipSpawn): 클릭한 바다와 같은 수역에 있는
  //   내 항구 중 가장 가까운 항구 타일. 항구가 없으면 건조되지 않는다.
  //   비용은 보유 수 기준 (n+1)×25만, 4척 넘으면 100만 고정.
  // ═════════════════════════════════════════════
  function requestWarships() {
    const game = getGameView();
    const bus = getEventBus();
    if (!game || !bus) { toast("❌ 게임 시작 후 사용하세요", "#ff5555"); return; }
    const me = game.myPlayer();
    if (!me) { toast("❌ 플레이어 정보 없음", "#ff5555"); return; }
    const ctor = findNukeEventCtor();   // build_unit 인텐트와 동일 클래스
    if (!ctor) { toast("❌ 건조 경로 없음 (게임 시작 후 재시도)", "#ff5555"); return; }
    const tile = computeCursorTile();
    if (tile === null) { toast("❌ 커서 위치 인식 실패", "#ff5555"); return; }

    // 바다인지 확인 (군함은 물에만 건조 가능)
    try {
      if (typeof game.isLand === "function" && game.isLand(tile)) {
        toast("❌ 바다를 클릭하세요 (군함은 육지에 못 띄웁니다)", "#ffaa00");
        setArmed(false);   // 실패했으면 무장 해제
        return;
      }
    } catch (e) {}

    // 항구 보유 확인 — 없으면 서버가 조용히 실패한다
    let portCount = 0;
    try {
      portCount = game.units("Port").filter((u) => {
        try { return isOwnedByMe(u, me); } catch (e) { return false; }
      }).length;
    } catch (e) {}
    if (portCount === 0) {
      toast("❌ 항구가 없습니다 — 군함은 항구에서만 건조됩니다", "#ff5555");
      setArmed(false);   // 실패했으면 무장을 풀어 사용자가 상태를 알 수 있게
      return;
    }

    const want = Math.max(1, Math.min(CFG.warshipCount | 0, CFG.warshipMaxCount));
    const baseDelay = Math.max(110, CFG.warshipDelayMs | 0);   // 초당 10개 제한(100ms) 대비 여유

    // 분당·초당 한도에 여유가 없으면 잠시 기다렸다가 다시 시도한다
    const room = rateDelayFor(want);
    if (room.allowed <= 0) {
      const wait = room.waitSec || rateGate() || 1;
      // 초당 한도는 짧게 기다리면 풀리므로 자동 재시도 (분당 소진은 길어서 포기)
      if (wait <= 3) {
        toast(`⏳ 서버 한도 — ${wait}초 후 자동 재시도`, "#ffd166");
        setTimeout(() => { try { requestWarships(); } catch (e) {} }, wait * 1000 + 80);
      } else {
        toast(`⏳ 서버 한도 소진 — 약 ${wait}초 후 다시 시도하세요`, "#ffaa00");
        setArmed(false);
      }
      return;
    }
    const count = room.allowed;
    // 남은 분당 여유에 맞춰 간격을 늘린다 (최소 간격 유지)
    const minGap = Math.ceil(60000 / Math.max(1, RL.perMinute - 5));
    const delay = Math.max(baseDelay, minGap);
    if (count < want) {
      toast(`🚢 한도로 ${want}척 중 ${count}척만 건조합니다`, "#ffd166");
    }

    let sent = 0;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        try {
          // amount 는 서버가 군함에 대해 무시하므로 1로 보낸다
          bus.emit(new ctor("Warship", tile, undefined, 1));
          rateUse();
          sent++;
          if (sent === count) {
            toast(`🚢 군함 ${count}척 건조 요청 완료 (항구 ${portCount}곳)`, "#7ee787");
          }
        } catch (e) {
          console.warn("[x50] 군함 건조 emit 실패:", e);
          toast("❌ 군함 건조 발송 실패", "#ff5555");
        }
      }, i * delay);
    }
    if (count > 1) toast(`🚢 군함 ${count}척 건조 시작…`, "#7ee787");
  }

  // ═════════════════════════════════════════════
  // 인텐트 속도 제한 (서버와 동일한 규칙을 클라이언트에서 미리 계산)
  //
  // 게임 서버(ClientMsgRateLimiter): 초당 10개 AND 분당 150개.
  // 둘 다 통과해야 하며, 초과분은 통보 없이 조용히 버려진다(킥 아님).
  // 분당 버킷은 시간이 아니라 '분 경계'에서 리셋되므로, 소진하면
  // 최대 60초간 아무것도 안 먹히는 것처럼 보인다.
  //   → 여기서 미리 세어 한도에 닿으면 발사를 막고 남은 시간을 알려준다.
  // ═════════════════════════════════════════════
  const RL = {
    perSecond: 10,
    perMinute: 150,
    secWindow: [],     // 최근 1초간 인텐트 타임스탬프
    minWindow: [],     // 최근 1분간 인텐트 타임스탬프
  };

  // 발사 가능 여부 판정. 반환값 = 기다려야 할 초 (0이면 지금 가능)
  function rateGate() {
    const now = Date.now();
    RL.secWindow = RL.secWindow.filter((t) => now - t < 1000);
    RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);

    // 서버가 여유를 갖도록 살짝 남긴다 (초당 1개·분당 5개)
    if (RL.secWindow.length >= RL.perSecond - 1) {
      const oldest = RL.secWindow[0];
      return Math.max(1, Math.ceil((1000 - (now - oldest)) / 1000));
    }
    if (RL.minWindow.length >= RL.perMinute - 5) {
      const oldest = RL.minWindow[0];
      return Math.max(1, Math.ceil((60000 - (now - oldest)) / 1000));
    }
    return 0;
  }

  function rateUse() {
    const now = Date.now();
    RL.secWindow.push(now);
    RL.minWindow.push(now);
  }

  // 여러 인텐트를 순차 발송할 때 남은 여유를 반환한다 (군함 건조 등).
  // 초당·분당 둘 다 고려한다: 초당은 간격으로, 분당은 총량으로 제한.
  function rateDelayFor(count) {
    const now = Date.now();
    RL.secWindow = RL.secWindow.filter((t) => now - t < 1000);
    RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);
    const secRoom = Math.max(0, RL.perSecond - 1 - RL.secWindow.length);
    const minRoom = Math.max(0, RL.perMinute - 5 - RL.minWindow.length);
    // 초당 여유가 있으면 그만큼은 즉시 보낼 수 있다 (간격으로 분산)
    // 초당 여유가 0이면 이번엔 보내지 않는다 (1초 뒤 재시도 유도)
    return {
      secRoom, minRoom,
      allowed: Math.min(count, minRoom, secRoom > 0 ? count : 0),
      waitSec: secRoom > 0 ? 0 : (RL.secWindow.length ? Math.max(1, Math.ceil((1000 - (now - RL.secWindow[0])) / 1000)) : 0),
    };
  }

  function requestUpgrade(big) {
    if(upgradeSelectionPending)return;
    upgradeSelectionPending=true;
    const epoch=upgradeEpoch;
    selectUpgrade(big,epoch).catch(e=>{console.warn('[x50] 업그레이드 대상 확인 실패',e);})
      .finally(()=>{if(epoch===upgradeEpoch)upgradeSelectionPending=false;});
  }
  async function selectUpgrade(big,epoch) {
    const game = getGameView();
    const bus = getEventBus();
    if (!game || !bus) { toast("❌ 게임 시작 후 사용하세요", "#ff5555"); return; }
    const me = game.myPlayer();
    if (!me) { toast("❌ 플레이어 정보 없음", "#ff5555"); return; }
    const ctor = findUpgradeEventCtor();
    if (!ctor) { toast("❌ 업그레이드 경로 없음 (게임 시작 후 재시도)", "#ff5555"); return; }
    const tile = computeCursorTile();
    if (tile === null) { toast("❌ 커서 위치 인식 실패", "#ff5555"); return; }

    const types = CFG.upgradableTypes;
    const maxDist = 15; // 게임 structureMinDist와 동일

    // 폴백: 게임 판정을 못 쓸 때 직접 최근접 탐색
    const direct = () => {
      const hit = nearestOwn(game, me, tile, types, maxDist);
      if (hit) { fireUpgrade(hit.unit.id(), hit.unit.type(), null, me, bus, ctor, big); return; }
      const dp = nearestOwn(game, me, tile, ["Defense Post"], maxDist);
      if (dp) { toast("ℹ️ 디펜스 포스트는 업그레이드할 수 없습니다", "#ffaa00"); return; }
      toast(`❌ 반경 ${maxDist}타일 내 업그레이드 가능한 내 구조물 없음`, "#ffaa00");
    };

    // 1순위: 게임 공식 판정 (buildables → canUpgrade = 업그레이드 대상 유닛 id)
    let p = null;
    try {
      if (typeof me.buildables === "function") p = me.buildables(tile, types);
      else if (typeof me.actions === "function") p = me.actions(tile, types);
    } catch (e) { p = null; }

    if (!p || typeof p.then !== "function") { direct(); return; }

    let res;
    try{res=await p;}catch{if(epoch===upgradeEpoch&&getGameView()===game)direct();return;}
    if(epoch!==upgradeEpoch||getGameView()!==game)return;
    {
      const arr = Array.isArray(res) ? res : (res && res.buildableUnits) || [];
      // canUpgrade가 살아있는 행들 중 클릭 지점에서 가장 가까운 구조물 선택
      let bestId = null, bestType = null, bestRow = null, bestD = Infinity;
      for (const row of arr) {
        if (!row || row.canUpgrade === false) continue;
        let d = Infinity;
        try {
          // game.unit(id) 없으면 전체 유닛에서 찾는다
          let u = null;
          if (typeof game.unit === "function") u = game.unit(row.canUpgrade);
          if (!u) {
            for (const cand of game.units(row.type)) {
              try { if (cand.id() === row.canUpgrade) { u = cand; break; } } catch (e) {}
            }
          }
          if (u) d = game.manhattanDist(tile, u.tile());
        } catch (e) {}
        if (d < bestD) { bestD = d; bestId = row.canUpgrade; bestType = row.type; bestRow = row; }
      }
      if (bestId !== null) { fireUpgrade(bestId, bestType, bestRow, me, bus, ctor, big); return; }

      // 업그레이드 대상이 없음 → 사유를 정확히 안내
      const hit = nearestOwn(game, me, tile, types, maxDist);
      if (hit) {
        try {
          if (typeof hit.unit.isUnderConstruction === "function" && hit.unit.isUnderConstruction()) {
            toast(`⏳ ${koName(hit.unit.type())} 건설 중 — 완료 후 다시 시도`, "#ffaa00");
            return;
          }
        } catch (e) {}
        // 골드 부족 여부 판정
        let row = null;
        for (const r of arr) { if (r && r.type === hit.unit.type()) { row = r; break; } }
        if (row && row.cost !== undefined && toBig(row.cost) > toBig(me.gold())) {
          toast(`❌ 골드 부족 — ${koName(hit.unit.type())} 다음 강화에 ${String(row.cost)} 필요`, "#ff5555");
          return;
        }
        fireUpgrade(hit.unit.id(), hit.unit.type(), row, me, bus, ctor, big);
        return;
      }
      const dp = nearestOwn(game, me, tile, ["Defense Post"], maxDist);
      if (dp) { toast("ℹ️ 디펜스 포스트는 업그레이드할 수 없습니다", "#ffaa00"); return; }
      toast(`❌ 반경 ${maxDist}타일 내 업그레이드 가능한 내 구조물 없음`, "#ffaa00");
    }
  }

  // ── 무장 상태 클릭 가로채기 (캡처 단계 → 게임보다 먼저) ──
  // 무장은 클릭해도 풀리지 않는다 — V/N을 다시 누르거나 Esc 로만 해제.
  // (여러 구조물을 연속으로 올릴 때 매번 키를 다시 누르지 않도록)
  window.addEventListener("pointerdown", (e) => {
    if (!armed) return;
    if (e.button !== 0) return;
    lastMouse = { x: e.clientX, y: e.clientY };
    const mode = armedMode;   // 이번 클릭 처리 후에도 유지
    suppressUp = true;
    clearTimeout(suppressTimer);
    // pointerup이 유실돼도 다음 클릭이 삼켜지지 않도록 자동 해제
    suppressTimer = setTimeout(() => { suppressUp = false; }, 1500);
    try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
    try {
      if (mode === "warship") requestWarships();
      else requestUpgrade(mode === "upgradeBig");
    } catch (err) {}
    scheduleIdleDisarm();   // 연속 작업 중에는 무장 유지
  }, true);

  window.addEventListener("pointerup", (e) => {
    if (!suppressUp) return;
    suppressUp = false;
    clearTimeout(suppressTimer);
    try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
  }, true);

  function setArmed(v, mode) {
    armed = v;
    armedMode = v ? (mode || "upgrade") : null;
    clearTimeout(idleTimer);
    if (v) {
      if (armedMode === "warship") {
        toast(`🚢 군함 무장 ON — 바다를 클릭하면 ${CFG.warshipCount}척 건조 (N/Esc: 해제)`, "#7ee787");
      } else if (armedMode === "upgradeBig") {
        const silo = (CFG.addLevelsByTypeBig && CFG.addLevelsByTypeBig["Missile Silo"]) || CFG.addLevelsBig;
        toast(`🚀 업그레이드(大) 무장 ON — 클릭당 +${CFG.addLevelsBig} (사일로 +${silo}) (X/Esc: 해제)`, "#7ee787");
      } else {
        toast("🎯 업그레이드 무장 ON — 구조물을 계속 클릭하세요 (V/Esc: 해제)", "#7ee787");
      }
      scheduleIdleDisarm();
    } else {
      toast("⚪ 무장 해제", "#ffaa00");
    }
  }

  // 무장은 유지되지만, 오래 방치하면 실수 클릭을 막기 위해 자동 해제한다.
  // 업그레이드를 할 때마다 타이머가 갱신되므로 연속 작업 중에는 풀리지 않는다.
  const IDLE_DISARM_MS = 90000;
  function scheduleIdleDisarm() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!armed) return;
      armed = false;
      toast("⌛ 무장 자동 해제 (90초 미사용)", "#ffaa00");
    }, IDLE_DISARM_MS);
  }

  // ── 키 입력 ──
  function isTypingTarget(el) {
    if (!el) return false;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el && el.isContentEditable)
    );
  }
  window.addEventListener(
    "keydown",
    (e) => {
      if(e.code==='Escape'){cancelUpgrades();if(armed)setArmed(false);}
      if (isTypingTarget(e.target)) return;
      if (plannerKeyGuard(e)) return;
      if(e.repeat&&[CFG.hotkeyUpgrade,CFG.hotkeyUpgradeBig,CFG.hotkeyWarship].includes(e.code)) {
        e.preventDefault();e.stopPropagation();return;
      }

      // ── 반복 입력 처리 ──
      // 키를 누르고 있으면 OS auto-repeat(초당 ~30회)이 들어온다.
      // 이를 그대로 보내면 서버 한도(초당 10·분당 150)를 태워 먹통이 되므로,
      // '서버가 감당하는 속도'로 눌러주는 것과 같게 만든다:
      //   - 한 번 누름(repeat 아님) → 즉시 1회
      //   - 누르고 있음(repeat)     → 한도에 여유가 있는 동안 계속 발사
      // 초당 한도는 rateGate() 가, 분당 한도도 함께 검사한다.
      const isFireKey =
        e.code === CFG.hotkey || e.code === CFG.hotkeyMax ||
        e.code === CFG.hotkeyHydro || e.code === CFG.hotkeyMirv;

      // 대량 살포·수소타격은 반복 입력을 무시한다 (연사는 내부 스케줄이 담당)
      if (e.repeat && e.code === CFG.hotkeySalvo) return;
      if (e.repeat && e.code === CFG.hotkeyStrike) return;
      if (e.repeat && isFireKey && !CFG.holdRepeat) return;   // holdRepeat 끄면 반복 무시

      const stop = () => {
        e.preventDefault();
        if (CFG.swallowGameKeys) { try { e.stopPropagation(); } catch (err) {} }
      };

      // 서버 한도에 여유가 없으면 건너뛴다 (토스트는 3초에 한 번만)
      const gate = () => {
        const wait = rateGate();
        if (wait > 0) {
          const now = Date.now();
          if (now - lastBlockToast > 3000) {
            lastBlockToast = now;
            toast(`⏳ 서버 한도 — ${wait}초 후 자동 재개 (계속 누르고 계셔도 됩니다)`, "#ffaa00");
          }
          return false;
        }
        return true;
      };

      if (e.code === CFG.hotkey) {
        stop();
        if (gate()) fireAtoms(CFG.amount);
      } else if (e.code === CFG.hotkeyMax) {
        stop();
        if (gate()) fireMax();
      } else if (e.code === CFG.hotkeyHydro) {
        stop();
        if (gate()) fireHydro();
      } else if (e.code === CFG.hotkeyMirv) {
        stop();
        if (gate()) fireMirv();
      } else if (e.code === CFG.hotkeySalvo) {
        stop();
        startSalvo();
      } else if (e.code === CFG.hotkeyStrike) {
        stop();
        startStrike();
      } else if (e.code === "Escape" && (salvoQueue.length > 0 || salvoTimer !== null || salvoFollow !== null)) {
        e.preventDefault();
        salvoStop("⚪ 대량 발사 중단");
      } else if (e.code === CFG.hotkeyUpgrade) {
        stop();
        setArmed(armedMode !== "upgrade", "upgrade");
      } else if (e.code === CFG.hotkeyUpgradeBig) {
        stop();
        setArmed(armedMode !== "upgradeBig", "upgradeBig");
      } else if (e.code === CFG.hotkeyWarship) {
        stop();
        setArmed(armedMode !== "warship", "warship");
      } else if (e.code === "Escape" && armed) {
        e.preventDefault();
        setArmed(false);
      }
    },
    true,
  );

  // ═════════════════════════════════════════════
  // 코너 HUD (v2.5)
  //
  // ① 서버 리밋 카운트다운 — '미사일의 80% 이상을 쓸 수 있게' 되는 시점까지.
  //    · 초당 한도(10건) 기준: 최근 1초 사용량이 80%(8건) 미만이면 '사용 가능(100%)'.
  //    · 남은 초가 있으면 "리밋 해제까지 N.N초"로 표시하고, 해제되면 초록으로 전환.
  //    · 분당 한도(150건)도 같이 본다 — 분당이 모자라면 그쪽이 지배한다.
  // ② 타깃 타격 가능성 — 커서가 가리키는 지역의 적 SAM을 분석해
  //    '소진 원자 C + 수소 1발 + 추가 3~5%'가 내 사일로·골드로 가능한지 상시 표기.
  //    (SAM이 없으면 '방어 없음', 분석 불가면 '—')
  // ═════════════════════════════════════════════
  let hudEl = null, hudTimer = null, hudCache = null, hudCacheAt = 0, hudCacheTile = null;
  let hudCacheBrief = false;    // 현재 캐시가 '이동 중 요약'인가 (정밀 아님)
  let hudPreciseTimer = null;   // 디바운스된 정밀 계산 예약
  // 커서가 멈추면 그 타일을 정밀 계산하도록 예약한다 (중복 예약은 취소)
  function schedulePrecise(tile) {
    if (hudPreciseTimer !== null) clearTimeout(hudPreciseTimer);
    hudPreciseTimer = setTimeout(() => {
      hudPreciseTimer = null;
      try {
        if (computeCursorTile() !== tile) return;   // 그새 커서가 더 움직였으면 생략
        hudCacheAt = 0; hudCacheTile = null;        // 강제 재계산 유도
        hudTick();
      } catch (e) {}
    }, 380);
  }

  function hudEnsure() {
    if (hudEl) return hudEl;
    try {
      hudEl = document.createElement("div");
      hudEl.style.cssText = [
        "position:fixed", "z-index:999998", "pointer-events:none",
        "padding:8px 10px", "border-radius:8px",
        "font:500 14px/1.55 -apple-system,BlinkMacSystemFont,Apple SD Gothic Neo,sans-serif",
        "color:#e6edf3", "background:rgba(13,17,23,.96)",
        "border:1px solid rgba(110,118,129,.4)", "white-space:pre-wrap", "overflow-wrap:anywhere", "max-width:min(430px,calc(100vw - 32px))", "max-height:65vh", "overflow:hidden",
        "text-shadow:0 1px 2px rgba(0,0,0,.6)", "display:none",
      ].join(";");
      const c = CFG.hudCorner || "bottom-left";
      if (c === "top-left") hudEl.style.cssText += ";top:8px;left:8px";
      else if (c === "top-right") hudEl.style.cssText += ";top:8px;right:8px";
      else if (c === "bottom-right") hudEl.style.cssText += ";bottom:8px;right:8px";
      else hudEl.style.cssText += ";bottom:8px;left:8px";
      document.body.appendChild(hudEl);
    } catch (e) { hudEl = null; }
    return hudEl;
  }

  // 서버 리밋 상태 — '한도의 80%를 다시 쓸 수 있게' 되는 시점까지의 남은 시간.
  //   · 기준: 지금 남은 여유가 초당 8건(10×80%)·분당 120건(150×80%) 이상이면
  //     '사용 가능(여유 80%↑)' — 다시 충분히 쏠 수 있는 상태.
  //   · 여유가 그보다 적으면, 오래된 사용 기록이 1초/1분 창을 벗어나 여유가
  //     80%까지 회복되는 시각을 카운트다운한다.
  //   → 두 한도 중 더 늦게 회복되는 쪽이 실제 대기 시간.
  function hudRateState() {
    const now = Date.now();
    RL.secWindow = RL.secWindow.filter((t) => now - t < 1000);
    RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);
    const usable = Math.max(1, Math.min(100, CFG.hudUsablePct || 80)) / 100;
    const secCap = RL.perSecond, minCap = RL.perMinute;
    const secWant = Math.max(1, Math.floor(secCap * usable));   // 회복해야 할 최소 여유 (8)
    const minWant = Math.max(1, Math.floor(minCap * usable));   // (120)
    const secUsed = RL.secWindow.length, minUsed = RL.minWindow.length;
    const secRoom = Math.max(0, secCap - secUsed);
    const minRoom = Math.max(0, minCap - minUsed);
    // 여유가 80%까지 회복되려면 만료돼야 할 건수 → 그중 마지막 건이 창을 벗어나는 시각
    let secLeft = 0, minLeft = 0;
    const secNeed = secUsed - (secCap - secWant);
    if (secNeed > 0 && RL.secWindow.length > 0) {
      const idx = Math.min(secNeed - 1, RL.secWindow.length - 1);
      secLeft = Math.max(0, (RL.secWindow[idx] + 1000 - now) / 1000);
    }
    const minNeed = minUsed - (minCap - minWant);
    if (minNeed > 0 && RL.minWindow.length > 0) {
      const idx = Math.min(minNeed - 1, RL.minWindow.length - 1);
      minLeft = Math.max(0, (RL.minWindow[idx] + 60000 - now) / 1000);
    }
    const left = Math.max(secLeft, minLeft);
    const ok = secRoom >= secWant && minRoom >= minWant;
    return { secUsed, secCap, minUsed, minCap, secWant, minWant,
             secRoom, minRoom, ok, secLeft, minLeft, left };
  }

  // 금액 표기 (억/만 단위 축약)
  function fmtGold(v) {
    try {
      const n = Number(toBig(v));
      if (!Number.isFinite(n)) return String(v);
      if (n >= 1e8) return (n / 1e8).toFixed(1) + "억";
      if (n >= 1e4) return (n / 1e4).toFixed(1) + "만";
      return n.toLocaleString();
    } catch (e) { return String(v); }
  }

  function legacyHudTargetLine() {
    try {
      if (!CFG.hudHover) return "🎯 —";
      const now = Date.now();
      const tileNow = computeCursorTile();
      if (tileNow === null) { hudCache = "🎯 커서를 영토에"; hudCacheTile = null; return hudCache; }
      // ── 디바운스: 커서가 '멈춘 뒤'에만 정밀 계산한다 ──
      //   정밀 계획은 규모에 따라 30~80ms까지 걸릴 수 있어, 커서가 움직이는 동안
      //   계산하면 프레임이 끊긴다. → 이동 중에는 가벼운 요약만 보여주고,
      //   멈추고 350ms 뒤에 한 번 정밀 계산한다 (타일별 캐시로 재방문은 즉시).
      const moving = (now - lastMouseMoveAt) < 350;
      if (hudCache && hudCacheTile === tileNow) {
        // 같은 타일 재방문/머무름: 캐시가 유효하면 그대로, 아니면 정밀 갱신
        if (now - hudCacheAt < 2500 && !(moving && hudCacheBrief)) return hudCache;
      } else if (moving) {
        // 이동 중: 가벼운 요약 (SAM 수·ΣLv·방어량) + '계산 중' 안내, 정밀 계산은 예약
        let brief = null;
        try {
          const ana = CFG.samSimpleMode ? samsNear(tileNow) : samDefenders(tileNow);
          if (ana === null) brief = "🎯 —";
          else if (ana.n === 0) {
            let extra = "";
            try {
              const all = (getGameView().units("SAM Launcher") || []).length;
              if (all > 0) extra = ` (지도에 SAM ${all}기)`;
            } catch (e) {}
            brief = "🎯 방어 없음 — I=수소 1발" + extra;
          }
          else brief = `🎯 SAM ${ana.n}기 ΣLv${ana.sumLevel} · 계산 중…`;
        } catch (e) { brief = "🎯 계산 중…"; }
        hudCache = brief; hudCacheBrief = true; hudCacheTile = tileNow;
        schedulePrecise(tileNow);   // 커서가 멈추면 이 타일을 정밀 계산
        return hudCache;
      } else if (hudCache && now - hudCacheAt < 600) {
        return hudCache;
      }
      hudCacheAt = now; hudCacheTile = tileNow; hudCacheBrief = false;
      const tile = tileNow;
      if (tile === null) { hudCache = "🎯 커서를 영토에"; return hudCache; }
      // ── 단순 모드 HUD (v2.8.4) ──
      //   반드시 strikeSummary(경로 기반)보다 '먼저' 처리한다.
      //   strikeSummary는 samDefenders(궤적 판정)를 쓰므로 단순 모드와 결과가 다르고,
      //   no-sam으로 조기 반환해 아래 단순 분기에 도달하지 못하는 버그가 있었다.
      if (CFG.samSimpleMode) {
        const sn = samsNear(tile);
        const afS = (CFG.samAfterMin | 0) + (CFG.samAfterMax | 0) + (CFG.samAfterHydroMin | 0) + (CFG.samAfterHydroMax | 0) > 0
          ? `+후속 ☢${CFG.samAfterMin}~${CFG.samAfterMax} 💧${CFG.samAfterHydroMin}~${CFG.samAfterHydroMax}` : "";
        if (!sn || sn.n === 0) {
          let hint = "";
          try {
            const all = (getGameView().units("SAM Launcher") || []).length;
            if (all > 0) hint = ` (지도에 ${all}기 — 반경 밖/아군)`;
          } catch (e) {}
          hudCache = `🎯 SAM 없음 (${CFG.samSimpleRange}타일 내) — I=수소 1발${hint}`;
          return hudCache;
        }
        // ── v3.0 블록 모드: I 1회 = 원자 N + 수소 M, 연타로 누적 ──
        if (CFG.samBlockMode) {
          const bA = Math.max(1, CFG.samBlockAtoms | 0 || 200);
          const bH = Math.max(0, CFG.samBlockHydro === undefined ? 1 : (CFG.samBlockHydro | 0));
          const qn = salvoQueue.length, pend = salvoPending();
          const qTxt = qn > 0 ? `\n📦 대기 ${qn}블록 · ${pend.toLocaleString()}발` : "";
          hudCache = `🎯 SAM ${sn.n}기 ΣLv${sn.sumLevel} (${sn.range}타일 내)\n`
                   + `I 1회 = ☢ ${bA}발 + 💧${bH}발 (연타=누적 최대속력)${qTxt}`;
          return hudCache;
        }
        const shots = simpleShots(sn);
        const v = simpleVerdict(sn, shots, tile);
        const hEv = Math.max(0, CFG.samHydroEvery | 0);
        const hCnt = hEv > 0 ? Math.ceil(shots / hEv) : 0;
        const hydroTxt = hEv > 0 ? `☢ ${shots.toLocaleString()}발(×${CFG.samSimpleMult}) + 💧${hCnt}발(200발마다)`
                                 : `☢ ${shots.toLocaleString()}발(×${CFG.samSimpleMult})`;
        hudCache = `🎯 SAM ${sn.n}기 ΣLv${sn.sumLevel} (${sn.range}타일 내)\n`
                 + `${hydroTxt} → ${afS}`
                 + (v ? "\n" + verdictText(v) : "");
        return hudCache;
      }
      // HUD도 '정밀에 가깝게' — 표시값이 실제 발사량과 어긋나면 오해를 준다.
      //   경량 모드는 배수 1개라 큰 규모에서 필요량을 과대(1.25배) 표시했다.
      //   예산은 짧게(18ms) 유지해 프레임 보호.
      const a = strikeSummary(tile, true);   // light=true (내부에서 예산 관리)
      if (a.k === "na") { hudCache = "🎯 —"; return hudCache; }
      if (a.k === "no-sam") {
        // SAM이 실제로 존재하는데 0기로 나오면 계산 문제 → 진단 힌트를 함께 표시
        let extra = "";
        try {
          const all = (getGameView().units("SAM Launcher") || []).length;
          if (all > 0) extra = ` (지도에 SAM ${all}기 있음 — 경로 밖/아군)`;
        } catch (e) {}
        hudCache = "🎯 방어 없음 — I=수소 1발" + extra;
        return hudCache;
      }
      if (a.k !== "plan") { hudCache = "🎯 —"; return hudCache; }
      const jt = (a.jitterMin !== undefined && a.jitterMax !== undefined) ? `${a.jitterMin}~${a.jitterMax}` : "";
      // 여유분 표기: max(필요×10%, 랜덤 5~50) — '날아가는 동안 SAM 증원' 대비
      let l1;
      if (a.atomNeed !== null && a.atomNeed !== undefined && a.atomReserve !== null && a.atomReserve !== undefined) {
        const pctPart = (a.reservePct || 0) > 0 ? Math.ceil(a.atomNeed * a.reservePct / 100) : 0;
        const how = (pctPart > 0 && a.atomReserve === pctPart) ? `${a.reservePct}%` : (jt ? `랜덤${jt}` : "여유");
        l1 = `🎯 SAM ${a.samN}기 ΣLv${a.samSL} · 필요 ☢ ${a.atomNeed.toLocaleString()}발 +여유 ${a.atomReserve}(${how}) = ${a.C.toLocaleString()}`;
      } else {
        l1 = `🎯 SAM ${a.samN}기 ΣLv${a.samSL} · 필요 ☢ ${a.C.toLocaleString()}발${jt ? " +여유 " + jt : ""}`;
      }
      const af = (CFG.samAfterMin | 0) + (CFG.samAfterMax | 0) + (CFG.samAfterHydroMin | 0) + (CFG.samAfterHydroMax | 0) > 0
        ? ` +후속 ☢${CFG.samAfterMin}~${CFG.samAfterMax} 💧${CFG.samAfterHydroMin}~${CFG.samAfterHydroMax}` : "";
      // 🏭 사일로: 필요(실패 시 추정) vs 보유
      let l2;
      const own = a.tubesOwned !== undefined && a.tubesOwned !== null
        ? `보유 ${a.siloN}기·관Σ${a.tubesOwned}` + (a.ready !== null && a.ready !== undefined ? `(장전${a.ready})` : "")
        : "보유 —";
      const nd = a.need;
      const needMsg = nd && nd.ok
        ? (nd.mode === "spread"
            ? `필요: 사일로 ${nd.siloN}기(각 Lv${nd.lvEach}·관Σ${nd.tubes}) — 분산 건설`
            : `필요: 관Σ${nd.tubes} (×${nd.lvMult}, ${nd.siloN}기)`)
        : null;
      if (a.why === "no-silo") l2 = `🏭 사일로 없음 → 건설 필요 (${own})`;
      else if (a.ok) l2 = `🏭 가능 ✓ (${own})`;
      else if (a.why === "spread") {
        const mb = (a.maxBusy !== null && a.maxBusy !== undefined) ? `동시점유 ${a.maxBusy}/${a.sumLevel}` : "";
        l2 = `🏭 불가: ${mb} (파동 얕음) → ${needMsg || "사일로 늘리기"} (${own})`;
      }
      else if (a.why === "no-gap") {
        l2 = `🏭 불가: 슬롯이 계속 회복 → ${needMsg || "사일로 병렬성 ↑"} (${own})`;
      }
      else if (a.why === "short-run") {
        const ml = (a.maxRunLen !== null && a.maxRunLen !== undefined) ? `사각창 ${(a.maxRunLen / 1000).toFixed(1)}s` : "";
        l2 = `🏭 불가: ${ml} 부족 → ${needMsg || "사일로 병렬성 ↑"} (${own})`;
      }
      else if (a.why === "tubes") {
        l2 = `🏭 불가: 수소 넣을 빈 관 없음 → ${needMsg || "사일로 ↑"} (${own})`;
      }
      else l2 = `🏭 불가(${a.why || "창"}) ${needMsg || ""} (${own})`;
      // 💧 수소 타격 가능성 — '첫 수소가 실제로 들어가는가'가 핵심 판정
      let l3;
      if (a.ok) {
        const d = a.defense;
        const defTxt = a.ceil9 ? `적 방어 9초당 ${a.ceil9}발` : "";
        l3 = "💧 첫 수소 통과 ✓" + (defTxt ? ` · ${defTxt}` : "") + (af ? " ·" + af : "");
      } else {
        const g = a.h2Gap;
        const whyTxt = g ? `첫 수소 ${g.why} 격추` : `수소타격 불가(${a.why || "창"})`;
        const defTxt = a.ceil9 ? ` · 적 방어 9초당 ${a.ceil9}발` : "";
        l3 = `💧 ${whyTxt}${defTxt}` + (af ? " ·" + af : "");
      }
      // 💰 비용: 필요 vs 보유
      let l4 = "";
      if (a.goldNeed !== null && a.goldNeed !== undefined) {
        const needStr = a.goldNeed === 0n ? "무료" : fmtGold(a.goldNeed);
        const gold = myGold();
        const ownStr = gold === null ? "" : " / 보유 " + (toBig(gold) === 0n ? "∞(치트)" : fmtGold(gold));
        l4 = `💰 필요 ${needStr}${ownStr}` + (a.goldOk === false ? " ❌부족" : a.goldOk === true ? " ✅" : "");
      }
      hudCache = [l1, l2, l3, l4].filter(Boolean).join("\n");
      return hudCache;
    } catch (e) { return "🎯 —"; }
  }

    function hudTick() {
    hudTimer = null;
    try {
      if (!CFG.hud) return;
      const el = hudEnsure();
      if (!el) return;
      const r = hudRateState();
      const bar = r.ok ? "🟢" : "🔴";
      let rate = `${bar} 서버 ${r.secUsed}/${r.secCap}·초  ${r.minUsed}/${r.minCap}·분`;
      if (!r.ok) {
        rate += `\n⏳ 리밋 해제까지 ${r.left.toFixed(1)}초 (80%↑)`;
      } else {
        rate += "\n요청 한도 여유 (공격 분석과 별개)";
      }
      plannerRenderHud(el, r);
      el.style.display = "block";
    } catch (e) {}
    hudTimer = setTimeout(hudTick, 200);
  }

  function hudStart() {
    if (hudTimer !== null) return;
    hudTimer = setTimeout(hudTick, 200);
  }

  // ── 토스트 ──
  let toastEl = null;
  let toastTimer = null;
  function toast(msg, color) {
    try {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.style.cssText = [
          "position:fixed","top:64px","left:50%","transform:translateX(-50%)",
          "z-index:999999","padding:10px 18px","border-radius:8px",
          "font:600 14px/1.4 -apple-system,sans-serif","color:#fff",
          "background:rgba(20,20,24,.92)","border:1px solid rgba(255,255,255,.15)",
          "box-shadow:0 4px 16px rgba(0,0,0,.4)","pointer-events:none","white-space:nowrap",
        ].join(";");
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.borderLeft = `4px solid ${color || "#ffd166"}`;
      toastEl.style.display = "block";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.style.display = "none";
      }, CFG.toastMs);
    } catch (e) {}
  }

// PlayerView intentionally lacks Player.unitsOwned / unitsConstructed. Prices
// must come from the engine worker's buildables query, as the game's UI does.
function createPriceReader({now=()=>Date.now(),refreshMs=2000,maxAgeMs=5000,timeoutMs=1500,onUpdate=()=>{}}={}) {
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

// Presentation only. Never changes a plan, its acceptance, or execution limits.
function resultPresentation(r,s={}) {
  const n=value=>Number(value??0).toLocaleString('ko-KR');
  let title,tone,reason,action;
  if(r.chosen) {
    title=r.mode==='mixed'?'수소 혼합 공격 추천':'원자 집중 공격 추천';tone='ready';
    reason=r.mode==='mixed'?'원자탄과 수소탄을 섞어 보내는 계획입니다.':'원자탄만 보내는 계획입니다.';
    action='I를 누르면 최신 상태로 확인한 뒤 발사합니다.';
  } else {
    tone='caution';title=r.limited?'계산 시간이 부족합니다':'돌파 계획을 찾지 못했습니다';
    reason='발사 수량·순서를 바꿔 시험했지만 통과를 확인하지 못했습니다.';
    action='사일로 레벨·위치와 재장전 상태를 확인하세요.';
    if(r.limited) {reason='정해진 시간 안에 공격 가능 여부를 확인하지 못했습니다.';action='I를 누르면 더 오래 계산합니다. 검증되면 발사합니다.';}
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

  // Predictive I/HUD integration. The old manual H/J/Z/etc. remain available.
  const plannerSettings = {maxAtoms:2000,maxHydros:1,minAtomHits:1,budgetMs:1800,maxTicks:1200,
    adaptiveBudgetMs:350,maxReplans:12,details:false};
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

  function plannerFingerprint(s) {
    return JSON.stringify([s.game,s.me,s.target,s.rules,s.atomCost.toString(),s.hydroCost.toString(),s.allowed,
      s.silos.map(u=>[u.id,u.x,u.y,u.level,u.building]),s.sams.map(u=>[u.id,u.x,u.y,u.level,u.building,u.upgrade])]);
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
  function plannerCompute(snapshot,execute=false) {
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
      plannerState.display={result,snapshot,updated:plannerState.updated};
      if(execute) {
        if(!result.chosen) {toast(result.reason,'#ffd166');return;}
        plannerExecute(snapshot,result);
      }
    };
    worker.postMessage({id,snapshot:workerSnapshot(snapshot),options:{...plannerSettings,budgetMs,allowNewHydro:plannerSettings.maxHydros>0}});
  }

  function plannerJob(kind,data,budget,done,fail) {
    plannerCancelJob();
    const id=plannerState.job,url=URL.createObjectURL(new Blob([PLANNER_WORKER_SOURCE],{type:'text/javascript'}));
    let worker;
    try{worker=new Worker(url);}catch(e){URL.revokeObjectURL(url);fail(e.message);return;}
    URL.revokeObjectURL(url);plannerState.worker=worker;
    const failed=message=>{if(id!==plannerState.job)return;plannerCancelJob();fail(message);};
    plannerState.pending={id,execute:true,kind,timeout:setTimeout(()=>failed('계산 시간 초과'),budget+1500)};
    worker.onerror=e=>failed(e.message);
    worker.onmessage=e=>{
      if(id!==plannerState.job)return;
      clearTimeout(plannerState.pending.timeout);plannerState.pending=null;plannerState.worker=null;worker.terminate();
      if(e.data.error)fail(e.data.error);else done(e.data.result);
    };
    worker.postMessage({id,kind,...data,snapshot:workerSnapshot(data.snapshot)});
  }

  // Freeze limits for the whole operation, including every later revision.
  function plannerExecute(snapshot,result) {
    let fresh;
    try{fresh=plannerSnapshot(snapshot.tile);}catch(e){plannerState.error=e.message;return;}
    if(plannerFingerprint(fresh)!==plannerFingerprint(snapshot)) {
      plannerState.error='계산 중 구조물·규칙이 바뀌었습니다. I로 다시 분석하세요';return;
    }
    plannerJob('assess',{snapshot:fresh,plan:result.chosen,options:{minAtomHits:plannerSettings.minAtomHits,budgetMs:2500}},2500,check=>{
      if(!check.ok){plannerState.error='현재 상태에서 계획이 유효하지 않습니다. I로 다시 분석하세요';return;}
      let current;try{current=plannerSnapshot(snapshot.tile);}catch(e){plannerState.error=e.message;return;}
      if(current.tick-fresh.tick>2||plannerFingerprint(current)!==plannerFingerprint(fresh)||
        JSON.stringify(current.silos.map(s=>s.queue))!==JSON.stringify(fresh.silos.map(s=>s.queue))||
        JSON.stringify(current.sams.map(s=>s.queue))!==JSON.stringify(fresh.sams.map(s=>s.queue))) {
        plannerState.error='발사 직전 상태가 변했습니다. I로 다시 분석하세요';return;
      }
      const plan=result.chosen,bus=getEventBus(),ctor=findNukeEventCtor();
      if(current.gold<plan.cost||rateGate()>0){plannerState.error='골드 또는 명령 한도가 부족합니다';return;}
      if(!bus||!ctor){plannerState.error='게임 발사 이벤트를 찾지 못했습니다';return;}
      const ids=new Set(getGameView().units(ATOM,HYDRO).map(u=>u.id()));
      const run={plan,tile:snapshot.tile,game:snapshot.game,me:snapshot.me,rules:JSON.stringify(current.rules),
        baseTick:current.tick,index:0,sent:0,sentAtoms:0,sentHydros:0,confirmed:0,ids,tracked:new Map(),outbox:[],
        atomLimit:Math.min(5000,Math.max(0,plannerSettings.maxAtoms)),hydroLimit:Math.max(0,plannerSettings.maxHydros),
        minHits:Math.max(1,plannerSettings.minAtomHits),goal:plan.goal??(plan.hydros?'hydro':'atomic'),
        hitAtoms:0,hitHydros:0,replans:0,phase:'firing',reason:'검증된 계획 실행',needsReplan:false,
        startedTick:current.tick,lastTick:current.tick,lastTickAt:Date.now(),bus,ctor,current,
        signature:defenseSignature(current),risk:'',history:[]};
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
  function plannerRisk(s) {
    return JSON.stringify([s.confirmedAtomHits,s.confirmedHydroHits,
      s.inflight.filter(b=>b.committed).map(b=>[b.id,b.targeted])]);
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
    const budget=Math.max(50,Math.min(1500,plannerSettings.adaptiveBudgetMs)),lead=Math.ceil(budget/100)+2;
    const signature=defenseSignature(s),risk=plannerRisk(s);
    const remaining=remainingPlan(run.plan,run.index,run.baseTick,s.tick,lead);
    plannerJob('adapt',{snapshot:s,request:{remaining,goal:run.goal,atomLimit:run.atomLimit,hydroLimit:run.hydroLimit,
      sentAtoms:run.sentAtoms,sentHydros:run.sentHydros},options:{minAtomHits:run.minHits,maxTicks:plannerSettings.maxTicks,budgetMs:budget,initialTicks:lead}},budget,result=>{
      if(plannerState.run!==run)return;
      let fresh;
      try{fresh=plannerSnapshot(run.tile);plannerObserve(run,fresh);}catch(e){return plannerFinish(e.message,run.current,false);}
      const first=result.chosen?.actions[0];
      if(signature!==defenseSignature(fresh)||risk!==plannerRisk(fresh)||(first&&s.tick+first.tick<=fresh.tick)||fresh.tick-s.tick>lead) {
        run.phase='waiting-ack';run.needsReplan=true;run.reason='계산 중 상태가 바뀌어 다시 검증';return;
      }
      if(!result.chosen)return plannerFinish('남은 발사 중단: '+result.reason,fresh,true);
      run.plan=result.chosen;run.baseTick=s.tick;run.index=0;run.signature=signature;
      run.goal=run.plan.goal??(run.plan.hydros?'hydro':'atomic');
      run.phase=run.plan.actions.length?'firing':'observing';run.reason=result.reason;
      run.history.push({tick:fresh.tick,decision:result.decision,atoms:run.plan.atoms,hydros:run.plan.hydros,reason:result.reason});
      run.needsReplan=false;
    },message=>{if(plannerState.run===run)plannerFinish('재계산 실패로 남은 발사 중단: '+message,run.current,true);});
  }

  function plannerPump() {
    plannerState.timer=null;
    const run=plannerState.run;if(!run)return;
    try {
      if(document.hidden)return plannerStop('탭이 숨겨져 남은 발사를 중단했습니다');
      if(getGameView()?.ticks()===run.sampledTick) {
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
          if(rateGate()>0||current.gold<cost||ready-(run.sent-run.confirmed)<action.amount||
            (hydro?current.allowed.mixed===false:current.allowed.atomic===false)) {
            run.needsReplan=true;run.reason='골드·발사관·명령 한도 변경 — 남은 발사 보류';plannerReplan(run,current);
          }else {
            // Reserve before emit so a synchronous test adapter cannot race ACK.
            run.outbox.push({type:action.type,amount:action.amount,acked:0,tick});
            run.bus.emit(new run.ctor(action.type,run.tile,run.plan.up,action.amount));rateUse();
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
    if(upgradeJobs.size||upgradeSelectionPending||salvoQueue.length||salvoTimer!==null||salvoFollow!==null||armed){toast('기존 작업을 Esc로 끝낸 뒤 I를 누르세요','#ffd166');return;}
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
    if(p.run)return;
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

  // ── 디버그용 노출 (F12 콘솔: __x50) ──
  try {
    window.__x50 = {
      planner: plannerDebug, CFG, setArmed, requestUpgrade, cancelUpgrades, requestWarships, rateGate, rateDelayFor, rateUse, RL,
      fireAtoms, fireHydro, fireMax, fireMirv, startSalvo, salvoStop,
      samDefenders, mySilos, samRangeAtLevel, stPlan, stStream, stDeadRuns, stPath, stEngage,
      samsNear, simpleShots, simpleVerdict, verdictText,
      samDiag: (tile) => {
        // 진단: 커서 반경 내 SAM 판독 상태 (게임 F12 콘솔에서 __x50.samDiag())
        try {
          const g = getGameView();
          const t0 = (tile === undefined || tile === null) ? computeCursorTile() : tile;
          if (t0 === null || t0 === undefined) return "커서 좌표 없음 (영토 위에 커서를)";
          const myId = g.myPlayer() ? g.myPlayer().id() : "?";
          const all = g.units("SAM Launcher") || [];
          const sn = samsNear(t0);
          const lines = [];
          lines.push(`목표 tile=${t0} (${g.x(t0)},${g.y(t0)}) · 반경 ${CFG.samSimpleRange}`);
          lines.push(`나: ${myId}`);
          lines.push(`전체 SAM: ${all.length}기`);
          if (sn) {
            lines.push(`반경 내 적 SAM: ${sn.n}기 ΣLv${sn.sumLevel} → 발사 ${simpleShots(sn)}발 (×${CFG.samSimpleMult})`);
            lines.push(`  제외: 내것 ${sn.mine}기 · 판독실패 ${sn.skipped}기 · 건설중(포함) ${sn.building}기`);
            sn.defs.slice(0, 6).forEach((d) => lines.push(`  포함: (${d.x},${d.y}) Lv${d.lv} d=${d.d == null ? "?" : d.d.toFixed(0)}`));
          } else lines.push("samsNear=null (게임 뷰 없음)");
          // 전체 SAM 목록 (왜 빠졌는지 판독)
          lines.push("전체 목록(첫 8기):");
          all.slice(0, 8).forEach((u) => {
            try {
              const ut = u.tile();
              const ux = g.x(ut), uy = g.y(ut);
              const d = Math.hypot(ux - g.x(t0), uy - g.y(t0)).toFixed(0);
              const o = u.owner();
              lines.push(`  (${ux},${uy}) Lv${u.level()} 거리${d} owner=${o ? o.id() : "?"}${o && o.id() === myId ? " ←나" : ""}`);
            } catch (e) { lines.push(`  판독오류: ${e.message}`); }
          });
          return lines.join("\n");
        } catch (e) { return "진단 오류: " + e.message; }
      },
      stSilosNeeded, strikeSummary, fmtGold, hudRateState, hudTick, hudTargetLine, startStrike,
      lastStrikeRef: () => lastStrike, salvoHydroRef: () => salvoHydro,
      requestUpgrade, requestUpgradeBig: () => requestUpgrade(true),
      salvoState, salvoQueue: () => salvoQueue.slice(), salvoPending,
      salvoFollowRef: () => salvoFollow, armFollow,
      atomCostPerBomb, myGold, readyTubes,
      findNukeEventCtor, findUpgradeEventCtor, getGameView, getEventBus,
      targetFor, unitLevel, goalLevel, addFor,
    };
  } catch (e) {}

  // ── 코너 HUD 시작 ──
  try { if (CFG.hud) hudStart(); } catch (e) {}

  // ── 상태 로그 ──
  const readyTimer = setInterval(() => {
    const bus = getEventBus();
    if (!bus) return;
    const nuke = findNukeEventCtor();
    const up = findUpgradeEventCtor();
    if (nuke) {
      clearInterval(readyTimer);
      console.log(
        `[x50] 준비 완료 — Z: ${CFG.salvoAmount.toLocaleString()}발 (연타=대기열) / H: 원자50발 / G: xMax / J: 수소 / M: MIRV / V→구조물: +${CFG.addLevels}Lv / X→구조물: +${CFG.addLevelsBig}Lv / N→바다: 군함 ${CFG.warshipCount}척` +
        `${up ? "" : " (업그레이드 경로 미확인)"}`,
      );
    }
  }, 1000);
  setTimeout(() => clearInterval(readyTimer), 120000);
})();
