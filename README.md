# LinzSings

**Linz city has something to sing to you.** LinzSings is a mobile-first web experience that hides an official City of Linz street-record ID inside music. One device uses the public street transmitter to play the transmission; another listens through its microphone, validates the signal, and reveals the matching English-language place story.

Audio analysis happens entirely in the browser. Nothing is recorded or uploaded, and the live experience does not need an API or network request after its data bundle has loaded.

## Live demo

You can try LinzSings online without cloning or installing this repository:

- [Open the public listening experience](https://linz-cipher.vercel.app)
- [Open the public street transmitter](https://linz-cipher.vercel.app/internal/transmit)

To test the complete system, open the listening experience on one device and the transmitter on another, then follow the walkthrough below.

## How it works

1. A visitor taps **Listen to the city** and grants microphone access.
2. An installation device plays ambient music containing a deterministic acoustic packet.
3. The listener detects four carrier frequencies, finds the packet clock and preamble, checks its CRC, and resolves the decoded Sonic ID locally.
4. The app opens the matching story, naming history, person details, and official City of Linz source link.

The visitor experience deliberately hides the protocol details. The transmitter is public so anyone can demonstrate the complete project with two devices, while the detailed receiver laboratory remains a development-only tool.

## Try the complete system

The easiest test uses two phones, tablets, or laptops: one with a speaker and one with a microphone. The receiving page must be served over HTTPS (or `localhost`) so the browser can request microphone access.

1. On the **receiving device**, open the [public experience](https://linz-cipher.vercel.app), tap **Listen to the city**, then **Start listening**, and allow microphone access.
2. On the **transmitting device**, open the [street transmitter](https://linz-cipher.vercel.app/internal/transmit).
3. Search for a street record and select it. Place the transmitting speaker about 20 cm from the receiving microphone and set the speaker to a comfortable, clearly audible volume.
4. Tap **Play ambient transmission on loop**. Each loop plays a short musical introduction, the encoded SLP/1 packet, and a musical resolution.
5. Allow 10–20 seconds for one or two complete loops. After the receiver finds the preamble and verifies the CRC, it should open the English story for the selected street.
6. Tap **Stop** on the transmitter when finished.

For the cleanest first test, use a quiet room, keep the devices off the same table to reduce vibration, and avoid headphones. If decoding does not succeed, move the devices closer, adjust the transmitter volume, reload the receiver, and grant microphone access again. Browser echo cancellation can make a same-device or same-laptop test unreliable, so two physical devices are strongly recommended.

## Quick start

Requirements: Node.js **22.13 or newer**, npm, and a recent browser. Microphone access works on `localhost`; physical-device testing requires HTTPS.

```bash
npm install
npm run data:normalize
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

No environment variables are required for normal development. The generated dataset and conservative English interpretations are committed to the repository.

## Application routes

| Route | Purpose | Availability |
| --- | --- | --- |
| `/` | Public introduction, listening, and story discovery flow | Development and production |
| `/debug/audio` | Carrier playback, microphone levels, decoder state, and packet diagnostics | Development only |
| `/internal/transmit` | Search a street record and play its SLP/1 transmission continuously | Development and production |

The `/debug/audio` diagnostic route returns `404` in production. The public transmitter is intentionally not linked from the visitor interface; open it directly or use the link above.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the vinext development server |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest unit and integration suite |
| `npm run test:e2e` | Run the mobile Playwright tests against a server on port 3000 |
| `npm run data:inspect` | Print raw CSV headers and record counts |
| `npm run data:normalize` | Rebuild all deterministic JSON bundles |
| `npm run data:validate` | Validate schemas, IDs, language, and interpretation coverage |
| `npm run data:curate` | Rank 20 strong historical demonstration records |
| `npm run interpretations:generate -- --limit=20` | Regenerate a limited set of editorial stories with Mistral |

For end-to-end tests, start `npm run dev` in another terminal first. If Playwright's browser is missing, run `npx playwright install chromium` once.

## Data pipeline

The raw CSV files come from the [City of Linz Open Data street catalogue](https://data.linz.gv.at/katalog/stadt/strassen/):

- `data/raw/current.csv` contains current street names.
- `data/raw/historical.csv` contains historical street names.

`npm run data:normalize` cleans and combines both sources, preserves every original field, sorts records by `sourceType:sourceId`, assigns contiguous deterministic Sonic IDs, classifies each record's event and mood, and writes:

- `data/generated/places.json` — full normalized records used by developer tools.
- `data/generated/interpretations.json` — English stories and musical parameters.
- `data/generated/public-stories.json` — browser-safe records used by the public experience.
- `data/generated/manifest.json` — generation time, source counts, and protocol version.

The current bundle contains **1,575 records**: 1,211 current and 364 historical. Run normalization and validation whenever either raw CSV changes.

### Optional Mistral editorial generation

The checked-in fallback copy is deterministic and works offline. To regenerate source-grounded editorial text, set either a direct Mistral key or an OpenRouter key in `.env.local`:

```bash
MISTRAL_API_KEY=... npm run interpretations:generate -- --limit=20
# or
OPENROUTER_API_KEY=... npm run interpretations:generate -- --ids=12,42,1223
```

`MISTRAL_MODEL` can override the default model. Responses are schema-validated, checked for likely mixed-language output, and saved after every record. These keys are used only by the preprocessing script and are never exposed to the live app. Do not commit `.env.local`.

## Acoustic protocol

### SLP/1 — live application protocol

SLP/1 encodes a record as a five-byte, 40-bit packet:

| Field | Bits |
| --- | ---: |
| Version | 4 |
| Event type | 4 |
| Sonic ID | 16 |
| Mood | 4 |
| Reserved | 4 |
| CRC-8, polynomial `0x07` | 8 |

Four musical carriers encode two bits per symbol: C5 (`00`), E♭5 (`01`), G5 (`10`), and B♭5 (`11`). A six-symbol preamble (`00 11 00 11 01 10`) precedes 20 payload symbols. Each 220 ms slot contains a 180 ms tone and a 40 ms gap, so the encoded section lasts about **5.72 seconds**. Ambient material plays only before and after that compatibility-critical section.

The receiver uses the Web Audio API, Goertzel energy measurements, clock and phase acquisition, rolling preamble search, payload validation, soft-decision recovery for limited symbol corruption, and CRC verification. A packet is accepted only when its Sonic ID and event type match the local public dataset.

### SLP/2 — experimental beacon components

The repository also contains tested SLP/2 building blocks: a shorter 22-bit beacon payload plus CRC, sequence and flag fields, high-frequency and key-aware carrier banks, narrowband contrast detection, soft-decision recovery, and multi-packet consensus. SLP/2 is currently an experimental path under `src/protocol/beacon-protocol.ts` and the related audio modules; the public transmitter and receiver still use SLP/1.

## Project structure

```text
app/                    Next.js App Router UI and developer routes
data/raw/               Source CSV files
data/generated/         Deterministic application data bundles
scripts/                Inspection, normalization, validation, curation, and AI preprocessing
src/audio/              Web Audio transmitters, detectors, decoders, and carrier banks
src/data/               Schemas, source links, fallback copy, and public-data shaping
src/protocol/           SLP/1 packet and experimental SLP/2 beacon formats
tests/                  Vitest coverage and Playwright mobile flows
PRODUCT.md              Product goals and visitor constraints
DESIGN.md               Visual-system guidance
FULL_APP_AUDIT.md       Detailed implementation and reliability audit
```

The main stack is Next.js 16 with React 19, TypeScript, vinext/Vite, Tone.js, Zod, Vitest, and Playwright. Styling lives in `app/globals.css`.

## Verification

Run the full local quality check before deploying or testing on phones:

```bash
npm run lint
npm test
npm run data:validate
npm run build
```

The suite covers packet round-trips, CRC rejection, carrier detection, clock drift, noisy and reverberant synthetic audio, limited corruption recovery, SLP/2 beacon behavior, source links, English copy, continuous transmission, and the 320–430 px visitor flow.

## Local physical-device test

1. Run the project locally, then expose it through an HTTPS development URL or deploy a preview. A plain LAN URL such as `http://192.168.x.x:3000` will not provide microphone access in most browsers.
2. Open the same HTTPS origin on two phones.
3. On the receiving phone, tap **Listen to the city** and allow microphone access.
4. On the transmitting phone, open `/internal/transmit`, choose a record, and start playback.
5. Begin about 20 cm apart in a quiet room, then test at 50 cm and 1 m with realistic background noise.
6. In a local development build, use `/debug/audio` to inspect levels, carrier confidence, clock lock, payload slots, and CRC results.

Synthetic tests cannot certify a particular phone, speaker, case, browser, or room. A real speaker-to-microphone pass is required before a live installation.

## Deployment

`npm run build` produces the deployment artifact. The Vite configuration selects the Sites/Cloudflare adapter locally and the Nitro adapter when `VERCEL=1`; `vercel.ts` supplies the Vercel build command. Keep microphone-facing deployments on HTTPS, confirm that `/internal/transmit` is reachable in production, and confirm that `/debug/audio` remains unavailable.
