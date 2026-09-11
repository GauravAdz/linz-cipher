import { describe, expect, it } from 'vitest';
import { SonicEvent, SonicMood } from '../src/data/types';
import { detectFrame, SymbolStateMachine } from '../src/audio/detector';
import { CARRIER_FREQUENCIES, PacketStreamDecoder, encodePacket } from '../src/protocol/protocol';

function tone(symbol: number, noise = 0) {
  const sampleRate = 48000, length = 4096;
  let seed = 17;
  return { sampleRate, samples: Float32Array.from({ length }, (_, i) => {
    seed = (seed * 16807) % 2147483647;
    return .42 * Math.sin(2 * Math.PI * CARRIER_FREQUENCIES[symbol] * i / sampleRate) + (((seed / 2147483647) * 2) - 1) * noise;
  }) };
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
});
