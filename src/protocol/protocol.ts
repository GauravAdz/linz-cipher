import { SonicEvent, SonicMood } from '../data/types';

export const PROTOCOL_VERSION = 1;
export const CARRIER_FREQUENCIES = [523.25, 622.25, 783.99, 932.33] as const;
export const CARRIER_NOTES = ['C5', 'Eb5', 'G5', 'Bb5'] as const;
export const PREAMBLE = [0, 3, 0, 3, 1, 2] as const;
export const SYMBOL_MS = 220;
export const TONE_MS = 180;

export interface SonicPacket { version: number; eventType: SonicEvent; sonicId: number; mood: SonicMood; }

export function crc8(bytes: readonly number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

export function packetBytes(packet: SonicPacket): number[] {
  if (packet.sonicId < 0 || packet.sonicId > 65535) throw new Error('sonicId out of range');
  const data = [
    ((packet.version & 0xf) << 4) | (packet.eventType & 0xf),
    (packet.sonicId >> 8) & 0xff,
    packet.sonicId & 0xff,
    (packet.mood & 0xf) << 4,
  ];
  return [...data, crc8(data)];
}

export function bytesToSymbols(bytes: readonly number[]): number[] {
  return bytes.flatMap(byte => [(byte >> 6) & 3, (byte >> 4) & 3, (byte >> 2) & 3, byte & 3]);
}

export function symbolsToBytes(symbols: readonly number[]): number[] {
  if (symbols.length % 4) throw new Error('Invalid symbol count');
  const bytes: number[] = [];
  for (let i = 0; i < symbols.length; i += 4) bytes.push((symbols[i] << 6) | (symbols[i + 1] << 4) | (symbols[i + 2] << 2) | symbols[i + 3]);
  return bytes;
}

export function encodePacket(packet: SonicPacket): number[] { return [...PREAMBLE, ...bytesToSymbols(packetBytes(packet))]; }

export function decodePayload(symbols: readonly number[]): SonicPacket {
  if (symbols.length !== 20) throw new Error('Expected 20 payload symbols');
  const bytes = symbolsToBytes(symbols);
  if (crc8(bytes.slice(0, 4)) !== bytes[4]) throw new Error('Checksum failed');
  const version = bytes[0] >> 4;
  const eventType = bytes[0] & 0xf;
  const mood = bytes[3] >> 4;
  if (version !== PROTOCOL_VERSION) throw new Error('Unsupported protocol');
  if (eventType > SonicEvent.COMMEMORATION || mood > SonicMood.HOPEFUL) throw new Error('Invalid semantic field');
  return { version, eventType, sonicId: (bytes[1] << 8) | bytes[2], mood };
}

export class PacketStreamDecoder {
  private window: number[] = [];
  private payload: number[] | null = null;
  push(symbol: number): { locked?: boolean; packet?: SonicPacket; error?: string } {
    if (this.payload) {
      this.payload.push(symbol);
      if (this.payload.length < 20) return {};
      try { const packet = decodePayload(this.payload); this.reset(); return { packet }; }
      catch (error) { const message = error instanceof Error ? error.message : 'Invalid packet'; this.reset(); return { error: message }; }
    }
    this.window.push(symbol);
    if (this.window.length > PREAMBLE.length) this.window.shift();
    if (this.window.length === PREAMBLE.length && this.window.every((value, i) => value === PREAMBLE[i])) { this.payload = []; return { locked: true }; }
    return {};
  }
  reset() { this.window = []; this.payload = null; }
}
