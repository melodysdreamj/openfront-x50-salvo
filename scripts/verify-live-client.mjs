// Full local client + native game worker + native local transport, on a real
// map with real GPU rendering. Never connect this test to a public game server.
// Start the pinned upstream Vite client first (GAME_ENV=dev npm run start:client).
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
const origin=process.env.LOCAL_CLIENT_URL??'http://127.0.0.1:9000';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Local client only');
const browser=await chromium.launch({headless:false,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const artifact=process.env.SCREENSHOT_DIR,samScenario=process.argv.includes('--sam'),upgradeScenario=process.argv.includes('--upgrade'),fastScenario=process.argv.includes('--fast');
assert.ok(!fastScenario||!samScenario,'--fast is a dedicated atomic throughput fixture');
assert.ok(!upgradeScenario||samScenario,'--upgrade requires --sam');
try {
 await page.goto(origin);await page.getByRole('button',{name:/^(혼자 하기|Single Player|Singleplayer)$/i}).click();
 await page.evaluate(()=>{const m=document.querySelector('single-player-modal');m.bots=0;m.nations=0;m.randomSpawn=true;m.instantBuild=true;m.infiniteGold=false;m.startingGold=true;m.startingGoldValue=100;m.infiniteTroops=true;m.compactMap=true;});
 if(fastScenario)await page.evaluate(()=>{document.querySelector('single-player-modal').infiniteGold=true;});
 if(samScenario)await page.evaluate(()=>document.addEventListener('join-lobby',e=>{
  // Two humans in a local-only fixture. The second actor exists solely to
  // supply a real defending structure through the original game worker.
  const info=e.detail.gameStartInfo;info.players.push({...info.players[0],clientID:'SAMtest123',username:'SAM fixture'});
 },{capture:true,once:true}));
 await page.getByRole('button',{name:/^(게임 시작|Start Game)$/i}).click();
 await page.waitForFunction(()=>document.querySelector('build-menu')?.game?.myPlayer?.(),null,{timeout:60000});
 await page.addScriptTag({path:path.resolve(import.meta.dirname,'../openfront-x50-salvo.user.js')});
 await page.waitForFunction(()=>window.__x50);
 await page.waitForFunction(()=>{const g=__x50.getGameView();return !g.inSpawnPhase()&&!g.isSpawnImmunityActive()&&g.myPlayer().isAlive();},null,{timeout:60000});
 console.log('Live client: original rendered singleplayer loaded; spawn protection ended.');
 const built=await page.evaluate(async()=>{
  const g=__x50.getGameView(),me=g.myPlayer(),{BuildUnitIntentEvent}=await import('/src/client/Transport.ts');
  const owned=[];for(let t=0;t<g.width()*g.height();t++)if(g.owner(t)===me&&g.isLand(t))owned.push(t);
  if(!owned.length)throw Error('No owned land');
  for(const tile of owned) {
   const choices=await me.buildables(tile,['Missile Silo']);
   if(typeof choices[0]?.canBuild==='number') {
    __x50.getEventBus().emit(new BuildUnitIntentEvent('Missile Silo',tile));
    return {tile,choices,owned:owned.length};
   }
  }
  throw Error('No buildable silo position');
 });console.log('Live silo request:',built);
 await page.waitForFunction(()=>__x50.getGameView().units('Missile Silo').some(u=>!u.isUnderConstruction()),null,{timeout:15000});
 if(fastScenario) {
  await page.evaluate(async()=>{
    const g=__x50.getGameView(),silo=g.units('Missile Silo')[0];
    const {SendUpgradeStructureIntentEvent}=await import('/src/client/Transport.ts');
    for(const amount of [50,50,50,50,50,50,50,50,50,49])
      __x50.getEventBus().emit(new SendUpgradeStructureIntentEvent(silo.id(),'Missile Silo',amount));
    Object.assign(__x50.planner.settings,{minAtomHits:500,maxAtoms:500,maxHydros:0});
  });
  await page.waitForFunction(()=>{const u=__x50.getGameView().units('Missile Silo')[0];return u.level()===500&&u.missileTimerQueue().length===0;},null,{timeout:80000});
  console.log('Live client: native Lv500 silo fully reloaded, with host-only infinite gold for throughput fixture.');
 }
 if(samScenario) {
  await page.evaluate(async()=>{
   const g=__x50.getGameView(),enemy=g.players().find(p=>p.clientID()==='SAMtest123');
   if(!enemy)throw Error('Missing local fixture defender');
   let tile;
   for(let t=0;t<g.width()*g.height();t++)if(g.owner(t)===enemy&&g.isLand(t)) {
    const choices=await enemy.buildables(t,['SAM Launcher']);
    if(typeof choices[0]?.canBuild==='number'){tile=choices[0].canBuild;break;}
   }
   if(tile===undefined)throw Error('Missing buildable defender land');
   const send=g.worker.sendTurn.bind(g.worker);
   window.__localFixtureIntents=[{type:'build_unit',unit:'SAM Launcher',tile,clientID:enemy.clientID()}];
   g.worker.sendTurn=turn=>send({...turn,intents:[...turn.intents,...window.__localFixtureIntents.splice(0)]});
   const {SendUpgradeStructureIntentEvent}=await import('/src/client/Transport.ts');
   __x50.getEventBus().emit(new SendUpgradeStructureIntentEvent(g.units('Missile Silo')[0].id(),'Missile Silo',9));
  });
  await page.waitForFunction(()=>__x50.getGameView().units('SAM Launcher').some(u=>!u.isUnderConstruction())&&__x50.getGameView().units('Missile Silo')[0].level()===10,null,{timeout:15000});
  console.log('Live client: native worker built enemy SAM Lv1 and own silo Lv10.');
 }
 const target=await page.evaluate(samScenario=>{
  if(samScenario){const g=__x50.getGameView(),sam=g.units('SAM Launcher')[0];document.querySelector('build-menu').transformHandler.centerAll();return {tile:sam.tile(),x:g.x(sam.tile()),y:g.y(sam.tile())};}

  const g=__x50.getGameView(),silo=g.units('Missile Silo')[0],x=g.x(silo.tile()),y=g.y(silo.tile());
  for(let d=250;d<500;d+=20)for(let dx=-d;dx<=d;dx+=20)for(const dy of [-d,d]) {
   const tx=x+dx,ty=y+dy;if(!g.isValidCoord(tx,ty))continue;const tile=g.ref(tx,ty);
   if(g.isWater(tile)&&!g.isImpassable(tile)) {
    const tf=document.querySelector('build-menu').transformHandler;tf.centerAll();
    return {tile,x:tx,y:ty};
   }
  }
  throw Error('No nearby sea target');
 },samScenario);
 // Move the real mouse through the native transform; do not replace GameView,
 // prices, the event bus, worker, or the coordinate conversion with mocks.
 let pointed=false;
 for(let attempt=0;attempt<15;attempt++) {
  const screen=await page.evaluate(t=>document.querySelector('build-menu').transformHandler.worldToScreenCoordinates({x:t.x+.5,y:t.y+.5}),target);
  await page.mouse.move(screen.x,screen.y);await page.waitForTimeout(300);
  pointed=await page.evaluate(t=>{try{return __x50.planner.snapshot().tile===t&&__x50.planner.inspect().snapshot?.tile===t&&!!__x50.planner.result()?.chosen;}catch{return false;}},target.tile);
  if(pointed)break;
 }
 assert.ok(pointed,'Native camera/mouse must settle on the intended target');
 const snapshot=await page.evaluate(()=>{const s=__x50.planner.snapshot();return {tile:s.tile,prices:[String(s.atomCost),String(s.hydroCost)],silos:s.silos.length,sams:s.sams.length};});
 assert.equal(snapshot.tile,target.tile);assert.deepEqual(snapshot.prices,fastScenario?['0','0']:['750000','5000000']);assert.equal(snapshot.silos,1);
 assert.equal(snapshot.sams,samScenario?1:0);
 console.log('Live client: cursor snapshot + '+(fastScenario?'host-free':'paid')+' native worker buildables prices:',snapshot);
 if(fastScenario) {
  await page.evaluate(()=>{
    window.__fastSent=[];const bus=__x50.getEventBus(),emit=bus.emit.bind(bus);
    bus.emit=e=>{if(e.unit==='Atom Bomb')window.__fastSent.push({at:performance.now(),tick:__x50.getGameView().ticks(),amount:e.amount});emit(e);};
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>window.__fastSent.length===10,null,{timeout:30000});
  await page.waitForFunction(()=>__x50.getGameView().units('Atom Bomb').length===500,null,{timeout:10000});
  const sent=await page.evaluate(()=>window.__fastSent);
  assert.ok(sent.every(e=>e.amount===50));
  assert.deepEqual(sent.map(e=>e.tick-sent[0].tick),[0,1,2,3,4,5,6,7,8,9]);
  assert.ok(sent[9].at-sent[0].at<1000,'500 atoms requested within one second');
  await page.keyboard.press('Escape');
  console.log('PASS: real local I requested 500 atoms in '+Math.round(sent[9].at-sent[0].at)+'ms, ten consecutive game ticks; native worker created all 500 missiles. Arrival timing remains silo-queue dependent.');
  assert.deepEqual(errors,[]);
 } else {
 await page.evaluate(()=>{
  window.__liveEvidence={samFired:false};window.__liveSampler=setInterval(()=>{
   const g=__x50.getGameView();if(g.units('SAM Missile').length||g.units('SAM Launcher').some(u=>u.missileTimerQueue().length))window.__liveEvidence.samFired=true;
  },30);
 });
 await page.keyboard.press('KeyI');
 await page.waitForFunction(()=>__x50.getGameView().units('Hydrogen Bomb').length>0,null,{timeout:12000});
 console.log('Live client: I created a real hydrogen missile through native transport.');
 if(upgradeScenario) {
  await page.evaluate(()=>{const g=__x50.getGameView(),sam=g.units('SAM Launcher')[0];window.__localFixtureIntents.push({type:'upgrade_structure',unit:'SAM Launcher',unitId:sam.id(),amount:2,clientID:sam.owner().clientID()});});
  await page.waitForFunction(()=>__x50.getGameView().units('SAM Launcher').some(u=>u.level()===3));
  console.log('Live client: defender upgraded to Lv3 while hydrogen was in flight.');
 }
 if(artifact){fs.mkdirSync(artifact,{recursive:true});await page.screenshot({path:path.join(artifact,upgradeScenario?'live-client-upgrade-flight.png':samScenario?'live-client-sam-flight.png':'live-client-sea-flight.png')});}
 await page.waitForFunction(()=>{const s=__x50.planner.state();return !s.running&&s.report&&(s.report.hitHydros>=1||s.report.hitAtoms>=1);},null,{timeout:45000});
 const final=await page.evaluate(()=>__x50.planner.state());assert.equal(final.report.sentHydros,1);if(!upgradeScenario)assert.equal(final.report.hitHydros,1);else assert.ok(final.report.replans>0);if(!samScenario)assert.equal(final.report.replans,0);
 if(samScenario){assert.ok(final.report.sentAtoms>0);assert.equal(await page.evaluate(()=>__liveEvidence.samFired),true);}
 await page.evaluate(()=>clearInterval(window.__liveSampler));
 console.log('Live client: actual goal arrival confirmed.',JSON.stringify(final.report));
 assert.deepEqual(errors,[]);
 console.log('PASS: real local rendered client, native prices, '+(upgradeScenario?'in-flight SAM upgrade and revision':samScenario?'SAM defense and mixed salvo':'sea target')+', I launch, worker motion and detonation observation. No public multiplayer match was tested.');
 }
} catch(e) {
 console.error('Live state:',await page.evaluate(()=>({state:window.__x50?.planner.state(),body:document.body.innerText.slice(-4000)})).catch(()=>null));
 throw e;
} finally {await browser.close();}
