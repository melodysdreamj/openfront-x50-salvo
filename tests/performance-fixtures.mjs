import {trajectory,makePlan,ATOM,HYDRO} from '../src/planner.mjs';
export const variants=[{}, {reverse:true,moveFirst:true,spawnFirst:true,flightShift:1}, {hydroDelay:-2,delay:2,flightShift:-1}, {reverse:true,hydroDelay:2,delay:2}];
export function base(overrides={}) {
 return {tick:1000,me:1,target:{x:700,y:500},height:1000,width:1000,
 rules:{tickMs:100,samCooldown:90,siloCooldown:90,atomSpeed:10,hydroSpeed:10,samSpeed:12,targetRange:150,maxSamRange:150},
 silos:[],sams:[],inflight:[],gold:100_000_000_000n,atomCost:750_000n,hydroCost:5_000_000n,allowed:{atomic:true,mixed:true},...overrides};
}
export function scenario(seed) {
 let state=seed;const rng=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/2**32),n=max=>Math.floor(rng()*max);
 const s=base({height:500+n(1100),includeCommitted:seed%2===0});s.width=600+n(1500);s.target={x:n(s.width),y:n(s.height)};
 s.rules={...s.rules,atomSpeed:6+n(8),hydroSpeed:6+n(8),targetRange:100+n(100),samCooldown:40+n(90),siloCooldown:40+n(90)};
 for(let i=0;i<1+n(9);i++) {const level=1+n(80);s.silos.push({id:i+1,x:n(s.width),y:n(s.height),level,building:rng()<.1,queue:Array.from({length:n(level)},()=>s.tick-n(120)).sort((a,b)=>a-b)});}
 for(let i=0;i<5+n(35);i++) {const level=1+n(12),anchor=i%3?s.target:s.silos[0];s.sams.push({id:100+i,x:anchor.x+n(500)-250,y:anchor.y+n(500)-250,level,queue:Array.from({length:n(level)},()=>s.tick-n(120)).sort((a,b)=>a-b),upgrade:i%3?null:{startTick:995,startRange:70,targetLevel:level,duration:45}});}
 for(let i=0;i<3;i++) {const path=trajectory(s.silos[0],s.target,s.height,i%2===0,s.rules.hydroSpeed,s.rules.targetRange);s.inflight.push({id:800+i,type:i%2?ATOM:HYDRO,owner:i===2?2:1,committed:true,targeted:i===2&&seed%2===0,path,index:n(path.length),waitTicks:n(10),target:s.target});}
 if(seed%11===0)s.gold=0n;if(seed%13===0)s.atomCost=s.hydroCost=0n;
 const amount=n(110),p=makePlan(amount,seed%3===0?null:n(amount+1),n(15),seed%2===0);
 return {snapshot:s,plan:p};
}
export function stress(silos,sams,atoms,dense=false) {
 const snapshot=base({width:4000,height:4000,target:{x:3000,y:2000},
 silos:Array.from({length:silos},(_,i)=>({id:i+1,x:500+i%10*30,y:1800+Math.floor(i/10)*30,level:500,queue:[]})),
 sams:Array.from({length:sams},(_,i)=>({id:1000+i,x:dense?2980+i%5*10:2800+i%20*25,y:dense?1980+Math.floor(i/5)%5*10:1800+Math.floor(i/20)*20,level:5,queue:[]}))});
 return {snapshot,plan:makePlan(atoms,atoms)};
}
