import { describe, expect, it } from 'vitest';
import {
  createHarmonicCarrierBank,
  getCarrierBank,
  CARRIER_BANK_KEY_C,
  CARRIER_BANK_4_6KHZ,
} from '../src/audio/carrier-bank';
import { bpmToSymbolTiming, embedBeacon } from '../src/audio/embedder';
import { BeaconDecoder } from '../src/audio/beacon-decoder';
import { BeaconConsensus } from '../src/audio/beacon-consensus';
import { analyzeBeaconTransmission } from './audio-fixtures';
import { BEACON_PROTOCOL_VERSION, type AcousticBeacon } from '../src/protocol/beacon-protocol';

describe('Harmonic Carrier Banks & Musical Key Tuning', () => {
  it('generates C major harmonic carrier bank with consonant scale degrees', () => {
    const bank = createHarmonicCarrierBank('C', 'major');
    expect(bank.id).toBe('harmonic-c-major');
    expect(bank.frequencies.length).toBe(4);
    expect(bank.notes?.length).toBe(4);

    // C8 = 4186 Hz, D8 = 4698.6 Hz, E8 = 5274 Hz, G8 = 6271.9 Hz
    expect(bank.notes).toEqual(['C8', 'D8', 'E8', 'G8']);
    expect(bank.frequencies[0]).toBeCloseTo(4186, 0);
    expect(bank.frequencies[1]).toBeCloseTo(4698.6, 0);
    expect(bank.frequencies[2]).toBeCloseTo(5274, 0);
    expect(bank.frequencies[3]).toBeCloseTo(6271.9, 0);

    // Strict ascending order
    for (let i = 0; i < 3; i++) {
      expect(bank.frequencies[i + 1]).toBeGreaterThan(bank.frequencies[i]);
    }
  });

  it('generates A minor harmonic bank with octave transposition for high keys', () => {
    const aMin = createHarmonicCarrierBank('A', 'minor');
    expect(aMin.notes?.length).toBe(4);
    // A offset = 9 semitones, 108 + 9 = 117 > 111, so octave shifted down to MIDI 105
    // Consonant intervals [0, 3, 5, 7]
    expect(aMin.notes?.[0]).toBe('A7');
    expect(aMin.notes?.[1]).toBe('C8');
    expect(aMin.notes?.[2]).toBe('D8');
    expect(aMin.notes?.[3]).toBe('E8');

    // Frequencies remain within 3.5k - 6k sweet spot
    for (const freq of aMin.frequencies) {
      expect(freq).toBeGreaterThan(3000);
      expect(freq).toBeLessThan(6000);
    }
  });

  it('resolves carrier banks by dynamic id string', () => {
    const bankG = getCarrierBank('harmonic-g-major');
    expect(bankG.name).toContain('G Major');

    const bankA = getCarrierBank('Key A Minor');
    expect(bankA.name).toContain('A Minor');

    const fallback = getCarrierBank('unknown-bank-id');
    expect(fallback.id).toBe(CARRIER_BANK_4_6KHZ.id);
  });
});

describe('BPM Beat Quantization & Percussive Camouflage', () => {
  it('quantizes 120 BPM to 125ms 1/16th note symbol slots', () => {
    const timing = bpmToSymbolTiming(120);
    expect(timing.bpm).toBe(120);
    expect(timing.symbolMs).toBe(125); // 15000 / 120 = 125
    expect(timing.subdivision).toBe('1/16');
    expect(timing.toneMs).toBe(Math.round(125 * 0.82));
  });

  it('quantizes 100 BPM to 150ms 1/16th note symbol slots', () => {
    const timing = bpmToSymbolTiming(100);
    expect(timing.symbolMs).toBe(150); // 15000 / 100 = 150
    expect(timing.subdivision).toBe('1/16');
  });

  it('handles moderate electronic tempos (128 BPM = ~117ms)', () => {
    const timing = bpmToSymbolTiming(128);
    expect(timing.symbolMs).toBe(117);
    expect(timing.subdivision).toBe('1/16');
  });

  it('end-to-end decodes beacon embedded with BPM sync and percussive envelope', () => {
    const sampleRate = 48000;
    const duration = 12; // 12 seconds
    const totalSamples = duration * sampleRate;
    const syntheticMusic = new Float32Array(totalSamples);

    // Synthetic acoustic track with 120 BPM kick/hi-hat groove and chord
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const kickEnv = Math.max(0, Math.exp(-((t % 0.5) * 15))); // Kick on every beat (0.5s = 120 BPM)
      const kick = Math.sin(2 * Math.PI * 60 * t) * kickEnv * 0.4;
      const chord = Math.sin(2 * Math.PI * 261.63 * t) * 0.15; // C4
      syntheticMusic[i] = kick + chord;
    }

    const beacon: AcousticBeacon = {
      version: BEACON_PROTOCOL_VERSION,
      contentId: 512,
      sequence: 0,
      flags: 0,
    };

    // Embed with BPM=120, C Major harmonic bank, and Percussive Hi-Hat envelope
    const embedded = embedBeacon(syntheticMusic, beacon, {
      bpm: 120,
      carrierBank: CARRIER_BANK_KEY_C,
      envelopeMode: 'PERCUSSIVE',
      profile: 'ROBUST',
    });

    expect(embedded.repetitions).toBeGreaterThanOrEqual(3);

    // Simulate receiver listening from an arbitrary offset (e.g. at 1.8s)
    const startSample = Math.round(1.8 * sampleRate);
    const listenWindow = Math.round(5.0 * sampleRate);
    const slice = embedded.samples.subarray(startSample, startSample + listenWindow);

    const frames = analyzeBeaconTransmission(slice, sampleRate, 0, CARRIER_BANK_KEY_C);
    const decoder = new BeaconDecoder();
    const consensus = new BeaconConsensus({ highConfidenceThreshold: 1.6 });

    let decodedId: number | null = null;
    for (const frame of frames) {
      const event = decoder.push(frame);
      if (event.type === 'beacon') {
        const beaconConf =
          event.slots.reduce((acc, s) => acc + s.confidence, 0) / event.slots.length;
        const res = consensus.addObservation(event.beacon, beaconConf, frame.timestampMs);
        if (res) {
          decodedId = res.contentId;
          break;
        }
      }
    }

    expect(decodedId).toBe(512);
  });
});
