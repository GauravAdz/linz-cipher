import { z } from 'zod';

export enum SonicEvent {
  UNKNOWN = 0,
  NAME_CHANGED = 1,
  HISTORICAL_NAME = 2,
  NAMED_AFTER_PERSON = 3,
  PLACE_REFERENCE = 4,
  GEOGRAPHIC_REFERENCE = 5,
  COMMEMORATION = 6,
}

export enum SonicMood {
  NEUTRAL = 0,
  REFLECTIVE = 1,
  WARM = 2,
  DARK = 3,
  TENSE = 4,
  HOPEFUL = 5,
}

export const placeRecordSchema = z.object({
  sonicId: z.number().int().min(0).max(65535),
  source: z.object({ type: z.enum(['current', 'historical']), sourceId: z.string(), canonicalKey: z.string() }),
  street: z.object({ name: z.string(), historicalName: z.string().optional(), currentName: z.string().optional() }),
  history: z.object({ namingStart: z.string().optional(), namingEnd: z.string().optional(), namingPeriod: z.string().optional(), description: z.string().optional() }),
  person: z.object({
    name: z.string().optional(),
    wikidataId: z.string().optional(),
    occupation: z.string().optional(),
    birthDate: z.string().optional(),
    deathDate: z.string().optional(),
  }).optional(),
  semantic: z.object({ eventType: z.nativeEnum(SonicEvent), mood: z.nativeEnum(SonicMood) }),
  raw: z.record(z.string(), z.string()),
});

export type PlaceRecord = z.infer<typeof placeRecordSchema>;

export const editorialProfileSchema = z.object({
  lede: z.string().min(1),
  whyThisName: z.string().min(1),
  cityContext: z.string().min(1),
  generatedBy: z.enum(['mistral', 'structured-fallback']),
  generatedAt: z.string().optional(),
});

export type EditorialProfile = z.infer<typeof editorialProfileSchema>;

export const interpretationSchema = z.object({
  sonicId: z.number().int().min(0),
  headline: z.string().min(1),
  story: z.string().min(1),
  editorial: editorialProfileSchema.optional(),
  music: z.object({
    tempo: z.number().min(55).max(110),
    brightness: z.number().min(0).max(1),
    density: z.number().min(0).max(1),
    tension: z.number().min(0).max(1),
    warmth: z.number().min(0).max(1),
    rhythmicActivity: z.number().min(0).max(1),
    texture: z.enum(['ambient', 'pulse', 'drone', 'fragmented', 'flowing']),
  }),
});

export type Interpretation = z.infer<typeof interpretationSchema>;

export const publicPlaceSchema = z.object({
  sonicId: z.number().int().min(0).max(65535),
  eventType: z.nativeEnum(SonicEvent),
  sourceType: z.enum(['current', 'historical']),
  sourceId: z.string(),
  streetName: z.string(),
  historicalName: z.string().optional(),
  currentName: z.string().optional(),
  cadastralMunicipality: z.string().optional(),
  namingYear: z.string().optional(),
  removalYear: z.string().optional(),
  namingPeriod: z.string().optional(),
  sourceLink: z.string().optional(),
  person: z.object({
    name: z.string(),
    wikidataId: z.string().optional(),
    occupation: z.string().optional(),
    birthDate: z.string().optional(),
    deathDate: z.string().optional(),
  }).optional(),
  interpretation: interpretationSchema,
});

export type PublicPlace = z.infer<typeof publicPlaceSchema>;
