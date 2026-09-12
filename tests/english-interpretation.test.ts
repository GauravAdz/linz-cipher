import { describe, expect, it } from 'vitest';
import interpretationsJson from '../data/generated/interpretations.json';
import placesJson from '../data/generated/places.json';
import { appearsToBeGermanProse, englishNarrativeFor } from '../src/data/english-interpretation';
import type { Interpretation, PlaceRecord } from '../src/data/types';

describe('visitor interpretations', () => {
  it('contains English prose for every generated visitor story', () => {
    const interpretations = interpretationsJson as Interpretation[];
    expect(interpretations).toHaveLength((placesJson as PlaceRecord[]).length);
    for (const interpretation of interpretations) {
      expect(appearsToBeGermanProse(interpretation.headline), `headline for ${interpretation.sonicId}`).toBe(false);
      expect(appearsToBeGermanProse(interpretation.story), `story for ${interpretation.sonicId}`).toBe(false);
      expect(interpretation.editorial, `editorial profile for ${interpretation.sonicId}`).toBeDefined();
      for (const value of [interpretation.editorial!.lede, interpretation.editorial!.whyThisName, interpretation.editorial!.cityContext]) {
        expect(appearsToBeGermanProse(value), `profile prose for ${interpretation.sonicId}`).toBe(false);
      }
    }
  });

  it('explains a historical name change naturally in English', () => {
    const place = (placesJson as PlaceRecord[]).find(item => item.sonicId === 1223);
    expect(place).toBeDefined();
    const narrative = englishNarrativeFor(place!);
    expect(narrative.story).toContain('Flohgaßl');
    expect(narrative.story).toContain('Kollegiumgasse');
    expect(narrative.story).toContain('1786–1869');
    expect(appearsToBeGermanProse(narrative.story)).toBe(false);
  });
});
