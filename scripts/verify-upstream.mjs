// Run with a checkout of the pinned engine: node scripts/verify-upstream.mjs ../OpenFrontIO
// Actual upstream execution classes run against a minimal map/player adapter.
// Terrain explosions are counted instead of applied (the planner likewise keeps SAMs alive).
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {trajectory,simulate,assess,search,makePlan,ATOM,HYDRO} from '../src/planner.mjs';
import {adapt,flightProgress} from '../src/adaptive.mjs';
const root=path.resolve(process.argv[2]??'../OpenFrontIO');
const deps={Math,PathStatus:{NEXT:0,COMPLETE:2},within:(x,a,b)=>Math.max(a,Math.min(b,x)),atan2:Math.atan2,
  UnitType:{AtomBomb:ATOM,HydrogenBomb:HYDRO,MIRVWarhead:'MIRV Warhead',MIRV:'MIRV',MissileSilo:'Missile Silo',SAMLauncher:'SAM Launcher',SAMMissile:'SAM Missile'},
  GameType:{Singleplayer:'Singleplayer'},MessageType:{},isUnit:u=>u instanceof Unit,listNukeBreakAlliance:()=>[]};
function load(file,names) {
  const original=fs.readFileSync(path.join(root,'src/core',file),'utf8');
  const ast=ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true);
  const source=ast.statements.filter(n=>!ts.isImportDeclaration(n)&&
    !(ts.isVariableStatement(n)&&/Schema|Snapshot/.test(n.declarationList.declarations.map(d=>d.name.getText(ast)).join(' '))))
    .map(n=>n.getText(ast)).join('\n').replace(/\bexport /g,'');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const found=Function(...Object.keys(deps),js+'\nreturn {'+names.join(',')+'};')(...Object.values(deps));
  Object.assign(deps,found);return found;
}
load('utilities/Line.ts',['DistanceBasedBezierCurve']);
load('PseudoRandom.ts',['PseudoRandom']);
load('pathfinding/PathFinder.Parabola.ts',['ParabolaUniversalPathFinder']);
load('pathfinding/PathFinder.Air.ts',['AirPathFinder']);
load('pathfinding/PathFinderStepper.ts',['PathFinderStepper']);
deps.UniversalPathFinding={Parabola:(g,o)=>new deps.ParabolaUniversalPathFinder(g,o)};
deps.PathFinding={Air:g=>new deps.PathFinderStepper(new deps.AirPathFinder(g))};
load('execution/SAMMissileExecution.ts',['SAMMissileExecution']);
load('execution/SAMLauncherExecution.ts',['SAMLauncherExecution']);
load('execution/MissileSiloExecution.ts',['MissileSiloExecution']);
load('execution/NukeExecution.ts',['NukeExecution']);
let currentGame;
class Unit {
  constructor(owner,type,tile,params={}) {this._owner=owner;this._type=type;this._tile=tile;this._params=params;this.q=[];this.lv=1;this.active=true;this._id=++currentGame.nextId;this.ns={trajectory:params.trajectory??[],trajectoryIndex:0,waitTicks:0,targetedBySam:false};}
  id(){return this._id;} owner(){return this._owner;} type(){return this._type;} tile(){return this._tile;}
  move(t){this._tile=t;}isActive(){return this.active;}isUnderConstruction(){return false;}level(){return this.lv;}
  missileTimerQueue(){return this.q;}isInCooldown(){return this.q.length===this.lv;}launch(){this.q.push(currentGame.time);}
  reloadMissile(){this.q.shift();}samLauncherState(){return this.upgrade;}
  nukeState(){return this.ns;}updateNukeState(s){Object.assign(this.ns,s);}trajectory(){return this.ns.trajectory;}
  trajectoryIndex(){return this.ns.trajectoryIndex;}setTrajectoryIndex(i){this.ns.trajectoryIndex=Math.min(i,this.trajectory().length-1);}
  targetedBySAM(){return this.ns.targetedBySam;}setTargetedBySAM(v){this.ns.targetedBySam=v;}setTargetable(){}
  targetTile(){return this._params.targetTile;}targetUnit(){return this._params.targetUnit;}delete(){this.active=false;}
}
function engineRun(s,plan,transition=null) {
  plan=structuredClone(plan);let adapted=null;
  const W=s.width,ref=(x,y)=>y*W+x,x=t=>t%W,y=t=>Math.floor(t/W),man=(a,b)=>Math.abs(x(a)-x(b))+Math.abs(y(a)-y(b));
  const all=[],execs=[],queued=[],motions=new Map();let gold=s.gold,atomHits=0,hydroHits=0;
  const cfg={nukeSpeed:t=>t===HYDRO?s.rules.hydroSpeed:s.rules.atomSpeed,defaultNukeTargetableRange:()=>s.rules.targetRange,
    maxSamRange:()=>s.rules.maxSamRange,defaultSamMissileSpeed:()=>s.rules.samSpeed,SAMCooldown:()=>s.rules.samCooldown,SiloCooldown:()=>s.rules.siloCooldown,
    nukeMagnitudes:()=>({inner:1,outer:1}),nukeAllianceBreakThreshold:()=>100,gameConfig:()=>({gameType:'Singleplayer'}),
    dynamicSamRange:(u,t)=>{const z=u.upgrade;const r=l=>150-480/(l+5);return !z?r(u.lv):t-z.upgradeStartTick>=z.duration?r(z.targetLevel):z.startRange+(r(z.targetLevel)-z.startRange)*(t-z.upgradeStartTick)/z.duration;}};
  const player=id=>({id:()=>id,smallID:()=>id,displayName:()=>String(id),isPlayer:()=>true,isFriendly:()=>false,isOnSameTeam:()=>false,
    incomingAllianceRequests:()=>[],allianceWith:()=>null,updateRelation:()=>{},
    units:type=>all.filter(u=>u.active&&u.owner().id()===id&&u.type()===type),
    canBuild(type,target){const silos=this.units('Missile Silo').filter(u=>!u.isInCooldown()).sort((a,b)=>man(a.tile(),target)-man(b.tile(),target));
      return gold<(type===HYDRO?s.hydroCost:s.atomCost)?false:silos[0]?.tile()??false;},
    buildUnit(type,tile,params){const u=new Unit(this,type,tile,params);all.push(u);if(type===ATOM||type===HYDRO)gold-=type===HYDRO?s.hydroCost:s.atomCost;return u;}});
  const me=player(1),enemy=player(2),neutral={isPlayer:()=>false};
  const game={time:s.tick,nextId:0,ticks(){return this.time;},width:()=>s.width,height:()=>s.height,x,y,ref,
    config:()=>cfg,manhattanDist:man,euclideanDistSquared:(a,b)=>(x(a)-x(b))**2+(y(a)-y(b))**2,
    nearbyUnits:(tile,range,types,predicate=()=>true)=>all.filter(u=>u.active&&(Array.isArray(types)?types.includes(u.type()):types===u.type()))
      .map(unit=>({unit,distSquared:(x(tile)-x(unit.tile()))**2+(y(tile)-y(unit.tile()))**2})).filter(v=>v.distSquared<=range**2&&predicate(v)),
    unitCount:type=>all.filter(u=>u.active&&u.type()===type).length,owner:()=>neutral,hasOwner:()=>false,getWinner:()=>null,
    addExecution:(...e)=>queued.push(...e),stats:()=>({bombLaunch(){},bombIntercept(){}}),recordMotionPlan(p){motions.set(p.unitId,p);},displayMessage(){},playerBySmallID:()=>enemy};
  currentGame=game;
  for(const d of s.silos){const u=me.buildUnit('Missile Silo',ref(d.x,d.y),{});u.lv=d.level;u.q=[...d.queue];const e=new deps.MissileSiloExecution(u);e.init(game,game.time);execs.push(e);}
  for(const d of s.sams){const u=enemy.buildUnit('SAM Launcher',ref(d.x,d.y),{});u.lv=d.level;u.q=[...d.queue];const e=new deps.SAMLauncherExecution(enemy,null,u);e.init(game,game.time);execs.push(e);}
  let a=0;
  for(;game.time<s.tick+1200;game.time++) {
    if(transition&&game.time===s.tick+transition.at) {
      const sent=plan.actions.slice(0,a);
      assert.ok(sent.every(v=>s.tick+v.tick+2<game.time),'transition after ACK');
      for(const u of all.filter(u=>u.type()==='SAM Launcher')) {
        const startRange=cfg.dynamicSamRange(u,game.time);u.lv+=transition.add;
        u.upgrade={upgradeStartTick:game.time,startRange,targetLevel:u.lv,duration:45};
      }
      if(transition.nearSilo) {
        const u=me.buildUnit('Missile Silo',ref(550,500),{});u.lv=50;
        const e=new deps.MissileSiloExecution(u);e.init(game,game.time);execs.push(e);
      }
      const structs=type=>all.filter(u=>u.active&&u.type()===type).map(u=>({id:u.id(),x:x(u.tile()),y:y(u.tile()),level:u.lv,queue:[...u.q],
        upgrade:u.upgrade?{startTick:u.upgrade.upgradeStartTick,startRange:u.upgrade.startRange,targetLevel:u.upgrade.targetLevel,duration:u.upgrade.duration}:null}));
      const inflight=all.filter(u=>u.active&&[ATOM,HYDRO].includes(u.type())).map(u=>({id:u.id(),type:u.type(),owner:1,committed:true,
        targeted:u.targetedBySAM(),index:u.trajectoryIndex(),waitTicks:u.ns.waitTicks,target:s.target,
        path:u.trajectory().map(p=>({tile:{x:x(p.tile),y:y(p.tile)},targetable:p.targetable}))}));
      for(const b of inflight) {
        const unit=all.find(u=>u.id()===b.id),motion=motions.get(b.id);
        const observed=flightProgress(b.path,{x:x(unit.tile()),y:y(unit.tile())},unit.ns,motion,game.time);
        assert.equal(observed.index,b.index,'client-derived flight index agrees with original engine');
        assert.equal(observed.waitTicks,b.waitTicks,'client-derived departure tick agrees with original engine');
      }
      const live={...s,tick:game.time,gold,silos:structs('Missile Silo'),sams:structs('SAM Launcher'),inflight,includeCommitted:true,
        confirmedAtomHits:atomHits,confirmedHydroHits:hydroHits};
      const count=t=>sent.filter(v=>v.type===t).reduce((n,v)=>n+v.amount,0);
      adapted=adapt(live,{remaining:{...makePlan(0),goal:'hydro'},goal:'hydro',atomLimit:80,sentAtoms:count(ATOM),hydroLimit:1,sentHydros:count(HYDRO)},
        {budgetMs:1000,initialTicks:6});
      const extra=adapted.chosen?.actions.map(v=>({...v,tick:game.time-s.tick+v.tick,up:adapted.chosen.up}))??[];
      plan.actions=[...sent,...extra];
    }
    for(const e of execs)if(e.isActive())e.tick(game.time);
    // Nuke init on input+1, first spawn on input+2, matching ConstructionExecution.
    while(a<plan.actions.length&&game.time===s.tick+plan.actions[a].tick+1) {
      const intent=plan.actions[a++];
      for(let n=0;n<intent.amount;n++) {
        const e=new deps.NukeExecution(intent.type,me,ref(s.target.x,s.target.y),null,-1,0,intent.up??plan.up);
        e.detonate=function(){if(this.nuke.type()===HYDRO)hydroHits++;else atomHits++;this.nuke.delete();this.active=false;};
        queued.push(e);
      }
    }
    for(const e of queued){e.init(game,game.time);execs.push(e);}queued.length=0;
    if(a===plan.actions.length&&!execs.some(e=>e instanceof deps.NukeExecution&&e.isActive())&&!all.some(u=>u.active&&[ATOM,HYDRO,'SAM Missile'].includes(u.type())))break;
  }
  return {atomHits,hydroHits,adapted};
}
const base={tick:1000,me:1,target:{x:700,y:500},width:1000,height:1000,
  rules:{tickMs:100,samCooldown:90,siloCooldown:90,atomSpeed:10,hydroSpeed:10,samSpeed:12,targetRange:150,maxSamRange:150},
  silos:[{id:1,x:100,y:500,level:50,queue:[]}],sams:[],gold:10_000_000_000n,atomCost:750000n,hydroCost:5000000n};
let comparisons=0,verified=0;
for(const samLevel of [0,1,3,10,30]) for(const up of [true,false]) for(const atoms of [0,4,15,40]) {
  const s={...base,sams:samLevel?[{id:10,x:695,y:500,level:samLevel,queue:[]}]:[]};
  const p=makePlan(atoms,atoms,8,up),ours=assess(s,p),actual=engineRun(s,p);
  comparisons++;
  if(ours.ok) {assert.ok(actual.hydroHits>=1,JSON.stringify({samLevel,up,atoms,actual,ours},(_,v)=>typeof v==='bigint'?v.toString():v));verified++;}
}
console.log(`Upstream executions: ${comparisons} scenarios; ${verified} recommended hydrogen plans all hit.`);
let extra=0,accepted=0;
for(let i=0;i<90;i++) {
  const sourceSam=i%3===0,near=i%5===0;
  const s={...base,target:{x:near?260:700,y:300+i%7*40},
    silos:[{id:1,x:100,y:500,level:20,queue:i%4===0?[950,980]:[]},{id:2,x:130,y:600,level:20,queue:[]}],
    sams:[{id:10,x:sourceSam?120:680,y:sourceSam?480:300+i%7*40,level:1+i%8,queue:[]},
      {id:11,x:680,y:450,level:1+i%4,queue:i%2===0?[970]:[]}]};
  const p=makePlan(5+i%30,i%2===0?null:3+i%25,i%3*5,i%2===0);
  const prediction=assess(s,p),actual=engineRun(s,p);extra++;
  if(prediction.ok){accepted++;assert.ok(p.hydros?actual.hydroHits>=1:actual.atomHits>=1,JSON.stringify({i,actual,p}));}
}
console.log(`Upstream varied geometry/cooldowns: ${extra} scenarios; all ${accepted} recommendations achieved the hit criterion.`);

let adaptiveCases=0,adaptiveAccepted=0,rescued=0,switched=0;
for(const at of [12,35,55])for(const add of [1,3,10,40])for(const nearSilo of [false,true]) {
  const s={...base,sams:[{id:10,x:695,y:500,level:1,queue:[]}]};
  const actual=engineRun(s,makePlan(2,2),{at,add,nearSilo});adaptiveCases++;
  const r=actual.adapted;
  if(r?.chosen){adaptiveAccepted++;
    assert.ok(r.chosen.goal==='hydro'?actual.hydroHits>=1:actual.atomHits>=1,JSON.stringify({at,add,nearSilo,decision:r.decision,actual},(_,v)=>typeof v==='bigint'?v.toString():v));
    if(r.decision==='rescue')rescued++;if(r.decision==='atomic')switched++;
  }
}
assert.ok(rescued>0&&switched>0);
console.log(`Upstream in-flight SAM upgrades: ${adaptiveCases} scenarios; ${adaptiveAccepted} accepted revisions achieved the criterion (${rescued} hydro rescues, ${switched} atomic switches).`);
