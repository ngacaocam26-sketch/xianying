import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import WebSocket from 'ws';
import { attachVoiceServer } from '../server/voice.mjs';
import { Pcm16Encoder, pcmToBase64, base64ToSamples } from '../src/voice/codec.ts';
import { VoiceSession } from '../src/voice/session.ts';
import { VoicePlayer } from '../src/voice/player.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const pcm = Buffer.alloc(3200).toString('base64');
test('44.1/48 kHz capture retains a full second across 128-sample worklet boundaries', () => {
  for (const rate of [44100, 48000]) {
    const encoder = new Pcm16Encoder(rate), packets = [];
    const input = new Float32Array(rate).fill(0.5);
    for (let i = 0; i < input.length; i += 128) encoder.push(input.subarray(i, i + 128), bytes => packets.push(bytes));
    assert.equal(packets.length, 10);
    assert.equal(encoder.offset, 0);
    assert.ok(packets.every(bytes => bytes.byteLength === 3200));
    assert.ok(base64ToSamples(pcmToBase64(packets[0])).every(v => Math.abs(v - 0.5) <= 1 / 32768));
  }
});
test('PCM is little endian, clips invalid samples, and rejects malformed or odd byte audio', () => {
  const encoder = new Pcm16Encoder(16000), packets = [];
  encoder.push(new Float32Array(1600).map((_, i) => [2, -2, NaN, 0.5][i % 4]), b => packets.push(b));
  const view = new DataView(packets[0]);
  assert.deepEqual([0, 1, 2, 3].map(i => view.getInt16(i * 2, true)), [32767, -32768, 0, 16384]);
  for (const audio of ['', 'bad', 'AA==', '%%%%']) assert.throws(() => base64ToSamples(audio));
});

function audioContext() {
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  return {
    currentTime: 10, destination: {}, closed: false, audioWorklet: { async addModule() {} },
    async resume() {}, async close() { this.closed = true; },
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createMediaStreamSource: node,
    createBuffer: (_channels, length, rate) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ ...node(), onended: null, stop() { this.stopped = true; }, start(at) { this.startAt = at; } }),
  };
}
test('playback is ordered and interrupt stops/disconnects all queued audio without an idle callback', () => {
  const context = audioContext(); let idle = 0;
  const player = new VoicePlayer(context, () => idle++);
  player.append(pcm); player.append(pcm);
  const sources = [...player.sources];
  assert.ok(sources[1].startAt > sources[0].startAt);
  player.clear();
  assert.equal(player.sources.size, 0);
  assert.ok(sources.every(s => s.stopped && s.disconnected && s.onended === null));
  assert.equal(idle, 0);
});
function clientFixture(getMicrophone) {
  const context = audioContext(), events = [];
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const socket = { readyState: 1, bufferedAmount: 0, sent: [], send(s) { this.sent.push(JSON.parse(s)); }, close() { this.closed = true; } };
  const capture = { port: { onmessage: null }, connect() {}, disconnect() { this.disconnected = true; } };
  const session = new VoiceSession('/worklet', e => events.push(e), {
    createContext: () => context, checkStatus: async () => true, getMicrophone: getMicrophone || (async () => stream),
    createCapture: () => capture, createSocket: () => socket, socketUrl: 'ws://localhost/api/voice',
  });
  return { session, context, events, track, stream, socket, capture };
}
test('ending while microphone permission is pending stops a late stream and never opens a socket', async () => {
  let resolve;
  const f = clientFixture(() => new Promise(r => { resolve = r; }));
  const starting = f.session.start(); await tick();
  f.session.stop(); resolve(f.stream); await starting;
  assert.ok(f.track.stopped && f.context.closed);
  assert.equal(f.session.socket, null);
});
test('microphone denial returns a usable error and releases the audio context', async () => {
  const f = clientFixture(async () => { throw new DOMException('denied', 'NotAllowedError'); });
  await f.session.start();
  assert.match(f.events.at(-1).error, /麦克风权限/);
  assert.ok(f.context.closed && f.session.stopped);
});
test('button and speech interruption suppress stale audio/transcripts; a new turn still plays', async () => {
  const f = clientFixture(); await f.session.start();
  const receive = e => f.session.receive(JSON.stringify(e));
  receive({ type: 'ready' }); receive({ type: 'response_started', responseId: 'old' });
  receive({ type: 'audio', responseId: 'old', audio: pcm });
  const oldSources = [...f.session.player.sources];
  f.session.interrupt();
  receive({ type: 'audio', responseId: 'old', audio: pcm });
  receive({ type: 'assistant_text', responseId: 'old', text: 'must not appear' });
  assert.ok(oldSources.every(s => s.stopped));
  assert.equal(f.session.player.sources.size, 0);
  assert.equal(f.events.filter(e => e.type === 'assistant').length, 0);
  assert.ok(f.socket.sent.some(e => e.type === 'interrupt'));
  receive({ type: 'response_started', responseId: 'new' });
  receive({ type: 'audio', responseId: 'new', audio: pcm });
  assert.equal(f.session.player.sources.size, 1);
  receive({ type: 'speech_started', itemId: 'user2' });
  assert.equal(f.session.player.sources.size, 0);
  assert.equal(f.events.at(-1).type, 'user_started');
  f.session.stop(); assert.ok(f.track.stopped && f.context.closed && f.socket.closed && f.capture.disconnected);
  assert.equal(f.capture.port.onmessage, null);
});

class Upstream extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  terminate() { this.close(); }
  event(e) { this.emit('message', Buffer.from(JSON.stringify(e))); }
}
async function relayFixture(t, options = {}) {
  const upstream = new Upstream(); let credentials;
  const server = createServer();
  const relay = attachVoiceServer(server, {
    config: { apiKey: 'fictional-secret', baseUrl: 'https://workspace.example.invalid/v1', realtimeModel: 'test-realtime' },
    upstreamFactory: (url, settings) => { credentials = { url, settings }; return upstream; }, ...options,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { relay.close(); server.closeAllConnections(); server.close(resolve); }));
  const base = `127.0.0.1:${server.address().port}`;
  const socket = new WebSocket(`ws://${base}/api/voice`, { origin: `http://${base}` });
  const events = []; socket.on('message', raw => events.push(JSON.parse(raw)));
  await once(socket, 'open');
  return { upstream, socket, events, base, get credentials() { return credentials; },
    ready: async () => { upstream.event({ type: 'session.created' }); upstream.event({ type: 'session.updated' }); await tick(); } };
}
test('relay keeps key server-side and accepts only same-origin upgrades', async t => {
  const f = await relayFixture(t); await f.ready();
  assert.equal(f.credentials.settings.headers.Authorization, 'Bearer fictional-secret');
  assert.match(f.credentials.url, /^wss:\/\/workspace\.example\.invalid/);
  assert.equal(f.upstream.sent[0].session.audio.input.format.sample_rate, 16000);
  assert.equal(f.upstream.sent[0].session.audio.output.format.sample_rate, 24000);
  assert.ok(!JSON.stringify(f.events).includes('fictional-secret'));
  const bad = new WebSocket(`ws://${f.base}/api/voice`, { origin: 'https://foreign.invalid' });
  const error = await new Promise(resolve => bad.on('error', resolve));
  assert.match(error.message, /403/);
});
test('relay speech and button cancel block late output without cancelling the next response', async t => {
  const f = await relayFixture(t); await f.ready();
  f.socket.send(JSON.stringify({ type: 'audio', audio: pcm })); await tick();
  assert.equal(f.upstream.sent.at(-1).type, 'input_audio_buffer.append');
  f.upstream.event({ type: 'response.created', response: { id: 'old' } });
  f.upstream.event({ type: 'response.audio.delta', response_id: 'old', delta: pcm }); await tick();
  f.socket.send(JSON.stringify({ type: 'interrupt' })); await tick();
  assert.equal(f.upstream.sent.at(-1).type, 'response.cancel');
  const cancelId = f.upstream.sent.at(-1).event_id;
  f.upstream.event({ type: 'error', error: { event_id: cancelId, message: 'already cancelled' } });
  f.upstream.event({ type: 'response.audio.delta', response_id: 'old', delta: pcm });
  f.upstream.event({ type: 'response.created', response: { id: 'new' } });
  f.upstream.event({ type: 'response.audio.delta', response_id: 'old', delta: pcm });
  f.upstream.event({ type: 'response.done', response: { id: 'old' } });
  f.upstream.event({ type: 'response.audio.delta', response_id: 'new', delta: pcm });
  f.upstream.event({ type: 'input_audio_buffer.speech_started', item_id: 'second' });
  f.upstream.event({ type: 'response.audio.delta', response_id: 'new', delta: pcm }); await tick();
  assert.deepEqual(f.events.filter(e => e.type === 'audio').map(e => e.responseId), ['old', 'new']);
  assert.equal(f.events.filter(e => e.type === 'voice_error').length, 0);
  assert.equal(f.upstream.sent.filter(e => e.type === 'response.cancel').length, 2);
  f.socket.close(); await once(f.socket, 'close'); await tick(); assert.equal(f.upstream.readyState, 3);
});
test('malformed audio closes both sockets; upstream private errors are replaced by a safe message', async t => {
  const f = await relayFixture(t); await f.ready();
  f.upstream.event({ type: 'error', error: { message: 'private fictional-secret' } }); await once(f.socket, 'close');
  assert.ok(!JSON.stringify(f.events).includes('fictional-secret'));
  assert.equal(f.events.at(-1).type, 'voice_error');
  const g = await relayFixture(t); await g.ready();
  g.socket.send(JSON.stringify({ type: 'audio', audio: 'AA==' })); await once(g.socket, 'close');
  assert.equal(g.upstream.readyState, 3);
});
test('interrupt while waiting also cancels a response that is created later, then allows a fresh turn', async t => {
  const f = await relayFixture(t); await f.ready();
  f.upstream.event({ type: 'input_audio_buffer.speech_stopped' }); await tick();
  f.socket.send(JSON.stringify({ type: 'interrupt' })); await tick();
  f.upstream.event({ type: 'response.created', response: { id: 'pending-old' } });
  f.upstream.event({ type: 'response.audio.delta', response_id: 'pending-old', delta: pcm }); await tick();
  assert.equal(f.events.filter(e => e.type === 'audio' || e.type === 'response_started').length, 0);
  assert.equal(f.upstream.sent.at(-1).type, 'response.cancel');
  f.upstream.event({ type: 'input_audio_buffer.speech_started', item_id: 'fresh-user' });
  f.upstream.event({ type: 'input_audio_buffer.speech_stopped' });
  f.upstream.event({ type: 'response.created', response: { id: 'fresh' } });
  f.upstream.event({ type: 'response.audio.delta', response_id: 'fresh', delta: pcm }); await tick();
  assert.deepEqual(f.events.filter(e => e.type === 'audio').map(e => e.responseId), ['fresh']);
});
test('connection deadline releases the relay and reports a recoverable timeout', async t => {
  const f = await relayFixture(t, { connectTimeoutMs: 80 });
  await once(f.socket, 'close');
  assert.match(f.events.at(-1).message, /等待过久/);
  assert.equal(f.upstream.readyState, 3);
});
