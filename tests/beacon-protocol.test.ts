import { describe, expect, it } from 'vitest';
import {
  BEACON_PROTOCOL_VERSION,
  BEACON_PAYLOAD_SYMBOLS,
  DEFAULT_BEACON_PREAMBLE,
  SHORT_BEACON_PREAMBLE,
  beaconBytes,
  beaconToPayloadSymbols,
  encodeBeacon,
  decodeBeaconPayload,
  decodeBeacon,
  type AcousticBeacon,
} from '../src/protocol/beacon-protocol';

describe('SLP/2 beacon protocol', () => {
  it('round-trips encode and decode across various content IDs, sequences, and flags', () => {
    const testCases: AcousticBeacon[] = [
      { version: BEACON_PROTOCOL_VERSION, contentId: 0, sequence: 0, flags: 0 },
      { version: BEACON_PROTOCOL_VERSION, contentId: 1, sequence: 1, flags: 0 },
      { version: BEACON_PROTOCOL_VERSION, contentId: 42, sequence: 2, flags: 1 },
      { version: BEACON_PROTOCOL_VERSION, contentId: 247, sequence: 3, flags: 2 },
      { version: BEACON_PROTOCOL_VERSION, contentId: 1223, sequence: 0, flags: 3 },
      { version: BEACON_PROTOCOL_VERSION, contentId: 32768, sequence: 1, flags: 0 },
      { version: BEACON_PROTOCOL_VERSION, contentId: 65535, sequence: 2, flags: 1 },
    ];

    for (const beacon of testCases) {
      const symbols = encodeBeacon(beacon);
      expect(symbols.length).toBe(DEFAULT_BEACON_PREAMBLE.length + BEACON_PAYLOAD_SYMBOLS);

      const decoded = decodeBeacon(symbols);
      expect(decoded).toEqual(beacon);
    }
  });

  it('cycles through all sequence values (0 -> 1 -> 2 -> 3 -> 0)', () => {
    const baseId = 247;
    for (let seq = 0; seq < 4; seq++) {
      const beacon: AcousticBeacon = {
        version: BEACON_PROTOCOL_VERSION,
        contentId: baseId,
        sequence: seq,
        flags: 0,
      };
      const payloadSymbols = beaconToPayloadSymbols(beacon);
      expect(payloadSymbols.length).toBe(15);
      const decoded = decodeBeaconPayload(payloadSymbols);
      expect(decoded.sequence).toBe(seq);
      expect(decoded.contentId).toBe(baseId);
    }
  });

  it('supports short preamble encoding and decoding', () => {
    const beacon: AcousticBeacon = {
      version: BEACON_PROTOCOL_VERSION,
      contentId: 247,
      sequence: 1,
      flags: 0,
    };
    const symbols = encodeBeacon(beacon, SHORT_BEACON_PREAMBLE);
    expect(symbols.length).toBe(SHORT_BEACON_PREAMBLE.length + BEACON_PAYLOAD_SYMBOLS);

    const decoded = decodeBeacon(symbols, SHORT_BEACON_PREAMBLE.length);
    expect(decoded).toEqual(beacon);
  });

  it('detects and rejects symbol corruptions via CRC-8', () => {
    const beacon: AcousticBeacon = {
      version: BEACON_PROTOCOL_VERSION,
      contentId: 247,
      sequence: 2,
      flags: 0,
    };
    const originalSymbols = beaconToPayloadSymbols(beacon);

    // Test mutating each of the 15 symbols
    for (let i = 0; i < originalSymbols.length; i++) {
      for (let delta = 1; delta <= 3; delta++) {
        const corrupted = [...originalSymbols];
        corrupted[i] = (corrupted[i] + delta) % 4;
        expect(() => decodeBeaconPayload(corrupted)).toThrow(/checksum failed/i);
      }
    }
  });

  it('validates beacon input boundaries', () => {
    expect(() => beaconBytes({ version: 2, contentId: -1, sequence: 0, flags: 0 })).toThrow(/out of range/);
    expect(() => beaconBytes({ version: 2, contentId: 65536, sequence: 0, flags: 0 })).toThrow(/out of range/);
    expect(() => beaconBytes({ version: -1, contentId: 247, sequence: 0, flags: 0 })).toThrow(/out of range/);
    expect(() => beaconBytes({ version: 4, contentId: 247, sequence: 0, flags: 0 })).toThrow(/out of range/);
    expect(() => beaconBytes({ version: 2, contentId: 247, sequence: 4, flags: 0 })).toThrow(/out of range/);
    expect(() => beaconBytes({ version: 2, contentId: 247, sequence: 0, flags: 4 })).toThrow(/out of range/);
  });

  it('rejects invalid symbol streams', () => {
    expect(() => decodeBeaconPayload(new Array(14).fill(0))).toThrow(/Expected 15/);
    expect(() => decodeBeaconPayload(new Array(16).fill(0))).toThrow(/Expected 15/);
    expect(() => decodeBeaconPayload([...new Array(14).fill(0), 4])).toThrow(/Invalid symbol value/);
    expect(() => decodeBeaconPayload([...new Array(14).fill(0), -1])).toThrow(/Invalid symbol value/);
  });
});
