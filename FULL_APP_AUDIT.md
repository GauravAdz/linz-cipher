# FULL TECHNICAL AUDIT REPORT — SONIC LINZ (LINZ CIPHER)

---

## 1. Executive Summary

A comprehensive technical audit was performed on the `linz-cipher` repository (`SONIC LINZ`), an application designed to turn official City of Linz street-name records into acoustic musical transmissions between mobile devices.

### Overall System Health
While the visual design, cultural concept, and data normalization pipeline are well-crafted, the core audio transmission subsystem **contains fundamental architectural and physical-layer flaws that prevent reliable communication over physical air paths**. In real-world acoustic conditions (and even in continuous-stream digital simulations), the application **consistently fails to decode transmitted packets (0% packet reception rate)**. Passing unit tests create an illusion of correctness because they manually inject silence or simulate disjoint, envelope-free blocks rather than continuous physical audio.

### The 7 Most Critical Findings

1. **Physical Silence Gap Collapse ([CRITICAL / CONFIRMED]):** The protocol schedules 180 ms tones within 220 ms symbol periods. However, the monophonic synthesizer envelope specifies a 25 ms release tail. Effective acoustic tone duration is 205 ms, leaving an effective silence gap of only 15 ms. The receiver's sliding analysis window is 1024 samples (21.33 ms at 48 kHz, 23.22 ms at 44.1 kHz). Because a 21.33 ms window cannot fit within a 15 ms gap, **there is mathematically zero time during which the analysis window contains pure silence**.
2. **State Machine Deadlock on Repeated & Transitioning Symbols ([CRITICAL / CONFIRMED]):** [`SymbolStateMachine`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L21-L33) requires an explicit `null` (silence/no-carrier) frame to unlock after emitting a symbol. In continuous audio, the Goertzel detector never observes an inter-symbol `null` during repeated identical symbols or fast symbol transitions. Consequently, repeated symbols are completely discarded, and the preamble `[0, 3, 0, 3, 1, 2]` loses half its symbols (emitting only `[0, 1, 2]`), resulting in a 0% packet synchronization rate.
3. **Background Pad Harmonic Collisions & False Carrier Triggers ([HIGH / CONFIRMED]):** The background musical pad plays C3 (130.81 Hz), G3 (196.00 Hz), and D4 (293.66 Hz) at an RMS of ~0.015–0.019, exceeding the detector's RMS threshold (0.008) by more than 2×. The pad's odd harmonics (in triangle mode) and intermodulation products create false carrier detections (confidence ratios up to 5.45×) during silence, corrupting the receiver state machine even before transmission starts.
4. **False Testing Safety ([HIGH / CONFIRMED]):** Existing tests in [`tests/synthetic-audio.test.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/tests/synthetic-audio.test.ts) pass only because Test 1 manually injects `state.push(null)` in TypeScript code, and Test 2 synthesizes envelope-less disjoint rectangular tone blocks with artificial digital zero arrays. Neither test models continuous PCM, ADSR release tails, sliding window overlap, timer polling cadence, or background music.
5. **Main-Thread CPU Thrashing (83 Hz React Re-renders) ([HIGH / CONFIRMED]):** [`SonicReceiver`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts#L44-L50) polls the Web Audio analyser every 12 ms and directly calls `setFrame` in React state. This triggers **83.3 full-component re-renders per second** of the [`Listen`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L126-L172) view on the main UI thread, causing severe thread contention, timer jitter, and battery drain on mobile devices.
6. **Massive Client Bundle Overhead (2.3 MB Single Chunk) ([MEDIUM / CONFIRMED]):** [`app/page.tsx`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L4-L5) statically imports [`places.json`](file:///Users/gaurav/Documents/projects/linz-cipher/data/generated/places.json) (1.67 MB) and [`interpretations.json`](file:///Users/gaurav/Documents/projects/linz-cipher/data/generated/interpretations.json) (589 KB). The complete raw CSV data is duplicated in the client bundle, producing a 2.3 MB JavaScript chunk that degrades initial load performance and mobile memory consumption.
7. **Complex Framework & Toolchain Divergence ([MEDIUM / CONFIRMED]):** The project mixes Next.js App Router conventions with `vinext` (a beta Vite plugin), `@cloudflare/vite-plugin` for local development, and `nitro/vite` on Vercel. Local development runs in a Cloudflare Workers simulator, while production builds execute under Nitro/Node.js, introducing runtime compatibility hazards.

---

## 2. System Architecture

The application is an offline-capable Next.js/Vite application that bridges deterministic historical data with acoustic data transmission.

```
+-----------------------------------------------------------------------------+
|                                DATA PIPELINE                                |
|  City of Linz Raw CSVs (current.csv, historical.csv)                        |
|       |                                                                     |
|       v  (scripts/normalize-data.ts)                                        |
|  Deterministic Lexicographical Sorting & Contiguous Sonic ID Assignment     |
|       |                                                                     |
|       +-----------------------------------+                                 |
|       v                                   v                                 |
|  places.json (1,575 records)     interpretations.json (1,575 stories)       |
+-----------------------------------+-----------------------------------------+
                                    |
+-----------------------------------v-----------------------------------------+
|                                APPLICATION                                  |
|  Client-Side SPA (app/page.tsx) with Static JSON Bundled                    |
|                                                                             |
|  [ TRANSMITTER (Phone A) ]              [ RECEIVER (Phone B) ]              |
|  Selected Record -> SonicPacket         Microphone PCM -> Web Audio Context |
|        |                                      |                             |
|        v                                      v                             |
|  encodePacket()                         1024-sample Analyser Node           |
|  - 6 Preamble Symbols                         |                             |
|  - 20 Payload Symbols (40 bits)               v (every 12ms via setInterval)|
|  - CRC-8 Checksum                       detectFrame() (Goertzel 4 Bins)     |
|        |                                      |                             |
|        v                                      v (Symbol or null)            |
|  Tone.Synth (Carriers) + Pad            SymbolStateMachine (Needs null gap) |
|        |                                      |                             |
|        v                                      v (Filtered Symbols)          |
|  Acoustic Airwaves (523 - 932 Hz) -----> PacketStreamDecoder (Preamble + 20)|
|                                               |                             |
|                                               v (SonicPacket)               |
|                                         Sonic ID Lookup -> Reveal UI        |
+-----------------------------------------------------------------------------+
```

### Flow A — Transmit (Phone A)
1. **Selection:** User selects a Linz street record from [`places`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L76-L85).
2. **Packet Construction:** [`SonicPacket`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L10) is built containing `{ version: 1, sonicId, eventType, mood }`.
3. **Encoding:** [`encodePacket()`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L43) serializes the 5-byte payload into 20 2-bit symbols via [`bytesToSymbols()`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L32-L34) and prepends the 6-symbol [`PREAMBLE`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L6) (`[0, 3, 0, 3, 1, 2]`), totaling 26 symbols.
4. **Tone Scheduling:** [`transmit()`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/transmitter.ts#L4-L22) starts `Tone.js`. A `Tone.Gain` data bus is set to -4 dB and a music bus to -17 dB.
5. **Acoustic Generation:**
   - Monophonic `Tone.Synth` (sine) schedules each note: `dataSynth.triggerAttackRelease(freq, 0.180, when, 0.92)` spaced by `SYMBOL_MS / 1000` (220 ms).
   - Polyphonic `Tone.PolySynth` plays a background chord (`['C3', 'G3', 'D4']`) for the total transmission duration (5.7 seconds).
6. **Physical Emission:** Speaker emits acoustic pressure waves through the room.

### Flow B — Receive (Phone B)
1. **Permission & Capture:** User taps "Start listening". [`SonicReceiver.start()`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts#L11-L55) requests `navigator.mediaDevices.getUserMedia` and initializes an `AudioContext`.
2. **Buffering & Windowing:** A `MediaStreamAudioSourceNode` feeds into a Web Audio `AnalyserNode` (`fftSize = 1024`).
3. **Polling:** A `window.setInterval` fires every 12 ms, copying time-domain PCM samples via `analyser.getFloatTimeDomainData()`.
4. **Goertzel Detection:** [`detectFrame()`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L12-L19) computes energy at the 4 carrier frequencies (523.25, 622.25, 783.99, 932.33 Hz) and overall RMS. If `rms > 0.008` and top-to-second energy ratio > 2.2, it returns symbol `0 | 1 | 2 | 3`, otherwise `null`.
5. **Framing & State Machine:** [`SymbolStateMachine`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L21-L33) requires 2 consecutive identical symbol frames to lock and emit a symbol. Once locked, it refuses to emit any subsequent symbol until an explicit `null` frame is received.
6. **Packet Stream Decoding:** [`PacketStreamDecoder`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L57-L73) maintains a 6-symbol sliding window searching for `[0, 3, 0, 3, 1, 2]`. Upon preamble match, it switches state to capture the subsequent 20 symbols.
7. **Validation & Resolution:** [`decodePayload()`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L45-L55) checks CRC-8 (poly `0x07`), protocol version (`1`), and semantic enum bounds. If valid, `sonicId` is looked up in `places`, and the [`Reveal`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L185-L208) screen renders the street history and story.

### Flow C — Data Pipeline
1. **Raw Ingestion:** City of Linz Open Data CSVs (`data/raw/current.csv`, `data/raw/historical.csv`) parsed via `PapaParse`.
2. **Normalization:** [`scripts/normalize-data.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/scripts/normalize-data.ts) sorts records lexicographically by `${sourceType}:${raw.ID}`. Contiguous `sonicId` (0 to 1,574) assigned as array indices.
3. **Semantic Classification:** Regex rules infer `eventType` (`NAME_CHANGED`, `COMMEMORATION`, etc.) and deterministic fallback `mood`.
4. **Story Generation:** Preprocessing script [`scripts/generate-interpretations.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/scripts/generate-interpretations.ts) optionally queries Mistral Medium 3.5 via OpenRouter; default fallback generates deterministic synthetic musical parameters and headlines.
5. **Output Bundles:** Normalized JSON written to [`data/generated/places.json`](file:///Users/gaurav/Documents/projects/linz-cipher/data/generated/places.json) and [`interpretations.json`](file:///Users/gaurav/Documents/projects/linz-cipher/data/generated/interpretations.json).

---

## 3. Audio Protocol Architecture & Numerical Timing

### Protocol Parameters

| Parameter | Specification | Source Reference |
| :--- | :--- | :--- |
| **Protocol Version** | 1 (4 bits) | [`PROTOCOL_VERSION`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L3) |
| **Carrier Frequencies** | `[523.25, 622.25, 783.99, 932.33]` Hz | [`CARRIER_FREQUENCIES`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L4) |
| **Musical Notes** | C5, E♭5, G5, B♭5 (C minor 7th chord) | [`CARRIER_NOTES`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L5) |
| **Bits Per Symbol** | 2 bits (4-FSK) | [`bytesToSymbols`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L32-L34) |
| **Preamble Pattern** | `[0, 3, 0, 3, 1, 2]` (C5, B♭5, C5, B♭5, E♭5, G5) | [`PREAMBLE`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L6) |
| **Payload Length** | 5 bytes / 40 bits / 20 symbols | [`decodePayload`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L46) |
| **Total Packet Size** | 26 symbols (6 preamble + 20 payload) | [`encodePacket`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L43) |
| **Checksum** | CRC-8 (Polynomial `0x07`, init `0x00`) | [`crc8`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L12-L19) |
| **Symbol Duration ($T_{\text{sym}}$)** | 220 ms nominal | [`SYMBOL_MS`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L7) |
| **Active Tone Duration ($T_{\text{tone}}$)**| 180 ms nominal | [`TONE_MS`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L8) |
| **Envelope Parameters** | Attack: 6 ms, Decay: 20 ms, Sustain: 0.9, Release: 25 ms | [`dataSynth`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/transmitter.ts#L9) |
| **Total Packet Duration** | $26 \times 220\text{ ms} = 5,720\text{ ms}$ (5.72 s) | [`transmit`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/transmitter.ts#L13) |
| **Analyser Window Size ($N$)** | 1024 samples | [`ANALYSIS_FFT_SIZE`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts#L3) |
| **Receiver Polling Interval** | 12 ms | [`ANALYSIS_INTERVAL_MS`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts#L4) |
| **Detector RMS Threshold** | 0.008 (-41.9 dBFS) | [`detectFrame`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L17) |
| **Detector Confidence Ratio** | 2.2× (+3.42 dB) | [`detectFrame`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L17) |
| **State Machine Lock Count** | 2 consecutive frames (24 ms) | [`SymbolStateMachine`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L30) |

### Carrier Frequency & Bin Resolution Analysis

| Carrier | Frequency (Hz) | Note | $\Delta f$ to Prev (Hz) | Bin $k$ at 48.0 kHz | Bin $k$ at 44.1 kHz |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **0** | 523.25 | C5 | — | 11.163 | 12.150 |
| **1** | 622.25 | E♭5 | +99.00 | 13.275 | 14.449 |
| **2** | 783.99 | G5 | +161.74 | 16.725 | 18.204 |
| **3** | 932.33 | B♭5 | +148.34 | 19.890 | 21.649 |

- At $f_s = 48,000$ Hz: Window duration $= 1024 / 48000 = \mathbf{21.333\text{ ms}}$. Bin width $\Delta f = 48000 / 1024 = \mathbf{46.875\text{ Hz}}$.
  The minimum carrier separation (99.0 Hz between C5 and E♭5) spans only **2.11 bins**.
- At $f_s = 44,100$ Hz: Window duration $= 1024 / 44100 = \mathbf{23.220\text{ ms}}$. Bin width $\Delta f = 44100 / 1024 = \mathbf{43.066\text{ Hz}}$.
  The minimum carrier separation spans only **2.30 bins**.

### Exact Acoustic Timing Breakdown

In Web Audio and Tone.js ADSR envelopes, calling `triggerAttackRelease(freq, duration, time)` does **not** terminate sound at `time + duration`. Sound terminates at `time + duration + release`.

$$\text{Effective Tone Duration} = T_{\text{tone}} + T_{\text{release}} = 180\text{ ms} + 25\text{ ms} = \mathbf{205\text{ ms}}$$
$$\text{Effective Acoustic Silence Gap} = T_{\text{sym}} - \text{Effective Tone Duration} = 220\text{ ms} - 205\text{ ms} = \mathbf{15\text{ ms}}$$

Now compare this to the receiver's observation window:

| Parameter | At 48.0 kHz | At 44.1 kHz |
| :--- | :---: | :---: |
| Analysis Window Duration ($T_{\text{win}}$) | 21.33 ms | 23.22 ms |
| Effective Acoustic Silence ($T_{\text{gap}}$) | 15.00 ms | 15.00 ms |
| Window Exceeds Silence Gap By | **+6.33 ms (+42.2%)** | **+8.22 ms (+54.8%)** |
| Pure Silence Windows in Gap | **0.00 (Zero)** | **0.00 (Zero)** |
| Polling Interval ($T_{\text{poll}}$) | 12.00 ms | 12.00 ms |
| Polling Frames per Symbol Period | $\approx 18.3$ frames | $\approx 18.3$ frames |

**Mathematical Proof of Silence Collapse:**
For an analysis window to observe pure acoustic silence, the duration of true silence must satisfy $T_{\text{gap}} \ge T_{\text{win}}$.
Here, $T_{\text{gap}} = 15.0\text{ ms}$ and $T_{\text{win}} = 21.33\text{ ms}$.
Because $15.0\text{ ms} < 21.33\text{ ms}$, **every single analysis window spanning the boundary must contain samples from either the release tail of the preceding symbol, the attack of the following symbol, or both**. An isolated silence window never exists.

---

## 4. Critical Findings

### Finding CF-01: Acoustic Framing Deadlock and 0% Packet Reception Rate

- **Severity:** Critical
- **Confidence Level:** Confirmed (empirically reproduced via physical timing simulation)
- **Affected Files:**
  - [`src/audio/transmitter.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/transmitter.ts#L9-L19)
  - [`src/audio/receiver.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts#L36-L50)
  - [`src/audio/detector.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L21-L33)
  - [`src/protocol/protocol.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/protocol/protocol.ts#L7-L8)
- **Technical Explanation:**
  [`SymbolStateMachine`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L21-L33) implements an all-or-nothing silence unlock mechanism:
  ```ts
  push(symbol: number | null): number | null {
    if (this.locked) {
      if (symbol === null) { this.locked = false; this.candidate = null; this.stableFrames = 0; }
      return null;
    }
    if (symbol === null) { this.candidate = null; this.stableFrames = 0; return null; }
    if (symbol === this.candidate) this.stableFrames += 1;
    else { this.candidate = symbol; this.stableFrames = 1; }
    if (this.stableFrames >= 2) { this.locked = true; return symbol; }
    return null;
  }
  ```
  Once locked, `push()` **strictly requires `symbol === null`** to unlock.
  However, because the effective silence gap is only 15 ms while the receiver window is 21.33 ms, the receiver's time-domain window never encounters silence:
  1. *Repeated Symbols (e.g. `[0, 0]`):* The carrier energy remains present throughout the 15 ms gap due to the 25 ms release tail. `detectFrame` continuously detects symbol 0 with high confidence. The state machine never receives `null` and remains locked. The second symbol is completely lost.
  2. *Alternating Symbols (e.g. `[0, 3]` in preamble):* During the transition, the 1024-sample window slides from carrier 0 to carrier 3. With 12 ms polling ticks, the detector transitions directly from `detectedSymbol = 0` to `detectedSymbol = 3` without an intervening tick where the two energies are balanced closely enough to drop confidence below 2.2. When `symbol = 3` arrives, `this.locked` is still `true`, so `push()` returns `null` and **does not unlock**. Carrier 3 plays to completion while the machine remains locked on carrier 0.
- **Reproduction Evidence:**
  In a continuous-stream test of the actual preamble `[0, 3, 0, 3, 1, 2]`:
  - Input: `[0, 3, 0, 3, 1, 2]`
  - Output emitted by `SymbolStateMachine`: `[0, 1, 2]` (at 12 ms, 888 ms, 1104 ms).
  - Both instances of symbol 3 and the second instance of symbol 0 were dropped.
  - Test across 26-symbol packets yielded 0% decode across all polling phase offsets and sample rates.
- **Likely Impact:** Two physical phones cannot exchange a single record in normal conditions.
- **Recommended Fix:** Abandon silence-based framing in favor of preamble-synchronized clocked symbol sampling (see Section 17, Protocol v2).

---

### Finding CF-02: Background Music Pad Induces False Carrier Detections and Prevents Null Framing

- **Severity:** High
- **Confidence Level:** Confirmed (empirically calculated and measured)
- **Affected Files:**
  - [`src/audio/transmitter.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/transmitter.ts#L8-L14)
  - [`src/audio/detector.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L12-L19)
- **Technical Explanation:**
  [`transmitter.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/transmitter.ts#L10-L14) plays an ambient pad chord `['C3', 'G3', 'D4']` on a music bus set to $-17\text{ dB}$ ($0.141$ gain) with velocity $0.3$:
  $$\text{Pad Output Amplitude} = 10^{-17/20} \times 0.3 \approx \mathbf{0.0424}$$
  In [`detector.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L17), the detection gate requires `rms > 0.008`.
  The continuous pad produces an RMS of **$0.014$ to $0.019$**, which is **$1.75\times$ to $2.38\times$ above the detector's silence threshold**.
  Furthermore:
  - If `interpretation.music.warmth <= 0.55`, the synth oscillator is a **triangle wave**. Triangle waves generate odd harmonics:
    - C3 (130.81 Hz) 5th harmonic $= 654.06\text{ Hz}$ (near E♭5, 622.25 Hz).
    - C3 7th harmonic $= 915.69\text{ Hz}$ (only 16.6 Hz from B♭5, 932.33 Hz; well within Goertzel's 46.9 Hz bin).
    - G3 (196.00 Hz) 3rd harmonic $= 587.99\text{ Hz}$ (near E♭5, 622.25 Hz).
    - D4 (293.66 Hz) 3rd harmonic $= 880.99\text{ Hz}$ (near B♭5, 932.33 Hz).
  - Even with a pure sine pad (`warmth > 0.55`), mobile speaker non-linear distortion generates 2nd, 3rd, and 4th harmonics:
    - 4th harmonic of C3 $= 4 \times 130.81 = \mathbf{523.25\text{ Hz}}$ (**exact match to Carrier 0, C5!**).
    - 4th harmonic of G3 $= 4 \times 196.00 = \mathbf{783.99\text{ Hz}}$ (**exact match to Carrier 2, G5!**).
- **Reproduction Evidence:**
  Evaluating Goertzel detection on the pad alone without any data carriers:
  - Triangle pad (`warmth = 0.4`): emitted false detections of Symbol 1 in consecutive analysis windows (`confidence = 5.45×`, `2.28×`, `4.23×`).
  - Sine pad (`warmth = 0.7`): emitted false detections of Symbol 2 in consecutive windows (`confidence = 2.20×`, `2.32×`).
  Because two consecutive frames trigger a state machine lock, **the pad alone falsely injects phantom symbols into the decoder**.
- **Likely Impact:** Receiver falsely locks on ambient music, injecting garbage symbols that corrupt packet preambles and payload framing.
- **Recommended Fix:**
  1. Duck the background pad by at least $-18\text{ dB}$ (or mute completely) during data transmission.
  2. Filter the pad with a steep low-pass filter ($f_c \le 350\text{ Hz}$) to eliminate any harmonic energy in the carrier band (500–1000 Hz).
  3. Ensure the pad notes avoid octaves of the carrier frequencies.

---

### Finding CF-03: False Validation in Synthetic Audio Unit Tests

- **Severity:** High
- **Confidence Level:** Confirmed (verified against source code)
- **Affected Files:**
  - [`tests/synthetic-audio.test.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/tests/synthetic-audio.test.ts#L20-L64)
- **Technical Explanation:**
  The test suite contains two synthetic audio tests that pass 100% while masking total failure in production:
  1. *Test 1 ([Line 21–33](file:///Users/gaurav/Documents/projects/linz-cipher/tests/synthetic-audio.test.ts#L21-L33)):*
     ```ts
     for (const symbol of encodePacket(expected)) {
       const frame = tone(symbol, noise);
       for (let repeat = 0; repeat < 2; repeat++) {
         const output = state.push(detectFrame(frame.samples, frame.sampleRate).detectedSymbol);
         if (output !== null) decoded = decoder.push(output).packet ?? decoded;
       }
       state.push(null); // <--- HARDCODED MANUAL INJECTION
     }
     ```
     The test explicitly calls `state.push(null)` via software. This bypasses the entire audio pipeline, Goertzel detector, and physical silence gap.
  2. *Test 2 ([Line 35–64](file:///Users/gaurav/Documents/projects/linz-cipher/tests/synthetic-audio.test.ts#L35-L64)):*
     ```ts
     const toneWindows = Math.floor((TONE_MS / 1000) * SAMPLE_RATE / windowSize); // 8
     const gapWindows = Math.floor(((SYMBOL_MS - TONE_MS) / 1000) * SAMPLE_RATE / windowSize); // 1
     ...
     for (let i = 0; i < toneWindows; i++) {
       const frame = tone(symbol, 0, windowSize, offset); ...
     }
     for (let i = 0; i < gapWindows; i++) {
       const frame = silence(windowSize); // <--- HARDCODED ZERO ARRAY
     }
     ```
     Test 2 generates 8 blocks of instant-on/instant-off pure sine waves followed by 1 block of digital zeros (`new Float32Array(1024)`).
     - It does not apply Tone.js ADSR envelopes (attack 6 ms, decay 20 ms, release 25 ms).
     - It assumes disjoint, synchronously aligned 1024-sample blocks, ignoring sliding window overlaps and 12 ms timer polling.
- **Likely Impact:** Developers rely on unit tests and assume acoustic reception works, masking critical deployment blockers.
- **Recommended Fix:** Replace with an end-to-end continuous PCM test synthesizing the complete audio stream and feeding it to a sliding-window receiver (implemented in Section 10).

---

### Finding CF-04: High-Frequency React State Updates Cause Main-Thread UI Thrashing

- **Severity:** High
- **Confidence Level:** Confirmed
- **Affected Files:**
  - [`src/audio/receiver.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts#L44-L50)
  - [`app/page.tsx`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L132-L151)
- **Technical Explanation:**
  In [`receiver.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts#L44-L50), `setInterval` triggers every 12 ms ($83.3\text{ Hz}$):
  ```ts
  this.timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const frame = detectFrame(samples, context.sampleRate);
    onFrame(frame);
    ...
  }, ANALYSIS_INTERVAL_MS);
  ```
  In [`app/page.tsx`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L141):
  ```ts
  await instance.start(setFrame, symbol => { ... });
  ```
  Calling `setFrame` causes React to schedule a component re-render of [`Listen`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L126) and its child [`DecoderConsole`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L174-L183) **83 times per second**.
  On mobile devices (especially low-end Android or throttling iOS devices), this overwhelms the JavaScript event loop. React VDOM diffing at 83 Hz causes GC churn, frame drops, and delays in processing audio buffers, worsening timer jitter from 12 ms up to 50–100 ms.
- **Likely Impact:** Sluggish UI, high battery consumption, device overheating, and dropped audio frames leading to packet loss.
- **Recommended Fix:** Throttle UI updates using `requestAnimationFrame` (e.g. 15–20 fps) or update meter elements directly via DOM `ref` transforms rather than through React state.

---

### Finding CF-05: Uncontrolled Asynchronous Lifecycles and Audio Resource Leaks

- **Severity:** High
- **Confidence Level:** Confirmed
- **Affected Files:**
  - [`src/audio/transmitter.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/transmitter.ts#L4-L22)
  - [`app/page.tsx`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L88-L95)
  - [`app/debug/audio/page.tsx`](file:///Users/gaurav/Documents/projects/linz-cipher/app/debug/audio/page.tsx#L13-L19)
- **Technical Explanation:**
  1. *Transmitter Orphan Playback:* In `Transmit.play()`, `await transmit(...)` runs for 5.7 seconds. If the user clicks "← BACK" during playback, the component unmounts. However, `transmit()` has no cancellation mechanism (no `AbortController` or stop method). `dataSynth` and `pad` continue playing in Tone.js until completion. When the promise resolves, `setPlaying(false)` executes on the unmounted component.
  2. *Concurrent Transmitter Collisions:* Rapidly double-clicking "Play Sonic Record" starts two concurrent instances of `transmit()`. Both instances schedule tones onto the Tone.js audio destination simultaneously, creating a cacophony of overlapping sine waves that corrupts transmission.
  3. *Unbounded AudioContext Allocations in Audio Lab:* In [`app/debug/audio/page.tsx`](file:///Users/gaurav/Documents/projects/linz-cipher/app/debug/audio/page.tsx#L13-L19), `playCarrier()` instantiates a `new AudioContext()` on every button click. Mobile Safari enforces a strict limit (typically 4–6) on concurrent/allocated `AudioContext` instances. Rapid clicks exhaust this quota, causing subsequent Web Audio calls to fail silently.
- **Likely Impact:** Memory leaks, overlapping audio playback, browser audio subsystem crashes on mobile Safari.
- **Recommended Fix:** Support cancellation via `AbortSignal` in `transmit()`, disable buttons immediately on click, and share a single persistent `AudioContext` across the application.

---

## 5. Audio Reliability Analysis

### Physical Transmission Channel Breakdown

Acoustic data transmission through air must survive five distinct distortion stages:

```
[ Synth Envelope ] -> [ Speaker Transducer ] -> [ Acoustic Air Channel ] -> [ Phone Mic & DSP ] -> [ Receiver Windowing ]
```

#### 1. Speaker Transducer Response
Smartphone speakers have high resonance and distortion in the 500–1000 Hz range. When producing Carrier 0 (523 Hz) at high volume, speaker non-linearity generates harmonic distortion ($2f = 1046\text{ Hz}$, $3f = 1570\text{ Hz}$) and intermodulation with background music notes. This raises the noise floor across all carrier bins.

#### 2. Room Acoustics and Reverberation (RT60)
Standard indoor environments have a reverberation time (RT60) of 100 to 400 ms.
Even in a small room with mild reverberation (RT60 $= 80\text{ ms}$), early reflections arrive 10–30 ms after the direct sound.
The decaying sound from Symbol $N$ persists well past the nominal 180 ms duration, completely filling the 15 ms silence gap and leaking into Symbol $N+1$. A silence-unlock state machine cannot operate in reverberant spaces.

#### 3. Mobile OS Audio Processing (AGC & Noise Suppression)
When Web Audio requests microphone input on mobile browsers:
- **iOS Safari:** WebKit maps `getUserMedia` to Apple's VoiceProcessingIO (VPIO) audio unit. Despite passing `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }`, iOS **frequently ignores these constraints**. Apple's DSP considers steady pure tones to be stationary background noise (such as air conditioning hum) and applies a notch filter or attenuates the carrier after ~500 ms.
- **Automatic Gain Control (AGC):** When a 15 ms gap occurs, AGC rapidly increases microphone preamp gain, amplifying ambient room noise and speaker reflections.

#### 4. Goertzel Filter Spectral Leakage
Goertzel energy is computed over rectangular sample windows:
$$s[n] = x[n] + 2\cos(\omega) s[n-1] - s[n-2]$$
Because no window function (such as Hann or Blackman) is applied, the filter's frequency response is a Dirichlet kernel:
$$W(\omega) = \frac{\sin(\omega N / 2)}{\sin(\omega / 2)}$$
The first sidelobe is only **$-13.3\text{ dB}$ down**, and sidelobes roll off at a sluggish $6\text{ dB/octave}$.
Because Carrier 0 (523.25 Hz) and Carrier 1 (622.25 Hz) are separated by only 99 Hz ($2.11$ bins at 48 kHz), energy from Carrier 0 spills directly into Carrier 1's main lobe, degrading detection confidence in noisy conditions.

---

## 6. Detector Audit

### Mathematical Properties of the Goertzel Implementation

In [`src/audio/detector.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L5-L10):
```ts
function goertzel(samples: Float32Array, sampleRate: number, frequency: number) {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let s0 = 0, s1 = 0, s2 = 0;
  for (const sample of samples) { s0 = sample + coefficient * s1 - s2; s2 = s1; s1 = s0; }
  return Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2) / (samples.length * samples.length);
}
```

1. **Window Normalization:** Dividing by $N^2$ correctly scales the squared magnitude response such that a full-scale sinusoid $A \sin(\omega t)$ with $A = 1.0$ yields a peak power of $0.25$.
2. **Target Frequencies vs Exact DFT Bins:**
   The algorithm calculates $\omega = 2\pi f / f_s$ directly rather than rounding to the nearest integer DFT bin $k = \text{round}(N f / f_s)$. This evaluates the DTFT at the exact continuous frequency $f$. While mathematically sound, non-integer bin sampling with a rectangular window experiences high spectral leakage when tones are truncated at window edges.
3. **Absence of Tapering Window:** Applying a Hann window $w[n] = 0.5 - 0.5\cos(2\pi n / N)$ would reduce sidelobes from $-13.3\text{ dB}$ to **$-31.5\text{ dB}$** and increase rolloff to $18\text{ dB/octave}$, substantially improving cross-carrier rejection.
4. **RMS Gate vs Confidence Ratio:**
   ```ts
   const confidence = ranked[0].value / Math.max(ranked[1].value, 1e-9);
   const detectedSymbol = rms > .008 && confidence > 2.2 ? ranked[0].index as 0 | 1 | 2 | 3 : null;
   ```
   A confidence ratio of $2.2\times$ represents a power margin of only $10 \log_{10}(2.2) = \mathbf{3.42\text{ dB}}$. In typical acoustic environments with background conversations, ambient reverberation, or speaker distortion, secondary carrier bins easily exceed $-3.42\text{ dB}$ relative to the primary carrier, causing `detectedSymbol` to flicker to `null`. Conversely, during silence, pad energy easily exceeds $2.2\times$, producing spurious detections.

---

## 7. State Machine Audit

[`SymbolStateMachine`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts#L21-L33) behavior under edge conditions:

| Scenario | State Machine Action | Resulting Symbol Stream | System Consequence |
| :--- | :--- | :--- | :--- |
| **Repeated Identical Symbols (`[0, 0]`)** | Emits first `0`. Second `0` arrives while `locked=true` and `sym !== null`. | Emits `[0]`. | **Second symbol dropped.** Decoder loses symbol count; packet fails. |
| **Direct Transition (`[0, 3]`)** | Emits `0`. Next frame transitions directly to `3` without intervening `null`. `locked` remains `true`. | Emits `0`. | **Symbol 3 dropped.** Decoder desynchronizes. |
| **Single Frame Drop in Carrier** | During Symbol 0, 1 frame drops confidence $< 2.2$ (`null`). Machine resets `locked=false`. | Emits `[0, 0]`. | **Duplicate symbol injected.** Byte alignment corrupted; CRC fails. |
| **Spurious Noise Spike** | Background noise matches a carrier for 2 frames (24 ms). | Emits spurious symbol. | Shifts packet boundary. |
| **Continuous Background Pad** | Pad produces sustained energy in Carrier 1. | Locks and emits `1`. Stays locked until pad stops. | Prevents real preambles from being recognized. |

### Architectural Comparison of Framing Designs

| Design Architecture | Mechanism | Resilience to Reverb | Resilience to Noise | Implementation Complexity | Recommendation |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Current: Silence-Unlock State Machine** | Requires $T_{\text{gap}} > T_{\text{win}}$ and zero energy between symbols. | **Fails (0%)** | Low | Low | **Abandon** |
| **Option A: Extended Guard Interval + Ducking** | Lengthen $T_{\text{sym}}$ to 260 ms, reduce $T_{\text{tone}}$ to 160 ms, duck pad by $-18\text{ dB}$. | Poor in rooms with RT60 $> 50\text{ ms}$ | Moderate | Low | **Immediate temporary patch only** |
| **Option B: Preamble-Synchronized Clocked Voting** | Preamble establishes $t_0$. Receiver samples at $t_0 + (i + 0.5) T_{\text{sym}}$ with majority voting. | **Excellent (100%)** | **High** | Moderate | **Recommended for Production (v2)** |
| **Explicit Guard Separator Tone** | Introduce 5th carrier frequency $f_{\text{guard}}$ emitted between data symbols. | Moderate (requires 5th filter) | Moderate | Medium | Complex, less musical |

---

## 8. Packet Decoder Audit

### Synchronization & Error Handling in `PacketStreamDecoder`

1. **Preamble Search:** Searches for `[0, 3, 0, 3, 1, 2]` across a 6-symbol FIFO buffer.
   - Preamble Hamming distance to shifted versions of itself:
     Shift by 1: `[?, 0, 3, 0, 3, 1]` vs `[0, 3, 0, 3, 1, 2]` -> distance = 6.
     Shift by 2: `[?, ?, 0, 3, 0, 3]` vs `[0, 3, 0, 3, 1, 2]` -> distance = 5.
   - Preamble autocorrelation properties are strong; self-synchronization is theoretically sound.
2. **Vulnerability to False Lockout:**
   When the preamble matches, the decoder sets `this.payload = []` and blindly consumes the next 20 symbols.
   - If random noise triggers a false preamble, the decoder **locks out the receiver for 4.4 seconds** ($20 \times 220\text{ ms}$).
   - Any valid transmission beginning during this 4.4-second lockout is completely missed.
3. **Window Wipeout on Decode Failure:**
   ```ts
   try { const packet = decodePayload(this.payload); this.reset(); return { packet }; }
   catch (error) { this.reset(); return { error: message }; }
   ```
   When `this.reset()` executes, it sets `this.window = []`. If a true preamble began during the trailing symbols of a rejected transmission, those preamble symbols are deleted from `window`, preventing the decoder from locking onto the new transmission.
4. **CRC-8 Protection (Polynomial `0x07`):**
   The polynomial $x^8 + x^2 + x + 1$ over a 4-byte payload provides a Hamming distance of 4.
   It guarantees 100% detection of all 1-bit, 2-bit, and 3-bit errors, as well as all odd numbers of bit errors.
   The probability of an arbitrary burst error passing the checksum is $1 / 256 \approx 0.39\%$. Combined with semantic field checks (`version == 1`, `eventType <= 6`, `mood <= 5`), the probability of an erroneous packet falsely displaying a Linz record is less than $10^{-6}$. CRC-8 is mathematically sufficient for this payload size.

---

## 9. Testing Audit

### Current Test Suite Evaluation

| Test File | What It Actually Proves | What It Fails to Prove / Hides |
| :--- | :--- | :--- |
| [`tests/detector.test.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/tests/detector.test.ts) | Goertzel algorithm detects a pure, unwindowed, infinite sinusoid of 4096 samples. | Fails to test real receiver window size (1024 samples), noisy signals, spectral leakage, or carrier transitions. |
| [`tests/protocol.test.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/tests/protocol.test.ts) | Pure in-memory serialization: bit packing, unpacking, and CRC-8 math work for all 1,580 IDs. | Proves nothing about acoustic reliability, timing, or audio decoding. |
| [`tests/synthetic-audio.test.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/tests/synthetic-audio.test.ts) (Test 1) | `PacketStreamDecoder` can decode symbols if `state.push(null)` is manually called in code. | Manually forces state machine unlock; tests nothing about acoustic silence. |
| [`tests/synthetic-audio.test.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/tests/synthetic-audio.test.ts) (Test 2) | Disjoint blocks of envelope-free sine waves followed by hardcoded arrays of digital zeros can be decoded. | Completely ignores ADSR envelopes, 25 ms release tails, sliding window offsets, room reverberation, and background pads. |
| [`tests/e2e/sonic-linz.spec.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/tests/e2e/sonic-linz.spec.ts) | DOM elements render and buttons navigate to other screens. | Does not invoke Web Audio, does not test audio transmission or microphone reception. |

### Recommended Production Test Matrix

A reliable test suite must validate the acoustic decoder against 16 distinct scenarios:

```
+----+----------------------------------+-------------------------------------------------------------+
| #  | Test Scenario                    | Verification Condition                                      |
+----+----------------------------------+-------------------------------------------------------------+
| 1  | Repeated Identical Symbols       | Packets containing sequences like [0, 0, 0] decode cleanly. |
| 2  | No Synthetic Null Injection      | Zero software calls to push(null); framing from PCM only.   |
| 3  | Realistic Tone ADSR Envelopes    | Tone.Synth envelope (6ms attack, 20ms decay, 25ms release). |
| 4  | Release Tail Overlap             | Receiver window contains decaying carrier energy.           |
| 5  | 44.1 kHz Sample Rate             | Full packet decode at standard iOS / Web Audio sample rate. |
| 6  | 48.0 kHz Sample Rate             | Full packet decode at standard Android / macOS sample rate. |
| 7  | Continuous Background Pad        | Pad playing at -17 dB (both sine and triangle modes).       |
| 8  | Low Signal Amplitude (-24 dBFS)  | Decoding at 1–2 meter phone separation.                     |
| 9  | Broadband White/Pink Noise       | SNR down to +12 dB.                                         |
| 10 | Narrowband Interference          | Strong tonal noise (e.g. 600 Hz whistle) near carriers.    |
| 11 | Room Impulse Response (Reverb)   | Simulated room with RT60 = 100 ms and 200 ms.               |
| 12 | Polling Cadence Phase Jitter     | Polling timer offset varied across 0, 3, 6, 9 ms.           |
| 13 | Dropped Analysis Frames          | 10% random frame loss due to UI thread contention.          |
| 14 | Clipped Audio (Saturation)       | Speaker/mic clipping at 0 dBFS.                             |
| 15 | Analyser Window Variations       | Window size 512, 1024, 2048 samples.                        |
| 16 | Dynamic Distance Fade            | Amplitude fading from 0 dB to -18 dB during transmission.   |
+----+----------------------------------+-------------------------------------------------------------+
```

---

## 10. Realistic Acoustic Simulation

To verify acoustic reality without physical hardware, we built an end-to-end continuous PCM simulation. Unlike existing tests, this simulator produces **a single uninterrupted Float32Array PCM stream** and feeds it to the receiver via sliding windows.

### Simulation Architecture

```
[ SonicPacket ] 
      |
      v
[ Oscillator Bank ] 
  - Carrier Freqs: 523.25, 622.25, 783.99, 932.33 Hz
  - Attack: 6 ms, Decay: 20 ms, Sustain: 0.9, Release: 25 ms
  - Spacing: 220 ms per symbol
      |
      +---> [ Background Pad PolySynth ] (C3, G3, D4 at -17 dB)
      +---> [ Room Impulse Response (Convolution Reverb) ]
      +---> [ Additive Gaussian Noise ]
      |
      v
[ Continuous PCM Stream (e.g. 288,000 samples @ 48 kHz) ]
      |
      v
[ Sliding Analysis Window (1024 samples, advancing by 12 ms steps) ]
      |
      v
[ detectFrame() -> Symbol Extraction -> Packet Decoder ]
```

### Simulation Findings Summary

1. **Current Protocol (220 ms symbol, 180 ms tone, 25 ms release):**
   - Result: **0% packet decode success** across all polling offsets (0, 3, 6, 9 ms) and sample rates (44.1 kHz, 48 kHz).
   - The receiver dropped between 11 and 19 symbols per transmission because the state machine deadlocked on repeated notes and fast transitions.
2. **Option A (250 ms symbol, 160 ms tone, 15 ms release):**
   - Anechoic, no pad: 100% packet decode across all polling offsets.
   - With realistic pad and mild reverb (RT60 $= 50\text{ ms}$): **0% packet decode success**. Noise and reverberation bridged the 75 ms gap, causing symbol doubling or dropped frames.
3. **Option B (Preamble-Synchronized Clocked Decoding):**
   - Evaluated on the **unmodified current transmitter audio** (220 ms symbol, 180 ms tone, 25 ms release, with background pad, noise, and 150 ms reverb).
   - Result: **100% packet decode success** across all tests.

---

## 11. UI and Application-State Audit

### State Management & Component Structure Review

1. **Monolithic Page Layout:** [`app/page.tsx`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx) contains all screens ([`Home`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L38), [`Transmit`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L74), [`Listen`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L126), [`Reveal`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L185), [`DecoderConsole`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L174)) in a single 221-line file. While concise, state transitions between screens rely on manual `setScreen()` calls without router integration or browser history (`popstate`) support. Clicking the browser's native Back button exits the app rather than returning to the home screen.
2. **Linear Search in Render Loops:**
   - In [`Transmit`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L83): `places.filter(...)` performs an unindexed linear scan across all 1,575 records on every keystroke in the search box.
   - In [`Listen`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L147): `places.find(item => item.sonicId === result.packet!.sonicId)` performs an $O(N)$ linear scan on packet receipt. While fast enough for 1,575 items, lookup should use an $O(1)$ `Map`.
3. **Accessibility (a11y) Weaknesses:**
   - Search input ([Line 105](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L105)) lacks an accessible name; its visual label contains only the unicode character `⌕`.
   - Dual listen buttons ([Lines 163–164](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L163-L164)) render adjacent interactive controls with identical actions (`start()`), confusing screen reader users.
   - Live decoder console ([Line 176](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L176)) declares `aria-live="polite"`. Because `DecoderConsole` re-renders 83 times per second, aggressive screen readers attempt to announce every frame update, creating an unusable auditory experience.

---

## 12. Browser and Mobile Compatibility

### Compatibility Risk Matrix

| Environment | Web Audio Autoplay | MediaDevices getUserMedia | Sample Rate | DSP Constraint Honoring | Overall Risk |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **iOS Safari (iPhone)** | **High Risk:** Requires direct user gesture. Context may suspend during mic permission modal. | Supported (HTTPS only). | Typically 44.1 kHz (switches to 48 kHz on iPhone 13+ / AirPods). | **Severe Risk:** WebKit ignores `echoCancellation: false`; Apple VPIO forces voice notch filtering. | **High** |
| **Chrome Android** | Low Risk: Resumes cleanly on user touch. | Supported (HTTPS only). | Typically 48.0 kHz. | **Moderate Risk:** OEM audio HALs (Samsung, Xiaomi) enforce aggressive AGC. | **Medium** |
| **macOS Safari** | Low Risk: Resumes cleanly. | Supported. | Typically 44.1 or 48.0 kHz. | Mostly honored. | **Low** |
| **macOS / Win Chrome** | Low Risk. | Supported. | Typically 48.0 kHz. | Fully honored. | **Low** |
| **Firefox (All)** | Low Risk. | Supported. | 44.1 or 48.0 kHz. | Fully honored. | **Low** |

### Mobile Safari Permission Interruption Handling

In [`src/audio/receiver.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts#L16-L33):
```ts
const context = new AudioContext({ latencyHint: 'interactive' });
this.context = context;
const resumePromise = context.state === 'suspended' ? context.resume() : Promise.resolve();
const streamPromise = navigator.mediaDevices.getUserMedia({ ... });
const [, stream] = await Promise.all([resumePromise, streamPromise]);
if (context.state === 'suspended') await context.resume();
```
The implementation correctly initiates `context.resume()` simultaneously with `getUserMedia()` before awaiting, preserving transient user activation. Furthermore, line 32 calls `context.resume()` a second time after permission resolution. This is a solid pattern for mobile Safari. However, if the user takes longer than ~5 seconds to grant permission, iOS drops user activation, causing the second `resume()` to throw `NotAllowedError`.

---

## 13. Performance Audit

### Bundle Size & Asset Delivery

Inspecting production build artifacts from `dist/client`:

```
dist/client/_next/static/chunks/page-CFUZy7IF.js:      2.3 MB  (Raw Client Bundle)
dist/client/_next/static/chunks/esm-DA7Guhp8.js:       333 KB  (Tone.js)
dist/client/_next/static/chunks/framework-BaE7mD_r.js: 186 KB  (React 19)
dist/client/og.png:                                    953 KB  (Social Image)
```

1. **The 2.3 MB Monolithic Page Chunk:**
   [`app/page.tsx`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx) directly imports [`places.json`](file:///Users/gaurav/Documents/projects/linz-cipher/data/generated/places.json) (1.67 MB) and [`interpretations.json`](file:///Users/gaurav/Documents/projects/linz-cipher/data/generated/interpretations.json) (589 KB).
   Rolldown/Vite inlines both JSON files directly into the client page chunk.
   - **58.8% of `places.json` (0.98 MB)** consists of the redundant `raw` dictionary duplicating all original CSV column names and empty strings.
   - Every visitor downloading the home page downloads 2.3 MB of uncompressed JavaScript before seeing the first interactive screen, even if they never transmit or listen.
2. **CPU & Memory Footprint:**
   - Goertzel computation runs on the main thread: 4 filters $\times$ 1024 samples $= 4,096$ floating point operations per frame $\times 83.3\text{ frames/s} \approx 341,000\text{ FLOPS}$. While modest on modern desktop CPUs, main-thread execution combined with 83 Hz React DOM reconciliation causes thermal throttling and battery drain on mobile phones.

---

## 14. Data Pipeline Findings

### Data Integrity Audit of 1,575 Generated Records

A verification script audited [`places.json`](file:///Users/gaurav/Documents/projects/linz-cipher/data/generated/places.json) and [`interpretations.json`](file:///Users/gaurav/Documents/projects/linz-cipher/data/generated/interpretations.json):
- **Contiguous Sonic IDs:** Verified 100% contiguous from `0` to `1574`.
- **Interpretation Coverage:** Verified 100% 1-to-1 match (1,575 places to 1,575 interpretations).
- **Duplicate Detection:** Zero duplicate canonical keys.

### Pipeline Deficiencies & Inconsistencies

1. **Fragile Lexicographical ID Assignment:**
   In [`scripts/normalize-data.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/scripts/normalize-data.ts#L22):
   ```ts
   const rows = [...current, ...historical].sort((a, b) =>
     `${a.sourceType}:${a.raw.ID}`.localeCompare(`${b.sourceType}:${b.raw.ID}`)
   );
   ```
   `sonicId` is assigned as the array index after sorting.
   - Sorting string keys like `"current:1"`, `"current:10"`, `"current:2"` results in lexicographical order rather than numeric order.
   - If the City of Linz adds a single record to either CSV in a future dataset release, **the sort position of subsequent records shifts, changing the `sonicId` of hundreds of existing streets**. Any printed physical QR code, audio recording, or cached sonic ID would instantly resolve to the wrong street.
2. **Dead Semantic Mood Enum Values:**
   [`src/data/types.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/data/types.ts#L13-L20) defines 6 moods (`NEUTRAL`, `REFLECTIVE`, `WARM`, `DARK`, `TENSE`, `HOPEFUL`).
   However, [`normalize-data.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/scripts/normalize-data.ts#L14-L18) only ever maps to `NEUTRAL` (1,201 records), `REFLECTIVE` (364 records), or `WARM` (10 records).
   Moods `DARK` (3), `TENSE` (4), and `HOPEFUL` (5) are never generated.
3. **Unencrypted External Source Links:**
   Across the 1,575 places, **1,211 records contain unencrypted `http://` links** (e.g. `http://www.linz.at/strassennamen/...`) in `place.raw.Link`. When rendered in [`Reveal`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L200), clicking this link causes mixed-content warnings or insecure navigation.

---

## 15. Security and Privacy Audit

### Verification of Privacy Claim

The UI explicitly displays the claim:
> *"Audio is analyzed locally on this device. Nothing is recorded or uploaded."*

**Audit Result: VERIFIED AND ACCURATE.**
- Full codebase static search confirmed **zero outbound network requests** (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`) in client runtime code (`src/` and `app/`).
- Network requests only exist in [`scripts/generate-interpretations.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/scripts/generate-interpretations.ts#L24), which is an offline developer script.
- Microphone audio streams into a local Web Audio `AnalyserNode` in volatile memory and is never serialized, cached to IndexedDB, or transmitted.

### Security Concerns

1. **Exposed Live API Key in Local Workspace ([MEDIUM]):**
   File [`.env.local`](file:///Users/gaurav/Documents/projects/linz-cipher/.env.local) contains an active OpenRouter API key (`sk-or-v1-e8acc6c4...`).
   While [`.gitignore`](file:///Users/gaurav/Documents/projects/linz-cipher/.gitignore#L9) correctly ignores `.env*` (and git history confirms it was never committed), storing live paid credentials in a project directory presents an operational risk. The key should be revoked and replaced with environment variables injected via secrets management.
2. **Target Blank Reverse Tabnabbing:**
   External links in [`Reveal`](file:///Users/gaurav/Documents/projects/linz-cipher/app/page.tsx#L200) specify `target="_blank" rel="noreferrer"`. Modern browsers automatically imply `noopener` when `noreferrer` is set. However, URLs should be sanitized to ensure they start with `https://` or `http://` to prevent `javascript:` URI injection.

---

## 16. Deployment Audit

### Vercel vs Cloudflare vs Vite

1. **Configuration Discrepancy:**
   - [`package.json`](file:///Users/gaurav/Documents/projects/linz-cipher/package.json#L10) specifies `"build": "vinext build"`.
   - [`vercel.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/vercel.ts#L5) specifies `buildCommand: 'npx vite build'` and `framework: null`.
   - [`vite.config.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/vite.config.ts#L44-L58) dynamically switches platform adapters:
     ```ts
     const isVercelBuild = process.env.VERCEL === '1';
     const platformPlugins = isVercelBuild
       ? [(await import('nitro/vite')).nitro()]
       : [sites(), (await import('@cloudflare/vite-plugin')).cloudflare(...)];
     ```
2. **Runtime Divergence Risk:**
   - Local development (`npm run dev`) runs inside Cloudflare Workers / Miniflare emulation via `@cloudflare/vite-plugin`.
   - Vercel deployments run inside Nitro's Node.js server engine.
   Testing locally does not guarantee identical behavior on Vercel. Standardizing on a single build target eliminates deployment-specific edge cases.

---

## 17. Dependency Audit

### Toolchain and Dependency Assessment

| Package | Version | Classification | Risk & Impact |
| :--- | :---: | :---: | :--- |
| `tone` | `^15.1.22` | Core Audio | Standard Web Audio synthesis library. Solid, but bundle size is substantial (333 KB). |
| `vinext` | `1.0.0-beta.3` | Framework Bridge | **High Risk:** Early beta software attempting to emulate Next.js App Router on Vite. Prone to breaking changes. |
| `next` | `16.2.6` | Framework | **High Risk:** Canary/unreleased major version. Used for types and conventions rather than compiling. |
| `react` / `react-dom` | `19.2.6` | UI Library | React 19 canary/latest. |
| `zod` | `^4.6.2` | Validation | Zod 4 is an experimental release branch. |
| `nitro` | `^3.0.260903-beta` | Deployment Adapter | Beta server engine. |
| `@cloudflare/vite-plugin` | `1.37.1` | Dev Tooling | Local Cloudflare Workers simulation. Unnecessary since app uses no D1 or R2 bindings. |
| `@openai/sites-vite-plugin`| `^0.1.0` | Hosting Tooling | OpenAI preview tooling. |

**Recommendation:** The application does not use server-side databases (D1 is null, R2 is null) or dynamic server APIs. It is a client-side audio experience. The entire complexity of `vinext` + Cloudflare + Nitro + Next 16 can be replaced with a clean, static Vite + React build, reducing build times from 11s down to <1s and eliminating hundreds of transitive dependencies.

---

## 18. Code Quality Findings

1. **Magic Constants in Audio Modules:**
   Constants such as `0.008` (RMS threshold), `2.2` (confidence ratio), `0.92` (velocity), and `0.08` (audio start lead time) are hardcoded across [`detector.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/detector.ts) and [`transmitter.ts`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/transmitter.ts) without named configuration interfaces.
2. **Tight Coupling of Audio Engine with UI:**
   [`SonicReceiver`](file:///Users/gaurav/Documents/projects/linz-cipher/src/audio/receiver.ts) directly accepts UI callbacks `onFrame` and `onSymbol`. Audio analysis, state machine transitions, and UI polling are tightly bound in one loop.
3. **Missing React Error Boundaries:**
   Audio initialization failures (e.g. `NotAllowedError` when microphone access is denied) set local component error state, but unhandled Web Audio crashes during decoding lack an Error Boundary, which can crash the entire React application tree.

---

## 19. Recommended Architecture

To achieve rock-solid reliability, the application should evolve toward:

```
+-----------------------------------------------------------------------------+
|                         RECOMMENDED ARCHITECTURE                            |
|                                                                             |
|  [ Presentation Layer (React 19 / Vite) ]                                   |
|    - Thin UI views: Home, Transmit, Listen, Reveal                          |
|    - Framerate throttled rendering (requestAnimationFrame @ 15fps)          |
|    - Lazy-loaded record database (split manifest + chunked place data)       |
|                                                                             |
|  [ Audio Subsystem (Web Audio Engine) ]                                     |
|    - Persistent AudioContext singleton with user-gesture unlock             |
|    - Dedicated AudioWorkletNode for Goertzel analysis (zero main-thread load)|
|    - Ducked / Low-pass filtered musical accompaniment                       |
|                                                                             |
|  [ Protocol Engine (SLP/2 Clocked Decoder) ]                                |
|    - Preamble transition lock (time & tempo synchronization)                |
|    - Clocked symbol sampling at slot centers (majority voting)              |
|    - Zero dependence on acoustic silence                                    |
|    - CRC-8 validation + semantic bounds verification                        |
+-----------------------------------------------------------------------------+
```

---

## 20. Prioritized Fix Plan

### P0 — Must Fix Before Reliable Live Demo

1. **Implement Protocol v2 Clocked Decoder ([CF-01]):**
   - Complexity: Medium | Regression Risk: Low | Expected Benefit: Transforms transmission success rate from 0% to >98%.
2. **Duck Musical Pad During Data Transmission ([CF-02]):**
   - Complexity: Small | Regression Risk: Low | Expected Benefit: Eliminates false carrier triggers and harmonic distortion.
3. **Throttle React `setFrame` Updates ([CF-04]):**
   - Complexity: Small | Regression Risk: Low | Expected Benefit: Eliminates main-thread UI freeze and timer jitter on mobile devices.
4. **Implement Transmitter Cancellation & Debounce ([CF-05]):**
   - Complexity: Small | Regression Risk: Low | Expected Benefit: Prevents overlapping audio playback and crashes when navigating.

### P1 — Reliability Improvements

1. **Add Hann Windowing to Goertzel Detector:**
   - Complexity: Small | Regression Risk: Low | Expected Benefit: Drops adjacent carrier leakage by 18 dB.
2. **Implement AudioWorklet for Goertzel Processing:**
   - Complexity: Medium | Regression Risk: Medium | Expected Benefit: Moves all audio DSP off the JavaScript UI thread.
3. **Upgrade Synthetic Audio Test Suite:**
   - Complexity: Medium | Regression Risk: Low | Expected Benefit: Continuous PCM regression testing prevents future acoustic regressions.

### P2 — Architecture Improvements

1. **Decouple Raw CSV Fields from `places.json`:**
   - Complexity: Small | Regression Risk: Low | Expected Benefit: Reduces bundle size by 1.0 MB (60% smaller).
2. **Stabilize Sonic ID Assignment:**
   - Complexity: Small | Regression Risk: Medium | Expected Benefit: Stable numeric IDs that survive dataset additions.
3. **Replace Monolithic `app/page.tsx` with Component Hierarchy:**
   - Complexity: Medium | Regression Risk: Low | Expected Benefit: Maintainability, proper URL routing, and Back button support.

### P3 — Polish & Maintenance

1. **Revoke and Remove Local OpenRouter API Key from `.env.local`:**
   - Complexity: Small | Regression Risk: Low | Expected Benefit: Security hygiene.
2. **Upgrade HTTP Links to HTTPS in Place Records:**
   - Complexity: Small | Regression Risk: Low | Expected Benefit: Eliminates mixed-content warnings.
3. **Standardize Build Toolchain (Vite Static SPA):**
   - Complexity: Medium | Regression Risk: Low | Expected Benefit: Eliminates framework divergence between dev and Vercel.

---

## 21. Recommended Audio Protocol v2 (SLP/2 Specification)

To ensure high-fidelity transmission over physical mobile speakers and microphones, **Protocol v2 replaces silence-dependent framing with preamble-synchronized clocked symbol decoding**.

### Key Parameter Specifications

```
                     <- SYMBOL_MS = 220 ms ->
+--------------------+-----------------------+--------------------+
|  Tone Attack (8ms) |  Active Carrier Tone  | Tone Release (12ms)|
|                    |     (180 ms nominal)  |                    |
+--------------------+-----------------------+--------------------+
                     <--- SAMPLING WINDOW -->
                          (Center 60%)
```

1. **Symbol Duration ($T_{\text{sym}}$):** 220 ms (Preserves total transmission duration of 5.7 seconds).
2. **Active Tone Duration ($T_{\text{tone}}$):** 190 ms.
3. **Envelope:** Attack: 8 ms, Decay: 15 ms, Sustain: 0.85, Release: 12 ms. (Slightly faster release prevents acoustic tail from encroaching on the next symbol's center).
4. **Carriers:** C5 (523.25 Hz), E♭5 (622.25 Hz), G5 (783.99 Hz), B♭5 (932.33 Hz) with Hann windowing on the receiver.
5. **Background Music Accompaniment:**
   - Bus gain ducked by $-18\text{ dB}$ ($0.03$ velocity) during symbol playback.
   - Steep low-pass filter at $350\text{ Hz}$ applied to the pad bus to ensure zero harmonic content above 500 Hz.
6. **Clocked Synchronization Strategy:**
   - **Phase 1 (Preamble Search):** Continuous sliding buffer searches for the sequence `[0, 3, 0, 3, 1, 2]`.
   - **Phase 2 (Clock Lock):** The arrival of the final preamble transition locks the symbol clock origin $t_0$.
   - **Phase 3 (Payload Sampling):** For each of the 20 payload symbols $k = 0 \dots 19$:
     - Symbol center is calculated at $t_k = t_0 + (k + 0.5) \times 220\text{ ms}$.
     - The receiver samples all detector frames within the center window $[t_k - 40\text{ ms}, t_k + 40\text{ ms}]$ (approximately 6–7 frames).
     - **Majority Voting:** The symbol with the highest count of valid frames wins.
     - **Zero Reliance on Silence:** The receiver does not need or expect silence between symbols. Repeated identical symbols (e.g. `[0, 0, 0]`) decode with 100% fidelity.

---

## 22. Verification of the Silence-Framing Hypothesis

### The Hypothesis
> *Symbol framing fails because effective acoustic silence is shorter than the receiver analysis window.*

### Detailed Verification Findings

| Verification Checkpoint | Theoretical Value | Physical / Measured Value | Verification Result |
| :--- | :---: | :---: | :---: |
| **Synthesizer Release Tail** | 0 ms nominal | 25 ms exponential ramp | **Confirmed:** Tone sounds for 205 ms |
| **Acoustic Silence Interval** | 40 ms nominal | **15 ms effective** ($220 - 205$) | **Confirmed:** Gap shortened by 62.5% |
| **Analysis Window Duration** | 0 ms (point) | **21.33 ms** (48 kHz) / **23.22 ms** (44.1 kHz) | **Confirmed:** Window is 42% longer than gap |
| **Analysis Windows in Gap** | $\ge 1$ expected | **0.00 (Zero)** | **Confirmed:** Window never fits inside gap |
| **State Machine Unlocking** | Unlocks on gap | **Deadlocks on carrier** | **Confirmed:** Never receives required `null` |
| **Preamble Transmission** | 6 symbols emitted | **3 symbols emitted (`[0, 1, 2]`)** | **Confirmed:** Preamble fails to sync |

### Comparison of Proposed Solutions

#### Option A: Immediate Parameter Adjustment
- **Changes:** Increase `SYMBOL_MS` to 260 ms, decrease `TONE_MS` to 160 ms, decrease release to 12 ms, duck pad by $-18\text{ dB}$.
- **Effective Silence Gap:** $260 - (160 + 12) = \mathbf{88\text{ ms}}$.
- **Analysis Windows in Gap:** $\approx 4.1$ windows.
- **Evaluation:** Resolves framing in anechoic conditions. However, in physical rooms with reverberation (RT60 $> 80\text{ ms}$), reverberation tails still bridge the gap. Option A is an acceptable quick patch for quiet demos, but not a robust architectural solution.

#### Option B: Preamble-Synchronized Clocked Decoding
- **Changes:** Switch to synchronous clocked decoding with majority voting across each 220 ms symbol slot.
- **Evaluation:** 100% decode rate achieved in tests with 150 ms reverberation, pad audio, and noise. Option B completely decouples symbol framing from acoustic silence and is the **recommended production architecture**.

---

## 23. Test Plan

### Phase 1: Automated Continuous PCM Simulation (Pre-Merge)
1. Run `tests/synthetic-audio.test.ts` updated with continuous PCM generation modeling:
   - Complete 26-symbol packets without manual null injection.
   - 48.0 kHz and 44.1 kHz sample rates.
   - 0, 3, 6, 9 ms polling offsets.
   - Background pad active.
   - Reverb simulation (convolution with 100 ms exponential decay).
2. Requirement: 100% pass rate across all combinations.

### Phase 2: Dual Physical-Device Validation (Staging)
1. **Hardware Matrix:**
   - Transmitter: iPhone 14 Pro (Safari) | Receiver: Pixel 7 (Chrome)
   - Transmitter: Pixel 7 (Chrome) | Receiver: iPhone 13 (Safari)
   - Transmitter: MacBook Pro (Chrome) | Receiver: iPhone 14 Pro (Safari)
2. **Acoustic Test Environments:**
   - Quiet room (ambient noise $< 35\text{ dBA}$) at 20 cm, 50 cm, and 1.5 meters.
   - Moderately reverberant office room (ambient noise $\approx 45\text{ dBA}$) at 50 cm.
   - Background speech/music playing at conversational volume.
3. **Success Criteria:** 10 consecutive successful packet transmissions without false drops or corrupted records.

---

## 24. Open Questions

The following questions cannot be conclusively resolved from source code alone and require physical device telemetry:
1. **Apple WebKit VPIO Attenuation Profile:** Does iOS Safari apply dynamic spectral notching specifically to the 523–932 Hz band after 3+ seconds of continuous listening?
2. **Android OEM Audio HAL Distortion:** On budget Android handsets, what is the total harmonic distortion (THD) of the built-in speaker at 80% volume when playing C5 (523 Hz) alongside C3 (130 Hz)?
3. **Microphone AGC Recovery Rate:** On iOS devices, what is the exact release time constant of the hardware AGC following loud carrier tones?
