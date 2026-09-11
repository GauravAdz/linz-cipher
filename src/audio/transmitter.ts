import { CARRIER_FREQUENCIES, SYMBOL_MS, TONE_MS, encodePacket, type SonicPacket } from '../protocol/protocol';
import type { Interpretation } from '../data/types';

export async function transmit(packet: SonicPacket, interpretation: Interpretation, onSymbol?: (symbol: number, index: number) => void) {
  const Tone = await import('tone');
  await Tone.start();
  const dataBus = new Tone.Gain(Tone.dbToGain(-4)).toDestination();
  const musicBus = new Tone.Gain(Tone.dbToGain(-17)).toDestination();
  const dataSynth = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: .006, decay: .02, sustain: .9, release: .025 } }).connect(dataBus);
  const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: interpretation.music.warmth > .55 ? 'sine' : 'triangle' }, envelope: { attack: .8, decay: .4, sustain: .45, release: 1.2 } }).connect(musicBus);
  const symbols = encodePacket(packet);
  const start = Tone.now() + .08;
  const total = symbols.length * SYMBOL_MS / 1000;
  pad.triggerAttackRelease(['C3', 'G3', 'D4'], Math.max(total - .2, 1), start, .3);
  symbols.forEach((symbol, i) => {
    const when = start + i * SYMBOL_MS / 1000;
    dataSynth.triggerAttackRelease(CARRIER_FREQUENCIES[symbol], TONE_MS / 1000, when, .92);
    window.setTimeout(() => onSymbol?.(symbol, i), Math.max(0, (when - Tone.now()) * 1000));
  });
  await new Promise(resolve => window.setTimeout(resolve, (total + .25) * 1000));
  dataSynth.dispose(); pad.dispose(); dataBus.dispose(); musicBus.dispose();
}
