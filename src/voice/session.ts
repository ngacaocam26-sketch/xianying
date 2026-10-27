import { pcmToBase64 } from './codec.ts';
import { VoicePlayer } from './player.ts';

export type VoiceState = 'requesting' | 'connecting' | 'listening' | 'user-speaking' | 'replying';
export type VoiceEvent =
  | { type: 'level'; level: number }
  | { type: 'state'; state: VoiceState }
  | { type: 'user_started'; itemId: string }
  | { type: 'user'; text: string; itemId: string }
  | { type: 'assistant'; text: string; responseId: string }
  | { type: 'interrupted' }
  | { type: 'ended'; message?: string; error?: string };

type Dependencies = {
  createContext?: () => AudioContext;
  getMicrophone?: () => Promise<MediaStream>;
  createCapture?: (context: AudioContext) => AudioWorkletNode;
  createSocket?: (url: string) => WebSocket;
  checkStatus?: (signal: AbortSignal) => Promise<boolean>;
  socketUrl?: string;
};

function microphoneError(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') return '麦克风权限未允许，请在浏览器地址栏允许麦克风后重试。';
  if (name === 'NotFoundError') return '没有找到可用的麦克风，请连接设备后重试。';
  if (name === 'NotReadableError') return '麦克风可能被其他程序占用，请检查后重试。';
  return error instanceof Error ? error.message : '语音暂时无法开始，请重试。';
}

export class VoiceSession {
  stopped = false;
  ready = false;
  socket: WebSocket | null = null;
  context: AudioContext | null = null;
  stream: MediaStream | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  capture: AudioWorkletNode | null = null;
  silent: GainNode | null = null;
  player: VoicePlayer | null = null;
  abort = new AbortController();
  responseId: string | null = null;
  responseText = '';
  blocked = new Set<string>();
  generating = false;
  workletUrl: string;
  onEvent: (event: VoiceEvent) => void;
  deps: Dependencies;
  watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(workletUrl: string, onEvent: (event: VoiceEvent) => void, deps: Dependencies = {}) {
    this.workletUrl = workletUrl; this.onEvent = onEvent; this.deps = deps;
  }
  emit(event: VoiceEvent) { if (!this.stopped) this.onEvent(event); }
  state(state: VoiceState) { this.emit({ type: 'state', state }); }
  send(event: object) { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(event)); }

  async start() {
    this.state('requesting');
    try {
      this.context = this.deps.createContext?.() ?? new AudioContext();
      await this.context.resume();
      if (this.stopped) return;
      const configured = await (this.deps.checkStatus?.(this.abort.signal) ??
        fetch('/api/status', { signal: this.abort.signal }).then(r => r.ok ? r.json() : Promise.reject(new Error('语音服务尚未启动，请重启项目。'))).then(s => Boolean(s.configured)));
      if (this.stopped) return;
      if (!configured) throw new Error('请先配置本机 API Key 并重启项目。');
      const getMicrophone = this.deps.getMicrophone ?? (() => {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法使用麦克风，请使用本机地址或 HTTPS 页面。');
        return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      });
      const stream = await getMicrophone();
      if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (!this.stopped) this.finish('麦克风连接已结束，请检查设备后重新开始。', true); });
      await this.context.audioWorklet.addModule(this.workletUrl);
      if (this.stopped) return;
      this.source = this.context.createMediaStreamSource(stream);
      this.capture = this.deps.createCapture?.(this.context) ?? new AudioWorkletNode(this.context, 'xianying-capture');
      this.silent = this.context.createGain(); this.silent.gain.value = 0;
      this.source.connect(this.capture); this.capture.connect(this.silent); this.silent.connect(this.context.destination);
      this.player = new VoicePlayer(this.context, () => {
        if (!this.generating && !this.stopped) this.state('listening');
      });
      this.capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
        if (this.stopped) return;
        const view = new DataView(data); let energy = 0;
        for (let i = 0; i + 1 < view.byteLength; i += 2) energy += (view.getInt16(i, true) / 32768) ** 2;
        this.emit({ type: 'level', level: Math.min(1, Math.sqrt(energy / Math.max(1, view.byteLength / 2)) * 7) });
        if (!this.ready || this.stopped || this.socket?.readyState !== 1) return;
        if (this.socket.bufferedAmount > 512 * 1024) { this.finish('语音上传较慢，请检查网络后重新开始。', true); return; }
        this.send({ type: 'audio', audio: pcmToBase64(data) });
      };
      this.state('connecting');
      const url = this.deps.socketUrl ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice`;
      this.socket = this.deps.createSocket?.(url) ?? new WebSocket(url);
      this.watchdog = setTimeout(() => this.finish('语音连接等待过久，请重新开始。', true), 20000);
      this.socket.onmessage = ({ data }: MessageEvent<string>) => this.receive(data);
      this.socket.onerror = () => this.finish('语音网络连接失败，请重新开始。', true);
      this.socket.onclose = () => { if (!this.stopped) this.finish('语音连接已断开，可以重新开始。', true); };
    } catch (error) {
      if (!this.stopped) this.finish(microphoneError(error), true);
    }
  }

  receive(data: string) {
    if (this.stopped) return;
    try {
      const event = JSON.parse(data);
      if (event.type === 'ready') {
        clearTimeout(this.watchdog); this.ready = true; this.state('listening');
      } else if (event.type === 'voice_error') this.finish(String(event.message).slice(0, 300), true);
      else if (event.type === 'ended') this.finish(String(event.message || '语音已结束。'));
      else if (event.type === 'speech_started') {
        this.clearReply(); this.state('user-speaking');
        this.emit({ type: 'user_started', itemId: String(event.itemId || '') });
      } else if (event.type === 'interrupted') {
        this.clearReply(); this.state('listening');
      } else if (event.type === 'speech_stopped') this.state('replying');
      else if (event.type === 'user_text') this.emit({ type: 'user', text: String(event.text || ''), itemId: String(event.itemId || '') });
      else if (event.type === 'response_started') {
        this.responseId = event.responseId; this.responseText = ''; this.generating = true;
      } else if (event.type === 'audio' || event.type === 'assistant_text') {
        if (!event.responseId || this.blocked.has(event.responseId) || event.responseId !== this.responseId) return;
        if (event.type === 'audio') { this.player?.append(event.audio); this.state('replying'); }
        else {
          this.responseText = (this.responseText + String(event.text || '')).slice(0, 4000);
          this.emit({ type: 'assistant', text: this.responseText, responseId: event.responseId });
        }
      } else if (event.type === 'response_done') {
        if (event.responseId && this.blocked.has(event.responseId)) return;
        if (event.responseId !== this.responseId) return;
        if (event.status === 'failed' || event.status === 'incomplete') { this.finish('这次语音回复未能完成，请重新开始。', true); return; }
        this.generating = false;
        if (!this.player?.sources.size) this.state('listening');
      }
    } catch { this.finish('语音数据暂时无法播放，请重新开始。', true); }
  }

  clearReply() {
    const wasReplying = this.generating || Boolean(this.player?.sources.size);
    if (this.responseId) {
      this.blocked.add(this.responseId);
      if (this.blocked.size > 64) this.blocked.delete(this.blocked.values().next().value!);
    }
    this.responseId = null; this.generating = false;
    this.player?.clear(); if (wasReplying) this.emit({ type: 'interrupted' });
  }
  interrupt() { this.clearReply(); this.send({ type: 'interrupt' }); this.state('listening'); }
  finish(message: string, error = false) {
    if (this.stopped) return;
    this.onEvent({ type: 'ended', ...(error ? { error: message } : { message }) });
    this.stop();
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.ready = false;
    clearTimeout(this.watchdog); this.abort.abort();
    this.player?.close(); this.player = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    if (this.capture) this.capture.port.onmessage = null;
    this.source?.disconnect(); this.capture?.disconnect(); this.silent?.disconnect();
    this.source = null; this.capture = null; this.silent = null;
    if (this.socket) {
      this.send({ type: 'end' });
      this.socket.onmessage = null; this.socket.onerror = null; this.socket.onclose = null;
      this.socket.close(); this.socket = null;
    }
    void this.context?.close().catch(() => {}); this.context = null;
  }
}
