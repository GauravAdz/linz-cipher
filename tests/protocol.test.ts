import { describe, expect, it } from 'vitest';
import { SonicEvent, SonicMood } from '../src/data/types';
import { bytesToSymbols, crc8, decodePayload, packetBytes } from '../src/protocol/protocol';

describe('SLP/1', () => {
  it('round-trips every dataset-range id', () => {
    for (let sonicId = 0; sonicId < 1580; sonicId++) {
      const packet = { version: 1, sonicId, eventType: SonicEvent.NAME_CHANGED, mood: SonicMood.REFLECTIVE };
      expect(decodePayload(bytesToSymbols(packetBytes(packet)))).toEqual(packet);
    }
  });
  it('rejects one changed symbol', () => {
    const symbols = bytesToSymbols(packetBytes({ version: 1, sonicId: 42, eventType: SonicEvent.NAME_CHANGED, mood: SonicMood.REFLECTIVE }));
    symbols[8] = (symbols[8] + 1) % 4;
    expect(() => decodePayload(symbols)).toThrow('Checksum failed');
  });
  it('uses CRC-8 polynomial 0x07', () => expect(crc8([0x11, 0, 42, 0x10])).toBe(0x2d));
});
