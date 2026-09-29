import {readFileSync, writeFileSync} from 'node:fs';
import ts from 'typescript';
const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const write = (p,s) => writeFileSync(new URL('../'+p, import.meta.url),s);
const version=JSON.parse(read('package.json')).version;
const vendor = ['Line','SAMTargeting'].map(n => ts.transpileModule(read('src/vendor/'+n+'.ts'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).join('\n');
write('src/vendor/engine.mjs', vendor);
const engine = vendor.replaceAll('export class ', 'class ') + '\n' + ['src/planner.mjs','src/adaptive.mjs'].map(p=>read(p).replace(/^import .*;$/mg,'').replace(/^export /mg,'')).join('\n');
const worker = engine + `
self.onmessage = e => {
  const d=e.data;
  const failed=error=>self.postMessage({id:d.id,error:error.message});
  try {
    if(d.options?.continuous) {
      const steps=searchSteps(d.snapshot,{...d.options,budgetMs:Infinity});
      const advance=()=>{
        try {
          const until=performance.now()+50;let step;
          do {step=steps.next();if(step.done){self.postMessage({id:d.id,result:step.value});return;}}
          while(performance.now()<until);
          self.postMessage({id:d.id,progress:step.value});
          setTimeout(advance,0);
        }catch(error){failed(error);}
      };
      self.postMessage({id:d.id,progress:{tested:0}});advance();return;
    }
    const result=d.kind==="adapt"?adapt(d.snapshot,d.request,d.options):d.kind==="advice"?upgradeAdvice(d.snapshot,d.options):d.kind==="assess"?assess(d.snapshot,d.plan,{...d.options,deadline:performance.now()+(d.options.budgetMs??2500)}):search(d.snapshot,d.options);
    self.postMessage({id:d.id,result});
  }catch(error){failed(error);}
};`;

let base = read('src/legacy.js');
base = base.replace(/\/\/ @version[^\n]+/, '// @version      '+version);
base = base.replace(/\/\/ @license[^\n]+/, '// @license      AGPL-3.0-only');
base = base.replace(/\/\/ @description[^\n]+/, '// @description  사설·연습 로비 — 커서 공격 예측 / I: 추천 계획 실행 / Esc: 중단');
base = base.replace('  "use strict";', '  "use strict";\n'+engine+'\nconst PLANNER_WORKER_SOURCE = '+JSON.stringify(worker)+';\n');
base = base.replace('  function startStrike() {', '  function legacyStartStrike() {');
base = base.replace('  function hudTargetLine() {', '  function legacyHudTargetLine() {');
base = base.replace('      if (isTypingTarget(e.target)) return;', '      if (isTypingTarget(e.target)) return;\n      if (plannerKeyGuard(e)) return;');
base = base.replace('  // ── 디버그용 노출', read('src/prices.mjs').replace(/^export /mg,'')+'\n'+read('src/hud.mjs').replace(/^export /mg,'')+'\n'+read('src/hud.js')+'\n'+read('src/browser.js')+'\n  // ── 디버그용 노출');
base = base.replace('      CFG, setArmed,', '      planner: plannerDebug, CFG, setArmed,');
base = base.replace('"white-space:pre",', '"white-space:pre-wrap", "overflow-wrap:anywhere", "max-width:min(430px,calc(100vw - 32px))", "max-height:65vh", "overflow:hidden",');
base = base.replace('"font:600 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",', '"font:500 14px/1.55 -apple-system,BlinkMacSystemFont,Apple SD Gothic Neo,sans-serif",');
base = base.replace('"background:rgba(13,17,23,.78)"','"background:rgba(13,17,23,.96)"');
base = base.replace('      el.textContent = rate + "\\n" + hudTargetLine();','      plannerRenderHud(el, r);');
base = base.replace('(e) => { lastMouse =', '(e) => { if(hudEl?.contains(e.target))return; lastMouse =');
base = base.replace('const readyTimer = setInterval', 'const readyTimer = setInterval');
base = base.replace('✅ 사용 가능 (80%↑)', '요청 한도 여유 (공격 분석과 별개)');
write('openfront-x50-salvo.user.js', base);
write('openfront-x50-salvo-v'+version+'.user.js', base);
console.log('Built v'+version+' ('+base.length.toLocaleString()+' characters)');
