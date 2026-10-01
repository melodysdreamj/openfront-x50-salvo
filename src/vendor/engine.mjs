/**
 *  Precomputes regular curve step points along a cubic Bezier curve.
 */
export class DistanceBasedBezierCurve {
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
export class SAMTargetingSystem {
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
