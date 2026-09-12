import { canonicalLinzStreetUrl } from './source-links';
import { publicPlaceSchema, type Interpretation, type PlaceRecord, type PublicPlace } from './types';

export function buildPublicStories(places: PlaceRecord[], interpretations: Interpretation[]): PublicPlace[] {
  const interpretationById = new Map(interpretations.map(item => [item.sonicId, item]));

  return places.map(place => {
    const interpretation = interpretationById.get(place.sonicId);
    if (!interpretation) throw new Error(`Missing interpretation for Sonic ID ${place.sonicId}`);

    return publicPlaceSchema.parse({
      sonicId: place.sonicId,
      eventType: place.semantic.eventType,
      sourceType: place.source.type,
      sourceId: place.source.sourceId,
      streetName: place.street.name,
      historicalName: place.street.historicalName,
      currentName: place.street.currentName,
      cadastralMunicipality: place.raw.KG?.trim() || undefined,
      namingYear: place.history.namingStart,
      removalYear: place.history.namingEnd,
      namingPeriod: place.history.namingPeriod,
      sourceLink: canonicalLinzStreetUrl(place.source.sourceId, place.source.type === 'historical'),
      person: place.person?.name ? place.person : undefined,
      interpretation,
    });
  });
}
