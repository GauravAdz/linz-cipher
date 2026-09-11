import { CARRIER_FREQUENCIES } from '../protocol/protocol';
import { AUDIO_CONFIG, type AnalysisWindow } from './config';

export type CarrierSymbol = 0 | 1 | 2 | 3;

export interface DetectionFrame {
  timestampMs: number;
  detectedSymbol: CarrierSymbol | null;
  strongestSymbol: CarrierSymbol;
  energies: [number, number, number, number];
  confidence: number;
  rms: number;
}

function windowMultiplier(index: number, length: number, window: AnalysisWindow) {
  return window === 'hann' ? 0.5 * (1 - Math.cos((2 * Math.PI * index) / (length - 1))) : 1;
}

function goertzel(samples: Float32Array, sampleRate: number, frequency: number, window: AnalysisWindow) {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] * windowMultiplier(index, samples.length, window);
    s0 = sample + coefficient * s1 - s2; s2 = s1; s1 = s0;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2) / (samples.length * samples.length);
}

export function detectFrame(
  samples: Float32Array,
  sampleRate: number,
  timestampMs = 0,
  window: AnalysisWindow = AUDIO_CONFIG.analysisWindow,
): DetectionFrame {
  const energies = CARRIER_FREQUENCIES.map(f => goertzel(samples, sampleRate, f, window)) as [number, number, number, number];
  const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  const ranked = energies.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const confidence = ranked[0].value / Math.max(ranked[1].value, 1e-9);
  const strongestSymbol = ranked[0].index as CarrierSymbol;
  const detectedSymbol = rms > AUDIO_CONFIG.detectorMinRms && confidence > AUDIO_CONFIG.detectorMinConfidence ? strongestSymbol : null;
  return { timestampMs, detectedSymbol, strongestSymbol, energies, confidence, rms };
}

/** Legacy silence-framing model retained only for the regression proof. */
export class SymbolStateMachine {
  private candidate: number | null = null;
  private stableFrames = 0;
  private locked = false;
  push(symbol: number | null): number | null {
    if (this.locked) { if (symbol === null) { this.locked = false; this.candidate = null; this.stableFrames = 0; } return null; }
    if (symbol === null) { this.candidate = null; this.stableFrames = 0; return null; }
    if (symbol === this.candidate) this.stableFrames += 1;
    else { this.candidate = symbol; this.stableFrames = 1; }
    if (this.stableFrames >= 2) { this.locked = true; return symbol; }
    return null;
  }
}
