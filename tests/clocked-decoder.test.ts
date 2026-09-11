import { describe, expect, it } from 'vitest';
import { ClockedPacketDecoder } from '../src/audio/clocked-decoder';
import { SymbolStateMachine } from '../src/audio/detector';
import { PacketStreamDecoder, encodePacket, type SonicPacket } from '../src/protocol/protocol';
import { SonicEvent, SonicMood } from '../src/data/types';
import { analyzeTransmission, generateTransmission, type TransmissionOptions } from './audio-fixtures';

const BASE_PACKET: SonicPacket = { version: 1, sonicId: 247, eventType: SonicEvent.NAME_CHANGED, mood: SonicMood.REFLECTIVE };

function packetFor(index: number): SonicPacket {
  return {
    version: 1,
    sonicId: (index * 977 + 31) % 65536,
    eventType: (index % 7) as SonicEvent,
    mood: (Math.floor(index / 7) % 6) as SonicMood,
  };
}

function decode(options: TransmissionOptions, phase = 0) {
  const frames = analyzeTransmission(generateTransmission(options), options.sampleRate, phase);
  const decoder = new ClockedPacketDecoder();
  let packet: SonicPacket | undefined;
  let error: string | undefined;
  for (const frame of frames) {
    const event = decoder.push(frame);
    if (event.type === 'packet') packet = event.packet;
    if (event.type === 'error') error = event.reason;
  }
  return { packet, error, diagnostics: decoder.getDiagnostics(), frames };
}

describe('clocked acoustic decoder', () => {
  it('reproduces the old silence-framing failure on continuous transmitter PCM', () => {
    const frames = analyzeTransmission(generateTransmission({ packet: BASE_PACKET, sampleRate: 48000, pad: 0.04 }), 48000, 3);
    const state = new SymbolStateMachine();
    const packetDecoder = new PacketStreamDecoder();
    let packet;
    let emitted = 0;
    for (const frame of frames) {
      const symbol = state.push(frame.detectedSymbol);
      if (symbol !== null) {
        emitted += 1;
        packet = packetDecoder.push(symbol).packet ?? packet;
      }
    }
    expect(emitted).toBeLessThan(encodePacket(BASE_PACKET).length);
    expect(packet).toBeUndefined();
  });

  it.each([44100, 48000])('decodes continuous PCM at %i Hz across polling phases', sampleRate => {
    for (const phase of [0, 3, 6, 9]) {
      const result = decode({ packet: BASE_PACKET, sampleRate }, phase);
      expect(result.packet, `phase=${phase}, error=${result.error}`).toEqual(BASE_PACKET);
    }
  }, 30_000);

  it('decodes adjacent repeated carriers without null frames', () => {
    const packets: SonicPacket[] = [
      { version: 1, sonicId: 0, eventType: SonicEvent.UNKNOWN, mood: SonicMood.NEUTRAL },
      { version: 1, sonicId: 0, eventType: SonicEvent.GEOGRAPHIC_REFERENCE, mood: SonicMood.NEUTRAL },
      { version: 1, sonicId: 0, eventType: SonicEvent.HISTORICAL_NAME, mood: SonicMood.WARM },
      { version: 1, sonicId: 0, eventType: SonicEvent.PLACE_REFERENCE, mood: SonicMood.NEUTRAL },
    ];
    packets.forEach((packet, repeatedSymbol) => {
      const payload = encodePacket(packet).slice(6);
      expect(payload.some((symbol, index) => index > 1 && symbol === repeatedSymbol && payload[index - 1] === symbol && payload[index - 2] === symbol)).toBe(true);
      expect(decode({ packet, sampleRate: 48000, toneMs: 220, releaseMs: 30 }, 6).packet).toEqual(packet);
    });
  });

  it.each([30, 20, 15])('decodes deterministic broadband noise at %i dB SNR', noiseSnrDb => {
    expect(decode({ packet: BASE_PACKET, sampleRate: 48000, noiseSnrDb }, 9).packet).toEqual(BASE_PACKET);
  }, 30_000);

  it.each([50, 100, 150])('decodes deterministic room tails of %i ms', reverbMs => {
    expect(decode({ packet: BASE_PACKET, sampleRate: 44100, reverbMs }, 3).packet).toEqual(BASE_PACKET);
  }, 30_000);

  it.each([200, 210, 220, 230, 240])('acquires an actual %i ms symbol clock', symbolMs => {
    const result = decode({
      packet: BASE_PACKET,
      sampleRate: 48000,
      symbolMs,
      toneMs: Math.min(180, symbolMs - 20),
    }, 6);
    expect(result.packet).toEqual(BASE_PACKET);
    expect(result.diagnostics.successfulPackets).toBe(1);
  });

  it('decodes 504 clean continuous-PCM packets across sample rates and polling phases', () => {
    let attempts = 0;
    for (const sampleRate of [44100, 48000]) {
      for (const phase of [0, 3, 6, 9]) {
        for (let index = 0; index < 63; index += 1) {
          const packet = packetFor(index);
          const result = decode({ packet, sampleRate }, phase);
          expect(result.packet, `rate=${sampleRate}, phase=${phase}, packet=${index}, error=${result.error}`).toEqual(packet);
          attempts += 1;
        }
      }
    }
    expect(attempts).toBe(504);
  }, 120_000);

  it('maintains at least 95% success at the declared noise and reverb limits', () => {
    const conditions = [
      { label: '15 dB SNR', options: { noiseSnrDb: 15 } },
      { label: '150 ms room tail', options: { reverbMs: 150 } },
    ] as const;
    for (const condition of conditions) {
      let successes = 0;
      const attempts = 50;
      for (let index = 0; index < attempts; index += 1) {
        const packet = packetFor(index + 100);
        const sampleRate = index % 2 ? 44100 : 48000;
        const phase = [0, 3, 6, 9][index % 4];
        const result = decode({ packet, sampleRate, ...condition.options }, phase);
        if (
          result.packet?.version === packet.version
          && result.packet.sonicId === packet.sonicId
          && result.packet.eventType === packet.eventType
          && result.packet.mood === packet.mood
        ) successes += 1;
      }
      expect(successes / attempts, condition.label).toBeGreaterThanOrEqual(0.95);
    }
  }, 120_000);
});
