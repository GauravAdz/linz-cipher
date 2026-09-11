import { AUDIO_CONFIG } from '../src/audio/config';
import { detectFrame, type DetectionFrame } from '../src/audio/detector';
import { detectSlp2Frame, type Slp2DetectionFrame } from '../src/audio/slp2-detector';
import { CARRIER_FREQUENCIES, SYMBOL_MS, TONE_MS, encodePacket, type SonicPacket } from '../src/protocol/protocol';
import { encodeBeacon, DEFAULT_BEACON_SYMBOL_MS, DEFAULT_BEACON_TONE_MS, type AcousticBeacon } from '../src/protocol/beacon-protocol';
import { CARRIER_BANK_4_6KHZ, type CarrierBank } from '../src/audio/carrier-bank';
import { AMBIENT_TIMING, TRANSMISSION_ENVELOPE } from '../src/audio/transmitter';

export interface TransmissionOptions {
  packet?: SonicPacket;
  beacon?: AcousticBeacon;
  carrierBank?: CarrierBank;
  carrierFrequencies?: readonly [number, number, number, number];
  sampleRate: number;
  symbolMs?: number;
  toneMs?: number;
  attackMs?: number;
  decayMs?: number;
  sustain?: number;
  releaseMs?: number;
  amplitude?: number;
  noiseSnrDb?: number;
  reverbMs?: number;
  pad?: number;
  backgroundSamples?: Float32Array;
  preamble?: readonly number[];
  ambientPresentation?: boolean;
}

function envelope(timeMs: number, attackMs: number, decayMs: number, sustain: number, toneMs: number, releaseMs: number) {
  if (timeMs < 0) return 0;
  if (timeMs < attackMs) return timeMs / Math.max(attackMs, 0.001);
  if (timeMs < attackMs + decayMs) return 1 - (1 - sustain) * ((timeMs - attackMs) / Math.max(decayMs, 0.001));
  if (timeMs < toneMs) return sustain;
  if (timeMs < toneMs + releaseMs) return sustain * (1 - ((timeMs - toneMs) / Math.max(releaseMs, 0.001)));
  return 0;
}

export function generateTransmission(options: TransmissionOptions) {
  const {
    packet, beacon, carrierBank, carrierFrequencies, sampleRate,
    symbolMs = (beacon ? DEFAULT_BEACON_SYMBOL_MS : SYMBOL_MS),
    toneMs = (beacon ? DEFAULT_BEACON_TONE_MS : TONE_MS),
    attackMs = TRANSMISSION_ENVELOPE.attackMs,
    decayMs = TRANSMISSION_ENVELOPE.decayMs,
    sustain = TRANSMISSION_ENVELOPE.sustain,
    releaseMs = TRANSMISSION_ENVELOPE.releaseMs,
    amplitude = 0.42, noiseSnrDb = Number.POSITIVE_INFINITY,
    reverbMs = 0, pad = 0, backgroundSamples, preamble, ambientPresentation = false,
  } = options;

  let symbols: number[];
  if (beacon) {
    symbols = encodeBeacon(beacon, preamble);
  } else if (packet) {
    symbols = encodePacket(packet);
  } else {
    throw new Error('Either packet or beacon must be provided to generateTransmission');
  }

  const frequencies = carrierBank?.frequencies ?? carrierFrequencies ?? CARRIER_FREQUENCIES;
  const payloadStartMs = ambientPresentation ? AMBIENT_TIMING.introLeadSeconds * 1000 : 0;
  const payloadEndMs = payloadStartMs + symbols.length * symbolMs;
  const resolutionEndMs = ambientPresentation
    ? payloadEndMs + (AMBIENT_TIMING.payloadToResolutionSeconds + AMBIENT_TIMING.resolutionDurationSeconds) * 1000
    : payloadEndMs;
  const tailMs = Math.max(releaseMs, reverbMs) + 100;
  const baseLength = Math.ceil(((resolutionEndMs + tailMs) / 1000) * sampleRate);
  const length = backgroundSamples ? Math.max(baseLength, backgroundSamples.length) : baseLength;
  const dry = new Float32Array(length);
  let seed = 17;
  let phase = 0;
  let previousSymbol = symbols[0];
  const noiseAmplitude = Number.isFinite(noiseSnrDb) ? amplitude / (10 ** (noiseSnrDb / 20)) : 0;

  for (let index = 0; index < length; index += 1) {
    const timeMs = (index / sampleRate) * 1000;
    const payloadTimeMs = timeMs - payloadStartMs;
    const slot = Math.floor(payloadTimeMs / symbolMs);
    const slotTime = payloadTimeMs - slot * symbolMs;
    const symbol = symbols[Math.min(slot, symbols.length - 1)] ?? previousSymbol;
    if (slot < symbols.length) previousSymbol = symbol;
    phase += (2 * Math.PI * frequencies[symbol]) / sampleRate;
    const gain = payloadTimeMs >= 0 && slot < symbols.length ? envelope(slotTime, attackMs, decayMs, sustain, toneMs, releaseMs) : 0;
    const introTime = timeMs - 60;
    const resolutionTime = timeMs - payloadEndMs - AMBIENT_TIMING.payloadToResolutionSeconds * 1000;
    const ambientGain = ambientPresentation
      ? envelope(introTime, 280, 500, .38, AMBIENT_TIMING.introDurationSeconds * 1000, 220) * .035
        + envelope(resolutionTime, 280, 500, .38, AMBIENT_TIMING.resolutionDurationSeconds * 1000, 400) * .04
      : 0;
    const ambientSignal = ambientGain * (
      Math.sin((2 * Math.PI * 130.81 * index) / sampleRate)
      + Math.sin((2 * Math.PI * 164.81 * index) / sampleRate)
      + Math.sin((2 * Math.PI * 196 * index) / sampleRate)
    ) / 3;
    const padSignal = pad * (
      Math.sin((2 * Math.PI * 130.81 * index) / sampleRate)
      + Math.sin((2 * Math.PI * 196 * index) / sampleRate)
      + Math.sin((2 * Math.PI * 293.66 * index) / sampleRate)
    ) / 3;
    seed = (seed * 16807) % 2147483647;
    const noise = (((seed / 2147483647) * 2) - 1) * noiseAmplitude;
    const bg = backgroundSamples && index < backgroundSamples.length ? backgroundSamples[index] : 0;
    dry[index] = amplitude * gain * Math.sin(phase) + ambientSignal + padSignal + noise + bg;
  }

  if (!reverbMs) return dry;
  const wet = new Float32Array(dry);
  const delaySamples = Math.max(1, Math.round(sampleRate * 0.017));
  const decay = Math.exp(-17 / Math.max(reverbMs, 1)) * 0.42;
  for (let index = delaySamples; index < wet.length; index += 1) wet[index] += wet[index - delaySamples] * decay;
  return wet;
}

export function analyzeTransmission(samples: Float32Array, sampleRate: number, phaseOffsetMs = 0): DetectionFrame[] {
  const windowSize = AUDIO_CONFIG.analysisFftSize;
  const hop = Math.max(1, Math.round((AUDIO_CONFIG.analysisIntervalMs / 1000) * sampleRate));
  const frames: DetectionFrame[] = [];
  for (let start = Math.round((phaseOffsetMs / 1000) * sampleRate); start + windowSize <= samples.length; start += hop) {
    const centerMs = ((start + windowSize / 2) / sampleRate) * 1000;
    frames.push(detectFrame(samples.subarray(start, start + windowSize), sampleRate, centerMs));
  }
  return frames;
}

export function analyzeBeaconTransmission(
  samples: Float32Array,
  sampleRate: number,
  phaseOffsetMs = 0,
  carrierBank: CarrierBank = CARRIER_BANK_4_6KHZ,
): Slp2DetectionFrame[] {
  const windowSize = AUDIO_CONFIG.analysisFftSize;
  const hop = Math.max(1, Math.round((AUDIO_CONFIG.analysisIntervalMs / 1000) * sampleRate));
  const frames: Slp2DetectionFrame[] = [];
  for (let start = Math.round((phaseOffsetMs / 1000) * sampleRate); start + windowSize <= samples.length; start += hop) {
    const centerMs = ((start + windowSize / 2) / sampleRate) * 1000;
    frames.push(detectSlp2Frame(samples.subarray(start, start + windowSize), sampleRate, centerMs, { carrierBank }));
  }
  return frames;
}
