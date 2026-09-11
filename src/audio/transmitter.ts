import { CARRIER_FREQUENCIES, SYMBOL_MS, TONE_MS, encodePacket, type SonicPacket } from '../protocol/protocol';

export interface AmbientMusicProfile {
  tempo: number;
  brightness: number;
  density: number;
  tension: number;
  warmth: number;
  rhythmicActivity: number;
  texture: 'ambient' | 'pulse' | 'drone' | 'fragmented' | 'flowing';
}

export const TRANSMISSION_ENVELOPE = {
  attackMs: 12,
  decayMs: 18,
  sustain: 0.84,
  releaseMs: 18,
} as const;

export const AMBIENT_TIMING = {
  introLeadSeconds: 1.45,
  introDurationSeconds: 1.08,
  payloadToResolutionSeconds: 0.16,
  resolutionDurationSeconds: 1.72,
} as const;

function ambientVoicing(packet: SonicPacket, profile?: AmbientMusicProfile) {
  const roots = [130.81, 146.83, 164.81, 174.61, 196] as const;
  const root = roots[(packet.sonicId + packet.mood) % roots.length];
  const tension = profile?.tension ?? 0.3;
  const brightness = profile?.brightness ?? 0.45;
  const secondRatio = tension > 0.68 ? 1.2 : brightness > 0.55 ? 1.25 : 1.1892;
  const thirdRatio = tension > 0.72 ? 1.4142 : 1.4983;
  return [root, root * secondRatio, root * thirdRatio];
}

export async function transmit(
  packet: SonicPacket,
  onSymbol?: (symbol: number, index: number) => void,
  signal?: AbortSignal,
  music?: AmbientMusicProfile,
) {
  const Tone = await import('tone');
  if (signal?.aborted) return;
  await Tone.start();
  const dataBus = new Tone.Gain(Tone.dbToGain(-6)).toDestination();
  const ambientBus = new Tone.Gain(Tone.dbToGain(-18 + (music?.warmth ?? 0.5) * 4)).toDestination();
  const dataSynth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: {
      attack: TRANSMISSION_ENVELOPE.attackMs / 1000,
      decay: TRANSMISSION_ENVELOPE.decayMs / 1000,
      sustain: TRANSMISSION_ENVELOPE.sustain,
      release: TRANSMISSION_ENVELOPE.releaseMs / 1000,
    },
  }).connect(dataBus);
  const ambientSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: .28, decay: .42, sustain: .34, release: .26 },
  }).connect(ambientBus);
  const symbols = encodePacket(packet);
  const now = Tone.now();
  const start = now + AMBIENT_TIMING.introLeadSeconds;
  const payloadDuration = symbols.length * SYMBOL_MS / 1000;
  const resolutionStart = start + payloadDuration + AMBIENT_TIMING.payloadToResolutionSeconds;
  const voicing = ambientVoicing(packet, music);
  const callbackTimers: number[] = [];

  // Musical material stays outside the compatibility-critical payload. Low sine
  // voicings fade completely before the first carrier and return only after the
  // encoded passage has ended.
  ambientSynth.triggerAttackRelease(voicing.slice(0, music?.density && music.density > .58 ? 3 : 2), AMBIENT_TIMING.introDurationSeconds, now + .06, .28);
  symbols.forEach((symbol, i) => {
    const when = start + i * SYMBOL_MS / 1000;
    dataSynth.triggerAttackRelease(CARRIER_FREQUENCIES[symbol], TONE_MS / 1000, when, .92);
    callbackTimers.push(window.setTimeout(() => onSymbol?.(symbol, i), Math.max(0, (when - Tone.now()) * 1000)));
  });
  ambientSynth.triggerAttackRelease(voicing, AMBIENT_TIMING.resolutionDurationSeconds, resolutionStart, .34);

  const total = AMBIENT_TIMING.introLeadSeconds
    + payloadDuration
    + AMBIENT_TIMING.payloadToResolutionSeconds
    + AMBIENT_TIMING.resolutionDurationSeconds;
  await new Promise<void>(resolve => {
    let finished = false;
    let completionTimer = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      callbackTimers.forEach(timer => clearTimeout(timer));
      clearTimeout(completionTimer);
      signal?.removeEventListener('abort', finish);
      dataSynth.triggerRelease();
      ambientSynth.releaseAll();
      dataSynth.dispose();
      ambientSynth.dispose();
      dataBus.dispose();
      ambientBus.dispose();
      resolve();
    };
    completionTimer = window.setTimeout(finish, (total + .4) * 1000);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}
