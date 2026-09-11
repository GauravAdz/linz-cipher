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

export const NOTE_SEMITONES: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function midiToFrequency(midi: number): number {
  return Math.round(440 * Math.pow(2, (midi - 69) / 12) * 10) / 10;
}

function midiToNoteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/**
 * Creates a carrier bank musically tuned to consonant scale degrees in the song's key.
 * Places carriers in Octaves 7/8 (3.0 kHz – 7.0 kHz) so they sound like harmonic overtones
 * or glockenspiel/shimmer sparkle rather than dissonant beeps.
 */
export function createHarmonicCarrierBank(
  key = 'C',
  mode: 'major' | 'minor' = 'major',
): CarrierBank {
  const cleanKey = key.trim().toUpperCase();
  const rootOffset = NOTE_SEMITONES[cleanKey] ?? 0;

  // Scale degrees: Major [Root, 2nd, 3rd, 5th], Minor [Root, 3rd, 4th, 5th]
  const intervals = mode === 'minor' ? [0, 3, 5, 7] : [0, 2, 4, 7];

  // Base note in octave 8 (C8 = MIDI 108 = 4186 Hz)
  let baseMidi = 108 + rootOffset;
  // If too high (> 7 kHz), drop down an octave into 2.6k - 4.2k sweet spot
  if (baseMidi > 111) baseMidi -= 12;

  const frequencies = intervals.map(semitone =>
    midiToFrequency(baseMidi + semitone),
  ) as [number, number, number, number];

  const notes = intervals.map(semitone =>
    midiToNoteName(baseMidi + semitone),
  ) as [string, string, string, string];

  // Delta for surrounding energy: ~25% of smallest interval
  const minIntervalHz = Math.min(
    frequencies[1] - frequencies[0],
    frequencies[2] - frequencies[1],
    frequencies[3] - frequencies[2],
  );
  const deltaHz = Math.max(90, Math.min(150, Math.round(minIntervalHz * 0.28)));

  const keyLabel = `${key} ${mode === 'minor' ? 'Minor' : 'Major'}`;

  return {
    id: `harmonic-${cleanKey.toLowerCase()}-${mode}`,
    name: `Harmonic ${keyLabel} (${notes.join('·')})`,
    frequencies,
    notes,
    deltaHz,
    description: `Musically tuned to ${keyLabel}. Carriers sit on consonant scale degrees (${notes.join(', ')}) blending as natural sparkle.`,
  };
}

export const CARRIER_BANK_KEY_C = createHarmonicCarrierBank('C', 'major');
export const CARRIER_BANK_KEY_G = createHarmonicCarrierBank('G', 'major');
export const CARRIER_BANK_KEY_D = createHarmonicCarrierBank('D', 'major');
export const CARRIER_BANK_KEY_A = createHarmonicCarrierBank('A', 'minor');
export const CARRIER_BANK_KEY_F = createHarmonicCarrierBank('F', 'major');

export const DEFAULT_SLP2_CARRIER_BANK = CARRIER_BANK_4_6KHZ;

export const ALL_CARRIER_BANKS: readonly CarrierBank[] = [
  CARRIER_BANK_4_6KHZ,
  CARRIER_BANK_KEY_C,
  CARRIER_BANK_KEY_G,
  CARRIER_BANK_KEY_A,
  CARRIER_BANK_KEY_D,
  CARRIER_BANK_KEY_F,
  CARRIER_BANK_2_4KHZ,
  CARRIER_BANK_6_8KHZ,
  CARRIER_BANK_8_10KHZ,
  CARRIER_BANK_SLP1,
];

export function getCarrierBank(idOrName?: string): CarrierBank {
  if (!idOrName) return DEFAULT_SLP2_CARRIER_BANK;

  // Check if it matches existing pre-configured bank
  const found = ALL_CARRIER_BANKS.find(
    b =>
      b.id.toLowerCase() === idOrName.toLowerCase() ||
      b.name.toLowerCase().includes(idOrName.toLowerCase()),
  );
  if (found) return found;

  // Check if idOrName specifies a key like "harmonic-d-major" or "Key A Minor"
  const harmonicIdMatch = idOrName.match(/^harmonic-([a-g][#b]?)(?:-(minor|major))?$/i);
  if (harmonicIdMatch) {
    const key = harmonicIdMatch[1];
    const mode = harmonicIdMatch[2]?.toLowerCase() === 'minor' ? 'minor' : 'major';
    return createHarmonicCarrierBank(key, mode);
  }

  const keyNameMatch = idOrName.match(/(?:^|\b)(?:key\s+)?([A-Ga-g][#b]?)\s+(minor|major)\b/i);
  if (keyNameMatch) {
    const key = keyNameMatch[1];
    const mode = keyNameMatch[2]?.toLowerCase() === 'minor' ? 'minor' : 'major';
    return createHarmonicCarrierBank(key, mode);
  }

  return DEFAULT_SLP2_CARRIER_BANK;
}
