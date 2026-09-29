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
  });
};
try{
  await load();await page.keyboard.press('KeyX');
  // Holding X must not toggle the armed mode back off.
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyX',repeat:true,bubbles:true})));
  await page.mouse.click(500,400);await page.mouse.click(500,400);
  await page.waitForFunction(()=>fixture.sent.length===10);await page.waitForTimeout(500);
  const sent=await page.evaluate(()=>fixture.sent);
  assert.equal(sent.length,10);assert.ok(sent.every(e=>e.amount===50&&e.unitType==='City'));
  assert.equal(await page.evaluate(()=>fixture.units()[0].level()),501);
  assert.equal(await page.evaluate(()=>__x50.RL.minWindow.length),10);
  console.log('Upgrade browser: held X and duplicate clicks produce exactly ten requests / +500.');
  await load();await page.keyboard.press('KeyX');await page.mouse.click(500,400);
  await page.waitForFunction(()=>fixture.sent.length===6);await page.keyboard.press('Escape');
  await page.waitForTimeout(1300);await page.mouse.click(500,400);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>fixture.sent.length),6);
  console.log('Upgrade browser: Esc cancels the remaining four requests.');
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
