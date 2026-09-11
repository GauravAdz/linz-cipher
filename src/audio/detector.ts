import { CARRIER_FREQUENCIES } from '../protocol/protocol';

export interface DetectionFrame { detectedSymbol: 0 | 1 | 2 | 3 | null; energies: [number, number, number, number]; confidence: number; rms: number; }

function goertzel(samples: Float32Array, sampleRate: number, frequency: number) {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let s0 = 0, s1 = 0, s2 = 0;
  for (const sample of samples) { s0 = sample + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2) / (samples.length * samples.length);
}

export function detectFrame(samples: Float32Array, sampleRate: number): DetectionFrame {
  const energies = CARRIER_FREQUENCIES.map(f => goertzel(samples, sampleRate, f)) as [number, number, number, number];
  const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  const ranked = energies.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const confidence = ranked[0].value / Math.max(ranked[1].value, 1e-9);
  const detectedSymbol = rms > .008 && confidence > 2.2 ? ranked[0].index as 0 | 1 | 2 | 3 : null;
  return { detectedSymbol, energies, confidence, rms };
}

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
