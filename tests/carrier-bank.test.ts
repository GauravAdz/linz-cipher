import { describe, expect, it } from 'vitest';
import {
  createHarmonicCarrierBank,
  getCarrierBank,
  CARRIER_BANK_4_6KHZ,
} from '../src/audio/carrier-bank';

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
