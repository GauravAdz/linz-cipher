'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SonicEvent, SonicMood } from '../../../src/data/types';
import { CARRIER_FREQUENCIES, CARRIER_NOTES } from '../../../src/protocol/protocol';
import { SonicReceiver, type ReceiverInfo } from '../../../src/audio/receiver';
import { transmit } from '../../../src/audio/transmitter';
import type { DetectionFrame } from '../../../src/audio/detector';
import type { DecoderDiagnostics } from '../../../src/audio/clocked-decoder';

function playCarrier(frequency: number) {
  const context = new AudioContext();
  const oscillator = context.createOscillator(); const gain = context.createGain();
  oscillator.frequency.value = frequency; oscillator.type = 'sine'; oscillator.connect(gain).connect(context.destination);
  gain.gain.setValueAtTime(.001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.5, context.currentTime + .015); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .5);
  oscillator.start(); oscillator.stop(context.currentTime + .52); oscillator.onended = () => void context.close();
}

export default function AudioDebug() {
  const [frame, setFrame] = useState<DetectionFrame | null>(null);
  const [active, setActive] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<DecoderDiagnostics | null>(null);
  const [info, setInfo] = useState<ReceiverInfo | null>(null);
  const [crcOutcome, setCrcOutcome] = useState('—');
  const [error, setError] = useState('');
  const receiver = useRef<SonicReceiver | null>(null);
  useEffect(() => () => receiver.current?.stop(), []);
  const toggle = async () => {
    if (active) { receiver.current?.stop(); setActive(false); return; }
    const next = new SonicReceiver(); receiver.current = next;
    setError(''); setCrcOutcome('—');
    try {
      await next.start({
        onFrame: (nextFrame, nextDiagnostics) => {
          setFrame(nextFrame); setLast(nextFrame.detectedSymbol); setDiagnostics(nextDiagnostics);
        },
        onEvent: event => {
          setDiagnostics(event.diagnostics);
          if (event.type === 'slot') setLast(event.slot.symbol);
          if (event.type === 'packet') setCrcOutcome(event.slots.some(s => s.repaired) ? 'REPAIRED (CHASE FEC)' : 'VALID');
          if (event.type === 'error') setCrcOutcome(event.reason === 'Checksum failed' ? 'FAILED' : event.reason.toUpperCase());
        },
        onInfo: setInfo,
      });
      setActive(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Microphone access failed.');
    }
  };
  return (
    <main className="debug-shell">
      <header className="topbar">
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Link className="wordmark" href="/">SONIC LINZ</Link>
          <Link href="/debug/embed" style={{ color: 'var(--lime)', fontSize: '11px', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>
            SLP/2 Embed Studio →
          </Link>
        </div>
        <div className="protocol-pill"><i /> AUDIO LAB</div>
      </header>
      <div className="debug-wrap">
        <div className="debug-head"><div><p className="eyebrow">SLP/1 DIAGNOSTICS</p><h1>Audio laboratory.</h1></div><button className="button button-primary" onClick={toggle}>{active ? 'Stop microphone' : 'Start microphone'}</button></div>
        <section className="meter-card">
          <div className="rms-row"><span>MIC RMS / PEAK</span><div><i style={{ transform: `scaleX(${Math.min(1, (frame?.rms ?? 0) * 8)})` }} /></div><b>{((frame?.rms ?? 0) * 100).toFixed(2)}% {((frame?.peak ?? 0) > 0.92) ? '⚠️ CLIP' : ''}</b></div>
          {CARRIER_NOTES.map((note, index) => { const energy = frame?.energies[index] ?? 0; const strongest = Math.max(...(frame?.energies ?? [1])); return <div className="carrier-row" key={note}><strong>{note.replace('b', '♭')}</strong><small>{Math.round(CARRIER_FREQUENCIES[index])} HZ</small><div><i style={{ transform: `scaleX(${energy / Math.max(strongest, 1e-8)})` }} /></div><b>{energy.toExponential(1)}</b><button onClick={() => playCarrier(CARRIER_FREQUENCIES[index])}>PLAY</button></div>; })}
          <div className="detection"><span>DETECTED <b>{last === null ? '—' : CARRIER_NOTES[last].replace('b', '♭')}</b></span><span>CONFIDENCE <b>{(frame?.confidence ?? 0).toFixed(2)}×</b></span></div>
          <div className="detection"><span>DECODER <b>{diagnostics?.state ?? 'SEARCHING'}</b></span><span>SYNC / CLOCK <b>{(diagnostics?.syncScore ?? 0).toFixed(2)} · {diagnostics?.symbolPeriodMs?.toFixed(1) ?? '—'} MS</b></span></div>
          <div className="detection"><span>PAYLOAD SLOT <b>{diagnostics?.payloadSlot ?? 0} / 20</b></span><span>SLOT CONF / CRC <b>{diagnostics?.slotConfidence?.toFixed(2) ?? '—'}× · {crcOutcome}</b></span></div>
          <div className="detection"><span>AUDIO CONTEXT <b>{info?.audioContextState?.toUpperCase() ?? '—'} · {info?.sampleRate ?? '—'} HZ</b></span><span>COUNTERS <b>{diagnostics?.successfulPackets ?? 0} OK ({diagnostics?.repairedPackets ?? 0} REPAIRED) · {diagnostics?.crcFailures ?? 0} CRC · {diagnostics?.syncLosses ?? 0} LOST</b></span></div>
        </section>
        {error && <p className="error">{error}</p>}
        <section className="test-packet"><div><p className="eyebrow">FIXED TEST PACKET</p><h2>Record 0042</h2><p>NAME_CHANGED · REFLECTIVE · CRC-8</p></div><button className="button button-ghost" onClick={() => void transmit({ version: 1, sonicId: 42, eventType: SonicEvent.NAME_CHANGED, mood: SonicMood.REFLECTIVE })}>Transmit test packet</button></section>
      </div>
    </main>
  );
}
