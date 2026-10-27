import { base64ToSamples } from './codec.ts';

export class VoicePlayer {
  context: AudioContext;
  gain: GainNode;
  sources = new Set<AudioBufferSourceNode>();
  until = 0;
  onIdle: () => void;
  constructor(context: AudioContext, onIdle: () => void) {
    this.context = context; this.onIdle = onIdle;
    this.gain = context.createGain(); this.gain.gain.value = 0.85;
    this.gain.connect(context.destination);
  }
  append(encoded: string) {
    if (this.until - this.context.currentTime > 30) throw new Error('声音播放积压较多，请重新开始语音。');
    const samples = base64ToSamples(encoded);
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer; source.connect(this.gain);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect(); this.sources.delete(source);
      if (!this.sources.size) this.onIdle();
    };
    const start = Math.max(this.context.currentTime + 0.015, this.until);
    this.until = start + buffer.duration;
    source.start(start);
  }
  clear() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
    }
    this.sources.clear(); this.until = this.context.currentTime;
  }
  close() { this.clear(); this.gain.disconnect(); }
}
