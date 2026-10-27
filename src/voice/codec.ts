// Weighted averaging keeps packet boundaries continuous at 44.1/48 kHz input.
export class Pcm16Encoder {
  ratio: number;
  remaining: number;
  sum = 0;
  packet = new Int16Array(1600);
  offset = 0;
  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < 8000 || inputRate > 192000) throw new Error('Unsupported sample rate');
    this.ratio = inputRate / 16000;
    this.remaining = this.ratio;
  }
  push(input: Float32Array, emit: (packet: ArrayBuffer) => void) {
    for (const raw of input) {
      const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      let weight = 1;
      while (weight > 1e-9) {
        const taken = Math.min(weight, this.remaining);
        this.sum += sample * taken;
        this.remaining -= taken; weight -= taken;
        if (this.remaining < 1e-9) {
          const value = this.sum / this.ratio;
          this.packet[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
          this.remaining = this.ratio; this.sum = 0;
          if (this.offset === this.packet.length) {
            const bytes = new ArrayBuffer(this.packet.length * 2);
            const view = new DataView(bytes);
            for (let i = 0; i < this.packet.length; i++) view.setInt16(i * 2, this.packet[i], true);
            emit(bytes); this.offset = 0;
          }
        }
      }
    }
  }
}

export function pcmToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToSamples(encoded: string): Float32Array {
  if (encoded.length > 1400000 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid audio');
  const binary = atob(encoded);
  if (!binary.length || binary.length % 2) throw new Error('Invalid PCM');
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const unsigned = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
    samples[i] = (unsigned >= 32768 ? unsigned - 65536 : unsigned) / 32768;
  }
  return samples;
}
