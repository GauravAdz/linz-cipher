'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import placesJson from '../data/generated/places.json';
import interpretationsJson from '../data/generated/interpretations.json';
import { SonicEvent, type Interpretation, type PlaceRecord } from '../src/data/types';
import { CARRIER_NOTES, PROTOCOL_VERSION, encodePacket, type SonicPacket } from '../src/protocol/protocol';
import { transmit } from '../src/audio/transmitter';
import { SonicReceiver } from '../src/audio/receiver';
import type { DetectionFrame } from '../src/audio/detector';
import type { ClockedDecoderEvent, DecoderDiagnostics } from '../src/audio/clocked-decoder';

const places = placesJson as PlaceRecord[];
const interpretations = interpretationsJson as Interpretation[];
const interpretationById = new Map(interpretations.map(value => [value.sonicId, value]));

const eventNames: Record<number, string> = {
  [SonicEvent.UNKNOWN]: 'CITY RECORD',
  [SonicEvent.NAME_CHANGED]: 'NAME CHANGED',
  [SonicEvent.HISTORICAL_NAME]: 'HISTORICAL NAME',
  [SonicEvent.NAMED_AFTER_PERSON]: 'NAMED AFTER PERSON',
  [SonicEvent.PLACE_REFERENCE]: 'PLACE REFERENCE',
  [SonicEvent.GEOGRAPHIC_REFERENCE]: 'GEOGRAPHIC REFERENCE',
  [SonicEvent.COMMEMORATION]: 'COMMEMORATION',
};

type Screen = 'home' | 'transmit' | 'listen' | 'reveal';
const featuredIds = [1223, 1226, 1227, 1241, 1265, 1299];

function Brand({ onHome }: { onHome: () => void }) {
  return (
    <header className="topbar">
      <button className="wordmark" onClick={onHome}>SONIC LINZ</button>
      <div className="protocol-pill"><i /> SLP/1 · OFFLINE</div>
    </header>
  );
}

function Home({ go }: { go: (screen: Screen) => void }) {
  return (
    <main className="home-shell screen-enter">
      <Brand onHome={() => go('home')} />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">THE CITY SPEAKS IN MUSIC</p>
          <h1>Hear the city <em>remember.</em></h1>
          <p className="dek">Linz street history becomes a musical transmission. One phone plays. Another listens. The story travels through air.</p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => go('listen')}><span className="listen-dot" /> Listen for Linz</button>
            <button className="button button-ghost" onClick={() => go('transmit')}>Transmit a street <span>↗</span></button>
          </div>
        </div>
        <SignalOrb />
      </section>
      <div className="duality" aria-label="Humans hear music. Machines hear Linz data.">
        <span><small>HUMAN</small> MUSIC</span><b>+</b><span><small>MACHINE</small> LINZ DATA</span>
      </div>
    </main>
  );
}

function SignalOrb({ active = false, symbol = 0 }: { active?: boolean; symbol?: number }) {
  return (
    <div className={`signal-orb ${active ? 'is-active' : ''}`}>
      <div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="orbit orbit-c" />
      <div className="note-wheel">
        {CARRIER_NOTES.map((note, index) => <span className={symbol === index && active ? 'hot' : ''} key={note} style={{ '--angle': `${index * 90}deg` } as React.CSSProperties}>{index.toString(2).padStart(2, '0')} · {note.replace('b', '♭')}</span>)}
      </div>
      <div className="orb-core"><strong>♪</strong><small>DATA + MUSIC</small></div>
      <div className="wave wave-a" /><div className="wave wave-b" />
    </div>
  );
}

function Transmit({ go }: { go: (screen: Screen) => void }) {
  const [query, setQuery] = useState('');
  const initial = places.find(p => p.sonicId === 1223) ?? places.find(p => p.source.type === 'historical')!;
  const [selected, setSelected] = useState(initial);
  const [playing, setPlaying] = useState(false);
  const [symbol, setSymbol] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const playingRef = useRef(false);
  const transmission = useRef<AbortController | null>(null);
  const results = useMemo(() => {
    const pool = query ? places.filter(p => `${p.street.name} ${p.street.currentName ?? ''}`.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de'))) : featuredIds.map(id => places.find(p => p.sonicId === id)).filter(Boolean) as PlaceRecord[];
    return pool.slice(0, 7);
  }, [query]);
  useEffect(() => () => transmission.current?.abort(), []);

  const play = async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    setError(''); setPlaying(true); setProgress(0);
    const packet: SonicPacket = { version: PROTOCOL_VERSION, sonicId: selected.sonicId, eventType: selected.semantic.eventType, mood: selected.semantic.mood };
    const controller = new AbortController();
    transmission.current = controller;
    const symbolCount = encodePacket(packet).length;
    try { await transmit(packet, (next, index) => { setSymbol(next); setProgress((index + 1) / symbolCount); }, controller.signal); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Audio could not start.'); }
    finally {
      if (transmission.current === controller) transmission.current = null;
      playingRef.current = false;
      setPlaying(false); setProgress(0);
    }
  };

  return (
    <main className="app-shell screen-enter">
      <Brand onHome={() => go('home')} />
      <button className="back" onClick={() => go('home')}>← &nbsp;BACK</button>
      <div className="transmit-grid">
        <section>
          <p className="eyebrow">PHONE A · TRANSMITTER</p>
          <h2>Choose a memory.</h2>
          <label className="search-box"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search 1,575 Linz records" /></label>
          <div className="record-list">
            {results.map(place => <button key={place.sonicId} className={place.sonicId === selected.sonicId ? 'selected' : ''} onClick={() => { setSelected(place); setQuery(''); }}><span><strong>{place.street.name}</strong><small>{place.street.currentName && place.street.currentName !== place.street.name ? `→ ${place.street.currentName}` : place.history.namingPeriod || place.source.type}</small></span><b>{String(place.sonicId).padStart(4, '0')}</b></button>)}
          </div>
        </section>
        <section className="transmit-card">
          <div className="record-meta"><span>{eventNames[selected.semantic.eventType]}</span><span>SONIC ID &nbsp;<b>{String(selected.sonicId).padStart(4, '0')}</b></span></div>
          <h3>{selected.street.name}</h3>
          {selected.street.currentName && selected.street.currentName !== selected.street.name && <p className="became">BECAME <strong>{selected.street.currentName}</strong> {selected.history.namingPeriod && <small>{selected.history.namingPeriod}</small>}</p>}
          <div className="mini-orb"><SignalOrb active={playing} symbol={symbol} /></div>
          <button className="button button-primary play-button" onClick={play} aria-busy={playing}>{playing ? 'Transmitting Linz…' : '▶  Play Sonic Record'}</button>
          <div className="progress"><i style={{ transform: `scaleX(${progress})` }} /></div>
          {error && <p className="error">{error}</p>}
          <p className="packet-hint">26 NOTES · 40 BITS · CRC-8 · 5.7 SEC</p>
        </section>
      </div>
      <Footer />
    </main>
  );
}

function Listen({ go, onDecoded }: { go: (screen: Screen) => void; onDecoded: (place: PlaceRecord) => void }) {
  const receiver = useRef<SonicReceiver | null>(null);
  const [active, setActive] = useState(false);
  const [locked, setLocked] = useState(false);
  const [symbols, setSymbols] = useState<number[]>([]);
  const [frame, setFrame] = useState<DetectionFrame | null>(null);
  const [diagnostics, setDiagnostics] = useState<DecoderDiagnostics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => () => receiver.current?.stop(), []);
  const start = async () => {
    if (active) { receiver.current?.stop(); receiver.current = null; setActive(false); return; }
    setError(''); setLocked(false); setSymbols([]); setDiagnostics(null);
    const instance = new SonicReceiver(); receiver.current = instance;
    try {
      await instance.start({
        onFrame: (nextFrame, nextDiagnostics) => { setFrame(nextFrame); setDiagnostics(nextDiagnostics); },
        onEvent: (event: ClockedDecoderEvent) => {
          setDiagnostics(event.diagnostics);
          if (event.type === 'locked') { setLocked(true); setSymbols([]); }
          if (event.type === 'slot') setSymbols(previous => [...previous, event.slot.symbol]);
          if (event.type === 'error') { setLocked(false); setError(event.reason); }
          if (event.type === 'packet') {
            setLocked(false);
            setSymbols(event.slots.map(slot => slot.symbol));
            const place = places.find(item => item.sonicId === event.packet.sonicId);
            if (place && place.semantic.eventType === event.packet.eventType) {
              instance.stop(); setActive(false); onDecoded(place);
            } else setError('Valid packet, but no matching Linz record was found.');
          }
        },
      });
      setActive(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Microphone access failed.'); }
  };

  return (
    <main className="listen-shell screen-enter">
      <Brand onHome={() => go('home')} />
      <button className="back" onClick={() => go('home')}>← &nbsp;BACK</button>
      <section className="listen-panel">
        <p className="eyebrow">PHONE B · RECEIVER</p>
        <h2>{locked ? 'Signal locked.' : active ? 'Listening for Linz…' : 'Listen to the city.'}</h2>
        <button className={`mic-button ${active ? 'active' : ''}`} onClick={start} aria-label={active ? 'Stop listening' : 'Start listening'}><span className="mic-glyph">◉</span><i /><i /><i /></button>
        <button className="listen-toggle" onClick={start}>{active ? 'STOP LISTENING' : 'PRESS TO LISTEN'}</button>
        <p className="privacy">Audio is analyzed locally on this device.<br />Nothing is recorded or uploaded.</p>
        {(active || symbols.length > 0) && <DecoderConsole frame={frame} symbols={symbols} locked={locked} diagnostics={diagnostics} />}
        {error && <p className="error console-error">{error}</p>}
      </section>
      <Footer />
    </main>
  );
}

function DecoderConsole({ frame, symbols, locked, diagnostics }: { frame: DetectionFrame | null; symbols: number[]; locked: boolean; diagnostics: DecoderDiagnostics | null }) {
  return (
    <div className="decoder-console" aria-live="polite">
      <div className="console-head"><span><i className={frame?.detectedSymbol !== null ? 'live' : ''} /> {locked ? 'SIGNAL LOCKED' : 'SEARCHING FOR SIGNAL'}</span><b>{Math.round((frame?.confidence ?? 0) * 10) / 10}× CONF</b></div>
      <div className="symbol-stream">{symbols.length ? symbols.map((symbol, index) => <span key={`${index}-${symbol}`}><b>{CARRIER_NOTES[symbol].replace('b', '♭')}</b><small>{symbol.toString(2).padStart(2, '0')}</small></span>) : <p>··· &nbsp; waiting for preamble &nbsp; ···</p>}</div>
      <div className="bitstream">{symbols.map(s => s.toString(2).padStart(2, '0')).join('')}</div>
      <div className="console-foot"><span>MIC RMS &nbsp; {((frame?.rms ?? 0) * 100).toFixed(1)}%</span><span>{diagnostics?.symbolPeriodMs ? `${diagnostics.symbolPeriodMs.toFixed(1)} MS · SLOT ${diagnostics.payloadSlot}/20` : 'LOCAL ANALYSIS'}</span></div>
    </div>
  );
}

function Reveal({ place, go }: { place: PlaceRecord; go: (screen: Screen) => void }) {
  const interpretation = interpretationById.get(place.sonicId)!;
  return (
    <main className="reveal-shell screen-enter">
      <Brand onHome={() => go('home')} />
      <section className="reveal-wrap">
        <div className="success-mark">✓</div><p className="eyebrow">SIGNAL DECODED · CHECKSUM VALID</p>
        <h2>{eventNames[place.semantic.eventType]}</h2>
        <p className="decoded-id">SONIC RECORD / {String(place.sonicId).padStart(4, '0')}</p>
        <div className="name-change">
          <div><small>HISTORICAL STREET</small><strong>{place.street.historicalName ?? place.street.name}</strong></div>
          {place.street.currentName && place.street.currentName !== place.street.historicalName && <><span>→</span><div><small>BECAME</small><strong>{place.street.currentName}</strong></div></>}
          {place.history.namingPeriod && <b>{place.history.namingPeriod}</b>}
        </div>
        <div className="story-grid">
          <article><p className="eyebrow">CITY RECORD</p><p>{place.history.description}</p><a href={place.raw.Link} target="_blank" rel="noreferrer">View official source ↗</a></article>
          <article><p className="eyebrow lime">INTERPRETATION</p><h3>{interpretation.headline}</h3><p>{interpretation.story}</p></article>
        </div>
        <div className="reveal-actions"><button className="button button-primary" onClick={() => go('transmit')}>♪ &nbsp; Listen to its sound</button><button className="button button-ghost" onClick={() => go('listen')}>Decode another</button></div>
      </section>
      <Footer />
    </main>
  );
}

function Footer() { return <footer><span>HUMANS HEAR MUSIC. MACHINES HEAR LINZ.</span><a href="https://data.linz.gv.at/katalog/stadt/strassen/" target="_blank" rel="noreferrer">DATA: CITY OF LINZ OPEN DATA ↗</a></footer>; }

export default function SonicLinz() {
  const [screen, setScreen] = useState<Screen>('home');
  const [decoded, setDecoded] = useState<PlaceRecord | null>(null);
  useEffect(() => {
    document.documentElement.dataset.sonicLinzHydrated = 'true';
    return () => { delete document.documentElement.dataset.sonicLinzHydrated; };
  }, []);
  const go = (next: Screen) => { window.scrollTo(0, 0); setScreen(next); };
  if (screen === 'transmit') return <Transmit go={go} />;
  if (screen === 'listen') return <Listen go={go} onDecoded={place => { setDecoded(place); setScreen('reveal'); }} />;
  if (screen === 'reveal' && decoded) return <Reveal place={decoded} go={go} />;
  return <Home go={go} />;
}
