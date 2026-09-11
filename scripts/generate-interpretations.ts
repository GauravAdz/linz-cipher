import fs from 'node:fs';
import { z } from 'zod';
import { interpretationSchema, type Interpretation, type PlaceRecord } from '../src/data/types';
import { appearsToBeGermanProse } from '../src/data/english-interpretation';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error('Set OPENROUTER_API_KEY before running interpretation preprocessing. The live app never needs it.');
const limitFlag = process.argv.find(arg => arg.startsWith('--limit='));
const limit = limitFlag ? Number(limitFlag.split('=')[1]) : Number.POSITIVE_INFINITY;
const places = (JSON.parse(fs.readFileSync('data/generated/places.json', 'utf8')) as PlaceRecord[]).slice(0, limit);
const existing = JSON.parse(fs.readFileSync('data/generated/interpretations.json', 'utf8')) as Interpretation[];
const byId = new Map(existing.map(item => [item.sonicId, item]));
const musicShape = {
  type: 'object', additionalProperties: false,
  properties: {
    headline: { type: 'string' }, story: { type: 'string' },
    music: { type: 'object', additionalProperties: false, properties: {
      tempo: { type: 'number', minimum: 55, maximum: 110 }, brightness: { type: 'number', minimum: 0, maximum: 1 }, density: { type: 'number', minimum: 0, maximum: 1 }, tension: { type: 'number', minimum: 0, maximum: 1 }, warmth: { type: 'number', minimum: 0, maximum: 1 }, rhythmicActivity: { type: 'number', minimum: 0, maximum: 1 }, texture: { type: 'string', enum: ['ambient', 'pulse', 'drone', 'fragmented', 'flowing'] },
    }, required: ['tempo', 'brightness', 'density', 'tension', 'warmth', 'rhythmicActivity', 'texture'] },
  }, required: ['headline', 'story', 'music'],
};

for (const [index, place] of places.entries()) {
  const facts = { street: place.street, history: place.history, person: place.person, semanticEvent: place.semantic.eventType };
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
    model: 'mistralai/mistral-medium-3-5', temperature: .55,
    response_format: { type: 'json_schema', json_schema: { name: 'sonic_linz_interpretation', strict: true, schema: musicShape } },
    messages: [{ role: 'system', content: 'Use only information explicitly contained in the supplied City of Linz record. Do not invent dates, people, events, motivations, or historical context. Write the headline and story entirely in concise, natural English; retain German only inside authentic street names and proper nouns. Never copy or lightly paraphrase the German source text. Your role is artistic interpretation, not historical research.' }, { role: 'user', content: JSON.stringify(facts) }],
  }) });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${await response.text()}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error(`No content for Sonic ID ${place.sonicId}`);
  const parsed = z.object({ headline: z.string(), story: z.string(), music: interpretationSchema.shape.music }).parse(JSON.parse(content));
  if (appearsToBeGermanProse(parsed.headline) || appearsToBeGermanProse(parsed.story)) {
    throw new Error(`Non-English interpretation returned for Sonic ID ${place.sonicId}; generation stopped before mixed-language data was saved.`);
  }
  byId.set(place.sonicId, interpretationSchema.parse({ sonicId: place.sonicId, ...parsed }));
  fs.writeFileSync('data/generated/interpretations.json', JSON.stringify([...byId.values()].sort((a, b) => a.sonicId - b.sonicId)));
  console.log(`[${index + 1}/${places.length}] ${place.sonicId} ${place.street.name}`);
}
