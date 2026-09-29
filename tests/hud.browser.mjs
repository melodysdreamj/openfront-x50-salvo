import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const server=http.createServer((req,res)=>{const file=req.url==='/openfront-x50-salvo.user.js'?'openfront-x50-salvo.user.js':'tests/browser-harness.html';res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(path.join(root,file)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const hud=page.locator('#of-strike-hud'),title=hud.locator('.of-title');
const screenshots=process.env.SCREENSHOT_DIR;if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
try {
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__x50?.planner.result()?.chosen);
 await page.waitForFunction(()=>document.querySelector('#of-strike-hud .of-title')?.textContent.includes('추천'));
 const original=await title.textContent(),rows=await hud.locator('.of-options').textContent();
 if(screenshots)await hud.screenshot({path:path.join(screenshots,'hud-ready.png')});
 await page.evaluate(()=>{
  const Native=Worker;window.Worker=class extends Native {postMessage(d,...args){setTimeout(()=>{try{super.postMessage(d,...args);}catch{}},1100);}};
  window.__titleChanges=[];new MutationObserver(()=>window.__titleChanges.push(document.querySelector('.of-title').textContent)).observe(document.querySelector('.of-title'),{childList:true,subtree:true,characterData:true});
  __x50.planner.analyze();
 });
 await page.waitForFunction(()=>document.querySelector('.of-refresh').textContent.includes('재계산 중'));
 assert.equal(await title.textContent(),original);assert.equal(await hud.locator('.of-options').textContent(),rows);
 assert.equal(await page.evaluate(()=>window.__titleChanges.length),0);
 if(screenshots)await hud.screenshot({path:path.join(screenshots,'hud-background-refresh.png')});
 console.log('HUD: background refresh preserves title, options and DOM text without a loading-screen flash.');
 // A different coordinate must be explicitly labelled, never misrepresented as
 // the completed recommendation for the current mouse position.
 await page.evaluate(()=>{fixture.bm.transformHandler.screenToWorldCoordinates=()=>({x:800,y:500});});
 await page.waitForFunction(()=>document.querySelector('.of-title').textContent.startsWith('이전 위치'));
 assert.ok((await hud.innerText()).includes('이전 분석 위치 (700, 500)'));
 await page.waitForFunction(()=>__x50.planner.inspect().snapshot?.tile===500800&&__x50.planner.result()?.chosen,null,{timeout:8000});
 await page.waitForFunction(()=>!document.querySelector('.of-title').textContent.startsWith('이전 위치'));
 assert.ok((await hud.innerText()).includes('목표 위치 (800, 500)'));
 console.log('HUD: cursor changes retain a clearly labelled previous result until the new result completes.');
 // Recreate the user's one-silo / 72-SAM screenshot using actual search.
 await page.evaluate(()=>{
  fixture.setUnits([fixture.unit(1,'Missile Silo',100,500,1,fixture.me),...Array.from({length:72},(_,i)=>fixture.unit(100+i,'SAM Launcher',790+i%3,495+Math.floor(i/3)%3,5,fixture.enemy))]);
  __x50.planner.settings.maxAtoms=10;__x50.planner.analyze();
 });
 await page.waitForFunction(()=>__x50.planner.result()?.sams.length===72&&!__x50.planner.state().pending,null,{timeout:10000});
 await page.waitForFunction(()=>document.querySelector('.of-title').textContent.includes('찾지 못'));
 const copy=await hud.innerText();assert.match(copy,/재장전 완료 1발분/);assert.match(copy,/지도 전체에서 SAM 72기/);assert.doesNotMatch(copy,/병목|준비 1관|요격 참여 —|공격 분석 중…/);
 if(screenshots){await page.screenshot({path:path.join(screenshots,'hud-desktop-blocked.png')});await hud.screenshot({path:path.join(screenshots,'hud-preview.png')});}
 await page.keyboard.press('F8');await page.waitForFunction(()=>!document.querySelector('.of-details').hidden);
 assert.match(await hud.locator('.of-details').innerText(),/목표 주변에 모두 있다는 뜻은 아닙니다/);
 await hud.locator('.of-details').evaluate(e=>e.scrollTop=180);await page.evaluate(()=>__x50.planner.analyze());
 await page.waitForFunction(()=>!__x50.planner.state().pending);await page.waitForTimeout(250);
 assert.equal(await hud.locator('.of-details').evaluate(e=>e.scrollTop),180);
 console.log('HUD: plain-language blocked reason, map-wide SAM count and stable detail scrolling.');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 const bounds=await hud.boundingBox();assert.ok(bounds.width<=374);assert.ok(bounds.height<=844-16);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(screenshots)await page.screenshot({path:path.join(screenshots,'hud-mobile-details.png')});
 await page.keyboard.press('F8');await page.setViewportSize({width:640,height:400});await page.waitForTimeout(300);
 assert.ok((await hud.boundingBox()).height<=384);assert.ok(await hud.evaluate(e=>e.scrollWidth<=e.clientWidth));
 if(screenshots)await page.screenshot({path:path.join(screenshots,'hud-zoom-200.png')});
 console.log('HUD: narrow and 200%-equivalent viewport remain bounded and scrollable.');
 await page.evaluate(()=>{fixture.units()[1].state={};});await page.keyboard.press('KeyI');
 await page.waitForFunction(()=>document.querySelector('.of-title').textContent==='지금은 분석할 수 없습니다');
 assert.equal(await hud.locator('.of-options').isVisible(),false);
 await page.keyboard.press('F8');await page.waitForFunction(()=>document.querySelector('.of-details').textContent.includes('오류 상세'));
 assert.match(await hud.locator('.of-details').innerText(),/업그레이드/);
 if(screenshots)await page.screenshot({path:path.join(screenshots,'hud-error.png')});
 assert.equal(await page.evaluate(()=>fixture.sent.length),0);
 console.log('HUD: a fresh read error overrides the prior recommendation and exposes diagnostics without firing.');
 assert.deepEqual(errors,[]);
}finally {await browser.close();await new Promise(r=>server.close(r));}
