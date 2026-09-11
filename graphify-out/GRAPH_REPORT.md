# Graph Report - linz-cipher  (2026-09-11)

## Corpus Check
- 33 files · ~183,718 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 245 nodes · 325 edges · 23 communities (17 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Build Tooling
- Audio User Flow
- Data Pipeline
- TypeScript Compiler
- Packet Protocol
- Project Scripts
- Product Concepts
- Runtime Dependencies
- TypeScript Sources
- Data Manifest
- App Metadata
- Cloudflare Runtime
- ESLint Configuration
- Next Configuration
- Next Type Declarations
- Brand Favicon
- Vercel Configuration

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `scripts` - 12 edges
3. `SonicEvent` - 8 edges
4. `SonicMood` - 7 edges
5. `include` - 7 edges
6. `detectFrame()` - 6 edges
7. `transmit()` - 6 edges
8. `Interpretation` - 6 edges
9. `CARRIER_FREQUENCIES` - 6 edges
10. `encodePacket()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `The City Speaks in Music` --conceptually_related_to--> `SONIC LINZ`  [INFERRED]
  public/og.png → README.md
- `Circular Audio Transmission Motif` --conceptually_related_to--> `SLP/1 Protocol`  [INFERRED]
  public/og.png → README.md
- `Transmit()` --calls--> `transmit()`  [EXTRACTED]
  app/page.tsx → src/audio/transmitter.ts
- `AudioDebug()` --calls--> `transmit()`  [EXTRACTED]
  app/debug/audio/page.tsx → src/audio/transmitter.ts
- `transmit()` --calls--> `encodePacket()`  [EXTRACTED]
  src/audio/transmitter.ts → src/protocol/protocol.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **SONIC LINZ Transmission Flow** — readme_stable_sonic_ids, readme_40_bit_packet, readme_four_carrier_note_encoding, readme_audio_receiver_pipeline [EXTRACTED 1.00]
- **Deterministic Record Resolution Boundary** — readme_deterministic_data_pipeline, readme_deterministic_interpretation_boundary, readme_mistral_preprocessing, readme_source_grounded_fallback_interpretations [EXTRACTED 1.00]

## Communities (23 total, 6 thin omitted)

### Community 0 - "Build Tooling"
Cohesion: 0.04
Nodes (47): @cloudflare/vite-plugin, @cloudflare/workers-types, eslint, eslint-config-next, nitro, @openai/sites-vite-plugin, devDependencies, @cloudflare/vite-plugin (+39 more)

### Community 1 - "Audio User Flow"
Cohesion: 0.09
Nodes (23): AudioDebug(), playCarrier(), testInterpretation, eventNames, featuredIds, interpretationById, interpretations, Listen() (+15 more)

### Community 2 - "Data Pipeline"
Cohesion: 0.11
Nodes (21): places, scored, byId, existing, limitFlag, musicShape, places, clean() (+13 more)

### Community 3 - "TypeScript Compiler"
Cohesion: 0.09
Nodes (22): @cloudflare/workers-types, dom, dom.iterable, esnext, node, compilerOptions, allowJs, esModuleInterop (+14 more)

### Community 4 - "Packet Protocol"
Cohesion: 0.22
Nodes (13): SonicEvent, SonicMood, bytesToSymbols(), crc8(), decodePayload(), encodePacket(), packetBytes(), PacketStreamDecoder (+5 more)

### Community 5 - "Project Scripts"
Cohesion: 0.11
Nodes (18): engines, node, name, private, scripts, build, data:curate, data:inspect (+10 more)

### Community 6 - "Product Concepts"
Cohesion: 0.12
Nodes (17): Circular Audio Transmission Motif, The City Speaks in Music, SONIC LINZ Open Graph Artwork, 40-bit Sonic Packet, Audio Receiver Pipeline, City of Linz Open Data Street Catalogue, Deterministic Data Pipeline, Deterministic Interpretation Boundary (+9 more)

### Community 7 - "Runtime Dependencies"
Cohesion: 0.15
Nodes (13): next, dependencies, next, papaparse, react, react-dom, tone, zod (+5 more)

### Community 8 - "TypeScript Sources"
Cohesion: 0.20
Nodes (9): **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx, exclude (+1 more)

### Community 9 - "Data Manifest"
Cohesion: 0.29
Nodes (6): generatedAt, protocol, records, sources, current, historical

### Community 10 - "App Metadata"
Cohesion: 0.40
Nodes (3): geistMono, geistSans, metadata

## Knowledge Gaps
- **111 isolated node(s):** `testInterpretation`, `geistSans`, `geistMono`, `metadata`, `places` (+106 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Build Tooling` to `Project Scripts`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Runtime Dependencies` to `Project Scripts`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `testInterpretation`, `geistSans`, `geistMono` to the rest of the system?**
  _111 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Build Tooling` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `Audio User Flow` be split into smaller, more focused modules?**
  _Cohesion score 0.09176788124156546 - nodes in this community are weakly interconnected._
- **Should `Data Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.10541310541310542 - nodes in this community are weakly interconnected._
- **Should `TypeScript Compiler` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._