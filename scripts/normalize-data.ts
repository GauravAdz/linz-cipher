import fs from 'node:fs';
import Papa from 'papaparse';
import { SonicEvent, SonicMood, placeRecordSchema, interpretationSchema, publicPlaceSchema, type PlaceRecord, type Interpretation, type PublicPlace } from '../src/data/types';
import { englishNarrativeFor } from '../src/data/english-interpretation';

type Raw = Record<string, string>;

function read(path: string): Raw[] {
  const parsed = Papa.parse<Raw>(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(JSON.stringify(parsed.errors));
  return parsed.data;
}

function clean(value?: string) { return value?.trim() || undefined; }
function moodFor(event: SonicEvent) {
  if (event === SonicEvent.NAME_CHANGED || event === SonicEvent.HISTORICAL_NAME) return SonicMood.REFLECTIVE;
  if (event === SonicEvent.COMMEMORATION) return SonicMood.WARM;
  return SonicMood.NEUTRAL;
}

const current = read('data/raw/current.csv').map(raw => ({ sourceType: 'current' as const, raw }));
const historical = read('data/raw/historical.csv').map(raw => ({ sourceType: 'historical' as const, raw }));
const rows = [...current, ...historical].sort((a, b) => `${a.sourceType}:${a.raw.ID}`.localeCompare(`${b.sourceType}:${b.raw.ID}`));

const places: PlaceRecord[] = rows.map(({ sourceType, raw }, sonicId) => {
  const historicalName = sourceType === 'historical' ? clean(raw.Name) : undefined;
  const currentName = sourceType === 'historical' ? clean(raw['Aktuelle Straße']) : clean(raw.Name);
  const personName = clean(raw['Benannt nach']);
  let eventType = SonicEvent.UNKNOWN;
  if (sourceType === 'historical' && historicalName && currentName && historicalName !== currentName) eventType = SonicEvent.NAME_CHANGED;
  else if (sourceType === 'historical') eventType = SonicEvent.HISTORICAL_NAME;
  else if (personName) eventType = SonicEvent.NAMED_AFTER_PERSON;
  else if (/Gedenk|Erinnerung|gewidmet/i.test(raw.Beschreibung ?? '')) eventType = SonicEvent.COMMEMORATION;
  else if (/Berg|Tal|Donau|Bach|Fluss|See/i.test(raw.Beschreibung ?? '')) eventType = SonicEvent.GEOGRAPHIC_REFERENCE;
  else if (/Ort|Gemeinde|Stadt|Land/i.test(raw.Beschreibung ?? '')) eventType = SonicEvent.PLACE_REFERENCE;

  const namingStart = clean(raw['Jahr der Benennung']);
  const namingEnd = clean(raw['Jahr der Löschung']);
  return placeRecordSchema.parse({
    sonicId,
    source: { type: sourceType, sourceId: raw.ID, canonicalKey: `${sourceType}:${raw.ID}` },
    street: { name: raw.Name, historicalName, currentName },
    history: { namingStart, namingEnd, namingPeriod: namingStart ? `${namingStart}${namingEnd ? `–${namingEnd}` : ''}` : undefined, description: clean(raw.Beschreibung) },
    person: personName ? { name: personName, wikidataId: clean(raw['Wikidata Person ID'] ?? raw.Wikidata) } : undefined,
    semantic: { eventType, mood: moodFor(eventType) },
    raw,
  });
});

function fraction(id: number, salt: number) { return (((id + 1) * salt) % 89) / 88; }
const interpretations: Interpretation[] = places.map(place => interpretationSchema.parse({
  sonicId: place.sonicId,
  ...englishNarrativeFor(place),
  music: {
    tempo: 55 + Math.round(fraction(place.sonicId, 17) * 55),
    brightness: Number(fraction(place.sonicId, 29).toFixed(2)),
    density: Number((.2 + fraction(place.sonicId, 11) * .55).toFixed(2)),
    tension: Number((place.semantic.eventType === SonicEvent.NAME_CHANGED ? .55 : fraction(place.sonicId, 7) * .45).toFixed(2)),
    warmth: Number((.35 + fraction(place.sonicId, 31) * .55).toFixed(2)),
    rhythmicActivity: Number((.15 + fraction(place.sonicId, 13) * .55).toFixed(2)),
    texture: place.semantic.eventType === SonicEvent.NAME_CHANGED ? 'ambient' : place.person ? 'pulse' : 'flowing',
  },
}));

const publicStories: PublicPlace[] = places.map((place, index) => publicPlaceSchema.parse({
  sonicId: place.sonicId,
  eventType: place.semantic.eventType,
  streetName: place.street.name,
  historicalName: place.street.historicalName,
  currentName: place.street.currentName,
  namingPeriod: place.history.namingPeriod,
  sourceLink: place.raw.Link,
  interpretation: interpretations[index],
}));

fs.mkdirSync('data/generated', { recursive: true });
fs.writeFileSync('data/generated/places.json', JSON.stringify(places));
fs.writeFileSync('data/generated/interpretations.json', JSON.stringify(interpretations));
fs.writeFileSync('data/generated/public-stories.json', JSON.stringify(publicStories));
fs.writeFileSync('data/generated/manifest.json', JSON.stringify({ protocol: 'SLP/1', generatedAt: new Date().toISOString(), records: places.length, sources: { current: current.length, historical: historical.length } }, null, 2));
console.log(`Generated ${places.length} stable Sonic Records (${current.length} current, ${historical.length} historical).`);
