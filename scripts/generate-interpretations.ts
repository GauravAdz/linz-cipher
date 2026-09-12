import fs from 'node:fs';
import { z } from 'zod';
import { appearsToBeGermanProse } from '../src/data/english-interpretation';
import { buildPublicStories } from '../src/data/public-stories';
import { interpretationSchema, type Interpretation, type PlaceRecord } from '../src/data/types';

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');

const mistralApiKey = process.env.MISTRAL_API_KEY;
const openRouterApiKey = process.env.OPENROUTER_API_KEY;
if (!mistralApiKey && !openRouterApiKey) {
  throw new Error('Set MISTRAL_API_KEY for the direct Mistral API, or OPENROUTER_API_KEY for the Mistral fallback. The public app never receives either key.');
}

const directMistral = Boolean(mistralApiKey);
const endpoint = directMistral
  ? 'https://api.mistral.ai/v1/chat/completions'
  : 'https://openrouter.ai/api/v1/chat/completions';
const apiKey = mistralApiKey ?? openRouterApiKey;
const model = process.env.MISTRAL_MODEL ?? (directMistral ? 'mistral-large-latest' : 'mistralai/mistral-medium-3-5');

const limitFlag = process.argv.find(arg => arg.startsWith('--limit='));
const idsFlag = process.argv.find(arg => arg.startsWith('--ids='));
const limit = limitFlag ? Number(limitFlag.split('=')[1]) : Number.POSITIVE_INFINITY;
const requestedIds = idsFlag
  ? new Set(idsFlag.split('=')[1].split(',').map(value => Number(value.trim())))
  : undefined;

const allPlaces = JSON.parse(fs.readFileSync('data/generated/places.json', 'utf8')) as PlaceRecord[];
const places = allPlaces
  .filter(place => !requestedIds || requestedIds.has(place.sonicId))
  .slice(0, limit);
const existing = JSON.parse(fs.readFileSync('data/generated/interpretations.json', 'utf8')) as Interpretation[];
const byId = new Map(existing.map(item => [item.sonicId, item]));

const editorialResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    story: { type: 'string' },
    editorial: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lede: { type: 'string' },
        whyThisName: { type: 'string' },
        cityContext: { type: 'string' },
      },
      required: ['lede', 'whyThisName', 'cityContext'],
    },
  },
  required: ['headline', 'story', 'editorial'],
};

const generatedResponseSchema = z.object({
  headline: z.string().min(1),
  story: z.string().min(1),
  editorial: z.object({
    lede: z.string().min(1),
    whyThisName: z.string().min(1),
    cityContext: z.string().min(1),
  }),
});

function writeOutputs() {
  const interpretations = [...byId.values()].sort((a, b) => a.sonicId - b.sonicId);
  fs.writeFileSync('data/generated/interpretations.json', JSON.stringify(interpretations));
  fs.writeFileSync('data/generated/public-stories.json', JSON.stringify(buildPublicStories(allPlaces, interpretations)));
}

for (const [index, place] of places.entries()) {
  const current = byId.get(place.sonicId);
  if (!current) throw new Error(`No base interpretation for Sonic ID ${place.sonicId}`);

  const facts = {
    street: place.street,
    sourceType: place.source.type,
    cadastralMunicipality: place.raw.KG || undefined,
    namingPeriod: place.history.namingPeriod,
    officialGermanDescription: place.history.description,
    namesake: place.person,
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(directMistral ? {} : { 'HTTP-Referer': 'https://sonic-linz.clear-guppy-9870.chatgpt.site', 'X-Title': 'Sonic Linz' }),
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 900,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'sonic_linz_place_profile',
          strict: true,
          schema: editorialResponseSchema,
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are the English editorial voice of Sonic Linz, a public cultural installation.',
            'Use only facts explicitly present in the supplied City of Linz record. Translate faithfully, but do not mention that you are translating.',
            'Never invent geography, architecture, dates, people, motives, atmosphere, or historical context. If the record is sparse, be concise instead of filling gaps.',
            'Every sentence must be directly supportable from the supplied fields. Do not address the reader, describe what they can see or hear, or claim that music, memory, legacy, or an atmosphere exists at the place.',
            'Do not turn a nickname into a literal condition: explain only the documented reason for it.',
            '“Named after” does not prove an intention to honour, celebrate, commemorate, or preserve a legacy; use the neutral phrase “named after” unless the record states a motive.',
            'Do not say a street ran past, connected, bordered, or occupied something unless the physical route is explicitly stated in the official description.',
            'Write entirely in natural English, retaining German only for authentic street names, place names, and proper nouns.',
            'The headline is 3–8 words. The story is a compact interpretation of 35–70 words.',
            'The editorial lede is an elegant 35–65 word factual opening that rewards curiosity without scenic invention.',
            'whyThisName explains the documented origin in 45–90 words. cityContext describes only the documented physical route, cadastral area, or change over time in 35–80 words.',
            'Avoid tourism clichés, generic praise, protocol language, and Wikipedia-style lead sentences.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`${directMistral ? 'Mistral' : 'OpenRouter'} ${response.status}: ${await response.text()}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error(`No content for Sonic ID ${place.sonicId}`);
  const parsed = generatedResponseSchema.parse(JSON.parse(content));
  const englishFields = [parsed.headline, parsed.story, parsed.editorial.lede, parsed.editorial.whyThisName, parsed.editorial.cityContext];
  if (englishFields.some(appearsToBeGermanProse)) {
    throw new Error(`Non-English interpretation returned for Sonic ID ${place.sonicId}; generation stopped before mixed-language data was saved.`);
  }

  byId.set(place.sonicId, interpretationSchema.parse({
    ...current,
    headline: parsed.headline,
    story: parsed.story,
    editorial: {
      ...parsed.editorial,
      generatedBy: 'mistral',
      generatedAt: new Date().toISOString(),
    },
  }));
  writeOutputs();
  console.log(`[${index + 1}/${places.length}] ${place.sonicId} ${place.street.name} · ${directMistral ? 'Mistral API' : 'Mistral via OpenRouter'}`);
}
