import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const server=http.createServer((req,res)=>{const name=req.url==='/openfront-x50-salvo.user.js'?'openfront-x50-salvo.user.js':'tests/browser-harness.html';res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(path.join(root,name)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const load=async()=>{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__x50);
  await page.evaluate(()=>{
    fixture.setUnits([fixture.unit(7,'City',100,500,1,fixture.me)]);
    fixture.bm.transformHandler.screenToWorldCoordinates=()=>({x:100,y:500});__x50.CFG.amount=1;
    const native=fixture.me.buildables;
    fixture.me.buildables=async(tile,types)=>types.includes('City')?[{type:'City',canUpgrade:fixture.units().find(u=>u.tile()===tile)?.id()??false}]:native(tile,types);
  });
};
try{
  await load();await page.keyboard.press('KeyX');
  // Holding X must not toggle the armed mode back off.
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyX',repeat:true,bubbles:true})));
  await page.mouse.click(500,400);await page.mouse.click(500,400);
  await page.waitForFunction(()=>fixture.sent.length===20);await page.waitForTimeout(500);
  const sent=await page.evaluate(()=>fixture.sent);
  assert.equal(sent.length,20);assert.ok(sent.every(e=>e.amount===50&&e.unitType==='City'));
  assert.equal(await page.evaluate(()=>fixture.units()[0].level()),1001);
  assert.equal(await page.evaluate(()=>__x50.RL.minWindow.length),20);
  console.log('Upgrade browser: held X ignores key repeat; two real clicks apply +1000 through twenty requests in FIFO order.');
  await load();await page.keyboard.press('KeyX');await page.mouse.click(500,400);
  await page.waitForFunction(()=>fixture.sent.length===6);await page.keyboard.press('Escape');
  await page.waitForTimeout(1300);await page.mouse.click(500,400);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>fixture.sent.length),6);
  console.log('Upgrade browser: Esc cancels the remaining four requests.');
  await load();
  await page.evaluate(()=>{
    fixture.units().push(fixture.unit(8,'City',300,500,1,fixture.me));
    const native=fixture.me.buildables;
    fixture.me.buildables=async(tile,types)=>{if(types.includes('City'))await new Promise(r=>setTimeout(r,400));return native(tile,types);};
  });
  await page.keyboard.press('KeyV');await page.mouse.click(500,400);
  await page.keyboard.press('KeyX');
  await page.evaluate(()=>{fixture.bm.transformHandler.screenToWorldCoordinates=()=>({x:300,y:500});});
  await page.mouse.click(500,400);
  await page.keyboard.press('KeyV');
  await page.evaluate(()=>{fixture.bm.transformHandler.screenToWorldCoordinates=()=>({x:100,y:500});});
  await page.mouse.click(500,400);
  await page.evaluate(()=>{fixture.bm.transformHandler.screenToWorldCoordinates=()=>({x:700,y:500});});
  await page.waitForFunction(()=>!__x50.upgrades.state().running,null,{timeout:15000});
  assert.deepEqual(await page.evaluate(()=>fixture.sent.map(e=>e.unitId)),[7,...Array(10).fill(8),7]);
  assert.deepEqual(await page.evaluate(()=>fixture.units().map(u=>u.level())),[101,501]);
  console.log('Upgrade browser: mixed V/X rapid clicks preserve structure and quantity during delayed lookup and cursor movement.');

  await load();
  await page.evaluate(()=>{fixture.me.buildables=async()=>{await new Promise(r=>setTimeout(r,600));return [{canUpgrade:7,type:'City'}];};});
  await page.keyboard.press('KeyX');await page.mouse.click(500,400);await page.mouse.click(500,400);
  await page.keyboard.press('Escape');await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>fixture.sent.length),0);
  assert.equal(await page.evaluate(()=>__x50.upgrades.state().batches),0);
  console.log('Upgrade browser: Esc cancels every queued click while target lookup is pending.');
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
