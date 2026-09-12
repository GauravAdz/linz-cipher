import { SonicEvent, type EditorialProfile, type PlaceRecord } from './types';

const germanProseMarkers = new Set([
  'bezeichnung', 'benannt', 'ehemalig', 'heute', 'zwischen', 'verlaufend',
  'wurde', 'wurden', 'ursprünglich', 'siehe', 'der', 'die', 'das', 'den',
  'dem', 'des', 'und', 'nach', 'von', 'bis', 'für', 'zur', 'zum',
]);

export function appearsToBeGermanProse(value: string) {
  const words = value.toLocaleLowerCase('de').match(/[a-zäöüß]+/g) ?? [];
  let markers = 0;
  for (const word of words) if (germanProseMarkers.has(word)) markers += 1;
  return markers >= 3 || /\b(?:bezeichnung|verlaufend|benannt|ursprünglich)\b/i.test(value);
}

export function englishEditorialFor(
  place: PlaceRecord,
  narrative: { headline: string; story: string },
): EditorialProfile {
  const displayName = place.street.currentName || place.street.name;
  const area = place.raw.KG?.trim();
  const namedYear = place.history.namingStart;
  const historicalName = place.street.historicalName;

  let whyThisName: string;
  if (place.person?.name) {
    whyThisName = `${displayName} carries the name of ${place.person.name}${namedYear ? `, with the naming recorded in ${namedYear}` : ''}. The official City of Linz archive preserves the connection between the person and this place.`;
  } else if (historicalName && displayName !== historicalName) {
    whyThisName = `${historicalName} was an earlier name for this place${place.history.namingPeriod ? ` during ${place.history.namingPeriod}` : ''}. The city record now connects that former name with ${displayName}.`;
  } else if (namedYear) {
    whyThisName = `The City of Linz records this name from ${namedYear}. It has remained part of the city’s official street vocabulary since then.`;
  } else {
    whyThisName = `The City of Linz archive preserves this name and its place in the city’s street history.`;
  }

  const cityContext = area
    ? `The official record places ${displayName} in the ${area} cadastral area of Linz. This civic detail locates the story within the city as well as within its history.`
    : `${displayName} belongs to the official Linz street-name archive, where the city records how its public places acquired their names.`;

  return {
    lede: narrative.story,
    whyThisName,
    cityContext,
    generatedBy: 'structured-fallback',
  };
}

export function englishNarrativeFor(place: PlaceRecord) {
  const historical = place.street.historicalName;
  const current = place.street.currentName;
  const period = place.history.namingPeriod;

  if (historical && current && historical !== current) {
    return {
      headline: 'The name beneath today’s street',
      story: `${period ? `During ${period}, t` : 'T'}his place carried the name ${historical}. It is known today as ${current}, while the earlier name preserves another layer of Linz in the city’s street record.`,
    };
  }

  if (place.source.type === 'historical') {
    return {
      headline: 'A street held in the city’s memory',
      story: `The City of Linz record preserves ${place.street.name} as a historical street name${period ? ` from ${period}` : ''}. The name keeps an earlier layer of the city within reach, even as the place around it has changed.`,
    };
  }

  if (place.person?.name) {
    return {
      headline: 'A person remembered in the city',
      story: `${place.street.name} is named for ${place.person.name}${place.history.namingStart ? `, with the naming recorded in ${place.history.namingStart}` : ''}. The name carries that person into the everyday language and movement of Linz.`,
    };
  }

  if (place.history.namingStart) {
    return {
      headline: 'A name woven into Linz',
      story: `The City of Linz records the name ${place.street.name} from ${place.history.namingStart}. It remains part of the city’s living map: an official name encountered here as sound, place, and memory.`,
    };
  }

  const headline = place.semantic.eventType === SonicEvent.GEOGRAPHIC_REFERENCE
    ? 'A place shaped by its surroundings'
    : 'A name on the living map';
  return {
    headline,
    story: `The City of Linz street-name archive records ${place.street.name} as part of the city’s living map. Here, that official entry becomes a reason to pause, listen, and notice the place around you.`,
  };
}
