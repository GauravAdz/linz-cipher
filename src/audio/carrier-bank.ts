import { CARRIER_FREQUENCIES, CARRIER_NOTES } from '../protocol/protocol';

export interface CarrierBank {
  id: string;
  name: string;
  frequencies: [number, number, number, number];
  deltaHz: number;
  description: string;
  notes?: [string, string, string, string];
}

export const CARRIER_BANK_SLP1: CarrierBank = {
  id: 'slp1-musical',
  name: 'SLP/1 Musical (500–1000 Hz)',
  frequencies: [...CARRIER_FREQUENCIES],
  deltaHz: 45,
  description: 'Original SLP/1 musical note carriers (C5, Eb5, G5, Bb5). Overlaps vocal and instrumental fundamentals.',
  notes: [...CARRIER_NOTES],
};

export const CARRIER_BANK_2_4KHZ: CarrierBank = {
  id: 'slp2-2-4khz',
  name: 'SLP/2 Mid-Treble (2.4–3.5 kHz)',
  frequencies: [2400, 2750, 3100, 3450],
  deltaHz: 100,
  description: 'Strong speaker and microphone sensitivity. Pierces low-end noise but can be perceived as gentle whistling.',
};

export const CARRIER_BANK_4_6KHZ: CarrierBank = {
  id: 'slp2-4-6khz',
  name: 'SLP/2 High-Treble (4.2–5.4 kHz)',
  frequencies: [4200, 4600, 5000, 5400],
  deltaHz: 120,
  description: 'Recommended default. Above most musical fundamentals; high phone transducer sensitivity and low audibility.',
};

export const CARRIER_BANK_6_8KHZ: CarrierBank = {
  id: 'slp2-6-8khz',
  name: 'SLP/2 Air-Band (6.2–7.4 kHz)',
  frequencies: [6200, 6600, 7000, 7400],
  deltaHz: 150,
  description: 'Near-inaudible in dense music, but subject to room air absorption over longer distances.',
};

export const CARRIER_BANK_8_10KHZ: CarrierBank = {
  id: 'slp2-8-10khz',
  name: 'SLP/2 High-Air (8.2–9.4 kHz)',
  frequencies: [8200, 8600, 9000, 9400],
  deltaHz: 150,
  description: 'Very subtle audibility; requires high-frequency response from playback and recording hardware.',
};

export const DEFAULT_SLP2_CARRIER_BANK = CARRIER_BANK_4_6KHZ;

export const ALL_CARRIER_BANKS: readonly CarrierBank[] = [
  CARRIER_BANK_4_6KHZ,
  CARRIER_BANK_2_4KHZ,
  CARRIER_BANK_6_8KHZ,
  CARRIER_BANK_8_10KHZ,
  CARRIER_BANK_SLP1,
];

export function getCarrierBank(idOrName?: string): CarrierBank {
  if (!idOrName) return DEFAULT_SLP2_CARRIER_BANK;
  const found = ALL_CARRIER_BANKS.find(
    b => b.id.toLowerCase() === idOrName.toLowerCase() || b.name.toLowerCase().includes(idOrName.toLowerCase())
  );
  return found ?? DEFAULT_SLP2_CARRIER_BANK;
}
