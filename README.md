# LinzSings

**Linz city has something to sing to you.** LinzSings is a mobile-first, offline-ready web experience that turns official Linz street-name records into musical transmissions. A transmitter plays an expressive composition with a deterministic data melody; a second device hears the melody through its microphone, validates its checksum, and reveals the exact source record.

## Start

```bash
npm install
npm run data:normalize
npm run dev
```

Open `http://localhost:3000`. The audio diagnostic screen is at `/debug/audio`.

## Data pipeline

The checked-in raw CSVs come from the [City of Linz Open Data street catalogue](https://data.linz.gv.at/katalog/stadt/strassen/):

- `Strassennamen-aktuell.csv` → `data/raw/current.csv`
- `Strassennamen-historisch.csv` → `data/raw/historical.csv`

`npm run data:inspect` reports exact headers and record counts. `npm run data:normalize` preserves every raw field, sorts `sourceType:originalDatasetId` lexicographically, assigns contiguous stable Sonic IDs, classifies semantic events with deterministic code, and writes the offline bundles in `data/generated`. `npm run data:validate` checks schemas, ID stability, and interpretation coverage. `npm run data:curate` ranks 20 strong historical demo candidates.

## SLP/1 protocol

Each 40-bit packet is five bytes:

| Field | Bits |
| --- | ---: |
| Version | 4 |
| Event type | 4 |
| Sonic ID | 16 |
| Mood | 4 |
| Reserved | 4 |
| CRC-8 (poly `0x07`) | 8 |

Four carrier notes encode two bits each: C5=`00`, E♭5=`01`, G5=`10`, B♭5=`11`. The six-symbol preamble `00 11 00 11 01 10` is followed by 20 payload notes. Notes last 180 ms with a 40 ms gap, for a 5.7-second record.

The receiver uses local Web Audio microphone input, Goertzel analysis for only the four known carriers, a gap-aware symbol state machine, rolling preamble search, field validation, and CRC verification. Audio never leaves the device.

## Interpretation boundary

Facts, Sonic IDs, semantic events, packets, and record resolution are deterministic. Mistral only supplies a story and musical parameters during preprocessing; it never decides which record was received. The repository includes conservative source-grounded fallback interpretations so the app runs immediately.

To replace them with validated Mistral Medium 3.5 outputs through OpenRouter:

```bash
OPENROUTER_API_KEY=... npm run interpretations:generate -- --limit=20
```

Omit `--limit` to process all records. Outputs are Zod-validated and cached after each record. The key and network are not used by the live application.

## Verification

```bash
npm test
npm run data:validate
npm run build
```

Tests cover all dataset-range packet IDs, CRC corruption rejection, all four Goertzel carriers, and clean/noisy synthetic PCM through the complete detector → symbol state machine → packet decoder path.

## Physical-device test

1. Open the app on two HTTPS-served phones.
2. On Phone B, open **Listen for Linz** and grant microphone access.
3. On Phone A, choose a historical record and play its Sonic Record.
4. Begin at 20 cm in a quiet room, then test 50 cm and 1 m.
5. Use `/debug/audio` to tune only carrier confidence, minimum RMS, note/gap timing, and data/music balance.

The app must receive a real speaker-to-microphone packet before a live demo. Synthetic tests cannot certify a specific phone, case, room, or browser.
