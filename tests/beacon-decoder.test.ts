import { describe, expect, it } from 'vitest';
import { BeaconDecoder } from '../src/audio/beacon-decoder';
import type { CarrierSymbol } from '../src/audio/detector';
import {
  BEACON_PROTOCOL_VERSION,
  DEFAULT_BEACON_PREAMBLE,
  DEFAULT_BEACON_SYMBOL_MS,
  type AcousticBeacon,
} from '../src/protocol/beacon-protocol';
import { CARRIER_BANK_4_6KHZ } from '../src/audio/carrier-bank';
import { analyzeBeaconTransmission, generateTransmission, type TransmissionOptions } from './audio-fixtures';

const BASE_BEACON: AcousticBeacon = {
  version: BEACON_PROTOCOL_VERSION,
  contentId: 247,
  sequence: 1,
  flags: 0,
};

function decodeBeaconHelper(options: TransmissionOptions, phase = 0, decoderOptions = {}) {
  const samples = generateTransmission({ ...options, carrierBank: CARRIER_BANK_4_6KHZ });
  const frames = analyzeBeaconTransmission(samples, options.sampleRate, phase, CARRIER_BANK_4_6KHZ);
  const decoder = new BeaconDecoder(decoderOptions);
  let beacon: AcousticBeacon | undefined;
  let error: string | undefined;

  for (const frame of frames) {
    const event = decoder.push(frame);
    if (event.type === 'beacon') beacon = event.beacon;
    if (event.type === 'error') error = event.reason;
  }
  return { beacon, error, diagnostics: decoder.getDiagnostics(), frames };
}

describe('SLP/2 clocked beacon decoder', () => {
  it.each([44100, 48000])('decodes clean continuous beacon at %i Hz across polling phases', sampleRate => {
    for (const phase of [0, 3, 6, 9]) {
      const result = decodeBeaconHelper({ beacon: BASE_BEACON, sampleRate }, phase);
      expect(result.beacon, `rate=${sampleRate}, phase=${phase}, error=${result.error}`).toEqual(BASE_BEACON);
      expect(result.diagnostics.successfulBeacons).toBe(1);
      expect(result.diagnostics.crcFailures).toBe(0);
    }
  });

  it.each([130, 150, 160])('acquires symbol clock at %i ms symbol duration', symbolMs => {
    const beacon: AcousticBeacon = { version: 2, contentId: 1223, sequence: 2, flags: 0 };
    const result = decodeBeaconHelper(
      {
        beacon,
        sampleRate: 48000,
        symbolMs,
        toneMs: symbolMs - 25,
      },
      3,
      { symbolMs },
    );

    expect(result.beacon, `symbolMs=${symbolMs}, error=${result.error}`).toEqual(beacon);
    expect(result.diagnostics.successfulBeacons).toBe(1);
  });

  it('decodes multiple distinct content IDs and sequence numbers', () => {
    const testCases: AcousticBeacon[] = [
      { version: 2, contentId: 42, sequence: 0, flags: 0 },
      { version: 2, contentId: 247, sequence: 1, flags: 1 },
      { version: 2, contentId: 1241, sequence: 2, flags: 0 },
      { version: 2, contentId: 65535, sequence: 3, flags: 2 },
    ];

    for (const b of testCases) {
      const result = decodeBeaconHelper({ beacon: b, sampleRate: 48000 }, 0);
      expect(result.beacon).toEqual(b);
    }
  });

  it('recovers 1-symbol corrupted beacon via Chase soft-decision FEC', () => {
    const beacon: AcousticBeacon = { version: 2, contentId: 247, sequence: 2, flags: 0 };
    const samples = generateTransmission({ beacon, sampleRate: 48000, carrierBank: CARRIER_BANK_4_6KHZ });
    const frames = analyzeBeaconTransmission(samples, 48000, 3, CARRIER_BANK_4_6KHZ);

    const preambleLength = DEFAULT_BEACON_PREAMBLE.length;
    const slot5Center = (preambleLength + 5.5) * DEFAULT_BEACON_SYMBOL_MS;

    for (const frame of frames) {
      if (Math.abs(frame.timestampMs - slot5Center) <= 50) {
        const trueWinner = frame.strongestSymbol;
        const wrong = ((trueWinner + 1) % 4) as CarrierSymbol;
        const peak = frame.energies[trueWinner];
        frame.energies[wrong] = peak * 1.15;
        frame.energies[trueWinner] = peak * 0.85;
        frame.strongestSymbol = wrong;
      }
    }

    const decoder = new BeaconDecoder();
    let decoded: AcousticBeacon | undefined;
    for (const frame of frames) {
      const event = decoder.push(frame);
      if (event.type === 'beacon') decoded = event.beacon;
    }

    expect(decoded).toEqual(beacon);
    expect(decoder.getDiagnostics().repairedBeacons).toBe(1);
  });

  it('recovers 2-symbol corrupted beacon via pairwise Chase soft-decision FEC', () => {
    const beacon: AcousticBeacon = { version: 2, contentId: 888, sequence: 0, flags: 0 };
    const samples = generateTransmission({ beacon, sampleRate: 48000, carrierBank: CARRIER_BANK_4_6KHZ });
    const frames = analyzeBeaconTransmission(samples, 48000, 6, CARRIER_BANK_4_6KHZ);

    const preambleLength = DEFAULT_BEACON_PREAMBLE.length;
    const slot3Center = (preambleLength + 3.5) * DEFAULT_BEACON_SYMBOL_MS;
    const slot8Center = (preambleLength + 8.5) * DEFAULT_BEACON_SYMBOL_MS;

    for (const frame of frames) {
      if (Math.abs(frame.timestampMs - slot3Center) <= 50) {
        const trueWinner = frame.strongestSymbol;
        const wrong = ((trueWinner + 1) % 4) as CarrierSymbol;
        const peak = frame.energies[trueWinner];
        frame.energies[wrong] = peak * 1.25;
        frame.energies[trueWinner] = peak * 0.8;
        frame.strongestSymbol = wrong;
      }
      if (Math.abs(frame.timestampMs - slot8Center) <= 50) {
        const trueWinner = frame.strongestSymbol;
        const wrong = ((trueWinner + 2) % 4) as CarrierSymbol;
        const peak = frame.energies[trueWinner];
        frame.energies[wrong] = peak * 1.25;
        frame.energies[trueWinner] = peak * 0.8;
        frame.strongestSymbol = wrong;
      }
    }

    const decoder = new BeaconDecoder();
    let decoded: AcousticBeacon | undefined;
    for (const frame of frames) {
      const event = decoder.push(frame);
      if (event.type === 'beacon') decoded = event.beacon;
    }

    expect(decoded).toEqual(beacon);
    expect(decoder.getDiagnostics().repairedBeacons).toBe(1);
  });
});
