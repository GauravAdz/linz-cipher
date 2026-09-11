import { describe, expect, it } from 'vitest';
import { embedBeacon, BiquadNotchFilter } from '../src/audio/embedder';
import { BeaconDecoder } from '../src/audio/beacon-decoder';
import { BeaconConsensus } from '../src/audio/beacon-consensus';
import { analyzeBeaconTransmission } from './audio-fixtures';
import { encodeWav } from '../src/audio/wav';
import { CARRIER_BANK_4_6KHZ } from '../src/audio/carrier-bank';
import { BEACON_PROTOCOL_VERSION, type AcousticBeacon } from '../src/protocol/beacon-protocol';

function generateSyntheticMusic(durationSeconds: number, sampleRate = 48000): Float32Array {
  const totalSamples = Math.round(durationSeconds * sampleRate);
  const samples = new Float32Array(totalSamples);
  let seed = 12345;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Multi-harmonic musical chords and rhythm (A minor / C major pad)
    const fundamental = 220; // A3
    const chord =
      Math.sin(2 * Math.PI * fundamental * t) * 0.2 +
      Math.sin(2 * Math.PI * (fundamental * 1.2) * t) * 0.15 + // C4
      Math.sin(2 * Math.PI * (fundamental * 1.5) * t) * 0.15 + // E4
      Math.sin(2 * Math.PI * (fundamental * 2.0) * t) * 0.1;   // A4

    // Ambient percussion / broadband hiss
    seed = (seed * 16807) % 2147483647;
    const noise = (((seed / 2147483647) * 2) - 1) * 0.03;

    samples[i] = chord + noise;
  }
  return samples;
}

describe('SLP/2 music embedder & random-start acquisition', () => {
  const sampleRate = 48000;

  it('embeds repeating beacon across track duration', () => {
    const music = generateSyntheticMusic(8, sampleRate); // 8 seconds
    const beacon: AcousticBeacon = { version: BEACON_PROTOCOL_VERSION, contentId: 247, sequence: 0, flags: 0 };

    const result = embedBeacon(music, beacon, { carrierBank: CARRIER_BANK_4_6KHZ, profile: 'BALANCED' });
    expect(result.samples.length).toBe(music.length);
    expect(result.sampleRate).toBe(sampleRate);
    expect(result.repetitions).toBeGreaterThanOrEqual(2); // At 3.15s per beacon, 8s fits ~3 repetitions
  });

  it('notches out carrier frequencies with high attenuation', () => {
    const freq = 4600;
    const notch = new BiquadNotchFilter(freq, sampleRate, 25);
    const numSamples = 2048;
    const tone = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      tone[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sampleRate);
    }

    const filtered = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      filtered[i] = notch.processSample(tone[i]);
    }

    // Measure power of the second half after transient settles
    let inPower = 0;
    let outPower = 0;
    for (let i = 1024; i < numSamples; i++) {
      inPower += tone[i] * tone[i];
      outPower += filtered[i] * filtered[i];
    }

    const attenuationDb = 10 * Math.log10(inPower / Math.max(outPower, 1e-12));
    expect(attenuationDb).toBeGreaterThan(20); // > 20 dB notch rejection
  });

  it('encodes WAV file with correct RIFF headers and PCM layout', () => {
    const mono = new Float32Array([0, 0.5, -0.5, 0.25]);
    const wavBytes = encodeWav(mono, 48000);

    expect(wavBytes.length).toBe(44 + 4 * 2); // 44 byte header + 8 bytes data
    const view = new DataView(wavBytes.buffer);

    // Check RIFF header
    expect(String.fromCharCode(wavBytes[0], wavBytes[1], wavBytes[2], wavBytes[3])).toBe('RIFF');
    expect(String.fromCharCode(wavBytes[8], wavBytes[9], wavBytes[10], wavBytes[11])).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1); // 1 channel
    expect(view.getUint32(24, true)).toBe(48000); // 48000 Hz
    expect(view.getUint16(34, true)).toBe(16); // 16 bits
  });

  it('resolves ID 247 from multiple arbitrary starting offsets in under 5 seconds', () => {
    const trackDuration = 18; // 18 seconds of music
    const music = generateSyntheticMusic(trackDuration, sampleRate);
    const targetBeacon: AcousticBeacon = {
      version: BEACON_PROTOCOL_VERSION,
      contentId: 247,
      sequence: 0,
      flags: 0,
    };

    const embedded = embedBeacon(music, targetBeacon, {
      profile: 'ROBUST',
      carrierBank: CARRIER_BANK_4_6KHZ,
    });

    // Test listener starting at 5 arbitrary offsets
    const startTimesSeconds = [0.0, 1.4, 3.8, 6.2, 8.9];
    let successes = 0;

    for (const startSec of startTimesSeconds) {
      const startSample = Math.round(startSec * sampleRate);
      // Listen for up to 5 seconds
      const listenSamples = Math.round(5.0 * sampleRate);
      const slice = embedded.samples.subarray(startSample, startSample + listenSamples);

      const frames = analyzeBeaconTransmission(slice, sampleRate, 0, CARRIER_BANK_4_6KHZ);
      const decoder = new BeaconDecoder();
      const consensus = new BeaconConsensus({ highConfidenceThreshold: 1.8 });

      let resolvedId: number | null = null;
      let latencyMs = 0;

      for (const frame of frames) {
        const event = decoder.push(frame);
        if (event.type === 'beacon') {
          const beaconConfidence =
            event.slots.reduce((sum, s) => sum + s.confidence, 0) / event.slots.length;
          const wasRepaired = event.slots.some(s => s.repaired);
          const res = consensus.addObservation(event.beacon, beaconConfidence, frame.timestampMs, wasRepaired);
          if (res) {
            resolvedId = res.contentId;
            latencyMs = frame.timestampMs;
            break;
          }
        }
      }

      expect(resolvedId, `start=${startSec}s, latency=${latencyMs}ms`).toBe(247);
      expect(latencyMs).toBeLessThan(5000); // Latency < 5 seconds!
      successes++;
    }

    expect(successes).toBe(startTimesSeconds.length);
  });
});
