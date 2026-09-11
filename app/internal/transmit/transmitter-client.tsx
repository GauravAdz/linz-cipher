'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import placesJson from '../../../data/generated/places.json';
import interpretationsJson from '../../../data/generated/interpretations.json';
import { transmit } from '../../../src/audio/transmitter';
import { loopTransmission } from '../../../src/audio/transmission-loop';
import type { Interpretation, PlaceRecord } from '../../../src/data/types';
import { PROTOCOL_VERSION, encodePacket, type SonicPacket } from '../../../src/protocol/protocol';

const places = placesJson as PlaceRecord[];
const interpretations = interpretationsJson as Interpretation[];
const interpretationById = new Map(interpretations.map(item => [item.sonicId, item]));

export default function InternalTransmitter() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(places.find(place => place.sonicId === 1223) ?? places[0]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [repetition, setRepetition] = useState(0);
  const [error, setError] = useState('');
  const transmission = useRef<AbortController | null>(null);
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('de');
    if (!normalized) return places.slice(0, 12);
    return places.filter(place => `${place.street.name} ${place.street.currentName ?? ''}`.toLocaleLowerCase('de').includes(normalized)).slice(0, 20);
  }, [query]);

  useEffect(() => () => transmission.current?.abort(), []);

  const play = async () => {
    if (playing) return;
    const controller = new AbortController();
    const packet: SonicPacket = {
      version: PROTOCOL_VERSION,
      sonicId: selected.sonicId,
      eventType: selected.semantic.eventType,
      mood: selected.semantic.mood,
    };
    transmission.current = controller;
    setError('');
    setPlaying(true);
    try {
      const symbols = encodePacket(packet);
      await loopTransmission(async pass => {
        setRepetition(pass);
        setProgress(0);
        await transmit(packet, (_, index) => setProgress((index + 1) / symbols.length), controller.signal, interpretationById.get(selected.sonicId)?.music);
      }, controller.signal);
    } catch (cause) {
      console.error('[Sonic Linz] internal transmission failed', cause);
      setError('Transmission could not start. Check the browser audio settings.');
    } finally {
      setPlaying(false);
      setProgress(0);
      setRepetition(0);
      if (transmission.current === controller) transmission.current = null;
    }
  };

  return (
    <main className="internal-shell">
      <header className="internal-header">
        <div><p>SONIC LINZ · INSTALLATION TOOL</p><h1>Street transmitter</h1></div>
        <Link href="/">Public experience</Link>
      </header>
      <div className="internal-grid">
        <section>
          <label className="internal-search">Search street records<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Street or place name" disabled={playing} /></label>
          <div className="internal-results">
            {matches.map(place => <button key={place.sonicId} className={selected.sonicId === place.sonicId ? 'selected' : ''} onClick={() => setSelected(place)} disabled={playing}><span>{place.street.name}</span><small>{place.street.currentName && place.street.currentName !== place.street.name ? place.street.currentName : place.source.type}</small></button>)}
          </div>
        </section>
        <section className="internal-player">
          <p>Selected installation record</p>
          <h2>{selected.street.name}</h2>
          <p>{interpretationById.get(selected.sonicId)?.headline}</p>
          <button onClick={() => void play()} disabled={playing}>{playing ? 'Playing on loop…' : 'Play ambient transmission on loop'}</button>
          <div className="internal-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></div>
          <p className="internal-loop-status" role="status" aria-live="polite">{playing ? `Continuous playback · repetition ${repetition}` : 'Playback remains stopped until started.'}</p>
          {error ? <p className="error">{error}</p> : null}
          <button className="internal-stop" onClick={() => transmission.current?.abort()} disabled={!playing}>Stop</button>
        </section>
      </div>
    </main>
  );
}
