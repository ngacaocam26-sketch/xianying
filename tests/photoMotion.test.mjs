import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelsToParticles } from '../src/photoToParticles.ts';
import { createPhotoMotion, updatePhotoDisplacement } from '../src/photoInteraction.ts';
const w=160,h=100;
const photo=pixelsToParticles({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(255)},1.6);
const fresh=()=>({d:new Float32Array(photo.positions.length),m:createPhotoMotion(photo,new Float32Array(photo.positions.length))});
const norm=a=>{let n=0;for(let i=0;i<a.length;i+=3)n=Math.max(n,Math.hypot(a[i],a[i+1],a[i+2]));return n;};
const brush=(a,b)=>({previousX:a,previousY:0,x:b,y:0,radius:.7});
const step=(s,dt,strokes=[])=>updatePhotoDisplacement(photo,s.d,s.m,dt,0,strokes);
function sweep(s,seconds,direction=1,fps=60){const n=Math.round(seconds*fps);for(let i=0;i<n;i++)step(s,1/fps,[brush(direction*(-1.6+3.2*i/n),direction*(-1.6+3.2*(i+1)/n))]);}
function counts(displacement){const bins=new Map();for(let i=0;i<w*h;i++){const x=photo.positions[i*3]+displacement[i*3],y=photo.positions[i*3+1]+displacement[i*3+1];const key=Math.floor(x/.09)+','+Math.floor(y/.09);bins.set(key,(bins.get(key)||0)+1);}return [...bins.values()].sort((a,b)=>a-b);}

test('stationary input never creates a hole, source appearance data is immutable',()=>{
 const s=fresh(),saved=structuredClone(photo);
 for(let i=0;i<120;i++)step(s,1/60,[brush(0,0)]);
 assert.equal(norm(s.d),0);assert.equal(norm(s.m.velocity),0);assert.deepEqual(photo,saved);
});
test('stroke changes velocity first; stopping retains forward inertia before smooth recovery',()=>{
 const s=fresh();step(s,0,[brush(-.3,.3)]);assert.equal(norm(s.d),0);assert.ok(norm(s.m.velocity)>.1);
 step(s,.05);const first=norm(s.d);step(s,.05);assert.ok(norm(s.d)>first);
 let peak=0;for(let i=0;i<60;i++){step(s,1/60);peak=Math.max(peak,norm(s.d));}
 for(let i=0;i<360;i++)step(s,1/60);
 assert.ok(norm(s.d)<peak*.08);assert.ok(norm(s.d)>0);
 for(let i=0;i<1200;i++)step(s,1/60);
 assert.equal(norm(s.d),0);assert.equal(norm(s.m.velocity),0);
});
test('fast, slow and reverse motion stays sparse, bounded and avoids compressed bright ridges',()=>{
 const baseline=counts(new Float32Array(photo.positions.length));
 const records=[];
 for(const [name,duration,reverse] of [['fast',.4,false],['slow',4,false],['reverse',1.3,true]]){
  const s=fresh();sweep(s,duration);if(reverse)sweep(s,duration,-1);
  let peak=norm(s.d);for(let i=0;i<30;i++){step(s,1/60);peak=Math.max(peak,norm(s.d));}
  const density=counts(s.d),p99=density[Math.floor(density.length*.99)],base99=baseline[Math.floor(baseline.length*.99)];
  assert.ok(peak>.02&&peak<1.5);assert.ok(p99/base99<1.65);assert.ok(Math.max(...density)/Math.max(...baseline)<2.1);
  const significant=s.d.filter((_,i)=>i%3===0).reduce((n,_,i)=>n+(Math.hypot(s.d[i*3],s.d[i*3+1])>.08?1:0),0);
  assert.ok(significant/(w*h)<.25);assert.ok(s.d.every(Number.isFinite));
  records.push({name,peak,p99DensityRatio:p99/base99,maxDensityRatio:Math.max(...density)/Math.max(...baseline),significantFraction:significant/(w*h)});
 }
 console.log(JSON.stringify({distribution:records}));
});
test('free motion and recovery are consistent at 30, 60 and 144 fps',()=>{
 const initial=fresh();step(initial,0,[brush(-.3,.3)]);const results=[];
 for(const fps of [30,60,144]){const s=fresh();s.m.velocity.set(initial.m.velocity);for(let i=0;i<fps*3;i++)step(s,1/fps);results.push(s.d);}
 for(const result of results.slice(1)){
  for(let i=0;i<results[0].length;i++)assert.ok(Math.abs(results[0][i]-result[i])<.00002);
 }
});
test('repeated reversals, slow frames and distant input never corrupt data',()=>{
 const s=fresh();const original=new Float32Array(photo.positions);
 step(s,1/60,[{...brush(30,40),previousY:30,y:30}]);assert.equal(norm(s.d),0);
 let maxJump=0;
 for(let i=0;i<600;i++){const old=new Float32Array(s.d);step(s,i%45===0?5:1/60,[brush(Math.sin(i*.2),Math.sin((i+1)*.2))]);for(let j=0;j<old.length;j++)maxJump=Math.max(maxJump,Math.abs(s.d[j]-old[j]));}
 assert.ok(norm(s.d)<1.5);assert.ok(maxJump<.13);assert.ok(s.d.every(Number.isFinite));assert.deepEqual(photo.positions,original);
 console.log(JSON.stringify({reversalMaxStep:maxJump,maxOffset:norm(s.d)}));
});
