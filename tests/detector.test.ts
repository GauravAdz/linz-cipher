import { describe, expect, it } from 'vitest';
import { detectFrame } from '../src/audio/detector';
import { CARRIER_FREQUENCIES } from '../src/protocol/protocol';

describe('Goertzel carrier detector', () => {
  it.each([0, 1, 2, 3])('detects carrier %i', symbol => {
    const sampleRate = 48000, length = 4096;
    const samples = Float32Array.from({ length }, (_, i) => .5 * Math.sin(2 * Math.PI * CARRIER_FREQUENCIES[symbol] * i / sampleRate));
    expect(detectFrame(samples, sampleRate).detectedSymbol).toBe(symbol);
  });
});
