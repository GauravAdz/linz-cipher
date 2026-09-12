# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Visitors, tourists, families, and local residents encountering a LinzSings installation outdoors on a phone. Most have no technical knowledge of the acoustic protocol and need to understand the experience at a glance, often while walking or standing in a busy public place.

## Product Purpose

LinzSings turns music playing at selected places in Linz into an entry point for discovering an English-language story about that place. Success means a visitor can open the site, start listening with one hand, and comfortably read the revealed story without needing to understand how the sound carries data.

## Positioning

The same public musical piece is both an ambient artwork in the city and the key that reveals its place-specific story on a visitor’s phone.

## Operating Context

The primary journey has three stages: introduction, listening, and discovery. Listening happens outdoors through the phone microphone. Audio analysis stays on the device. Installation creators still need transmitter and decoder diagnostics, but those tools are outside public navigation and production visitor UX.

## Capabilities and Constraints

- Preserve the existing acoustic protocol’s carrier frequencies, symbol order, preamble, and timing.
- Preserve local decoding, validation, error correction, and developer diagnostics.
- Keep the encoded carrier clean and dominant; richer ambience belongs before and after the encoded passage.
- Present all visitor-facing interface language and narrative in English while keeping authentic place names.
- Support phone widths from 320–430 px without horizontal overflow and enhance larger layouts.
- Keep official City of Linz source records available through an unobtrusive external link.

## Brand Commitments

The product name is LinzSings. Its voice is calm, clear, welcoming, and culturally literate. Linz yellow identifies the city name and the primary invitation to listen. The visual world is connected to Linz, the Danube at night, contemporary media art, and technological civic culture without copying Ars Electronica branding or becoming an aggressive cyberpunk interface.

## Evidence on Hand

- Structured current and historical street records: `data/generated/places.json`
- Generated interpretation and musical mood data: `data/generated/interpretations.json`
- Official source links inside each place record
- Working transmitter, receiver, decoder, and reliability tests under `src/audio`, `src/protocol`, and `tests`

## Product Principles

- The human story is the product; the protocol is invisible infrastructure.
- One clear action per stage.
- Calm enough for a cultural installation, clear enough for a noisy street.
- Every technical failure becomes short, helpful language with a recovery action.
- Musical character may vary by place, but recognition reliability never does.

## Accessibility & Inclusion

Use semantic HTML, visible focus states, high contrast, comfortable mobile body text, 44 px minimum touch targets, reduced-motion alternatives, assistive-technology status announcements, safe-area support, and plain English.
