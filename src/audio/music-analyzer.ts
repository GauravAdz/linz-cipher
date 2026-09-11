import { goertzel } from './slp2-detector';
import { DEFAULT_SLP2_CARRIER_BANK, type CarrierBank } from './carrier-bank';

export interface MusicAnalysisFrame {
  timestamp: number;
  carrierEnergy: [number, number, number, number];
  surroundingEnergy: [number, number, number, number];
  rms: number;
  spectralDensity: number;
}

export interface MusicAnalysisResult {
  frames: MusicAnalysisFrame[];
  averageRms: number;
  peakRms: number;
  sampleRate: number;
  durationMs: number;
  carrierBank: CarrierBank;
}

export interface MusicAnalysisOptions {
  carrierBank?: CarrierBank;
  windowSize?: number;
  hopMs?: number;
}

/**
 * Analyzes natural music background to evaluate local carrier suitability.
 * Inspects energy at and around candidate carrier frequencies (f ± Δ).
 */
export function analyzeMusic(
  samples: Float32Array,
  sampleRate: number,
  options: MusicAnalysisOptions = {},
): MusicAnalysisResult {
  const bank = options.carrierBank ?? DEFAULT_SLP2_CARRIER_BANK;
  const windowSize = options.windowSize ?? 1024;
  const hopMs = options.hopMs ?? 20;
  const hopSamples = Math.max(1, Math.round((hopMs / 1000) * sampleRate));

  const frames: MusicAnalysisFrame[] = [];
  let totalRms = 0;
  let peakRms = 0;

  for (let start = 0; start + windowSize <= samples.length; start += hopSamples) {
    const slice = samples.subarray(start, start + windowSize);
    const timestamp = ((start + windowSize / 2) / sampleRate) * 1000;

    let sumSq = 0;
    for (let i = 0; i < slice.length; i++) {
      sumSq += slice[i] * slice[i];
    }
    const rms = Math.sqrt(sumSq / slice.length);
    totalRms += rms;
    if (rms > peakRms) peakRms = rms;

    const carrierEnergy: [number, number, number, number] = [0, 0, 0, 0];
    const surroundingEnergy: [number, number, number, number] = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const f = bank.frequencies[i];
      const delta = bank.deltaHz;

      const eCenter = goertzel(slice, sampleRate, f, 'hann');
      const eLower = goertzel(slice, sampleRate, f - delta, 'hann');
      const eUpper = goertzel(slice, sampleRate, f + delta, 'hann');

      carrierEnergy[i] = eCenter;
      surroundingEnergy[i] = (eLower + eUpper) / 2;
    }

    // Spectral density approximation: average surrounding energy across the carrier band
    const avgSurround = surroundingEnergy.reduce((sum, e) => sum + e, 0) / 4;

    frames.push({
      timestamp,
      carrierEnergy,
      surroundingEnergy,
      rms,
      spectralDensity: avgSurround,
    });
  }

  const durationMs = (samples.length / sampleRate) * 1000;
  const averageRms = frames.length ? totalRms / frames.length : 0;

  return {
    frames,
    averageRms,
    peakRms,
    sampleRate,
    durationMs,
    carrierBank: bank,
  };
}

/**
 * Computes local background suitability around a specific carrier frequency during a symbol slot.
 */
export function getSlotCarrierEnergy(
  analysis: MusicAnalysisResult,
  startMs: number,
  durationMs: number,
  carrierIndex: number,
): number {
  const endMs = startMs + durationMs;
  const matchingFrames = analysis.frames.filter(f => f.timestamp >= startMs && f.timestamp <= endMs);
  if (!matchingFrames.length) return 0;

  const total = matchingFrames.reduce((sum, f) => sum + f.surroundingEnergy[carrierIndex], 0);
  return total / matchingFrames.length;
}
