import { SYMBOL_MS } from '../protocol/protocol';

export type AnalysisWindow = 'rectangular' | 'hann';

export const AUDIO_CONFIG = {
  // DSP cadence. Protocol processing runs at analysisIntervalMs; only visual
  // callbacks use the slower uiUpdateIntervalMs cadence.
  analysisFftSize: 1024,
  analysisIntervalMs: 12,
  uiUpdateIntervalMs: 50,
  analysisWindow: 'hann' as AnalysisWindow,

  // Acquisition retains a complete preamble and searches both clock phase and
  // period. Boundary probes reject coincidental center-only matches.
  historyMs: 1800,
  preamblePeriodMinMs: SYMBOL_MS * 0.9,
  preamblePeriodMaxMs: SYMBOL_MS * 1.1,
  preamblePeriodStepMs: 2,
  preambleOriginStepMs: 12,
  preambleWindowMs: 52,
  preambleBoundaryProbeMs: 36,
  preambleBoundaryWindowMs: 18,
  payloadWindowMs: 54,

  // Normalized-energy acceptance gates for preamble and payload integration.
  minPreambleSlotShare: 0.48,
  minPreambleSlotConfidence: 1.18,
  minPreambleScore: 0.56,
  minSlotConfidence: 1.06,
  minFramesPerSlot: 3,
  minCarrierEnergy: 1e-7,

  // Live-meter and legacy diagnostic gates. The clocked decoder consumes the
  // raw energy vector even when detectedSymbol is null.
  detectorMinRms: 0.008,
  detectorMinConfidence: 2.2,
} as const;
