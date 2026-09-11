'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SonicEvent, SonicMood, type Interpretation } from '../../../src/data/types';
import { CARRIER_FREQUENCIES, CARRIER_NOTES } from '../../../src/protocol/protocol';
import { SonicReceiver } from '../../../src/audio/receiver';
import { transmit } from '../../../src/audio/transmitter';
import type { DetectionFrame } from '../../../src/audio/detector';

const testInterpretation: Interpretation = { sonicId: 42, headline: 'Test packet', story: 'Fixed diagnostic packet.', music: { tempo: 68, brightness: .4, density: .25, tension: .45, warmth: .6, rhythmicActivity: .2, texture: 'ambient' } };

function playCarrier(frequency: number) {
  const context = new AudioContext();
  const oscillator = context.createOscillator(); const gain = context.createGain();
  oscillator.frequency.value = frequency; oscillator.type = 'sine'; oscillator.connect(gain).connect(context.destination);
  gain.gain.setValueAtTime(.001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.5, context.currentTime + .015); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .5);
  oscillator.start(); oscillator.stop(context.currentTime + .52); oscillator.onended = () => void context.close();
}

export default function AudioDebug() {
  const [frame, setFrame] = useState<DetectionFrame | null>(null); const [active, setActive] = useState(false); const [last, setLast] = useState<number | null>(null); const receiver = useRef<SonicReceiver | null>(null);
  useEffect(() => () => receiver.current?.stop(), []);
  const toggle = async () => {
    if (active) { receiver.current?.stop(); setActive(false); return; }
    const next = new SonicReceiver(); receiver.current = next;
    await next.start(setFrame, setLast); setActive(true);
  };
  return (
    <main className="debug-shell">
      <header className="topbar"><Link className="wordmark" href="/">SONIC LINZ</Link><div className="protocol-pill"><i /> AUDIO LAB</div></header>
      <div className="debug-wrap">
        <div className="debug-head"><div><p className="eyebrow">SLP/1 DIAGNOSTICS</p><h1>Audio laboratory.</h1></div><button className="button button-primary" onClick={toggle}>{active ? 'Stop microphone' : 'Start microphone'}</button></div>
        <section className="meter-card">
          <div className="rms-row"><span>MIC RMS</span><div><i style={{ transform: `scaleX(${Math.min(1, (frame?.rms ?? 0) * 8)})` }} /></div><b>{((frame?.rms ?? 0) * 100).toFixed(2)}%</b></div>
          {CARRIER_NOTES.map((note, index) => { const energy = frame?.energies[index] ?? 0; const strongest = Math.max(...(frame?.energies ?? [1])); return <div className="carrier-row" key={note}><strong>{note.replace('b', '♭')}</strong><small>{Math.round(CARRIER_FREQUENCIES[index])} HZ</small><div><i style={{ transform: `scaleX(${energy / Math.max(strongest, 1e-8)})` }} /></div><b>{energy.toExponential(1)}</b><button onClick={() => playCarrier(CARRIER_FREQUENCIES[index])}>PLAY</button></div>; })}
          <div className="detection"><span>DETECTED <b>{last === null ? '—' : CARRIER_NOTES[last].replace('b', '♭')}</b></span><span>CONFIDENCE <b>{(frame?.confidence ?? 0).toFixed(2)}×</b></span></div>
        </section>
        <section className="test-packet"><div><p className="eyebrow">FIXED TEST PACKET</p><h2>Record 0042</h2><p>NAME_CHANGED · REFLECTIVE · CRC-8</p></div><button className="button button-ghost" onClick={() => transmit({ version: 1, sonicId: 42, eventType: SonicEvent.NAME_CHANGED, mood: SonicMood.REFLECTIVE }, testInterpretation)}>Transmit test packet</button></section>
      </div>
    </main>
  );
}
