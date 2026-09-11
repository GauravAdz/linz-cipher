import { describe, expect, it } from 'vitest';
import { detectSlp2Frame } from '../src/audio/slp2-detector';
import { CARRIER_BANK_4_6KHZ, CARRIER_BANK_2_4KHZ } from '../src/audio/carrier-bank';

function generateSine(sampleRate: number, frequency: number, durationSamples: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(durationSamples);
  for (let i = 0; i < durationSamples; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

function generateBroadbandNoise(durationSamples: number, amplitude = 0.1): Float32Array {
  const samples = new Float32Array(durationSamples);
  let seed = 42;
  for (let i = 0; i < durationSamples; i++) {
    seed = (seed * 16807) % 2147483647;
    samples[i] = (((seed / 2147483647) * 2) - 1) * amplitude;
  }
  return samples;
}

describe('SLP/2 narrowband spectral detector', () => {
  const sampleRate = 48000;
  const fftSize = 1024;

  it('detects each pure carrier in the default 4-6 kHz bank', () => {
    const bank = CARRIER_BANK_4_6KHZ;
    for (let symbol = 0; symbol < 4; symbol++) {
      const freq = bank.frequencies[symbol];
      const samples = generateSine(sampleRate, freq, fftSize, 0.4);
      const frame = detectSlp2Frame(samples, sampleRate, 0, { carrierBank: bank });

      expect(frame.detectedSymbol).toBe(symbol);
      expect(frame.strongestSymbol).toBe(symbol);
      expect(frame.confidence).toBeGreaterThan(3.0);
      expect(frame.narrowbandScores[symbol]).toBeGreaterThan(10.0);
    }
  });

  it('rejects broadband noise without false-triggering symbol lock', () => {
    const noise = generateBroadbandNoise(fftSize, 0.2);
    const frame = detectSlp2Frame(noise, sampleRate, 0);

    // Because surrounding energy matches center energy in broadband noise,
    // narrowband scores remain close to 1.0 and confidence stays low
    expect(frame.detectedSymbol).toBeNull();
    expect(frame.confidence).toBeLessThan(2.0);
  });

  it('detects carrier tone submerged in broadband background noise', () => {
    const bank = CARRIER_BANK_4_6KHZ;
    const targetSymbol = 2; // 5000 Hz
    const carrier = generateSine(sampleRate, bank.frequencies[targetSymbol], fftSize, 0.3);
    const noise = generateBroadbandNoise(fftSize, 0.15);

    const mixed = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      mixed[i] = carrier[i] + noise[i];
    }

    const frame = detectSlp2Frame(mixed, sampleRate, 0, { carrierBank: bank });
    expect(frame.strongestSymbol).toBe(targetSymbol);
    expect(frame.detectedSymbol).toBe(targetSymbol);
    expect(frame.narrowbandScores[targetSymbol]).toBeGreaterThan(frame.narrowbandScores[0]);
  });

  it('operates correctly across different carrier banks', () => {
    const bank = CARRIER_BANK_2_4KHZ;
    for (let symbol = 0; symbol < 4; symbol++) {
      const freq = bank.frequencies[symbol];
      const samples = generateSine(sampleRate, freq, fftSize, 0.4);
      const frame = detectSlp2Frame(samples, sampleRate, 0, { carrierBank: bank });

      expect(frame.detectedSymbol).toBe(symbol);
      expect(frame.carrierBank.id).toBe(bank.id);
    }
  });
});
