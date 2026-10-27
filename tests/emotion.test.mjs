import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DEFAULT_VISUAL, validateVisual } from '../src/visual.ts';
import { writeEmotionRest, activityLevel } from '../src/emotionShape.ts';
import { validateSnapshot, NEBULA_SEED } from '../src/artwork.ts';
import { VoiceSculptor } from '../src/voice/sculptor.ts';
import { createApiHandler } from '../server/api.mjs';

const base = new Float32Array([1, 1, .3, -1, 1, -.2, -1, -1, .2, 1, -1, -.3]);
const phases = new Float32Array(4);
const rest = visual => { const out = new Float32Array(base.length); writeEmotionRest(base, phases, visual, 0, out); return out; };
test('neutral structure reproduces legacy flow; opening, weight, folds and fragmentation change geometry independently', () => {
  const neutral = rest(DEFAULT_VISUAL);
  for (let i = 0; i < 4; i++) {
    const o = i * 3, x = base[o], y = base[o+1], z = base[o+2];
    assert.ok(Math.abs(neutral[o] - (x + Math.sin(y*1.6+z*1.1)*.07)) < 1e-6);
  }
  const opened = rest({...DEFAULT_VISUAL, openness:1}), closed = rest({...DEFAULT_VISUAL, openness:0});
  assert.ok(Math.abs(opened[0]) > Math.abs(closed[0]) + .5);
  const heavy = rest({...DEFAULT_VISUAL, weight:1}), light = rest({...DEFAULT_VISUAL, weight:0});
  assert.ok(heavy[1] < light[1]);
  for (const key of ['tension','coherence']) assert.notDeepEqual(rest({...DEFAULT_VISUAL,[key]:0}),rest({...DEFAULT_VISUAL,[key]:1}));
  for (const endpoint of [0,1]) {
    const v=Object.fromEntries(Object.keys(DEFAULT_VISUAL).map(key=>[key,endpoint]));
    assert.ok(rest(v).every(Number.isFinite));
  }
  assert.deepEqual(base,new Float32Array([1,1,.3,-1,1,-.2,-1,-1,.2,1,-1,-.3]));
});
test('activity is bounded and fades; partial new parameters cannot silently become a valid shape', () => {
  assert.equal(activityLevel({level:2,at:0},0),1);
  assert.ok(activityLevel({level:1,at:0},2000)<.004);
  assert.equal(validateVisual({dispersion:.5,motion:.5,warmth:.5,openness:.8}),null);
  assert.equal(validateVisual({dispersion:.5,motion:.5,warmth:.5},false),null);
});
test('v1 remains readable with unchanged three parameters; v2 retains all structural parameters', () => {
  const old={version:1,kind:'nebula',seed:NEBULA_SEED,phase:12,photo:null,visual:{dispersion:.3,motion:.4,warmth:.7}};
  assert.deepEqual(validateSnapshot(old),old);
  const newer={...old,version:2,visual:{...DEFAULT_VISUAL,openness:.8,tension:.2,coherence:.9,weight:.1}};
  assert.deepEqual(validateSnapshot(structuredClone(newer)),newer);
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('voice analysis discards interrupted, superseded, stopped and late transcription results', async () => {
  const pending=[], applied=[], statuses=[];
  const s=new VoiceSculptor(()=>DEFAULT_VISUAL,v=>applied.push(v),(m)=>statuses.push(m),(words,v,signal)=>{
    const d=deferred();pending.push({...d,words,signal});return d.promise;
  });
  s.begin('one');const one=s.complete('one','第一句虚构表达');
  s.begin('two');const two=s.complete('two','第二句虚构表达');
  assert.equal(pending[0].signal.aborted,true);
  pending[0].resolve({...DEFAULT_VISUAL,weight:1});await one;assert.equal(applied.length,0);
  pending[1].resolve({...DEFAULT_VISUAL,openness:.9});await two;assert.equal(applied.length,1);
  await s.complete('one','晚到的旧转写');assert.equal(pending.length,2);
  s.begin('three');const three=s.complete('three','第三句');s.cancel();pending[2].resolve(DEFAULT_VISUAL);await three;
  assert.equal(applied.length,1);
  s.begin('four');const four=s.complete('four','第四句');s.stop();pending[3].resolve(DEFAULT_VISUAL);await four;
  assert.equal(applied.length,1);
  assert.equal(s.words.length,0);
});
test('analysis failure keeps existing artwork and offers a retry without duplicating the utterance', async () => {
  let count=0;const states=[],applied=[];
  const s=new VoiceSculptor(()=>DEFAULT_VISUAL,v=>applied.push(v),(m,r)=>states.push(r),async words=>{
    assert.equal(words.length,1);if(++count===1)throw new Error('fictional failure');return DEFAULT_VISUAL;
  });
  s.begin('one');await s.complete('one','虚构输入');assert.equal(applied.length,0);assert.equal(states.at(-1),true);
  await s.complete('one','虚构输入');assert.equal(applied.length,1);assert.equal(s.words.length,1);s.stop();
});
test('sculpture API uses the shared model with only user speech and validates input', async t => {
  const config={apiKey:'fictional-key',baseUrl:'https://fictional.invalid/v1',model:'fictional-model'};
  let sent,calls=0;
  const server=createServer(createApiHandler({config,fetchImpl:async(url,options)=>{
    calls++;sent=JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({visual:DEFAULT_VISUAL})}}]}));
  }}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const url=`http://127.0.0.1:${server.address().port}/api/sculpture`;
  const post=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post({utterances:['测试：被理解后很开心'],visual:DEFAULT_VISUAL});
  assert.deepEqual(await response.json(),{visual:DEFAULT_VISUAL});
  assert.equal(sent.stream,false);assert.equal(sent.messages.length,2);assert.match(sent.messages[1].content,/被理解/);
  assert.equal(sent.response_format.json_schema.schema.properties.visual.required.length,8);
  for(const utterances of [[],['x'.repeat(2001)],['x','x','x','x','x','x'],[{}]]) assert.equal((await post({utterances})).status,400);
  assert.equal(calls,1);
});
test('sculpture failure never returns incomplete parameters or private provider bodies, and disconnect aborts analysis', async t => {
  const config={apiKey:'fictional-secret',baseUrl:'https://fictional.invalid/v1',model:'test'};
  let mode='invalid', aborted=false; const started=deferred();
  const server=createServer(createApiHandler({config,fetchImpl:async(url,options)=>{
    if(mode==='private')return new Response('fictional-secret private input',{status:403});
    if(mode==='wait')return new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('cancelled','AbortError'));},{once:true});started.resolve();
    });
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({visual:{dispersion:.5,motion:.5,warmth:.5}})}}]}));
  }}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const url=`http://127.0.0.1:${server.address().port}/api/sculpture`;
  const post=signal=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({utterances:['虚构测试']}),signal});
  assert.equal((await post()).status,502);
  mode='private';const failure=await post();assert.equal(failure.status,503);assert.ok(!(await failure.text()).includes('fictional-secret'));
  mode='wait';const controller=new AbortController();const response=post(controller.signal).catch(()=>null);
  await started.promise;controller.abort();await response;await new Promise(r=>setTimeout(r,25));assert.equal(aborted,true);
});
