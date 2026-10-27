import { Pcm16Encoder } from './codec';

declare const sampleRate: number;
declare const AudioWorkletProcessor: { new(): { port: MessagePort } };
declare function registerProcessor(name: string, processor: unknown): void;

class CaptureProcessor extends AudioWorkletProcessor {
  encoder = new Pcm16Encoder(sampleRate);
  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if (channel) this.encoder.push(channel, bytes => this.port.postMessage(bytes, [bytes]));
    return true;
  }
}
registerProcessor('xianying-capture', CaptureProcessor);
