import fs from 'node:fs';
import { z } from 'zod';
import { placeRecordSchema, interpretationSchema } from '../src/data/types';

const places = z.array(placeRecordSchema).parse(JSON.parse(fs.readFileSync('data/generated/places.json', 'utf8')));
const interpretations = z.array(interpretationSchema).parse(JSON.parse(fs.readFileSync('data/generated/interpretations.json', 'utf8')));
if (new Set(places.map(p => p.source.canonicalKey)).size !== places.length) throw new Error('Duplicate canonical keys');
if (places.some((p, i) => p.sonicId !== i)) throw new Error('Sonic IDs are not contiguous and deterministic');
if (interpretations.length !== places.length) throw new Error('Interpretation count mismatch');
console.log(`Validated ${places.length} places and ${interpretations.length} interpretations.`);
