import { AUDIO_CONFIG, type AnalysisWindow } from './config';
import { DEFAULT_SLP2_CARRIER_BANK, type CarrierBank } from './carrier-bank';
import type { CarrierSymbol, DetectionFrame } from './detector';

export interface Slp2DetectionFrame extends DetectionFrame {
  carrierEnergies: [number, number, number, number];
  surroundingEnergies: [number, number, number, number];
  narrowbandScores: [number, number, number, number];
  carrierBank: CarrierBank;
}

export interface Slp2DetectorOptions {
  carrierBank?: CarrierBank;
  window?: AnalysisWindow;
  epsilon?: number;
  minRms?: number;
  minConfidence?: number;
  minNarrowbandScore?: number;
}

const HANN_CACHE = new Map<number, Float32Array>();

function getHannWindow(length: number): Float32Array {
  let table = HANN_CACHE.get(length);
  if (!table) {
    table = new Float32Array(length);
    const denom = Math.max(length - 1, 1);
    for (let i = 0; i < length; i++) {
      table[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    }
    HANN_CACHE.set(length, table);
  }
  return table;
}

export function goertzel(
  samples: Float32Array,
  sampleRate: number,
  frequency: number,
  window: AnalysisWindow = 'hann',
): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let s0 = 0, s1 = 0, s2 = 0;
  if (window === 'hann') {
    const table = getHannWindow(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index] * table[index];
      s0 = sample + coefficient * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
  } else {
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      s0 = sample + coefficient * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2) / (samples.length * samples.length);
}

/**
 * Detects carrier presence using Goertzel filters with narrowband contrast scoring.
 * For each carrier frequency f_i:
 *   surrounding = (E(f_i - Δ) + E(f_i + Δ)) / 2
 *   narrowbandScore = E(f_i) / (surrounding + ε)
 *
 * This rejects broadband music or noise where surrounding energy matches the carrier band,
 * while detecting narrow carrier tones even when submerged in music.
 */
export function detectSlp2Frame(
  samples: Float32Array,
  sampleRate: number,
  timestampMs = 0,
  options: Slp2DetectorOptions = {},
): Slp2DetectionFrame {
  const bank = options.carrierBank ?? DEFAULT_SLP2_CARRIER_BANK;
  const window = options.window ?? 'hann';
  const epsilon = options.epsilon ?? 1e-8;
  const minRms = options.minRms ?? AUDIO_CONFIG.detectorMinRms;
  const minConfidence = options.minConfidence ?? AUDIO_CONFIG.detectorMinConfidence;
  const minNarrowbandScore = options.minNarrowbandScore ?? 6.0;

  const carrierEnergies: [number, number, number, number] = [0, 0, 0, 0];
  const surroundingEnergies: [number, number, number, number] = [0, 0, 0, 0];
  const narrowbandScores: [number, number, number, number] = [0, 0, 0, 0];

  for (let i = 0; i < 4; i++) {
    const f = bank.frequencies[i];
    const delta = bank.deltaHz;

    const eCenter = goertzel(samples, sampleRate, f, window);
    const eLower = goertzel(samples, sampleRate, f - delta, window);
    const eUpper = goertzel(samples, sampleRate, f + delta, window);

    const eSurrounding = (eLower + eUpper) / 2;
    const score = eCenter / (eSurrounding + epsilon);

    carrierEnergies[i] = eCenter;
    surroundingEnergies[i] = eSurrounding;
    narrowbandScores[i] = score;
  }

  // Calculate overall RMS and peak
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);

  // Rank by narrowband score (how distinctly the tone rises above its local background)
  const ranked = narrowbandScores
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);

  const strongestSymbol = ranked[0].index as CarrierSymbol;
  const isNarrowbandPeak = ranked[0].value >= minNarrowbandScore;
  const confidence = isNarrowbandPeak ? ranked[0].value / Math.max(ranked[1].value, 1e-9) : 1.0;
  const detectedSymbol =
    rms > minRms && confidence > minConfidence && isNarrowbandPeak ? strongestSymbol : null;

  return {
    timestampMs,
    detectedSymbol,
    strongestSymbol,
    energies: narrowbandScores, // energies exposed as narrowband contrast scores
    carrierEnergies,
    surroundingEnergies,
    narrowbandScores,
    confidence,
    rms,
    peak,
    carrierBank: bank,
  };
}
