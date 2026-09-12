'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SonicReceiver } from '../src/audio/receiver';
import type { ClockedDecoderEvent, DecoderDiagnostics } from '../src/audio/clocked-decoder';
import type { DetectionFrame } from '../src/audio/detector';
import type { PublicPlace } from '../src/data/types';

let publicStoriesRequest: Promise<PublicPlace[]> | null = null;

function loadPublicStories() {
  publicStoriesRequest ??= import('../data/generated/public-stories.json')
    .then(module => module.default as PublicPlace[]);
  return publicStoriesRequest;
}

type Screen = 'introduction' | 'listening' | 'discovery';
type ListeningPhase = 'idle' | 'requesting' | 'listening' | 'detected' | 'almost' | 'error';

function Brand({ onHome }: { onHome: () => void }) {
  return (
    <header className="site-header">
      <button className="wordmark" onClick={onHome} aria-label="Sonic Linz, back to the start">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <span>SONIC LINZ</span>
      </button>
      <span className="header-context">Stories carried by music</span>
    </header>
  );
}

function CityArtwork({ listening = false, level = 0 }: { listening?: boolean; level?: number }) {
  return (
    <div className={`city-artwork ${listening ? 'is-listening' : ''}`} style={{ '--sound-level': level } as React.CSSProperties} aria-hidden="true">
      <div className="city-halo" />
      <div className="city-orbit city-orbit-a" />
      <div className="city-orbit city-orbit-b" />
      <div className="city-river"><i /><i /><i /></div>
      <div className="city-light"><span /></div>
      <div className="city-grid" />
    </div>
  );
}

function Introduction({ onListen, preparing, error }: { onListen: () => void; preparing: boolean; error: string }) {
  return (
    <main className="public-shell intro-screen">
      <Brand onHome={() => undefined} />
      <section className="intro-hero">
        <div className="intro-copy">
          <h1>The city has<br />something to <em>tell you.</em></h1>
          <p className="intro-dek">Musical pieces are playing at selected places around Linz. Each one carries an English story connected to the street where you hear it.</p>
          <ol className="simple-steps" aria-label="How it works">
            <li><span aria-hidden="true">Find</span><p>Encounter a Sonic Linz location.</p></li>
            <li><span aria-hidden="true">Listen</span><p>Allow microphone access.</p></li>
            <li><span aria-hidden="true">Discover</span><p>Let your phone hear the music.</p></li>
          </ol>
        </div>
        <CityArtwork />
      </section>
      <div className="mobile-action-dock">
        {error ? <p className="intro-load-error" role="alert">{error}</p> : null}
        <button className="primary-action" onClick={onListen} disabled={preparing} aria-busy={preparing}>
          <span className="action-dot" aria-hidden="true" />
          {preparing ? 'Preparing listener…' : 'Listen to the city'}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
      </div>
      <SiteFooter />
    </main>
  );
}

const phaseCopy: Record<ListeningPhase, { title: string; detail: string }> = {
  idle: { title: 'Ready when you are.', detail: 'Stand near the music and hold your phone naturally.' },
  requesting: { title: 'One moment…', detail: 'Your browser is asking for microphone access.' },
  listening: { title: 'Listening…', detail: 'Keep your phone near the music.' },
  detected: { title: 'Music detected…', detail: 'Stay here while we listen for the story.' },
  almost: { title: 'Almost there…', detail: 'The story is coming into view.' },
  error: { title: 'Let’s try that again.', detail: 'We could not recognise this piece just now.' },
};

function friendlyMicrophoneError(cause: unknown) {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone access is off. Allow it in your browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found on this device.';
  if (!navigator.mediaDevices?.getUserMedia) return 'Listening is not supported in this browser. Try a recent version of Safari or Chrome.';
  return 'Listening could not start. Check microphone access and try again.';
}

function Listening({ places, onHome, onDiscovered }: { places: PublicPlace[]; onHome: () => void; onDiscovered: (place: PublicPlace) => void }) {
  const receiver = useRef<SonicReceiver | null>(null);
  const timeout = useRef<number | null>(null);
  const phaseRef = useRef<ListeningPhase>('idle');
  const [phase, setPhaseState] = useState<ListeningPhase>('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const placesById = useMemo(() => new Map(places.map(place => [place.sonicId, place])), [places]);

  const setPhase = (next: ListeningPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const stop = (next: ListeningPhase = 'idle') => {
    receiver.current?.stop();
    receiver.current = null;
    if (timeout.current !== null) window.clearTimeout(timeout.current);
    timeout.current = null;
    setLevel(0);
    setPhase(next);
  };

  useEffect(() => () => {
    receiver.current?.stop();
    if (timeout.current !== null) window.clearTimeout(timeout.current);
  }, []);

  const logFrame = (frame: DetectionFrame, diagnostics: DecoderDiagnostics) => {
    if (process.env.NODE_ENV !== 'production') console.debug('[Sonic Linz] receiver frame', { frame, diagnostics });
  };

  const handleEvent = (event: ClockedDecoderEvent) => {
    if (process.env.NODE_ENV !== 'production') console.debug('[Sonic Linz] decoder event', event);
    if (event.type === 'locked') setPhase('detected');
    if (event.type === 'slot' && event.diagnostics.payloadSlot >= 8) setPhase('almost');
    if (event.type === 'error') {
      console.warn('[Sonic Linz] recognition failed', event.reason, event.diagnostics);
      // A damaged frame can be followed by a clean repeat. Keep listening and
      // retain the detailed failure only in the developer console.
      setPhase('listening');
    }
    if (event.type === 'packet') {
      const place = placesById.get(event.packet.sonicId);
      if (place && place.eventType === event.packet.eventType) {
        if ('vibrate' in navigator) {
          try { navigator.vibrate([35, 45, 35]); } catch { /* Optional device feedback. */ }
        }
        stop('idle');
        onDiscovered(place);
      } else {
        console.warn('[Sonic Linz] recognised an unknown place', event.packet);
        setError('We heard the music, but could not find its story. Please try again.');
        stop('error');
      }
    }
  };

  const start = async () => {
    if (phase === 'requesting') return;
    if (phase === 'listening' || phase === 'detected' || phase === 'almost') {
      stop('idle');
      return;
    }
    setError('');
    setPhase('requesting');
    const instance = new SonicReceiver();
    receiver.current = instance;
    try {
      await instance.start({
        validatePacket: packet => {
          const place = placesById.get(packet.sonicId);
          return Boolean(place && place.eventType === packet.eventType);
        },
        onFrame: (frame, diagnostics) => {
          logFrame(frame, diagnostics);
          setLevel(Math.min(1, Math.max(0.08, frame.rms * 12)));
          if (phaseRef.current === 'listening' && frame.confidence >= 1.3 && frame.rms > 0.006) setPhase('detected');
        },
        onEvent: handleEvent,
      });
      setPhase('listening');
      timeout.current = window.setTimeout(() => {
        setError('We could not find a Sonic Linz piece yet. Move closer to the music and try once more.');
        stop('error');
      }, 30_000);
    } catch (cause) {
      console.error('[Sonic Linz] microphone start failed', cause);
      receiver.current = null;
      setError(friendlyMicrophoneError(cause));
      setPhase('error');
    }
  };

  const isActive = phase === 'listening' || phase === 'detected' || phase === 'almost';
  const copy = phaseCopy[phase];

  return (
    <main className="public-shell listening-screen screen-enter">
      <Brand onHome={onHome} />
      <button className="text-back" onClick={onHome}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        Back
      </button>
      <section className="listening-stage">
        <div className="listener-visual">
          <CityArtwork listening={isActive || phase === 'requesting'} level={level} />
          <button className={`listen-control phase-${phase}`} onClick={() => void start()} aria-label={isActive ? 'Stop listening' : phase === 'error' ? 'Try listening again' : 'Start listening'} aria-busy={phase === 'requesting'}>
            <span className="listen-control-icon" aria-hidden="true">
              {isActive ? <><i /><i /><i /><i /><i /></> : <svg viewBox="0 0 24 24"><path d="M12 15.4a3.4 3.4 0 0 0 3.4-3.4V6.4a3.4 3.4 0 1 0-6.8 0V12a3.4 3.4 0 0 0 3.4 3.4Z"/><path d="M5.8 11.3v.7a6.2 6.2 0 0 0 12.4 0v-.7M12 18.2V22M8.8 22h6.4"/></svg>}
            </span>
            <span>{isActive ? 'Stop' : phase === 'requesting' ? 'Allow access' : phase === 'error' ? 'Try again' : 'Listen'}</span>
          </button>
        </div>
        <div className="listening-copy" role="status" aria-live="polite" aria-atomic="true">
          <h1>{copy.title}</h1>
          <p>{error || copy.detail}</p>
        </div>
        <aside className="privacy-note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5.5 5.7v5.4c0 4.2 2.7 7.9 6.5 9.9 3.8-2 6.5-5.7 6.5-9.9V5.7L12 3Z"/><path d="m9.3 12.1 1.7 1.7 3.8-4"/></svg>
          <p><strong>Your listening stays private.</strong> Audio is analysed on this phone only. Nothing is recorded or uploaded.</p>
        </aside>
      </section>
    </main>
  );
}

export function Discovery({ place, onListenAgain, onHome }: { place: PublicPlace; onListenAgain: () => void; onHome: () => void }) {
  const interpretation = place.interpretation;
  const editorial = interpretation.editorial;
  const historicalName = place.historicalName;
  const currentName = place.currentName;
  const changedName = historicalName && currentName && historicalName !== currentName;
  const displayName = currentName || place.streetName;
  const birthYear = place.person?.birthDate?.match(/\d{4}/)?.[0];
  const deathYear = place.person?.deathDate?.match(/\d{4}/)?.[0];
  const lifespan = birthYear && deathYear ? `${birthYear}–${deathYear}` : birthYear ? `Born ${birthYear}` : deathYear ? `Died ${deathYear}` : undefined;
  const occupation = place.person?.occupation
    ? place.person.occupation.replace(/\b\w/g, letter => letter.toLocaleUpperCase('en'))
    : undefined;
  const initials = place.person?.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('');

  return (
    <main className="public-shell discovery-screen screen-enter">
      <Brand onHome={onHome} />
      <article className="place-profile">
        <header className="place-hero">
          <div className="place-route-mark" aria-hidden="true"><i /><span /></div>
          <div className="place-title-block">
            <h1>{displayName}</h1>
            {changedName ? <p className="former-name">Formerly <strong>{historicalName}</strong>{place.namingPeriod ? ` · ${place.namingPeriod}` : ''}</p> : historicalName && !currentName ? <p className="former-name"><strong>{historicalName}</strong>{place.namingPeriod ? ` · ${place.namingPeriod}` : ''}</p> : null}
          </div>
          <dl className="place-facts" aria-label="Place overview">
            {place.cadastralMunicipality ? <div><dt>Within Linz</dt><dd>{place.cadastralMunicipality} cadastral area</dd></div> : null}
            {place.namingYear ? <div><dt>{place.sourceType === 'historical' ? 'Recorded from' : 'Named'}</dt><dd>{place.namingYear}</dd></div> : null}
            <div><dt>City record</dt><dd>{place.sourceType === 'historical' ? 'Former street name' : 'Current street name'}</dd></div>
          </dl>
          <p className="place-lede">{editorial?.lede ?? interpretation.story}</p>
        </header>

        <div className="profile-flow">
          <section className="profile-section profile-story">
            <span className="route-stop" aria-hidden="true" />
            <h2>{interpretation.headline}</h2>
            <p>{interpretation.story}</p>
          </section>

          <section className="profile-section naming-origin">
            <span className="route-stop" aria-hidden="true" />
            <h2>Why this name</h2>
            <p>{editorial?.whyThisName ?? interpretation.story}</p>
          </section>

          <section className="profile-section city-context">
            <span className="route-stop" aria-hidden="true" />
            <h2>Its place in Linz</h2>
            <p>{editorial?.cityContext ?? `${displayName} belongs to the official City of Linz street-name archive.`}</p>
          </section>

          {place.person?.name ? (
            <section className="namesake-section">
              <div className="namesake-monogram" aria-hidden="true">{initials}</div>
              <div className="namesake-copy">
                <h2>The person in the place</h2>
                <h3>{place.person.name}</h3>
                {(lifespan || occupation) ? <p className="person-line">{[lifespan, occupation].filter(Boolean).join(' · ')}</p> : null}
                <p>The City of Linz record connects {displayName} with {place.person.name}.</p>
                {place.person.wikidataId ? <a href={`https://www.wikidata.org/wiki/${place.person.wikidataId}`} target="_blank" rel="noreferrer">Explore the namesake record <ExternalLinkIcon /></a> : null}
              </div>
            </section>
          ) : null}

          {(place.namingYear || place.removalYear || changedName) ? (
            <section className="profile-section name-timeline">
              <span className="route-stop" aria-hidden="true" />
              <h2>Name through time</h2>
              <ol>
                {place.namingYear ? <li><time>{place.namingYear}</time><p><strong>{historicalName || displayName}</strong> enters the City of Linz record.</p></li> : null}
                {place.removalYear && changedName ? <li><time>{place.removalYear}</time><p>The recorded name changes to <strong>{displayName}</strong>.</p></li> : null}
                {!place.removalYear && place.sourceType === 'current' ? <li><time>Today</time><p>The place is recorded as <strong>{displayName}</strong>.</p></li> : null}
              </ol>
            </section>
          ) : null}

          <section className="archive-section">
            <div>
              <h2>Continue into the archive</h2>
              <p>The official German-language record from the Archive of the City of Linz remains the authoritative source for this place.</p>
            </div>
            {place.sourceLink ? <a className="source-link" href={place.sourceLink} target="_blank" rel="noreferrer">Open the Stadtgeschichte record <ExternalLinkIcon /></a> : null}
          </section>
        </div>

        <div className="discovery-actions">
          <button className="primary-action" onClick={onListenAgain}><span className="action-dot" aria-hidden="true" /> Listen again <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
          <button className="secondary-action" onClick={onHome}>Back to the start</button>
        </div>
      </article>
      <SiteFooter />
    </main>
  );
}

function ExternalLinkIcon() {
  return <svg className="external-link-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>;
}

function SiteFooter() {
  return <footer className="site-footer"><span>SONIC LINZ</span><span>A city heard differently</span></footer>;
}

export default function SonicLinz() {
  const [screen, setScreen] = useState<Screen>('introduction');
  const [places, setPlaces] = useState<PublicPlace[] | null>(null);
  const [discovered, setDiscovered] = useState<PublicPlace | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');

  useEffect(() => {
    document.documentElement.dataset.sonicLinzHydrated = 'true';
    let cancelled = false;
    if (process.env.NODE_ENV !== 'production') {
      const previewValue = new URLSearchParams(window.location.search).get('preview');
      if (previewValue !== null) {
        void loadPublicStories().then(loaded => {
          if (cancelled) return;
          const previewPlace = loaded.find(place => place.sonicId === Number(previewValue));
          if (previewPlace) {
            setPlaces(loaded);
            window.requestAnimationFrame(() => {
              setDiscovered(previewPlace);
              setScreen('discovery');
            });
          }
        }).catch(cause => console.error('[Sonic Linz] preview data failed to load', cause));
      }
    }
    return () => {
      cancelled = true;
      delete document.documentElement.dataset.sonicLinzHydrated;
    };
  }, []);

  const goHome = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setDiscovered(null);
    setScreen('introduction');
  };
  const goListen = async () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setPrepareError('');
    setPreparing(true);
    try {
      const loaded = places ?? await loadPublicStories();
      setPlaces(loaded);
      setScreen('listening');
    } catch (cause) {
      console.error('[Sonic Linz] public stories failed to load', cause);
      setPrepareError('The listener could not be prepared. Check your connection and try again.');
    } finally {
      setPreparing(false);
    }
  };

  if (screen === 'listening' && places) return <Listening places={places} onHome={goHome} onDiscovered={place => { setDiscovered(place); setScreen('discovery'); }} />;
  if (screen === 'discovery' && discovered) return <Discovery place={discovered} onListenAgain={() => void goListen()} onHome={goHome} />;
  return <Introduction onListen={() => void goListen()} preparing={preparing} error={prepareError} />;
}
