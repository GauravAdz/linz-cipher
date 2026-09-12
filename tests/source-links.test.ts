import { describe, expect, it } from 'vitest';
import { canonicalLinzStreetUrl } from '../src/data/source-links';

describe('canonicalLinzStreetUrl', () => {
  it('migrates current records to the Stadtgeschichte index', () => {
    expect(canonicalLinzStreetUrl('920', false)).toBe(
      'https://stadtgeschichte.linz.at/strassennamen/index.php?ID=920&action=strassendetail',
    );
  });

  it('keeps the historical archive context', () => {
    expect(canonicalLinzStreetUrl('2656', true)).toBe(
      'https://stadtgeschichte.linz.at/strassennamen/index.php?ID=2656&action=strassendetail&hist=historisch',
    );
  });

  it('rejects malformed identifiers', () => {
    expect(canonicalLinzStreetUrl('../920', false)).toBeUndefined();
  });
});
