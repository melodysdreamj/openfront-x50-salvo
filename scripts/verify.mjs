// One release gate; every stage must pass. The upstream checkout is explicit so
// a missing real-engine/client stage cannot silently become a mocked-only pass.
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const project=path.resolve(import.meta.dirname,'..');
const upstream=path.resolve(process.argv[2]??'../OpenFrontIO');
const pinned='5dc09dbd2dde5105d8b403d7b5ddf8d503e04ec2';
const actual=execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(actual!==pinned)throw Error('Reference checkout differs from the audited engine. Expected '+pinned+', got '+actual);
const tests=fs.readdirSync(path.join(project,'tests')).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'tests/'+n);
const stages=[
 ['build',['scripts/build.mjs']],
 ['unit and regression',['--test',...tests]],
 ['original client/config boundaries',['scripts/verify-client.mjs',upstream]],
 ['original engine executions',['scripts/verify-upstream.mjs',upstream]],
 ['browser attack flow',['tests/browser.integration.mjs']],
 ['browser upgrade flow',['tests/upgrade.browser.mjs']],
 ['stable HUD and readable states',['tests/hud.browser.mjs']],
 ['warship queue and cancellation',['tests/warships.browser.mjs']],
];
for(const [name,args] of stages){
 console.log('\nVerification: '+name);
 const result=spawnSync(process.execPath,args,{cwd:project,stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
console.log('\nPASS: all eight verification stages. This is not online-server end-to-end certification.');
