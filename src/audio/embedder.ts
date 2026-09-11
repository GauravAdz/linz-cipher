import {
  DEFAULT_BEACON_PREAMBLE,
  DEFAULT_BEACON_SYMBOL_MS,
  DEFAULT_BEACON_TONE_MS,
  encodeBeacon,
  type AcousticBeacon,
} from '../protocol/beacon-protocol';
import { CARRIER_BANK_4_6KHZ, type CarrierBank } from './carrier-bank';
import { analyzeMusic, getSlotCarrierEnergy } from './music-analyzer';

export type EmbedProfile = 'ROBUST' | 'BALANCED' | 'SUBTLE';

export interface EmbedOptions {
  profile: EmbedProfile;
  carrierBank: CarrierBank;
  symbolMs: number;
  toneMs: number;
  attackMs: number;
  releaseMs: number;
  minCarrierGain: number;
  maxCarrierGain: number;
  targetCarrierToLocalEnergyRatio: number;
  notchFilter: boolean;
  notchQ: number;
  preamble: readonly number[];
}

export const PROFILE_CONFIGS: Record<EmbedProfile, Partial<EmbedOptions>> = {
  ROBUST: {
    minCarrierGain: 0.05,
    maxCarrierGain: 0.16,
    targetCarrierToLocalEnergyRatio: 0.7,
    notchQ: 20,
  },
  BALANCED: {
    minCarrierGain: 0.025,
    maxCarrierGain: 0.09,
    targetCarrierToLocalEnergyRatio: 0.45,
    notchQ: 25,
  },
  SUBTLE: {
    minCarrierGain: 0.012,
    maxCarrierGain: 0.05,
    targetCarrierToLocalEnergyRatio: 0.3,
    notchQ: 30,
  },
};

export const DEFAULT_EMBED_OPTIONS: EmbedOptions = {
  profile: 'BALANCED',
  carrierBank: CARRIER_BANK_4_6KHZ,
  symbolMs: DEFAULT_BEACON_SYMBOL_MS,
  toneMs: DEFAULT_BEACON_TONE_MS,
  attackMs: 8,
  releaseMs: 16,
  minCarrierGain: 0.025,
  maxCarrierGain: 0.09,
  targetCarrierToLocalEnergyRatio: 0.45,
  notchFilter: true,
  notchQ: 25,
  preamble: DEFAULT_BEACON_PREAMBLE,
};

/**
 * 2nd-order IIR Biquad Notch Filter
 */
export class BiquadNotchFilter {
  private b0: number = 1;
  private b1: number = 0;
  private b2: number = 0;
  private a1: number = 0;
  private a2: number = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(frequency: number, sampleRate: number, q = 25) {
    const w0 = (2 * Math.PI * frequency) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);

    const a0 = 1 + alpha;
    this.b0 = 1 / a0;
    this.b1 = (-2 * cosw0) / a0;
    this.b2 = 1 / a0;
    this.a1 = (-2 * cosw0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  processSample(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset() {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
}

export interface EmbedResult {
  samples: Float32Array;
  sampleRate: number;
  channelCount: number;
  repetitions: number;
  durationMs: number;
}

/**
 * Raised-cosine envelope for click-free carrier burst
 */
function symbolEnvelope(
  timeMs: number,
  attackMs: number,
  toneMs: number,
  releaseMs: number,
): number {
  if (timeMs < 0) return 0;
  if (timeMs < attackMs) {
    return 0.5 * (1 - Math.cos((Math.PI * timeMs) / attackMs));
  }
  if (timeMs < toneMs) return 1.0;
  if (timeMs < toneMs + releaseMs) {
    const relTime = timeMs - toneMs;
    return 0.5 * (1 + Math.cos((Math.PI * relTime) / releaseMs));
  }
  return 0;
}

/**
 * Embeds a continuously repeating SLP/2 beacon into an audio track.
 * Applies optional spectral notching and adaptive carrier amplitude.
 */
export function embedBeacon(
  source: Float32Array | { samples: Float32Array; sampleRate: number; channelCount?: number },
  beacon: AcousticBeacon,
  optionsInput: Partial<EmbedOptions> = {},
): EmbedResult {
  const samples = source instanceof Float32Array ? source : source.samples;
  const sampleRate = source instanceof Float32Array ? 48000 : source.sampleRate;
  const channelCount = source instanceof Float32Array ? 1 : source.channelCount ?? 1;

  const profile = optionsInput.profile ?? 'BALANCED';
  const profileDefaults = PROFILE_CONFIGS[profile];
  const options: EmbedOptions = {
    ...DEFAULT_EMBED_OPTIONS,
    ...profileDefaults,
    ...optionsInput,
    profile,
  };

  const {
    carrierBank,
    symbolMs,
    toneMs,
    attackMs,
    releaseMs,
    minCarrierGain,
    maxCarrierGain,
    targetCarrierToLocalEnergyRatio,
    notchFilter,
    notchQ,
    preamble,
  } = options;

  const totalSamples = samples.length;
  const durationMs = (totalSamples / sampleRate) * 1000;

  // 1. Optional spectral notching on the music signal
  let musicOutput = new Float32Array(samples);
  if (notchFilter) {
    for (let c = 0; c < 4; c++) {
      const notch = new BiquadNotchFilter(carrierBank.frequencies[c], sampleRate, notchQ);
      const filtered = new Float32Array(musicOutput.length);
      for (let i = 0; i < musicOutput.length; i++) {
        filtered[i] = notch.processSample(musicOutput[i]);
      }
      musicOutput = filtered;
    }
  }

  // 2. Perform music background analysis for adaptive gain
  const analysis = analyzeMusic(samples, sampleRate, { carrierBank });

  // 3. Build repeating beacon symbol stream
  // Each beacon packet has 21 symbols (6 preamble + 15 payload)
  // Sequence cycles: 0 -> 1 -> 2 -> 3 -> 0...
  const totalSlots = Math.ceil(durationMs / symbolMs);

  const slotSymbols: number[] = [];
  let seq = beacon.sequence;
  let repetitions = 0;

  while (slotSymbols.length < totalSlots) {
    const currentBeacon: AcousticBeacon = {
      ...beacon,
      sequence: seq,
    };
    const symbols = encodeBeacon(currentBeacon, preamble);
    slotSymbols.push(...symbols);
    seq = (seq + 1) % 4;
    repetitions++;
  }

  // 4. Generate modulated carriers with adaptive gain
  const output = new Float32Array(totalSamples);
  let phase = 0;

  for (let slotIndex = 0; slotIndex < totalSlots; slotIndex++) {
    const slotStartMs = slotIndex * symbolMs;
    const slotStartSample = Math.round((slotStartMs / 1000) * sampleRate);
    const slotEndSample = Math.min(
      totalSamples,
      Math.round(((slotStartMs + symbolMs) / 1000) * sampleRate),
    );

    if (slotStartSample >= totalSamples) break;

    const symbol = slotSymbols[slotIndex];
    const carrierFreq = carrierBank.frequencies[symbol];

    // Compute adaptive gain for this slot
    const localSurround = getSlotCarrierEnergy(analysis, slotStartMs, symbolMs, symbol);
    const localRms = Math.sqrt(Math.max(localSurround, 1e-9));
    const rawGain = localRms * targetCarrierToLocalEnergyRatio;
    const slotGain = Math.max(minCarrierGain, Math.min(maxCarrierGain, rawGain));

    for (let n = slotStartSample; n < slotEndSample; n++) {
      const timeMs = (n / sampleRate) * 1000;
      const slotTimeMs = timeMs - slotStartMs;
      const env = symbolEnvelope(slotTimeMs, attackMs, toneMs, releaseMs);

      phase += (2 * Math.PI * carrierFreq) / sampleRate;
      const carrierSample = slotGain * env * Math.sin(phase);

      const combined = musicOutput[n] + carrierSample;
      // Soft-clip to [-1.0, 1.0]
      output[n] = Math.max(-1.0, Math.min(1.0, combined));
    }
  }

  return {
    samples: output,
    sampleRate,
    channelCount,
    repetitions,
    durationMs,
  };
}
