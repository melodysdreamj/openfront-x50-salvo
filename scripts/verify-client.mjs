// Boundary integration: original client/config/engine methods against a minimal
// map and in-process worker transport. Not a full browser or online-server test.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createPriceReader} from '../src/prices.mjs';
import {validateSnapshot,trajectory,search,simulate,ATOM,HYDRO} from '../src/planner.mjs';
import {flightProgress} from '../src/adaptive.mjs';
const root=path.resolve(process.argv[2]??'../OpenFrontIO');
const deps={};
function ast(file){const text=fs.readFileSync(path.join(root,'src',file),'utf8');return ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);}
function evaluate(source,names){const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;const out=Function(...Object.keys(deps),js+'\nreturn {'+names.join(',')+'};')(...Object.values(deps));Object.assign(deps,out);return out;}
function enums(file,names){const a=ast(file);return evaluate(a.statements.filter(n=>ts.isEnumDeclaration(n)&&names.includes(n.name.text)).map(n=>n.getText(a).replace(/^export /,'')).join('\n'),names);}
enums('core/game/Game.ts',['UnitType','PlayerType','TrainType']);
const renderer=ast('client/render/types/Renderer.ts');
for(const [name,alias] of [['PlayerTypeEnum','PlayerTypeEnum'],['TrainType','RendererTrainType']]){
 const n=renderer.statements.find(n=>ts.isEnumDeclaration(n)&&n.name.text===name);
 const found=evaluate(n.getText(renderer).replace(/^export /,'').replace('enum '+name,'enum '+alias),[alias]);
}
function methods(file,name,selected,{includeConstructor=false,helpers=[]}={}){
 const a=ast(file),c=a.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===name);
 const members=c.members.filter(n=>selected===null||selected.includes(n.name?.getText(a))||(includeConstructor&&ts.isConstructorDeclaration(n)));
 if(selected)for(const s of selected)assert.ok(members.some(n=>n.name?.getText(a)===s),'upstream method missing: '+name+'.'+s);
 const extra=a.statements.filter(n=>ts.isFunctionDeclaration(n)&&helpers.includes(n.name?.text)).map(n=>n.getText(a)).join('\n');
 return evaluate(extra+'\nclass '+name+' {\n'+members.map(n=>n.getText(a)).join('\n')+'\n}',[name])[name];
}
const Config=methods('core/configuration/Config.ts','Config',['unitInfoCache','unitInfo','costWrapper','infiniteGold','hasInfiniteGoldFor','isReplay','msPerTick','SAMCooldown','SiloCooldown','isUnitDisabled','nukeMagnitudes','nukeSpeed','defaultNukeTargetableRange','samRange','maxSamRange','samUpgradeDuration','defaultSamMissileSpeed'],{includeConstructor:true});
const Player=methods('core/game/PlayerImpl.ts','PlayerImpl',['buildableUnits','unitsOwned','unitsConstructed','type','isLobbyCreator']);
const PlayerView=methods('client/view/PlayerView.ts','PlayerView',['buildables','actions','id','smallID','type','isPlayer','isAlive','isOnSameTeam','isFriendly','isAlliedWith','isLobbyCreator','gold']);
const UnitView=methods('client/view/UnitView.ts','UnitView',null,{helpers:['trainTypeToNum','numToTrainType','unitStateFromUpdate','applyUpdateInPlace']});
const GameView=methods('client/view/GameView.ts','GameView',['units','unit','motionPlans','updatesSinceLastTick','advanceMotionPlannedUnits']);
const cfg=new Config({infiniteGold:false,disabledUnits:[]},null,false),g=new GameView();
Object.assign(g,{_units:new Map(),unitMotionPlans:new Map(),lastUpdate:{updates:{}},time:1000,
 ticks(){return this.time;},config:()=>cfg,gameID:()=> 'boundary-fixture',width:()=>1000,height:()=>1000,
 x:t=>t%1000,y:t=>Math.floor(t/1000),inSpawnPhase:()=>false,isSpawnImmunityActive:()=>false,isImpassable:()=>false,
 railNetwork:()=>({}),unitGrid:{updateUnitCell(){}},markMotionPlannedUnitIdsDirty(){},advanceTrainMotionPlannedUnits(){}});
function player(id,team=null){const p=new PlayerView();p.game=g;p.static={id:'p'+id,team,playerType:deps.PlayerTypeEnum.Human};p.state={smallID:id,isAlive:true,gold:1000000000,allies:[]};return p;}
const me=player(1),enemy=player(2),mate=player(3,'blue'),neutral={isPlayer:()=>false,smallID:()=>0};
const players=new Map([[1,me],[2,enemy],[3,mate],[0,neutral]]);g.myPlayer=()=>me;g.playerBySmallID=id=>players.get(id);g.owner=()=>enemy;
const engine=new Player();Object.assign(engine,{mg:g,playerInfo:{playerType:deps.PlayerType.Human,isLobbyCreator:false},_units:[],myUnitsOwnedMemo:new Map(),_myUnitsVersion:0,numUnitsConstructed:{}});
g.worker={async playerBuildables(id,x,y,types){assert.equal(id,me.id());assert.equal(x,undefined);assert.equal(y,undefined);return engine.buildableUnits(null,types);}};
function update(id,type,owner,pos,extra={}){return {id,unitType:type,ownerID:owner,pos,lastPos:pos,isActive:true,reachedTarget:false,troops:0,missileTimerQueue:[],level:1,hasTrainStation:false,markedForDeletion:false,...extra};}
function unit(u){const v=new UnitView(g,u);g._units.set(v.id(),v);return v;}
const silo=unit(update(1,'Missile Silo',1,500100,{level:50}));
const sam=unit(update(2,'SAM Launcher',2,500695,{level:5,missileTimerQueue:[980],samUpgrade:{upgradeStartTick:995,startRange:70,targetLevel:5}}));
const allySam=unit(update(3,'SAM Launcher',3,500680,{level:2}));
let cursor=500700;
const legacy=fs.readFileSync(new URL('../src/legacy.js',import.meta.url),'utf8');
const ownerFn=legacy.slice(legacy.indexOf('  function isOwnedByMe'),legacy.indexOf('  function getTransform'));
const browserSource=fs.readFileSync(new URL('../src/browser.js',import.meta.url),'utf8');
const snapshotFn=browserSource.slice(browserSource.indexOf('  function plannerSnapshot'),browserSource.indexOf('  function plannerStop'));
const reader=createPriceReader(),context=vm.createContext({getGameView:()=>g,ATOM,HYDRO,validateSnapshot,flightProgress,plannerPrices:reader,plannerPaths:new WeakMap(),getRocketDirectionUp:()=>true,RL:{perMinute:150,minWindow:[]},dist2:(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2});
vm.runInContext(ownerFn+'\n'+snapshotFn+'\nthis.snapshot=plannerSnapshot;',context);
let checks=0;const check=(label,fn)=>{fn();checks++;console.log('Client boundary: '+label);};
check('previous price call reproduces unitsOwned failure with original Config and PlayerView',()=>{
 assert.equal(typeof me.unitsOwned,'undefined');assert.throws(()=>cfg.unitInfo(ATOM).cost(g,me),/unitsOwned/);
});
await reader.refresh(g,me);
check('fixed snapshot reads actual engine prices via original PlayerView.buildables',()=>{
 const s=context.snapshot(cursor);assert.equal(s.atomCost,750000n);assert.equal(s.hydroCost,5000000n);assert.equal(s.silos.length,1);assert.equal(s.sams.length,2);
});
check('original UnitView preserves SAM upgrade state and current reload queue',()=>{
 const s=context.snapshot(cursor),u=s.sams.find(u=>u.id===2);assert.equal(u.upgrade.startTick,995);assert.equal(u.upgrade.duration,45);assert.equal(u.queue[0],980);
});
check('sea target keeps nearby SAMs, including launch-path defenders',()=>{
 g.owner=()=>neutral;
 unit(update(6,'SAM Launcher',2,500110,{level:2}));
 unit(update(7,'SAM Launcher',2,0,{level:99}));
 const s=context.snapshot(cursor);assert.equal(s.sams.length,4);assert.equal(s.allowed.mixed,true);
 const result=simulate(s,{actions:[{tick:3,type:HYDRO,amount:1}],atoms:0,hydros:1,up:true});
 assert.ok(result.participating.includes(6));assert.ok(!result.participating.includes(7));
 g._units.delete(6);g._units.delete(7);g.owner=()=>enemy;
});
check('team filtering excludes teammate SAMs and protects nearby team structures',()=>{
 me.static.team='blue';const s=context.snapshot(cursor);assert.equal(s.sams.length,1);assert.equal(s.allowed.mixed,false);me.static.team=null;
});
check('zero gold stays zero and does not produce an affordable attack',()=>{
 me.state.gold=0;const s=context.snapshot(cursor);assert.equal(s.gold,0n);assert.equal(search(s).chosen,null);me.state.gold=1000000000;
});
cfg._gameConfig.hostCheats={infiniteGold:true};engine.playerInfo.isLobbyCreator=true;
await reader.refresh(g,me,true);
check('original host-only infinite-gold rule yields free weapon prices',()=>{const s=context.snapshot(cursor);assert.equal(s.atomCost,0n);assert.equal(s.hydroCost,0n);});
engine.playerInfo.isLobbyCreator=false;await reader.refresh(g,me,true);
check('non-host still pays standard prices under host-only infinite gold',()=>{assert.equal(context.snapshot(cursor).hydroCost,5000000n);});
const points=trajectory({x:100,y:500},{x:700,y:500},1000,true,10,150),pathTiles=points.map(p=>({tile:p.tile.y*1000+p.tile.x,targetable:p.targetable}));
const nuke=unit(update(4,HYDRO,1,500100,{targetTile:cursor,nukeState:{trajectory:pathTiles,trajectoryIndex:0,waitTicks:0,targetedBySam:false}}));
g.unitMotionPlans.set(4,{planId:1,startTick:990,ticksPerStep:1,path:Uint32Array.from(pathTiles.slice(0,-1),p=>p.tile)});
g.advanceMotionPlannedUnits(g.time);
check('original client-derived motion overrides the stale nukeState index',()=>{assert.equal(context.snapshot(cursor).inflight[0].index,10);});
unit(update(5,'SAM Missile',2,500690,{targetUnitId:4}));
check('original SAM missile target field identifies interception despite stale nuke flag',()=>{assert.equal(nuke.nukeState().targetedBySam,false);assert.equal(context.snapshot(cursor).inflight[0].targeted,true);});
const terminal=update(4,HYDRO,1,nuke.tile(),{targetTile:cursor,isActive:false,reachedTarget:true,nukeState:nuke.nukeState()});
nuke.update(terminal);g.lastUpdate.updates={1:[terminal]};
check('inactive missiles leave active enumeration but keep actual reachedTarget state',()=>{assert.equal(g.units(HYDRO).length,0);assert.equal(g.unit(4).reachedTarget(),true);assert.equal(g.updatesSinceLastTick()[1][0].reachedTarget,true);});
check('original UnitView exposes warship patrol target used for creation acknowledgment',()=>{
 const ship=unit(update(8,'Warship',1,500100,{warshipState:{patrolTile:500700,state:'patrolling'}}));
 assert.equal(ship.warshipState().patrolTile,500700);
 assert.ok(g.units('Warship').some(u=>u.id()===8&&u.owner()===me));
});
console.log(`Original client/config boundary checks: ${checks} passed. Source: ${root}`);
