import fs from 'node:fs';
import { z } from 'zod';
import { placeRecordSchema, interpretationSchema, publicPlaceSchema } from '../src/data/types';
import { appearsToBeGermanProse } from '../src/data/english-interpretation';

const places = z.array(placeRecordSchema).parse(JSON.parse(fs.readFileSync('data/generated/places.json', 'utf8')));
const interpretations = z.array(interpretationSchema).parse(JSON.parse(fs.readFileSync('data/generated/interpretations.json', 'utf8')));
const publicStories = z.array(publicPlaceSchema).parse(JSON.parse(fs.readFileSync('data/generated/public-stories.json', 'utf8')));
if (new Set(places.map(p => p.source.canonicalKey)).size !== places.length) throw new Error('Duplicate canonical keys');
if (places.some((p, i) => p.sonicId !== i)) throw new Error('Sonic IDs are not contiguous and deterministic');
if (interpretations.length !== places.length) throw new Error('Interpretation count mismatch');
if (publicStories.length !== places.length) throw new Error('Public story count mismatch');
const nonEnglish = interpretations.filter(item => appearsToBeGermanProse(item.headline) || appearsToBeGermanProse(item.story));
if (nonEnglish.length) throw new Error(`Found ${nonEnglish.length} likely non-English interpretations. First Sonic ID: ${nonEnglish[0].sonicId}`);
console.log(`Validated ${places.length} places and ${interpretations.length} interpretations.`);
