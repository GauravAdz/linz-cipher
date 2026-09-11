import { crc8 } from './protocol';

export const BEACON_PROTOCOL_VERSION = 2;
export const BEACON_PAYLOAD_SYMBOLS = 15;
export const DEFAULT_BEACON_PREAMBLE = [0, 3, 1, 2] as const;
export const EXTENDED_BEACON_PREAMBLE = [0, 3, 0, 3, 1, 2] as const;
export const SHORT_BEACON_PREAMBLE = [0, 3, 1, 2] as const;

export const DEFAULT_BEACON_SYMBOL_MS = 130;
export const DEFAULT_BEACON_TONE_MS = 105;

export interface AcousticBeacon {
  version: number;   // 2 bits: 0..3 (typically 2 for SLP/2)
  contentId: number; // 16 bits: 0..65535
  sequence: number;  // 2 bits: 0..3 (cycles 0->1->2->3->0...)
  flags: number;     // 2 bits: 0..3 (0: normal, 1: extended metadata, 2: alt carrier bank, 3: reserved)
}

export { crc8 };

/**
 * Packs a beacon's 22-bit payload into 3 data bytes (with 2 zero padding bits)
 * followed by 1 byte CRC-8. Returns 4 bytes in total.
 */
export function beaconBytes(beacon: AcousticBeacon): number[] {
  if (beacon.contentId < 0 || beacon.contentId > 65535) {
    throw new Error(`contentId out of range: ${beacon.contentId}`);
  }
  if (beacon.version < 0 || beacon.version > 3) {
    throw new Error(`version out of range (2 bits): ${beacon.version}`);
  }
  if (beacon.sequence < 0 || beacon.sequence > 3) {
    throw new Error(`sequence out of range (2 bits): ${beacon.sequence}`);
  }
  if (beacon.flags < 0 || beacon.flags > 3) {
    throw new Error(`flags out of range (2 bits): ${beacon.flags}`);
  }

  const byte0 = ((beacon.version & 0x03) << 6) | ((beacon.contentId >> 10) & 0x3f);
  const byte1 = (beacon.contentId >> 2) & 0xff;
  const byte2 = ((beacon.contentId & 0x03) << 6) | ((beacon.sequence & 0x03) << 4) | ((beacon.flags & 0x03) << 2);
  const data = [byte0, byte1, byte2];
  const checksum = crc8(data);
  return [...data, checksum];
}

/**
 * Converts a beacon to 15 quaternary payload symbols (2 bits per symbol).
 * Symbol 0: version (2 bits)
 * Symbols 1..8: contentId (16 bits)
 * Symbol 9: sequence (2 bits)
 * Symbol 10: flags (2 bits)
 * Symbols 11..14: CRC-8 (8 bits)
 */
export function beaconToPayloadSymbols(beacon: AcousticBeacon): number[] {
  const bytes = beaconBytes(beacon);
  const symbols: number[] = [
    beacon.version & 0x03,
    (beacon.contentId >> 14) & 0x03,
    (beacon.contentId >> 12) & 0x03,
    (beacon.contentId >> 10) & 0x03,
    (beacon.contentId >> 8) & 0x03,
    (beacon.contentId >> 6) & 0x03,
    (beacon.contentId >> 4) & 0x03,
    (beacon.contentId >> 2) & 0x03,
    beacon.contentId & 0x03,
    beacon.sequence & 0x03,
    beacon.flags & 0x03,
    // CRC-8 byte unpacked into 4 symbols
    (bytes[3] >> 6) & 0x03,
    (bytes[3] >> 4) & 0x03,
    (bytes[3] >> 2) & 0x03,
    bytes[3] & 0x03,
  ];
  return symbols;
}

/**
 * Encodes a beacon with a preamble for acoustic transmission.
 */
export function encodeBeacon(
  beacon: AcousticBeacon,
  preamble: readonly number[] = DEFAULT_BEACON_PREAMBLE,
): number[] {
  return [...preamble, ...beaconToPayloadSymbols(beacon)];
}

/**
 * Decodes 15 quaternary payload symbols into an AcousticBeacon.
 * Validates the embedded CRC-8 checksum.
 */
export function decodeBeaconPayload(symbols: readonly number[]): AcousticBeacon {
  if (symbols.length !== BEACON_PAYLOAD_SYMBOLS) {
    throw new Error(`Expected ${BEACON_PAYLOAD_SYMBOLS} beacon payload symbols, got ${symbols.length}`);
  }

  for (let i = 0; i < symbols.length; i++) {
    if (symbols[i] < 0 || symbols[i] > 3 || !Number.isInteger(symbols[i])) {
      throw new Error(`Invalid symbol value at index ${i}: ${symbols[i]}`);
    }
  }

  const byte0 = (symbols[0] << 6) | (symbols[1] << 4) | (symbols[2] << 2) | symbols[3];
  const byte1 = (symbols[4] << 6) | (symbols[5] << 4) | (symbols[6] << 2) | symbols[7];
  const byte2 = (symbols[8] << 6) | (symbols[9] << 4) | (symbols[10] << 2);
  const expectedCrc = (symbols[11] << 6) | (symbols[12] << 4) | (symbols[13] << 2) | symbols[14];

  const actualCrc = crc8([byte0, byte1, byte2]);
  if (actualCrc !== expectedCrc) {
    throw new Error('Beacon checksum failed');
  }

  const version = symbols[0];
  const contentId =
    (symbols[1] << 14) |
    (symbols[2] << 12) |
    (symbols[3] << 10) |
    (symbols[4] << 8) |
    (symbols[5] << 6) |
    (symbols[6] << 4) |
    (symbols[7] << 2) |
    symbols[8];
  const sequence = symbols[9];
  const flags = symbols[10];

  return { version, contentId, sequence, flags };
}

/**
 * Decodes a full symbol stream including preamble.
 */
export function decodeBeacon(
  symbols: readonly number[],
  preambleLength: number = DEFAULT_BEACON_PREAMBLE.length,
): AcousticBeacon {
  if (symbols.length !== preambleLength + BEACON_PAYLOAD_SYMBOLS) {
    throw new Error(`Expected ${preambleLength + BEACON_PAYLOAD_SYMBOLS} total symbols, got ${symbols.length}`);
  }
  return decodeBeaconPayload(symbols.slice(preambleLength));
}
