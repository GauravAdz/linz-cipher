import { AUDIO_CONFIG } from '../src/audio/config';
import { detectFrame, type DetectionFrame } from '../src/audio/detector';
import { CARRIER_FREQUENCIES, SYMBOL_MS, TONE_MS, encodePacket, type SonicPacket } from '../src/protocol/protocol';

export interface TransmissionOptions {
  packet: SonicPacket;
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
    packet, sampleRate, symbolMs = SYMBOL_MS, toneMs = TONE_MS, attackMs = 6, decayMs = 20,
    sustain = 0.9, releaseMs = 25, amplitude = 0.42, noiseSnrDb = Number.POSITIVE_INFINITY,
    reverbMs = 0, pad = 0,
  } = options;
  const symbols = encodePacket(packet);
  const tailMs = Math.max(releaseMs, reverbMs) + 100;
  const length = Math.ceil(((symbols.length * symbolMs + tailMs) / 1000) * sampleRate);
  const dry = new Float32Array(length);
  let seed = 17;
  let phase = 0;
  let previousSymbol = symbols[0];
  const noiseAmplitude = Number.isFinite(noiseSnrDb) ? amplitude / (10 ** (noiseSnrDb / 20)) : 0;

  for (let index = 0; index < length; index += 1) {
    const timeMs = (index / sampleRate) * 1000;
    const slot = Math.floor(timeMs / symbolMs);
    const slotTime = timeMs - slot * symbolMs;
    const symbol = symbols[Math.min(slot, symbols.length - 1)] ?? previousSymbol;
    if (slot < symbols.length) previousSymbol = symbol;
    phase += (2 * Math.PI * CARRIER_FREQUENCIES[symbol]) / sampleRate;
    const gain = slot < symbols.length ? envelope(slotTime, attackMs, decayMs, sustain, toneMs, releaseMs) : 0;
    const padSignal = pad * (
      Math.sin((2 * Math.PI * 130.81 * index) / sampleRate)
      + Math.sin((2 * Math.PI * 196 * index) / sampleRate)
      + Math.sin((2 * Math.PI * 293.66 * index) / sampleRate)
    ) / 3;
    seed = (seed * 16807) % 2147483647;
    const noise = (((seed / 2147483647) * 2) - 1) * noiseAmplitude;
    dry[index] = amplitude * gain * Math.sin(phase) + padSignal + noise;
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

