import fs from 'node:fs';
import type { PlaceRecord } from '../src/data/types';

const places = JSON.parse(fs.readFileSync('data/generated/places.json', 'utf8')) as PlaceRecord[];
const scored = places.filter(p => p.source.type === 'historical').map(place => ({
  place,
  score: Number(Boolean(place.street.historicalName)) * 3 + Number(Boolean(place.street.currentName)) * 3 + Number(Boolean(place.history.description)) * 2 + Number(Boolean(place.history.namingPeriod)) * 2 + Math.min(3, Math.floor((place.history.description?.length ?? 0) / 120)),
})).sort((a, b) => b.score - a.score || a.place.sonicId - b.place.sonicId).slice(0, 20);

console.log('TOP 20 DEMO CANDIDATES');
for (const { place, score } of scored) console.log(`${String(place.sonicId).padStart(4, '0')} | ${score} | ${place.street.name} → ${place.street.currentName ?? '—'} | ${place.history.namingPeriod ?? 'period unknown'}`);
