import {
  DEFAULT_BEACON_PREAMBLE,
  DEFAULT_BEACON_SYMBOL_MS,
  BEACON_PAYLOAD_SYMBOLS,
  decodeBeaconPayload,
  type AcousticBeacon,
} from '../protocol/beacon-protocol';
import { AUDIO_CONFIG } from './config';
import type { CarrierSymbol, DetectionFrame } from './detector';
import type { ClockLock, DecodedSlot, DecoderState } from './clocked-decoder';

export interface BeaconDecoderDiagnostics {
  state: DecoderState;
  syncScore: number;
  symbolPeriodMs: number | null;
  payloadSlot: number;
  slotConfidence: number | null;
  transmissionsHeard: number;
  preambleLocks: number;
  successfulBeacons: number;
  crcFailures: number;
  syncLosses: number;
  repairedBeacons: number;
}

export type BeaconDecoderEvent =
  | { type: 'searching'; diagnostics: BeaconDecoderDiagnostics }
  | { type: 'locked'; lock: ClockLock; diagnostics: BeaconDecoderDiagnostics }
  | { type: 'slot'; index: number; slot: DecodedSlot; diagnostics: BeaconDecoderDiagnostics }
  | { type: 'beacon'; beacon: AcousticBeacon; slots: DecodedSlot[]; diagnostics: BeaconDecoderDiagnostics }
  | { type: 'error'; reason: string; diagnostics: BeaconDecoderDiagnostics };

export interface BeaconDecoderOptions {
  symbolMs?: number;
  preamble?: readonly number[];
  validateBeacon?: (beacon: AcousticBeacon) => boolean;
  minSlotConfidence?: number;
}

function normalizedEnergies(frame: DetectionFrame): [number, number, number, number] {
  const total = frame.energies.reduce((sum, value) => sum + value, 0);
  if (total <= AUDIO_CONFIG.minCarrierEnergy) return [0, 0, 0, 0];
  return frame.energies.map(value => value / total) as [number, number, number, number];
}

function aggregate(
  frames: readonly DetectionFrame[],
  center: number,
  halfWidth: number,
  minFrames: number,
): DecodedSlot | null {
  const selected = frames.filter(frame => Math.abs(frame.timestampMs - center) <= halfWidth);
  if (selected.length < minFrames) return null;
  const energies: [number, number, number, number] = [0, 0, 0, 0];
  for (const frame of selected) {
    const normalized = normalizedEnergies(frame);
    for (let carrier = 0; carrier < 4; carrier += 1) energies[carrier] += normalized[carrier];
  }
  const ranked = energies
    .map((score, symbol) => ({ score, symbol: symbol as CarrierSymbol }))
    .sort((a, b) => b.score - a.score);
  return {
    symbol: ranked[0].symbol,
    score: ranked[0].score / selected.length,
    confidence: ranked[0].score / Math.max(ranked[1].score, 1e-9),
    frameCount: selected.length,
    energies,
  };
}

function symbolShare(slot: DecodedSlot | null, expected: number): number {
  if (!slot) return 0;
  const total = slot.energies.reduce((sum, value) => sum + value, 0);
  return total > 0 ? slot.energies[expected] / total : 0;
}

export class BeaconDecoder {
  private frames: DetectionFrame[] = [];
  private state: DecoderState = 'SEARCHING';
  private lock: ClockLock | null = null;
  private slots: DecodedSlot[] = [];
  private readonly preamble: readonly number[];
  private readonly symbolMs: number;
  private readonly preamblePeriodMinMs: number;
  private readonly preamblePeriodMaxMs: number;
  private readonly preambleWindowMs: number;
  private readonly preambleBoundaryProbeMs: number;
  private readonly preambleBoundaryWindowMs: number;
  private readonly payloadWindowMs: number;
  private readonly minFramesPerSlot: number;
  private readonly minSlotConfidence: number;
  private readonly validateBeacon?: (beacon: AcousticBeacon) => boolean;

  private diagnostics: BeaconDecoderDiagnostics = {
    state: 'SEARCHING',
    syncScore: 0,
    symbolPeriodMs: null,
    payloadSlot: 0,
    slotConfidence: null,
    transmissionsHeard: 0,
    preambleLocks: 0,
    successfulBeacons: 0,
    crcFailures: 0,
    syncLosses: 0,
    repairedBeacons: 0,
  };

  constructor(options: BeaconDecoderOptions = {}) {
    this.symbolMs = options.symbolMs ?? DEFAULT_BEACON_SYMBOL_MS;
    this.preamble = options.preamble ?? DEFAULT_BEACON_PREAMBLE;
    this.validateBeacon = options.validateBeacon;
    this.minSlotConfidence = options.minSlotConfidence ?? 1.05;

    this.preamblePeriodMinMs = this.symbolMs * 0.88;
    this.preamblePeriodMaxMs = this.symbolMs * 1.12;
    this.preambleWindowMs = Math.round(this.symbolMs * 0.26);
    this.preambleBoundaryProbeMs = Math.round(this.symbolMs * 0.18);
    this.preambleBoundaryWindowMs = Math.round(this.symbolMs * 0.10);
    this.payloadWindowMs = Math.round(this.symbolMs * 0.26);
    this.minFramesPerSlot = 2;
  }

  push(frame: DetectionFrame): BeaconDecoderEvent {
    this.frames.push(frame);
    this.trimHistory(frame.timestampMs);

    if (this.state === 'SEARCHING') {
      const lock = this.acquireLock(frame.timestampMs);
      if (!lock) return { type: 'searching', diagnostics: this.snapshot() };

      this.state = 'RECEIVING';
      this.lock = lock;
      this.slots = [];
      this.diagnostics = {
        ...this.diagnostics,
        state: 'RECEIVING',
        syncScore: lock.score,
        symbolPeriodMs: lock.symbolPeriodMs,
        payloadSlot: 0,
        slotConfidence: null,
        transmissionsHeard: this.diagnostics.transmissionsHeard + 1,
        preambleLocks: this.diagnostics.preambleLocks + 1,
      };
      return { type: 'locked', lock, diagnostics: this.snapshot() };
    }

    const lock = this.lock!;
    const index = this.slots.length;
    const center = lock.packetStartTime + (this.preamble.length + index + 0.5) * lock.symbolPeriodMs;

    if (frame.timestampMs <= center + this.payloadWindowMs) {
      return { type: 'searching', diagnostics: this.snapshot() };
    }

    const slot = aggregate(this.frames, center, this.payloadWindowMs, this.minFramesPerSlot);
    if (!slot || slot.confidence < this.minSlotConfidence) {
      const reason = slot
        ? `Low confidence in beacon payload slot ${index}`
        : `Insufficient frames in beacon payload slot ${index}`;
      this.diagnostics.syncLosses += 1;
      this.resetToSearch(frame.timestampMs);
      return { type: 'error', reason, diagnostics: this.snapshot() };
    }

    this.slots.push(slot);
    this.diagnostics.payloadSlot = this.slots.length;
    this.diagnostics.slotConfidence = slot.confidence;

    if (this.slots.length < BEACON_PAYLOAD_SYMBOLS) {
      return { type: 'slot', index, slot, diagnostics: this.snapshot() };
    }

    let beacon: AcousticBeacon;
    let wasRepaired = false;
    const rawSymbols = this.slots.map(s => s.symbol);

    try {
      beacon = decodeBeaconPayload(rawSymbols);
      if (this.validateBeacon && !this.validateBeacon(beacon)) {
        throw new Error('Beacon validation failed');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Invalid beacon';
      if (reason === 'Beacon checksum failed') {
        const recovery = this.recoverPayload(this.slots);
        if (recovery) {
          beacon = recovery.beacon;
          wasRepaired = true;
          for (let i = 0; i < BEACON_PAYLOAD_SYMBOLS; i++) {
            if (this.slots[i].symbol !== recovery.symbols[i]) {
              this.slots[i].symbol = recovery.symbols[i];
              this.slots[i].repaired = true;
            }
          }
        } else {
          this.diagnostics.crcFailures += 1;
          this.resetToSearch(frame.timestampMs);
          return { type: 'error', reason, diagnostics: this.snapshot() };
        }
      } else {
        this.diagnostics.syncLosses += 1;
        this.resetToSearch(frame.timestampMs);
        return { type: 'error', reason, diagnostics: this.snapshot() };
      }
    }

    if (wasRepaired) this.diagnostics.repairedBeacons += 1;
    this.diagnostics.successfulBeacons += 1;
    const completedSlots = [...this.slots];
    this.resetToSearch(frame.timestampMs);
    return { type: 'beacon', beacon, slots: completedSlots, diagnostics: this.snapshot() };
  }

  reset() {
    this.frames = [];
    this.state = 'SEARCHING';
    this.lock = null;
    this.slots = [];
    this.diagnostics = {
      ...this.diagnostics,
      state: 'SEARCHING',
      syncScore: 0,
      symbolPeriodMs: null,
      payloadSlot: 0,
      slotConfidence: null,
    };
  }

  getDiagnostics(): BeaconDecoderDiagnostics {
    return this.snapshot();
  }

  private acquireLock(now: number): ClockLock | null {
    if (this.frames.length < this.preamble.length * this.minFramesPerSlot) return null;
    let best: ClockLock | null = null;
    const oldest = this.frames[0].timestampMs;
    const acquisitionSpan = this.preamble.length * this.preamblePeriodMaxMs + this.preambleWindowMs;
    if (now - oldest < acquisitionSpan) return null;

    const periodStepMs = 2;
    const originStepMs = 10;

    for (let period = this.preamblePeriodMinMs; period <= this.preamblePeriodMaxMs; period += periodStepMs) {
      const latestStart = now - (this.preamble.length - 0.5) * period - this.preambleWindowMs;
      for (let start = oldest - period / 2; start <= latestStart; start += originStepMs) {
        let score = 0;
        let valid = true;
        for (let index = 0; index < this.preamble.length; index++) {
          const slot = aggregate(
            this.frames,
            start + (index + 0.5) * period,
            this.preambleWindowMs,
            this.minFramesPerSlot,
          );
          const expected = this.preamble[index];
          if (
            !slot ||
            slot.symbol !== expected ||
            slot.score < AUDIO_CONFIG.minPreambleSlotShare ||
            slot.confidence < AUDIO_CONFIG.minPreambleSlotConfidence
          ) {
            valid = false;
            break;
          }
          score += slot.score;
        }

        let boundaryScore = 0;
        if (valid) {
          for (let index = 1; index < this.preamble.length; index++) {
            const boundary = start + index * period;
            const before = aggregate(
              this.frames,
              boundary - this.preambleBoundaryProbeMs,
              this.preambleBoundaryWindowMs,
              1,
            );
            const after = aggregate(
              this.frames,
              boundary + this.preambleBoundaryProbeMs,
              this.preambleBoundaryWindowMs,
              1,
            );
            boundaryScore += symbolShare(before, this.preamble[index - 1]);
            boundaryScore += symbolShare(after, this.preamble[index]);
          }
        }

        const centerScore = score / this.preamble.length;
        const transitionScore = boundaryScore / ((this.preamble.length - 1) * 2);
        const meanScore = centerScore * 0.45 + transitionScore * 0.55;

        if (valid && meanScore >= AUDIO_CONFIG.minPreambleScore && (!best || meanScore > best.score)) {
          best = { packetStartTime: start, symbolPeriodMs: period, score: meanScore };
        }
      }
    }

    return best ? this.refineLockFromTransitions(best) : null;
  }

  private refineLockFromTransitions(lock: ClockLock): ClockLock {
    const crossings: Array<{ index: number; timestampMs: number }> = [];
    for (let index = 1; index < this.preamble.length; index++) {
      const expectedBoundary = lock.packetStartTime + index * lock.symbolPeriodMs;
      const nearby = this.frames.filter(frame => Math.abs(frame.timestampMs - expectedBoundary) <= 60);
      let previous: { time: number; difference: number } | null = null;
      for (const frame of nearby) {
        const energies = normalizedEnergies(frame);
        const difference = energies[this.preamble[index]] - energies[this.preamble[index - 1]];
        if (previous && previous.difference < 0 && difference >= 0) {
          const fraction = -previous.difference / Math.max(difference - previous.difference, 1e-9);
          crossings.push({
            index,
            timestampMs: previous.time + fraction * (frame.timestampMs - previous.time),
          });
          break;
        }
        previous = { time: frame.timestampMs, difference };
      }
    }

    // Need at least 2 clean crossings to refine slope
    if (crossings.length < 2) return lock;

    const meanIndex = crossings.reduce((sum, value) => sum + value.index, 0) / crossings.length;
    const meanTime = crossings.reduce((sum, value) => sum + value.timestampMs, 0) / crossings.length;
    const numerator = crossings.reduce(
      (sum, value) => sum + (value.index - meanIndex) * (value.timestampMs - meanTime),
      0,
    );
    const denominator = crossings.reduce((sum, value) => sum + (value.index - meanIndex) ** 2, 0);
    const rawPeriod = numerator / Math.max(denominator, 1e-9);
    if (rawPeriod < this.preamblePeriodMinMs || rawPeriod > this.preamblePeriodMaxMs) return lock;

    const symbolPeriodMs = rawPeriod;
    const packetStartTime = meanTime - meanIndex * symbolPeriodMs;
    return { ...lock, packetStartTime, symbolPeriodMs };
  }

  private recoverPayload(
    slots: DecodedSlot[],
  ): { beacon: AcousticBeacon; symbols: CarrierSymbol[]; repaired: number } | null {
    const baseSymbols = slots.map(s => s.symbol);

    const indexed = slots
      .map((slot, index) => {
        const carrierRank = ([0, 1, 2, 3] as CarrierSymbol[])
          .map(c => ({ carrier: c, energy: slot.energies[c] }))
          .sort((a, b) => b.energy - a.energy);
        return { index, slot, carrierRank };
      })
      .sort((a, b) => a.slot.confidence - b.slot.confidence);

    let bestCandidate: { beacon: AcousticBeacon; symbols: CarrierSymbol[]; repaired: number } | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    const testCandidate = (candidateSymbols: CarrierSymbol[], repairedCount: number) => {
      try {
        const b = decodeBeaconPayload(candidateSymbols);
        if (this.validateBeacon && !this.validateBeacon(b)) return;

        let logLikelihood = 0;
        for (let i = 0; i < BEACON_PAYLOAD_SYMBOLS; i++) {
          const sym = candidateSymbols[i];
          logLikelihood += Math.log(Math.max(slots[i].energies[sym], 1e-9));
        }
        if (logLikelihood > bestScore) {
          bestScore = logLikelihood;
          bestCandidate = { beacon: b, symbols: [...candidateSymbols], repaired: repairedCount };
        }
      } catch {
        // Invalid CRC or boundary check
      }
    };

    // Level 1: 1-symbol perturbation across all 15 slots
    for (const item of indexed) {
      for (let rank = 1; rank < 4; rank++) {
        const alt = item.carrierRank[rank];
        const candidate = [...baseSymbols];
        candidate[item.index] = alt.carrier;
        testCandidate(candidate, 1);
      }
    }

    if (bestCandidate) return bestCandidate;

    // Level 2: 2-symbol perturbation across top 5 lowest-confidence slots
    const top5 = indexed.slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
      for (let j = i + 1; j < top5.length; j++) {
        const itemA = top5[i];
        const itemB = top5[j];
        for (const rankA of [1, 2]) {
          const candA = itemA.carrierRank[rankA];
          for (const rankB of [1, 2]) {
            const candB = itemB.carrierRank[rankB];
            const candidate = [...baseSymbols];
            candidate[itemA.index] = candA.carrier;
            candidate[itemB.index] = candB.carrier;
            testCandidate(candidate, 2);
          }
        }
      }
    }

    return bestCandidate;
  }

  private trimHistory(now: number) {
    const receivingFloor = this.lock
      ? this.lock.packetStartTime +
        (this.preamble.length + this.slots.length - 0.5) * this.lock.symbolPeriodMs -
        this.payloadWindowMs -
        100
      : Number.NEGATIVE_INFINITY;
    const cutoff = this.state === 'SEARCHING' ? now - AUDIO_CONFIG.historyMs : receivingFloor;
    while (this.frames.length && this.frames[0].timestampMs < cutoff) this.frames.shift();
  }

  private resetToSearch(now: number) {
    this.state = 'SEARCHING';
    this.lock = null;
    this.slots = [];
    this.frames = this.frames.filter(frame => frame.timestampMs >= now - AUDIO_CONFIG.historyMs);
    this.diagnostics = {
      ...this.diagnostics,
      state: 'SEARCHING',
      syncScore: 0,
      symbolPeriodMs: null,
      payloadSlot: 0,
      slotConfidence: null,
    };
  }

  private snapshot(): BeaconDecoderDiagnostics {
    return { ...this.diagnostics };
  }
}
