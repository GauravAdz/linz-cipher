import { PREAMBLE, decodePayload, type SonicPacket } from '../protocol/protocol';
import { AUDIO_CONFIG } from './config';
import type { CarrierSymbol, DetectionFrame } from './detector';

export type DecoderState = 'SEARCHING' | 'RECEIVING';

export interface ClockLock {
  /** Start time of preamble symbol zero, in the same monotonic timebase as input frames. */
  packetStartTime: number;
  symbolPeriodMs: number;
  score: number;
}

export interface DecodedSlot {
  symbol: CarrierSymbol;
  score: number;
  confidence: number;
  frameCount: number;
  energies: [number, number, number, number];
}

export interface DecoderDiagnostics {
  state: DecoderState;
  syncScore: number;
  symbolPeriodMs: number | null;
  payloadSlot: number;
  slotConfidence: number | null;
  transmissionsHeard: number;
  preambleLocks: number;
  successfulPackets: number;
  crcFailures: number;
  syncLosses: number;
}

export type ClockedDecoderEvent =
  | { type: 'searching'; diagnostics: DecoderDiagnostics }
  | { type: 'locked'; lock: ClockLock; diagnostics: DecoderDiagnostics }
  | { type: 'slot'; index: number; slot: DecodedSlot; diagnostics: DecoderDiagnostics }
  | { type: 'packet'; packet: SonicPacket; slots: DecodedSlot[]; diagnostics: DecoderDiagnostics }
  | { type: 'error'; reason: string; diagnostics: DecoderDiagnostics };

function normalizedEnergies(frame: DetectionFrame): [number, number, number, number] {
  const total = frame.energies.reduce((sum, value) => sum + value, 0);
  if (total <= AUDIO_CONFIG.minCarrierEnergy) return [0, 0, 0, 0];
  return frame.energies.map(value => value / total) as [number, number, number, number];
}

function aggregate(frames: readonly DetectionFrame[], center: number, halfWidth: number): DecodedSlot | null {
  const selected = frames.filter(frame => Math.abs(frame.timestampMs - center) <= halfWidth);
  if (selected.length < AUDIO_CONFIG.minFramesPerSlot) return null;
  const energies: [number, number, number, number] = [0, 0, 0, 0];
  for (const frame of selected) {
    const normalized = normalizedEnergies(frame);
    for (let carrier = 0; carrier < 4; carrier += 1) energies[carrier] += normalized[carrier];
  }
  const ranked = energies.map((score, symbol) => ({ score, symbol: symbol as CarrierSymbol })).sort((a, b) => b.score - a.score);
  return {
    symbol: ranked[0].symbol,
    score: ranked[0].score / selected.length,
    confidence: ranked[0].score / Math.max(ranked[1].score, 1e-9),
    frameCount: selected.length,
    energies,
  };
}

function symbolShare(slot: DecodedSlot | null, expected: number) {
  if (!slot) return 0;
  const total = slot.energies.reduce((sum, value) => sum + value, 0);
  return total > 0 ? slot.energies[expected] / total : 0;
}

export class ClockedPacketDecoder {
  private frames: DetectionFrame[] = [];
  private state: DecoderState = 'SEARCHING';
  private lock: ClockLock | null = null;
  private slots: DecodedSlot[] = [];
  private diagnostics: DecoderDiagnostics = {
    state: 'SEARCHING', syncScore: 0, symbolPeriodMs: null, payloadSlot: 0, slotConfidence: null,
    transmissionsHeard: 0, preambleLocks: 0, successfulPackets: 0, crcFailures: 0, syncLosses: 0,
  };

  push(frame: DetectionFrame): ClockedDecoderEvent {
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
        state: 'RECEIVING', syncScore: lock.score, symbolPeriodMs: lock.symbolPeriodMs,
        payloadSlot: 0, slotConfidence: null, transmissionsHeard: this.diagnostics.transmissionsHeard + 1,
        preambleLocks: this.diagnostics.preambleLocks + 1,
      };
      return { type: 'locked', lock, diagnostics: this.snapshot() };
    }

    const lock = this.lock!;
    const index = this.slots.length;
    const center = lock.packetStartTime + (PREAMBLE.length + index + 0.5) * lock.symbolPeriodMs;
    if (frame.timestampMs <= center + AUDIO_CONFIG.payloadWindowMs) {
      return { type: 'searching', diagnostics: this.snapshot() };
    }

    const slot = aggregate(this.frames, center, AUDIO_CONFIG.payloadWindowMs);
    if (!slot || slot.confidence < AUDIO_CONFIG.minSlotConfidence) {
      const reason = slot ? `Low confidence in payload slot ${index}` : `Insufficient frames in payload slot ${index}`;
      this.diagnostics.syncLosses += 1;
      this.resetToSearch(frame.timestampMs);
      return { type: 'error', reason, diagnostics: this.snapshot() };
    }

    this.slots.push(slot);
    this.diagnostics.payloadSlot = this.slots.length;
    this.diagnostics.slotConfidence = slot.confidence;
    if (this.slots.length < 20) return { type: 'slot', index, slot, diagnostics: this.snapshot() };

    try {
      const packet = decodePayload(this.slots.map(value => value.symbol));
      const completedSlots = [...this.slots];
      this.diagnostics.successfulPackets += 1;
      this.resetToSearch(frame.timestampMs);
      return { type: 'packet', packet, slots: completedSlots, diagnostics: this.snapshot() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Invalid packet';
      if (reason === 'Checksum failed') this.diagnostics.crcFailures += 1;
      else this.diagnostics.syncLosses += 1;
      this.resetToSearch(frame.timestampMs);
      return { type: 'error', reason, diagnostics: this.snapshot() };
    }
  }

  reset() {
    this.frames = [];
    this.state = 'SEARCHING';
    this.lock = null;
    this.slots = [];
    this.diagnostics = { ...this.diagnostics, state: 'SEARCHING', syncScore: 0, symbolPeriodMs: null, payloadSlot: 0, slotConfidence: null };
  }

  getDiagnostics() { return this.snapshot(); }

  private acquireLock(now: number): ClockLock | null {
    if (this.frames.length < PREAMBLE.length * AUDIO_CONFIG.minFramesPerSlot) return null;
    let best: ClockLock | null = null;
    const oldest = this.frames[0].timestampMs;
    // Do not accept a compressed-period hypothesis before the longest allowed
    // preamble could have completed. Without this guard, the alternating
    // preamble can look valid at the minimum search period while it is still
    // playing, which shifts every payload slot progressively earlier.
    const acquisitionSpan = PREAMBLE.length * AUDIO_CONFIG.preamblePeriodMaxMs
      + AUDIO_CONFIG.preambleWindowMs;
    if (now - oldest < acquisitionSpan) return null;
    for (let period = AUDIO_CONFIG.preamblePeriodMinMs; period <= AUDIO_CONFIG.preamblePeriodMaxMs; period += AUDIO_CONFIG.preamblePeriodStepMs) {
      const latestStart = now - (PREAMBLE.length - 0.5) * period - AUDIO_CONFIG.preambleWindowMs;
      for (let start = oldest - period / 2; start <= latestStart; start += AUDIO_CONFIG.preambleOriginStepMs) {
        let score = 0;
        let valid = true;
        for (let index = 0; index < PREAMBLE.length; index += 1) {
          const slot = aggregate(this.frames, start + (index + 0.5) * period, AUDIO_CONFIG.preambleWindowMs);
          const expected = PREAMBLE[index];
          if (!slot || slot.symbol !== expected || slot.score < AUDIO_CONFIG.minPreambleSlotShare || slot.confidence < AUDIO_CONFIG.minPreambleSlotConfidence) {
            valid = false;
            break;
          }
          score += slot.score;
        }
        // The alternating preamble gives us five known carrier transitions.
        // Probe on both sides of each expected boundary so a candidate whose
        // centers merely happen to fall inside the right tones cannot win with
        // a period that will drift across the payload.
        let boundaryScore = 0;
        if (valid) {
          for (let index = 1; index < PREAMBLE.length; index += 1) {
            const boundary = start + index * period;
            const before = aggregate(
              this.frames,
              boundary - AUDIO_CONFIG.preambleBoundaryProbeMs,
              AUDIO_CONFIG.preambleBoundaryWindowMs,
            );
            const after = aggregate(
              this.frames,
              boundary + AUDIO_CONFIG.preambleBoundaryProbeMs,
              AUDIO_CONFIG.preambleBoundaryWindowMs,
            );
            boundaryScore += symbolShare(before, PREAMBLE[index - 1]);
            boundaryScore += symbolShare(after, PREAMBLE[index]);
          }
        }
        const centerScore = score / PREAMBLE.length;
        const transitionScore = boundaryScore / ((PREAMBLE.length - 1) * 2);
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
    for (let index = 1; index < PREAMBLE.length; index += 1) {
      const expectedBoundary = lock.packetStartTime + index * lock.symbolPeriodMs;
      const nearby = this.frames.filter(frame => Math.abs(frame.timestampMs - expectedBoundary) <= 80);
      let previous: { time: number; difference: number } | null = null;
      for (const frame of nearby) {
        const energies = normalizedEnergies(frame);
        const difference = energies[PREAMBLE[index]] - energies[PREAMBLE[index - 1]];
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
    if (crossings.length < 3) return lock;

    const meanIndex = crossings.reduce((sum, value) => sum + value.index, 0) / crossings.length;
    const meanTime = crossings.reduce((sum, value) => sum + value.timestampMs, 0) / crossings.length;
    const numerator = crossings.reduce(
      (sum, value) => sum + (value.index - meanIndex) * (value.timestampMs - meanTime),
      0,
    );
    const denominator = crossings.reduce((sum, value) => sum + (value.index - meanIndex) ** 2, 0);
    const symbolPeriodMs = numerator / Math.max(denominator, 1e-9);
    if (symbolPeriodMs < AUDIO_CONFIG.preamblePeriodMinMs || symbolPeriodMs > AUDIO_CONFIG.preamblePeriodMaxMs) return lock;
    const packetStartTime = meanTime - meanIndex * symbolPeriodMs;
    return { ...lock, packetStartTime, symbolPeriodMs };
  }

  private trimHistory(now: number) {
    const receivingFloor = this.lock
      ? this.lock.packetStartTime + (PREAMBLE.length + this.slots.length - 0.5) * this.lock.symbolPeriodMs - AUDIO_CONFIG.payloadWindowMs - 100
      : Number.NEGATIVE_INFINITY;
    const cutoff = this.state === 'SEARCHING' ? now - AUDIO_CONFIG.historyMs : receivingFloor;
    while (this.frames.length && this.frames[0].timestampMs < cutoff) this.frames.shift();
  }

  private resetToSearch(now: number) {
    this.state = 'SEARCHING';
    this.lock = null;
    this.slots = [];
    this.frames = this.frames.filter(frame => frame.timestampMs >= now - AUDIO_CONFIG.historyMs);
    this.diagnostics = { ...this.diagnostics, state: 'SEARCHING', syncScore: 0, symbolPeriodMs: null, payloadSlot: 0, slotConfidence: null };
  }

  private snapshot(): DecoderDiagnostics { return { ...this.diagnostics }; }
}
