import WebSocket, { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { VOICE_INSTRUCTIONS } from './prompt.mjs';

export function buildVoiceSession(config) {
  return {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'], instructions: VOICE_INSTRUCTIONS,
      turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 700 },
      input_audio_transcription: { model: 'qwen3-asr-flash-realtime' },
      audio: {
        input: { format: { type: 'pcm', sample_rate: 16000, sample_format: 's16le', channels: 1, packing: 'interleaved', channel_layout: 'mono' } },
        output: { voice: config.realtimeVoice || 'Tina', format: { type: 'pcm', sample_rate: 24000 } },
      },
    },
  };
}

export function attachVoiceServer(server, {
  config, upstreamFactory = (url, options) => new WebSocket(url, options),
  maxDurationMs = 5 * 60 * 1000, connectTimeoutMs = 15000,
} = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 12000, perMessageDeflate: false });
  const cleanups = new Set();
  const onUpgrade = (req, socket, head) => {
    if (req.url !== '/api/voice') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    try {
      const origin = new URL(req.headers.origin || '');
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw new Error();
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  };
  server.on('upgrade', onUpgrade);
  wss.on('connection', (client) => {
    const send = payload => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload)); };
    if (!config.apiKey || cleanups.size >= (config.limits?.voice ?? 2)) {
      send({ type: 'voice_error', message: config.apiKey ? '当前语音连接较多，请稍后重试。' : '请先配置本机 API Key 并重启项目。' });
      client.close(); return;
    }
    let upstream;
    let closed = false, ready = false, activeResponse = null, waitingForResponse = false, cancelPending = false;
    const blocked = new Set();
    const cancelEvents = new Set();
    let credit = 96000, lastCredit = Date.now(), messageTimes = [];
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(connectTimer); clearTimeout(durationTimer); clearInterval(heartbeat);
      cleanups.delete(close);
      if (upstream?.readyState === WebSocket.CONNECTING) upstream.terminate();
      else if (upstream?.readyState === WebSocket.OPEN) upstream.close();
      if (client.readyState === WebSocket.OPEN) client.close();
    };
    const fail = message => { send({ type: 'voice_error', message }); close(); };
    const connectTimer = setTimeout(() => fail('语音连接等待过久，请重新开始。'), connectTimeoutMs);
    const durationTimer = setTimeout(() => { send({ type: 'ended', message: '本次语音已到 5 分钟，可以重新开始。' }); close(); }, maxDurationMs);
    let alive = true;
    const heartbeat = setInterval(() => { if (!alive) { close(); client.terminate(); } else { alive = false; client.ping(); } }, 15000);
    client.on('pong', () => { alive = true; });
    cleanups.add(close);
    const sendUp = payload => { if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(payload)); };
    const interrupt = () => {
      if (waitingForResponse) cancelPending = true;
      if (activeResponse) {
        blocked.add(activeResponse);
        if (blocked.size > 64) blocked.delete(blocked.values().next().value);
        const eventId = randomUUID();
        cancelEvents.add(eventId);
        if (cancelEvents.size > 64) cancelEvents.delete(cancelEvents.values().next().value);
        sendUp({ type: 'response.cancel', event_id: eventId });
        activeResponse = null;
      }
      send({ type: 'interrupted' });
    };
    client.on('close', close);
    client.on('error', close);
    client.on('message', (raw, binary) => {
      if (closed) return;
      try {
        if (binary) throw new Error();
        const event = JSON.parse(raw.toString());
        const now = Date.now();
        messageTimes = messageTimes.filter(time => now - time < 1000);
        messageTimes.push(now);
        if (messageTimes.length > 50) throw new Error();
        if (event.type === 'end') { close(); return; }
        if (event.type === 'interrupt') { interrupt(); return; }
        if (event.type !== 'audio' || !ready || typeof event.audio !== 'string' ||
            event.audio.length > 9000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.audio)) throw new Error();
        const bytes = Buffer.from(event.audio, 'base64');
        credit = Math.min(96000, credit + (now - lastCredit) * 48); lastCredit = now;
        if (bytes.length < 2 || bytes.length > 6400 || bytes.length % 2 || event.audio.length % 4 || credit < bytes.length) throw new Error();
        credit -= bytes.length;
        if (upstream.bufferedAmount > 1024 * 1024) { fail('语音上传网络较慢，请重新开始。'); return; }
        sendUp({ type: 'input_audio_buffer.append', audio: event.audio });
      } catch { fail('语音数据暂时无法处理，请重新开始。'); }
    });
    try {
      const host = new URL(config.baseUrl).host;
      const model = config.realtimeModel || 'qwen3.8-omni-flash-realtime';
      upstream = upstreamFactory(`wss://${host}/api-ws/v1/realtime?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` }, maxPayload: 2 * 1024 * 1024,
        handshakeTimeout: connectTimeoutMs, perMessageDeflate: false,
      });
      upstream.on('unexpected-response', (_req, response) => {
        response.resume();
        fail(response.statusCode === 401 ? '语音密钥验证失败，请检查本机配置。' :
          response.statusCode === 403 ? '实时语音暂不可用，请检查该模型的权限、额度和账户状态。' :
            '实时语音未能连接，请检查模型配置或稍后重试。');
      });
      upstream.on('error', () => { if (!closed) fail('实时语音连接失败，请稍后重新开始。'); });
      upstream.on('close', () => { if (!closed) fail('实时语音连接已断开，可以重新开始。'); });
      upstream.on('message', (raw) => {
        if (closed) return;
        try {
          const event = JSON.parse(raw.toString());
          if (event.type === 'session.created') { sendUp(buildVoiceSession(config)); return; }
          if (event.type === 'session.updated') {
            ready = true; clearTimeout(connectTimer);
            send({ type: 'ready', inputRate: 16000, outputRate: 24000 }); return;
          }
          if (event.type === 'error') {
            if (cancelEvents.delete(event.error?.event_id)) return;
            fail('实时语音服务未能处理请求，请检查模型权限、额度或稍后重试。'); return;
          }
          if (event.type === 'input_audio_buffer.speech_started') {
            waitingForResponse = false; cancelPending = false;
            interrupt(); send({ type: 'speech_started', itemId: event.item_id }); return;
          }
          if (event.type === 'input_audio_buffer.speech_stopped') { waitingForResponse = true; send({ type: 'speech_stopped' }); return; }
          if (event.type === 'response.created') {
            waitingForResponse = false;
            activeResponse = event.response.id;
            if (cancelPending) { cancelPending = false; interrupt(); return; }
            send({ type: 'response_started', responseId: activeResponse }); return;
          }
          if (event.response_id && blocked.has(event.response_id)) return;
          if (event.type === 'response.audio.delta') {
            if (!activeResponse || event.response_id !== activeResponse) return;
            if (client.bufferedAmount > 1024 * 1024) { fail('声音播放的网络较慢，请重新开始。'); return; }
            send({ type: 'audio', audio: event.delta, responseId: activeResponse });
          } else if (event.type === 'response.audio_transcript.delta') {
            if (activeResponse && event.response_id === activeResponse) send({ type: 'assistant_text', text: event.delta, responseId: activeResponse });
          } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
            send({ type: 'user_text', text: String(event.transcript || '').slice(0, 2000), itemId: event.item_id });
          } else if (event.type === 'response.done') {
            const id = event.response?.id;
            if (id && blocked.has(id)) return;
            if (id !== activeResponse) return;
            activeResponse = null;
            send({ type: 'response_done', responseId: id, status: event.response?.status });
          }
        } catch { fail('实时语音返回了无法处理的数据，请重新开始。'); }
      });
    } catch { fail('实时语音配置不正确，请检查后重启项目。'); }
  });
  return { close() { server.off('upgrade', onUpgrade); for (const cleanup of [...cleanups]) cleanup(); for (const ws of wss.clients) ws.terminate(); wss.close(); } };
}
