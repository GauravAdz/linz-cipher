import { CARRIER_FREQUENCIES, SYMBOL_MS, TONE_MS, encodePacket, type SonicPacket } from '../protocol/protocol';

export async function transmit(
  packet: SonicPacket,
  onSymbol?: (symbol: number, index: number) => void,
  signal?: AbortSignal,
) {
  const Tone = await import('tone');
  if (signal?.aborted) return;
  await Tone.start();
  const dataBus = new Tone.Gain(Tone.dbToGain(-4)).toDestination();
  const dataSynth = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: .006, decay: .02, sustain: .9, release: .012 } }).connect(dataBus);
  const symbols = encodePacket(packet);
  const start = Tone.now() + .08;
  const total = symbols.length * SYMBOL_MS / 1000;
  const callbackTimers: number[] = [];
  symbols.forEach((symbol, i) => {
    const when = start + i * SYMBOL_MS / 1000;
    dataSynth.triggerAttackRelease(CARRIER_FREQUENCIES[symbol], TONE_MS / 1000, when, .92);
    callbackTimers.push(window.setTimeout(() => onSymbol?.(symbol, i), Math.max(0, (when - Tone.now()) * 1000)));
  });
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
      dataSynth.dispose();
      dataBus.dispose();
      resolve();
    };
    completionTimer = window.setTimeout(finish, (total + .25) * 1000);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}
