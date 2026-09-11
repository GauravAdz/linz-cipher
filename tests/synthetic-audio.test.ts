import { describe, expect, it } from 'vitest';
import { SonicEvent, SonicMood } from '../src/data/types';
import { detectFrame, SymbolStateMachine } from '../src/audio/detector';
import { CARRIER_FREQUENCIES, PacketStreamDecoder, SYMBOL_MS, TONE_MS, encodePacket } from '../src/protocol/protocol';

const SAMPLE_RATE = 48000;

function tone(symbol: number, noise = 0, length = 1024, offset = 0) {
  let seed = 17 + offset;
  return { sampleRate: SAMPLE_RATE, samples: Float32Array.from({ length }, (_, i) => {
    seed = (seed * 16807) % 2147483647;
    return .42 * Math.sin(2 * Math.PI * CARRIER_FREQUENCIES[symbol] * (i + offset) / SAMPLE_RATE) + (((seed / 2147483647) * 2) - 1) * noise;
  }) };
}

function silence(length = 1024) {
  return { sampleRate: SAMPLE_RATE, samples: new Float32Array(length) };
}

describe('synthetic audio pipeline', () => {
  it.each([0, .03])('decodes a packet through PCM with noise %f', noise => {
    const expected = { version: 1, sonicId: 247, eventType: SonicEvent.NAME_CHANGED, mood: SonicMood.REFLECTIVE };
    const state = new SymbolStateMachine(); const decoder = new PacketStreamDecoder(); let decoded;
    for (const symbol of encodePacket(expected)) {
      const frame = tone(symbol, noise);
      for (let repeat = 0; repeat < 2; repeat++) {
        const output = state.push(detectFrame(frame.samples, frame.sampleRate).detectedSymbol);
        if (output !== null) decoded = decoder.push(output).packet ?? decoded;
      }
      state.push(null);
    }
    expect(decoded).toEqual(expected);
  });

  it('decodes with real 180 ms tones and 40 ms gaps using 1024-sample analysis windows', () => {
    const expected = { version: 1, sonicId: 247, eventType: SonicEvent.NAME_CHANGED, mood: SonicMood.REFLECTIVE };
    const state = new SymbolStateMachine();
    const decoder = new PacketStreamDecoder();
    let decoded;
    let offset = 0;
    const windowSize = 1024;
    const toneWindows = Math.floor((TONE_MS / 1000) * SAMPLE_RATE / windowSize);
    const gapWindows = Math.floor(((SYMBOL_MS - TONE_MS) / 1000) * SAMPLE_RATE / windowSize);

    expect(toneWindows).toBeGreaterThanOrEqual(2);
    expect(gapWindows).toBeGreaterThanOrEqual(1);

    for (const symbol of encodePacket(expected)) {
      for (let i = 0; i < toneWindows; i++) {
        const frame = tone(symbol, 0, windowSize, offset);
        offset += windowSize;
        const output = state.push(detectFrame(frame.samples, frame.sampleRate).detectedSymbol);
        if (output !== null) decoded = decoder.push(output).packet ?? decoded;
      }
      for (let i = 0; i < gapWindows; i++) {
        const frame = silence(windowSize);
        offset += windowSize;
        const output = state.push(detectFrame(frame.samples, frame.sampleRate).detectedSymbol);
        if (output !== null) decoded = decoder.push(output).packet ?? decoded;
      }
    }

    expect(decoded).toEqual(expected);
  });
});
