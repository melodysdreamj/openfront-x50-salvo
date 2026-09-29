import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const server=http.createServer((req,res)=>{const name=req.url==='/openfront-x50-salvo.user.js'?'openfront-x50-salvo.user.js':'tests/browser-harness.html';res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(path.join(root,name)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const url='http://127.0.0.1:'+server.address().port;
const load=async()=>{await page.goto(url);await page.waitForFunction(()=>window.__x50?.planner.result()?.chosen,{timeout:15000});};
try {
  await load();
  assert.equal(await page.evaluate(()=>__x50.planner.result().mode),'mixed');
  await page.keyboard.press('F8');
  await page.waitForFunction(()=>document.body.textContent.includes('사일로 배치'));
  const screenshots=process.env.SCREENSHOT_DIR;
  if(screenshots){fs.mkdirSync(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,'planner-desktop.png')});}
  await page.keyboard.press('F8');
  await page.keyboard.press('KeyI');
  await page.evaluate(()=>{fixture.bm.transformHandler.screenToWorldCoordinates=()=>({x:800,y:500});});
  await page.waitForFunction(()=>fixture.sent.length>0,{timeout:10000});
  await page.waitForFunction(()=>!__x50.planner.state().running&&!__x50.planner.state().pending,{timeout:10000});
  const sent=await page.evaluate(()=>fixture.sent);
  assert.ok(sent.some(e=>e.unit==='Hydrogen Bomb'));assert.ok(sent.every(e=>e.tile===500700));
  assert.ok(sent.every(e=>e.amount<=50));
  console.log('Browser: I executes the frozen target and verified mixed plan.');
  await load();
  await page.keyboard.press('KeyI');await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(()=>fixture.sent.length),0);
  console.log('Browser: Esc cancels the pending worker without firing.');
  await load();
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.sent.length>0);
  await page.keyboard.press('Escape');
  const beforeCancel=await page.evaluate(()=>fixture.sent.length);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>fixture.sent.length),beforeCancel);
  assert.equal(await page.evaluate(()=>__x50.planner.state().running),false);
  console.log('Browser: Esc stops unsent actions during execution.');
  await load();
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.sent.length>0);
  await page.evaluate(()=>{fixture.units()[1].level=()=>999;});
  await page.waitForFunction(()=>!__x50.planner.state().running);
  assert.equal(await page.evaluate(()=>fixture.sent.filter(e=>e.unit==='Hydrogen Bomb').length),0);
  await page.waitForFunction(()=>__x50.planner.state().advice&&!__x50.planner.state().pending);
  assert.ok(await page.evaluate(()=>__x50.planner.state().report.replans>0));
  console.log('Browser: impossible SAM upgrade stops remaining hydrogen and supplies next-attack advice.');
  await load();
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.units().some(u=>u.type()==='Hydrogen Bomb'));
  assert.equal(await page.evaluate(()=>__x50.planner.state().running),true);
  await page.evaluate(()=>{
    fixture.units()[1].level=()=>3;
    fixture.units().push(fixture.unit(3,'Missile Silo',550,500,50,fixture.me));
  });
  await page.waitForFunction(()=>__x50.planner.state().history?.some(h=>h.decision==='rescue'),{timeout:5000});
  await page.waitForFunction(()=>fixture.sent.filter(e=>e.unit==='Atom Bomb').length>1);
  assert.equal(await page.evaluate(()=>fixture.sent.filter(e=>e.unit==='Hydrogen Bomb').reduce((n,e)=>n+e.amount,0)),1);
  if(screenshots)await page.screenshot({path:path.join(screenshots,'adaptive-rescue.png')});
  await page.waitForFunction(()=>!__x50.planner.state().running,{timeout:10000});
  assert.match(await page.evaluate(()=>__x50.planner.state().lastExecution),/도달 확인/);
  console.log('Browser: in-flight upgrade adds atom support, preserves one-hydro cap and observes arrival.');
  await load();
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.units().some(u=>u.type()==='Hydrogen Bomb'));
  await page.evaluate(()=>{
    const h=fixture.units().find(u=>u.type()==='Hydrogen Bomb');
    const interceptor=fixture.unit(900,'SAM Missile',695,500,1,fixture.enemy);
    interceptor.state={targetUnitId:h.id()};fixture.units().push(interceptor);
  });
  await page.waitForFunction(()=>__x50.planner.state().history?.some(h=>h.decision==='atomic'),{timeout:5000});
  assert.equal(await page.evaluate(()=>fixture.sent.filter(e=>e.unit==='Hydrogen Bomb').length),1);
  await page.keyboard.press('Escape');
  console.log('Browser: assigned hydro interceptor triggers atomic fallback without a second hydro.');
  await load();
  await page.evaluate(()=>fixture.units().push(fixture.unit(3,'SAM Launcher',0,0,1,fixture.enemy)));
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.units().some(u=>u.type()==='Hydrogen Bomb'));
  await page.evaluate(()=>{fixture.units().find(u=>u.id()===3).level=()=>999;});
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>__x50.planner.state().replans),0);
  await page.keyboard.press('Escape');
  console.log('Browser: distant irrelevant SAM upgrade does not interrupt the volley.');
  await load();
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.units().some(u=>u.type()==='Hydrogen Bomb'));
  await page.evaluate(()=>{fixture.units().find(u=>u.type()==='Hydrogen Bomb').nukeState=()=>({trajectory:[]});});
  await page.waitForFunction(()=>!__x50.planner.state().running);
  assert.match(await page.evaluate(()=>__x50.planner.state().lastExecution),/궤적/);
  console.log('Browser: unavailable committed flight timing stops further fire.');
  await load();
  await page.evaluate(()=>{
    const Native=window.Worker;
    window.Worker=class extends Native {
      postMessage(d,...rest){if(d.kind==='adapt'){fixture.adaptRequested=true;setTimeout(()=>{try{super.postMessage(d,...rest);}catch{}},500);}else super.postMessage(d,...rest);}
    };
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.units().some(u=>u.type()==='Hydrogen Bomb'));
  await page.evaluate(()=>{fixture.units()[1].level=()=>3;});
  await page.waitForFunction(()=>fixture.adaptRequested);
  await page.keyboard.press('Escape');
  const adaptiveCancel=await page.evaluate(()=>fixture.sent.length);
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>fixture.sent.length),adaptiveCancel);
  assert.equal(await page.evaluate(()=>__x50.planner.state().running),false);
  console.log('Browser: Esc during adaptation ignores the late worker response.');
  await load();
  await page.evaluate(()=>{
    __x50.planner.settings.maxReplans=2;
    const Native=window.Worker;
    window.Worker=class extends Native {
      postMessage(d,...rest){if(d.kind==='adapt'){setTimeout(()=>{try{super.postMessage(d,...rest);}catch{}},400);}else super.postMessage(d,...rest);}
    };
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.units().some(u=>u.type()==='Hydrogen Bomb'));
  const beforeChurn=await page.evaluate(()=>{
    let level=2;fixture.units()[1].level=()=>level;
    fixture.churn=setInterval(()=>level++,80);return fixture.sent.length;
  });
  await page.waitForFunction(()=>!__x50.planner.state().running,{timeout:6000});
  await page.evaluate(()=>clearInterval(fixture.churn));
  assert.equal(await page.evaluate(()=>fixture.sent.length),beforeChurn);
  assert.match(await page.evaluate(()=>__x50.planner.state().lastExecution),/재계산 한도/);
  console.log('Browser: repeated upgrades invalidate stale results and stop at the revision limit.');

  await load();
  await page.evaluate(()=>{fixture.setGold(0);__x50.planner.stop();});
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>__x50.planner.result()?.reason.includes('골드'));
  assert.equal(await page.evaluate(()=>fixture.sent.length),0);
  console.log('Browser: insufficient gold does not fire.');
  await load();
  await page.evaluate(()=>fixture.units()[1].state={});
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>__x50.planner.state().error.includes('업그레이드'));
  assert.equal(await page.evaluate(()=>fixture.sent.length),0);
  console.log('Browser: incompatible SAM state fails closed.');
  await load();
  await page.evaluate(()=>{fixture.me.buildables=async()=>{throw Error('price worker unavailable');};});
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>__x50.planner.state().error.includes('price worker unavailable'));
  assert.equal(await page.evaluate(()=>fixture.sent.length),0);
  console.log('Browser: failed official price query blocks I without guessed costs.');
  await load();
  await page.evaluate(()=>{fixture.me.buildables=()=>new Promise(resolve=>{fixture.resolvePrices=resolve;});});
  await page.keyboard.press('KeyI');await page.waitForFunction(()=>!!fixture.resolvePrices);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>fixture.resolvePrices([{type:'Atom Bomb',cost:750000n},{type:'Hydrogen Bomb',cost:5000000n}]));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>fixture.sent.length),0);
  assert.equal(await page.evaluate(()=>__x50.planner.state().running),false);
  console.log('Browser: Esc during price lookup blocks the late execution callback.');
  await load();
  await page.evaluate(()=>{
    __x50.planner.stop();
    const Native=window.Worker;
    window.Worker=class extends Native {
      postMessage(d,...rest){
        if(d.options?.continuous){fixture.continuous=true;setTimeout(()=>{try{super.postMessage(d,...rest);}catch{}},7000);}
        else super.postMessage(d,...rest);
      }
    };
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.continuous);
  await page.waitForTimeout(6300);
  assert.equal(await page.evaluate(()=>__x50.planner.state().pending),true);
  assert.equal(await page.evaluate(()=>__x50.planner.state().error),'');
  assert.equal(await page.evaluate(()=>fixture.sent.length),0);
  assert.match(await page.locator('.of-refresh').textContent(),/계속 계산 중/);
  await page.waitForFunction(()=>fixture.sent.length>0,{timeout:10000});
  await page.keyboard.press('Escape');
  console.log('Browser: I survives the former 4-second budget and 6-second watchdog; HUD stays responsive.');

  await load();
  await page.evaluate(()=>{
    const Native=window.Worker;
    window.Worker=class extends Native {
      postMessage(d,...rest){
        if(d.kind==='assess'){fixture.assessStarted=fixture.game.ticks();setTimeout(()=>{try{super.postMessage(d,...rest);}catch{}},800);}
        else super.postMessage(d,...rest);
      }
    };
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.sent.length>0,{timeout:10000});
  assert.ok(await page.evaluate(()=>fixture.sent[0].tick-fixture.assessStarted>2));
  await page.keyboard.press('Escape');
  console.log('Browser: an unchanged state passes a validation longer than 200ms without stale rejection.');

  await load();
  await page.evaluate(()=>{
    fixture.checkedLevels=[];const Native=window.Worker;
    window.Worker=class extends Native {
      postMessage(d,...rest){
        if(d.kind==='assess'){
          fixture.checkedLevels.push(d.snapshot.sams[0].level);
          if(fixture.checkedLevels.length===1){fixture.units()[1].level=()=>3;setTimeout(()=>{try{super.postMessage(d,...rest);}catch{}},400);return;}
        }
        super.postMessage(d,...rest);
      }
    };
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.sent.length>0,{timeout:10000});
  const checked=await page.evaluate(()=>fixture.checkedLevels);
  assert.equal(checked[0],1);assert.equal(checked.at(-1),3);assert.ok(checked.length>=2);
  assert.equal(await page.evaluate(()=>__x50.planner.state().error),'');
  await page.keyboard.press('Escape');
  console.log('Browser: SAM upgrade during validation triggers fresh validation/search and fires without a second I.');

  await load();
  await page.evaluate(()=>{
    const Native=window.Worker;
    window.Worker=class extends Native {
      postMessage(d,...rest){
        if(d.kind==='assess'){
          fixture.retryAssess=(fixture.retryAssess??0)+1;
          if(fixture.retryAssess===1)fixture.units()[1].level=()=>3;
          setTimeout(()=>{try{super.postMessage(d,...rest);}catch{}},300);return;
        }
        super.postMessage(d,...rest);
      }
    };
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.retryAssess>=2);
  await page.keyboard.press('Escape');await page.waitForTimeout(700);
  assert.equal(await page.evaluate(()=>fixture.sent.length),0);
  console.log('Browser: Esc during automatic prelaunch revalidation prevents late firing.');

  await load();
  await page.evaluate(()=>{
    fixture.adaptiveBudgets=[];const Native=window.Worker;
    window.Worker=class extends Native {
      postMessage(d,...rest){
        if(d.kind==='adapt'){
          fixture.adaptiveBudgets.push(d.options.budgetMs);
          if(fixture.adaptiveBudgets.length===1){
            setTimeout(()=>this.onmessage?.({data:{id:d.id,result:{chosen:null,limited:true,reason:'injected deadline'}}}),100);return;
          }
        }
        super.postMessage(d,...rest);
      }
    };
  });
  await page.keyboard.press('KeyI');
  await page.waitForFunction(()=>fixture.units().some(u=>u.type()==='Hydrogen Bomb'));
  await page.evaluate(()=>{
    fixture.units()[1].level=()=>3;
    fixture.units().push(fixture.unit(3,'Missile Silo',550,500,50,fixture.me));
  });
  await page.waitForFunction(()=>__x50.planner.state().history?.some(h=>h.decision==='rescue'),{timeout:10000});
  const budgets=await page.evaluate(()=>fixture.adaptiveBudgets);
  assert.equal(budgets[0],350);assert.equal(budgets[1],700);
  assert.equal(await page.evaluate(()=>fixture.sent.filter(e=>e.unit==='Hydrogen Bomb').reduce((n,e)=>n+e.amount,0)),1);
  await page.keyboard.press('Escape');
  console.log('Browser: adaptive deadline expands the next budget and rescues without resetting the hydro cap.');

  await load();
  await page.setViewportSize({width:390,height:844});await page.keyboard.press('F8');
  await page.waitForTimeout(250);
  const sizes=await page.evaluate(()=>{const panel=[...document.querySelectorAll('div')].find(e=>e.id==='of-strike-hud');return {width:panel.getBoundingClientRect().width,page:innerWidth,overflow:document.documentElement.scrollWidth};});
  assert.ok(sizes.width<=sizes.page-16);assert.ok(sizes.overflow<=sizes.page);
  if(screenshots)await page.screenshot({path:path.join(screenshots,'planner-mobile.png')});
  console.log('Browser: narrow-screen HUD has no horizontal overflow.');
  assert.deepEqual(errors,[]);
} finally {await browser.close();await new Promise(r=>server.close(r));}
