import type { AcousticBeacon } from '../protocol/beacon-protocol';

export interface BeaconObservation {
  contentId: number;
  sequence: number;
  flags: number;
  confidence: number;
  timestamp: number;
}

export interface ConsensusResult {
  contentId: number;
  observations: BeaconObservation[];
  confidence: number;
  rule: 'high_confidence' | 'multi_packet';
}

export interface BeaconConsensusOptions {
  windowMs?: number;               // Observation window (default 12,000 ms)
  highConfidenceThreshold?: number;// Single packet threshold (default 2.4)
  minMatchingObservations?: number;// Multi-packet threshold (default 2)
}

export class BeaconConsensus {
  private observations: BeaconObservation[] = [];
  private readonly windowMs: number;
  private readonly highConfidenceThreshold: number;
  private readonly minMatchingObservations: number;

  constructor(options: BeaconConsensusOptions = {}) {
    this.windowMs = options.windowMs ?? 12_000;
    this.highConfidenceThreshold = options.highConfidenceThreshold ?? 2.4;
    this.minMatchingObservations = options.minMatchingObservations ?? 2;
  }

  addObservation(
    beacon: AcousticBeacon,
    confidence: number,
    timestamp: number = Date.now(),
  ): ConsensusResult | null {
    const observation: BeaconObservation = {
      contentId: beacon.contentId,
      sequence: beacon.sequence,
      flags: beacon.flags,
      confidence,
      timestamp,
    };

    this.observations.push(observation);
    this.trim(timestamp);

    // Rule 1: Single packet with very high confidence
    if (confidence >= this.highConfidenceThreshold) {
      return {
        contentId: beacon.contentId,
        observations: [observation],
        confidence,
        rule: 'high_confidence',
      };
    }

    // Rule 2: Multiple matching valid packets within the time window
    const matching = this.observations.filter(obs => obs.contentId === beacon.contentId);
    if (matching.length >= this.minMatchingObservations) {
      const avgConfidence = matching.reduce((sum, o) => sum + o.confidence, 0) / matching.length;
      return {
        contentId: beacon.contentId,
        observations: matching,
        confidence: avgConfidence,
        rule: 'multi_packet',
      };
    }

    return null;
  }

  getRecentObservations(): readonly BeaconObservation[] {
    return this.observations;
  }

  reset(): void {
    this.observations = [];
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.observations.length && this.observations[0].timestamp < cutoff) {
      this.observations.shift();
    }
  }
}
