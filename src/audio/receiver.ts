import { ClockedPacketDecoder, type ClockedDecoderEvent, type DecoderDiagnostics } from './clocked-decoder';
import { AUDIO_CONFIG } from './config';
import { detectFrame, type DetectionFrame } from './detector';
import { detectSlp2Frame, type Slp2DetectionFrame } from './slp2-detector';
import {
  BeaconDecoder,
  type BeaconDecoderEvent,
  type BeaconDecoderDiagnostics,
} from './beacon-decoder';
import {
  BeaconConsensus,
  type ConsensusResult,
  type BeaconConsensusOptions,
} from './beacon-consensus';
import { DEFAULT_SLP2_CARRIER_BANK, type CarrierBank } from './carrier-bank';
import type { AcousticBeacon } from '../protocol/beacon-protocol';
import type { SonicPacket } from '../protocol/protocol';

export interface ReceiverInfo {
  audioContextState: AudioContextState;
  sampleRate: number;
}

export interface ReceiverCallbacks {
  onFrame: (frame: DetectionFrame, diagnostics: DecoderDiagnostics) => void;
  onEvent: (event: ClockedDecoderEvent) => void;
  onInfo?: (info: ReceiverInfo) => void;
  validatePacket?: (packet: SonicPacket) => boolean;
}

export interface BeaconReceiverCallbacks {
  onFrame?: (frame: Slp2DetectionFrame, diagnostics: BeaconDecoderDiagnostics) => void;
  onEvent?: (event: BeaconDecoderEvent) => void;
  onBeacon?: (beacon: AcousticBeacon, confidence: number) => void;
  onConsensus?: (result: ConsensusResult) => void;
  onInfo?: (info: ReceiverInfo) => void;
  validateBeacon?: (beacon: AcousticBeacon) => boolean;
}

export interface BeaconReceiverOptions {
  carrierBank?: CarrierBank;
  symbolMs?: number;
  preamble?: readonly number[];
  consensusOptions?: BeaconConsensusOptions;
}

export class SonicReceiver {
  private context?: AudioContext;
  private stream?: MediaStream;
  private timer?: number;

  async start(callbacks: ReceiverCallbacks) {
    this.stop();

    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not supported in this browser.');

    // Create/resume the AudioContext before the first await so mobile Safari sees it
    // as part of the user's tap. Starting getUserMedia in the same gesture also
    // avoids losing transient user activation while the permission prompt is open.
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    const resumePromise = context.state === 'suspended' ? context.resume() : Promise.resolve();
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    try {
      const [, stream] = await Promise.all([resumePromise, streamPromise]);
      this.stream = stream;

      // Some mobile browsers may suspend the context again while the permission UI
      // is visible. Resume once more after permission is granted when allowed.
      if (context.state === 'suspended') await context.resume();

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = AUDIO_CONFIG.analysisFftSize;
      source.connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      const decoder = new ClockedPacketDecoder({ validatePacket: callbacks.validatePacket });
      let lastUiUpdate = Number.NEGATIVE_INFINITY;
      callbacks.onInfo?.({ audioContextState: context.state, sampleRate: context.sampleRate });
      this.timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const timestampMs = context.currentTime * 1000 - (analyser.fftSize / context.sampleRate) * 500;
        const frame = detectFrame(samples, context.sampleRate, timestampMs);
        const event = decoder.push(frame);
        if (event.type !== 'searching') callbacks.onEvent(event);
        if (timestampMs - lastUiUpdate >= AUDIO_CONFIG.uiUpdateIntervalMs) {
          callbacks.onFrame(frame, decoder.getDiagnostics());
          callbacks.onInfo?.({ audioContextState: context.state, sampleRate: context.sampleRate });
          lastUiUpdate = timestampMs;
        }
      }, AUDIO_CONFIG.analysisIntervalMs);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async startBeaconMode(
    callbacks: BeaconReceiverCallbacks,
    options: BeaconReceiverOptions = {},
  ) {
    this.stop();

    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not supported in this browser.');

    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    const resumePromise = context.state === 'suspended' ? context.resume() : Promise.resolve();
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    try {
      const [, stream] = await Promise.all([resumePromise, streamPromise]);
      this.stream = stream;

      if (context.state === 'suspended') await context.resume();

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = AUDIO_CONFIG.analysisFftSize;
      source.connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      const carrierBank = options.carrierBank ?? DEFAULT_SLP2_CARRIER_BANK;
      const decoder = new BeaconDecoder({
        symbolMs: options.symbolMs,
        preamble: options.preamble,
        validateBeacon: callbacks.validateBeacon,
      });
      const consensus = new BeaconConsensus(options.consensusOptions);

      let lastUiUpdate = Number.NEGATIVE_INFINITY;
      callbacks.onInfo?.({ audioContextState: context.state, sampleRate: context.sampleRate });

      this.timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const timestampMs = context.currentTime * 1000 - (analyser.fftSize / context.sampleRate) * 500;
        const frame = detectSlp2Frame(samples, context.sampleRate, timestampMs, { carrierBank });
        const event = decoder.push(frame);

        if (event.type !== 'searching') {
          callbacks.onEvent?.(event);
        }

        if (event.type === 'beacon') {
          const beaconConfidence =
            event.slots.reduce((sum, s) => sum + s.confidence, 0) / event.slots.length;
          callbacks.onBeacon?.(event.beacon, beaconConfidence);
          const consensusResult = consensus.addObservation(event.beacon, beaconConfidence, timestampMs);
          if (consensusResult) {
            callbacks.onConsensus?.(consensusResult);
          }
        }

        if (timestampMs - lastUiUpdate >= AUDIO_CONFIG.uiUpdateIntervalMs) {
          callbacks.onFrame?.(frame, decoder.getDiagnostics());
          callbacks.onInfo?.({ audioContextState: context.state, sampleRate: context.sampleRate });
          lastUiUpdate = timestampMs;
        }
      }, AUDIO_CONFIG.analysisIntervalMs);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = undefined;
  }
}
