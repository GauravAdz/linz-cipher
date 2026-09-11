'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import placesJson from '../../../data/generated/places.json';
import { type PlaceRecord } from '../../../src/data/types';
import {
  ALL_CARRIER_BANKS,
  CARRIER_BANK_4_6KHZ,
  getCarrierBank,
} from '../../../src/audio/carrier-bank';
import {
  embedBeacon,
  type EmbedProfile,
  type EmbedResult,
} from '../../../src/audio/embedder';
import { encodeWav } from '../../../src/audio/wav';
import {
  BEACON_PROTOCOL_VERSION,
  DEFAULT_BEACON_SYMBOL_MS,
  type AcousticBeacon,
} from '../../../src/protocol/beacon-protocol';
import { SonicReceiver } from '../../../src/audio/receiver';
import type { Slp2DetectionFrame } from '../../../src/audio/slp2-detector';
import type { BeaconDecoderDiagnostics } from '../../../src/audio/beacon-decoder';
import type { ConsensusResult } from '../../../src/audio/beacon-consensus';

const places = placesJson as PlaceRecord[];

export default function EmbedDebugPage() {
  // Source audio state
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [sourceBuffer, setSourceBuffer] = useState<AudioBuffer | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);

  // Beacon configuration
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<PlaceRecord>(
    places.find(p => p.sonicId === 247) ?? places[0],
  );
  const [customId, setCustomId] = useState<number>(247);
  const [carrierBankId, setCarrierBankId] = useState<string>(CARRIER_BANK_4_6KHZ.id);
  const [profile, setProfile] = useState<EmbedProfile>('BALANCED');
  const [symbolMs, setSymbolMs] = useState<number>(DEFAULT_BEACON_SYMBOL_MS);
  const [notchFilter, setNotchFilter] = useState<boolean>(true);

  // Embedding state
  const [embedding, setEmbedding] = useState(false);
  const [embedResult, setEmbedResult] = useState<EmbedResult | null>(null);
  const [embedError, setEmbedError] = useState('');

  // Audio Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<'original' | 'encoded'>('encoded');
  const [playbackTime, setPlaybackTime] = useState(0);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackStartTimeRef = useRef(0);
  const playbackTimerRef = useRef<number | null>(null);

  // Live Decoder Test
  const [liveListening, setLiveListening] = useState(false);
  const [liveFrame, setLiveFrame] = useState<Slp2DetectionFrame | null>(null);
  const [liveDiagnostics, setLiveDiagnostics] = useState<BeaconDecoderDiagnostics | null>(null);
  const [liveConsensus, setLiveConsensus] = useState<ConsensusResult | null>(null);
  const [liveError, setLiveError] = useState('');
  const receiverRef = useRef<SonicReceiver | null>(null);

  const selectedBank = getCarrierBank(carrierBankId);

  // Filter Linz places for search dropdown
  const filteredPlaces = searchQuery
    ? places
        .filter(p =>
          `${p.street.name} ${p.street.currentName ?? ''} ${p.sonicId}`
            .toLowerCase()
            .includes(searchQuery.toLowerCase()),
        )
        .slice(0, 8)
    : [];

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (playbackCtxRef.current && playbackCtxRef.current.state !== 'closed') {
      void playbackCtxRef.current.close();
      playbackCtxRef.current = null;
    }
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setIsPlaying(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback();
      receiverRef.current?.stop();
    };
  }, []);

  // Handle local audio file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioFile(file);
    setLoadingAudio(true);
    setEmbedResult(null);
    setEmbedError('');
    stopPlayback();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      setSourceBuffer(decoded);
      void ctx.close();
    } catch (err) {
      setEmbedError(err instanceof Error ? err.message : 'Could not decode audio file.');
    } finally {
      setLoadingAudio(false);
    }
  };

  // Run the beacon embedder
  const handleEmbed = async () => {
    if (!sourceBuffer) return;
    setEmbedding(true);
    setEmbedError('');
    stopPlayback();

    // Use setTimeout to yield so UI can update to show embedding state
    setTimeout(() => {
      try {
        const rawSamples = sourceBuffer.getChannelData(0);
        const beacon: AcousticBeacon = {
          version: BEACON_PROTOCOL_VERSION,
          contentId: customId,
          sequence: 0,
          flags: 0,
        };

        const result = embedBeacon(
          {
            samples: rawSamples,
            sampleRate: sourceBuffer.sampleRate,
            channelCount: 1,
          },
          beacon,
          {
            profile,
            carrierBank: selectedBank,
            symbolMs,
            notchFilter,
          },
        );

        setEmbedResult(result);
        setPlayMode('encoded');
      } catch (err) {
        setEmbedError(err instanceof Error ? err.message : 'Embedding failed.');
      } finally {
        setEmbedding(false);
      }
    }, 50);
  };

  // Playback handlers
  const startPlayback = (mode: 'original' | 'encoded') => {
    stopPlayback();
    if (!sourceBuffer) return;

    const ctx = new AudioContext();
    playbackCtxRef.current = ctx;

    const buffer = ctx.createBuffer(1, sourceBuffer.length, sourceBuffer.sampleRate);
    const data =
      mode === 'original'
        ? sourceBuffer.getChannelData(0)
        : embedResult
        ? embedResult.samples
        : sourceBuffer.getChannelData(0);
    buffer.getChannelData(0).set(data);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    source.onended = () => {
      setIsPlaying(false);
      setPlaybackTime(0);
    };

    source.start(0);
    sourceNodeRef.current = source;
    playbackStartTimeRef.current = ctx.currentTime;
    setIsPlaying(true);
    setPlayMode(mode);

    playbackTimerRef.current = window.setInterval(() => {
      if (playbackCtxRef.current) {
        setPlaybackTime(playbackCtxRef.current.currentTime - playbackStartTimeRef.current);
      }
    }, 100);
  };

  // Export 16-bit WAV file
  const handleExportWav = () => {
    if (!embedResult) return;
    try {
      const wavBytes = encodeWav(embedResult.samples, embedResult.sampleRate);
      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = audioFile ? audioFile.name.replace(/\.[^/.]+$/, '') : 'linz-cipher';
      a.href = url;
      a.download = `${baseName}_slp2_id${customId}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setEmbedError(err instanceof Error ? err.message : 'WAV export failed.');
    }
  };

  // Live Decoder toggle
  const toggleLiveListening = async () => {
    if (liveListening) {
      receiverRef.current?.stop();
      receiverRef.current = null;
      setLiveListening(false);
      return;
    }

    setLiveError('');
    setLiveConsensus(null);
    const receiver = new SonicReceiver();
    receiverRef.current = receiver;

    try {
      await receiver.startBeaconMode(
        {
          onFrame: (f, d) => {
            setLiveFrame(f);
            setLiveDiagnostics(d);
          },
          onConsensus: res => {
            setLiveConsensus(res);
          },
        },
        {
          carrierBank: selectedBank,
          symbolMs,
        },
      );
      setLiveListening(true);
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Microphone start failed.');
      setLiveListening(false);
    }
  };

  const resolvedConsensusPlace = liveConsensus
    ? places.find(p => p.sonicId === liveConsensus.contentId)
    : null;

  return (
    <main className="debug-shell">
      <header className="topbar">
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Link className="wordmark" href="/">
            SONIC LINZ
          </Link>
          <Link href="/debug/audio" style={{ color: 'var(--muted)', fontSize: '11px', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}>
            ← SLP/1 Lab
          </Link>
        </div>
        <div className="protocol-pill">
          <i /> SLP/2 BEACON EMBEDDER
        </div>
      </header>

      <div className="debug-wrap">
        <div className="debug-head">
          <div>
            <p className="eyebrow">ACOUSTIC WATERMARKING & IDENTIFIER INJECTION</p>
            <h1>SLP/2 Embed Studio.</h1>
            <p className="dek" style={{ margin: '10px 0 0' }}>
              Embed continuous 30-bit repeating acoustic beacons into arbitrary songs or audio tracks.
            </p>
          </div>
        </div>

        {/* 1. File Upload Section */}
        <section className="meter-card" style={{ padding: '24px', marginBottom: '25px' }}>
          <p className="eyebrow">STEP 1 · SELECT AUDIO TRACK</p>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="button button-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
              <span>📁 {audioFile ? 'Replace Audio File' : 'Choose Local Audio File (.mp3, .wav, .m4a)'}</span>
              <input type="file" accept="audio/*" onChange={handleFileChange} style={{ display: 'none' }} />
            </label>
            {audioFile && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--lime)' }}>
                ✓ {audioFile.name} ({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)
              </span>
            )}
            {loadingAudio && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--muted)' }}>
                Decoding audio in browser...
              </span>
            )}
          </div>
          {sourceBuffer && (
            <div style={{ marginTop: '16px', display: 'flex', gap: '24px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
              <span>DURATION: <b>{sourceBuffer.duration.toFixed(1)}s</b></span>
              <span>SAMPLE RATE: <b>{sourceBuffer.sampleRate} Hz</b></span>
              <span>CHANNELS: <b>{sourceBuffer.numberOfChannels}</b></span>
            </div>
          )}
        </section>

        {/* 2. Beacon Target Configuration */}
        <section className="meter-card" style={{ padding: '24px', marginBottom: '25px' }}>
          <p className="eyebrow">STEP 2 · CONFIGURE LINZ IDENTIFIER</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                SEARCH LINZ STREET / MEMORY
              </label>
              <label className="search-box">
                <span>⌕</span>
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search street name or ID..."
                />
              </label>
              {filteredPlaces.length > 0 && (
                <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '8px', marginTop: '6px', background: '#121216' }}>
                  {filteredPlaces.map(place => (
                    <button
                      key={place.sonicId}
                      onClick={() => {
                        setSelectedPlace(place);
                        setCustomId(place.sonicId);
                        setSearchQuery('');
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        color: 'white',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span><b>{place.street.name}</b> <small style={{ color: 'var(--muted)' }}>({place.source.type})</small></span>
                      <b style={{ color: 'var(--lime)' }}>#{place.sonicId}</b>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                NUMERIC CONTENT ID (16 BITS, 0–65535)
              </label>
              <input
                type="number"
                min={0}
                max={65535}
                value={customId}
                onChange={e => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setCustomId(val);
                    const matched = places.find(p => p.sonicId === val);
                    if (matched) setSelectedPlace(matched);
                  }
                }}
                style={{
                  width: '100%',
                  height: '56px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--line)',
                  borderRadius: '14px',
                  padding: '0 16px',
                  color: 'var(--lime)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '20px',
                  fontWeight: 'bold',
                }}
              />
              <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                SELECTED: <b style={{ color: 'white' }}>{selectedPlace ? selectedPlace.street.name : `Record ${customId}`}</b>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Carrier & Profile Settings */}
        <section className="meter-card" style={{ padding: '24px', marginBottom: '25px' }}>
          <p className="eyebrow">STEP 3 · CARRIER BANK & EMBEDDING PROFILE</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                CARRIER BANK
              </label>
              <select
                value={carrierBankId}
                onChange={e => setCarrierBankId(e.target.value)}
                style={{
                  width: '100%',
                  height: '46px',
                  background: '#121216',
                  border: '1px solid var(--line)',
                  borderRadius: '10px',
                  padding: '0 12px',
                  color: 'white',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                }}
              >
                {ALL_CARRIER_BANKS.map(bank => (
                  <option key={bank.id} value={bank.id}>
                    {bank.name} ({bank.frequencies.join(', ')} Hz)
                  </option>
                ))}
              </select>
              <p style={{ margin: '6px 0 0', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                {selectedBank.description}
              </p>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                AUDIBILITY PROFILE
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['SUBTLE', 'BALANCED', 'ROBUST'] as EmbedProfile[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setProfile(p)}
                    className="button"
                    style={{
                      flex: 1,
                      minHeight: '46px',
                      background: profile === p ? 'var(--lime)' : 'transparent',
                      color: profile === p ? '#09090b' : 'white',
                      borderColor: profile === p ? 'var(--lime)' : 'var(--line)',
                      fontSize: '11px',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                {profile === 'ROBUST' && 'Higher carrier power for loud rooms or budget speakers.'}
                {profile === 'BALANCED' && 'Balanced carrier amplitude; subtle in music, reliable across devices.'}
                {profile === 'SUBTLE' && 'Minimal volume; near-transparent in acoustic mixes.'}
              </p>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--muted)' }}>SYMBOL DURATION</span>
                <b style={{ color: 'var(--lime)' }}>{symbolMs} MS</b>
              </div>
              <input
                type="range"
                min={120}
                max={160}
                step={5}
                value={symbolMs}
                onChange={e => setSymbolMs(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                  <input
                    type="checkbox"
                    checked={notchFilter}
                    onChange={e => setNotchFilter(e.target.checked)}
                  />
                  <span>Carve Narrow Music Notches around Carriers</span>
                </label>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '28px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button
              onClick={handleEmbed}
              disabled={!sourceBuffer || embedding}
              className="button button-primary"
              style={{ minWidth: '220px' }}
            >
              {embedding ? 'Embedding Beacon...' : '⚡ Embed Repeating Beacon'}
            </button>
            {embedResult && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--lime)' }}>
                ✓ Embedded {embedResult.repetitions} beacon cycles ({((embedResult.durationMs / 1000)).toFixed(1)}s total)
              </span>
            )}
          </div>
          {embedError && <p className="error" style={{ textAlign: 'left', marginTop: '12px' }}>{embedError}</p>}
        </section>

        {/* 4. Preview & Export */}
        {embedResult && (
          <section className="meter-card" style={{ padding: '24px', marginBottom: '25px', borderColor: 'var(--lime)' }}>
            <p className="eyebrow">STEP 4 · AUDITION & EXPORT WAV</p>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => (isPlaying && playMode === 'original' ? stopPlayback() : startPlayback('original'))}
                className={`button ${playMode === 'original' && isPlaying ? 'button-primary' : 'button-ghost'}`}
              >
                {playMode === 'original' && isPlaying ? '⏸ Pause Original' : '▶ Play Original Audio'}
              </button>

              <button
                onClick={() => (isPlaying && playMode === 'encoded' ? stopPlayback() : startPlayback('encoded'))}
                className={`button ${playMode === 'encoded' && isPlaying ? 'button-primary' : 'button-ghost'}`}
              >
                {playMode === 'encoded' && isPlaying ? '⏸ Pause Encoded' : '▶ Play Encoded Audio (with ID)'}
              </button>

              <button onClick={handleExportWav} className="button button-primary" style={{ marginLeft: 'auto' }}>
                ⬇ Export 16-Bit WAV
              </button>
            </div>

            {isPlaying && (
              <div style={{ marginTop: '16px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--muted)' }}>
                PLAYING: <b style={{ color: 'var(--lime)' }}>{playMode.toUpperCase()}</b> ({playbackTime.toFixed(1)}s / {(embedResult.durationMs / 1000).toFixed(1)}s)
              </div>
            )}
          </section>
        )}

        {/* 5. Integrated Live Decoder / Self-Test */}
        <section className="meter-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <p className="eyebrow">STEP 5 · LIVE RECEIVER VERIFICATION</p>
              <h2 style={{ margin: 0, fontSize: '24px' }}>Test Beacon Reception</h2>
              <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                Listen via microphone while playing the encoded audio through your speakers or a second device.
              </p>
            </div>
            <button
              onClick={toggleLiveListening}
              className={`button ${liveListening ? 'button-primary' : 'button-ghost'}`}
            >
              {liveListening ? '⏹ Stop Microphone' : '🎙 Start Live Receiver'}
            </button>
          </div>

          {liveListening && (
            <div style={{ marginTop: '24px' }}>
              <div className="detection" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <span>CARRIER BANK <b>{selectedBank.name}</b></span>
                <span>STATE <b>{liveDiagnostics?.state ?? 'SEARCHING'}</b></span>
                <span>SYNC SCORE <b>{(liveDiagnostics?.syncScore ?? 0).toFixed(2)}</b></span>
                <span>PAYLOAD SLOT <b>{liveDiagnostics?.payloadSlot ?? 0} / 15</b></span>
                <span>BEACONS DECODED <b>{liveDiagnostics?.successfulBeacons ?? 0}</b></span>
              </div>

              {/* Carrier Narrowband Scores */}
              <div style={{ padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <p style={{ margin: '0 0 10px', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  CARRIER NARROWBAND CONTRAST SCORES (E(f) / E(surrounding))
                </p>
                {selectedBank.frequencies.map((f, i) => {
                  const score = liveFrame?.narrowbandScores[i] ?? 1.0;
                  return (
                    <div key={f} className="carrier-row">
                      <strong>#{i}</strong>
                      <small>{f} HZ</small>
                      <div>
                        <i style={{ transform: `scaleX(${Math.min(1, score / 20)})` }} />
                      </div>
                      <b>{score.toFixed(1)}×</b>
                      <span style={{ fontSize: '9px', color: liveFrame?.detectedSymbol === i ? 'var(--lime)' : 'rgba(255,255,255,0.3)' }}>
                        {liveFrame?.detectedSymbol === i ? 'HOT' : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Consensus Result Display */}
              {liveConsensus && (
                <div
                  style={{
                    marginTop: '20px',
                    padding: '16px 20px',
                    borderRadius: '12px',
                    background: 'rgba(217,255,67,0.08)',
                    border: '1px solid var(--lime)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '10px', color: 'var(--lime)', fontFamily: 'var(--font-mono)' }}>
                      ✓ CONSENSUS CONFIRMED ({liveConsensus.rule.toUpperCase()})
                    </span>
                    <h3 style={{ margin: '4px 0 0', fontSize: '20px' }}>
                      {resolvedConsensusPlace ? resolvedConsensusPlace.street.name : `Linz Record #${liveConsensus.contentId}`}
                    </h3>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    <b style={{ fontSize: '22px', color: 'var(--lime)' }}>ID {liveConsensus.contentId}</b>
                    <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
                      {liveConsensus.observations.length} PACKETS
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {liveError && <p className="error" style={{ marginTop: '14px' }}>{liveError}</p>}
        </section>
      </div>
    </main>
  );
}
