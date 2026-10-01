import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const server=http.createServer((req,res)=>{const f=req.url==='/openfront-x50-salvo.user.js'?'openfront-x50-salvo.user.js':'tests/browser-harness.html';res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(path.join(root,f)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
async function load(){
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__x50);
 await page.evaluate(()=>{
  const f=fixture;f.setUnits([f.unit(7,'Port',100,500,1,f.me)]);f.game.isLand=()=>false;
  const original=f.me.buildables;f.me.buildables=(tile,types)=>types.includes('Warship')?Promise.resolve([{type:'Warship',cost:100n,canBuild:500100}]):original(tile,types);
  const emit=f.bm.eventBus.emit;let id=100;
  f.bm.eventBus.emit=e=>{
   if(e.unit!=='Warship')return emit(e);
   f.sent.push({at:Date.now(),...e});setTimeout(()=>{const u=f.unit(id++,'Warship',100,500,1,f.me);u.warshipState=()=>({patrolTile:e.tile});f.units().push(u);},180);
  };
 });
 await page.keyboard.press('KeyN');
}
try{
 await load();await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyN',repeat:true,bubbles:true})));
 for(let i=0;i<5;i++) {
  await page.evaluate(i=>fixture.bm.transformHandler.screenToWorldCoordinates=()=>({x:700+i,y:500}),i);
  await page.mouse.click(500,400);
 }
 await page.evaluate(()=>fixture.bm.transformHandler.screenToWorldCoordinates=()=>({x:999,y:700}));
 await page.keyboard.press('KeyI');assert.equal(await page.evaluate(()=>__x50.planner.state().running),false);
 await page.waitForFunction(()=>document.querySelector('#of-strike-hud')?.textContent.includes('군함을 순서대로 건조'));
 if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.locator('#of-strike-hud').screenshot({path:path.join(process.env.SCREENSHOT_DIR,'warships-queue.png')});}
 await page.waitForFunction(()=>__x50.warships.state().confirmed===50,null,{timeout:20000});
 const events=await page.evaluate(()=>fixture.sent);assert.equal(events.length,50);
 assert.deepEqual(events.map(e=>e.tile),Array.from({length:50},(_,i)=>500700+Math.floor(i/10)));
 assert.ok(events.every(e=>e.unit==='Warship'&&e.amount===1));
 for(const e of events)assert.ok(events.filter(x=>x.at<=e.at&&x.at>e.at-1000).length<=9);
 assert.equal(await page.evaluate(()=>fixture.units().filter(u=>u.type()==='Warship').length),50);
 console.log('Warship browser: held N + five rapid clicks queue 50 creations FIFO; cursor movement and I cannot redirect/interleave them.');
 await load();await page.mouse.click(500,400);await page.mouse.click(500,400);
 await page.waitForFunction(()=>fixture.sent.length>=1);await page.keyboard.press('Escape');const count=await page.evaluate(()=>fixture.sent.length);
 await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>fixture.sent.length),count);assert.equal(await page.evaluate(()=>__x50.warships.state().running),false);
 console.log('Warship browser: Esc clears every remaining batch.');
 await load();await page.evaluate(()=>fixture.me.buildables=()=>new Promise(r=>fixture.resolveWarship=r));await page.mouse.click(500,400);
 await page.waitForFunction(()=>!!fixture.resolveWarship);await page.keyboard.press('Escape');
 await page.evaluate(()=>fixture.resolveWarship([{type:'Warship',cost:0n,canBuild:500100}]));await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>fixture.sent.length),0);
 console.log('Warship browser: Esc while native-style preflight is pending cannot produce a late build.');
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
