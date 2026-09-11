'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import placesJson from '../../../data/generated/places.json';
import { type PlaceRecord } from '../../../src/data/types';
import {
  ALL_CARRIER_BANKS,
  CARRIER_BANK_4_6KHZ,
  createHarmonicCarrierBank,
  getCarrierBank,
  type CarrierBank,
} from '../../../src/audio/carrier-bank';
import {
  bpmToSymbolTiming,
  embedBeacon,
  type EmbedProfile,
  type EmbedResult,
  type EnvelopeMode,
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
const MUSICAL_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

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

  // Musical Carrier Bank configuration
  const [bankMode, setBankMode] = useState<'harmonic' | 'standard'>('harmonic');
  const [musicalKey, setMusicalKey] = useState<string>('C');
  const [musicalScale, setMusicalScale] = useState<'major' | 'minor'>('major');
  const [carrierBankId, setCarrierBankId] = useState<string>(CARRIER_BANK_4_6KHZ.id);

  // BPM & Rhythm timing configuration
  const [syncBpm, setSyncBpm] = useState<boolean>(true);
  const [bpm, setBpm] = useState<number>(120);
  const [tapTimestamps, setTapTimestamps] = useState<number[]>([]);

  // Camouflage Envelope & Profile
  const [envelopeMode, setEnvelopeMode] = useState<EnvelopeMode>('PERCUSSIVE');
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

  const selectedBank: CarrierBank =
    bankMode === 'harmonic'
      ? createHarmonicCarrierBank(musicalKey, musicalScale)
      : getCarrierBank(carrierBankId);

  const bpmTiming = syncBpm ? bpmToSymbolTiming(bpm) : null;
  const activeSymbolMs = bpmTiming ? bpmTiming.symbolMs : symbolMs;

  const handleTapTempo = () => {
    const now = performance.now();
    setTapTimestamps(prev => {
      const recent = prev.filter(t => now - t < 3000);
      const updated = [...recent, now].slice(-5);
      if (updated.length >= 2) {
        let totalInterval = 0;
        for (let i = 1; i < updated.length; i++) {
          totalInterval += updated[i] - updated[i - 1];
        }
        const avgInterval = totalInterval / (updated.length - 1);
        const calculatedBpm = Math.round(60000 / avgInterval);
        if (calculatedBpm >= 50 && calculatedBpm <= 220) {
          setBpm(calculatedBpm);
        }
      }
      return updated;
    });
  };

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
            symbolMs: activeSymbolMs,
            notchFilter,
            envelopeMode,
            bpm: syncBpm ? bpm : undefined,
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
          symbolMs: activeSymbolMs,
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

        {/* 3. Carrier, Harmony & Profile Settings */}
        <section className="meter-card" style={{ padding: '24px', marginBottom: '25px' }}>
          <p className="eyebrow">STEP 3 · MUSICAL HARMONY, BPM SYNC & PERCUSSIVE CAMOUFLAGE</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '22px' }}>
            {/* 3A: Musical Key & Carrier Tuning */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                  CARRIER TUNING ARCHITECTURE
                </label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setBankMode('harmonic')}
                    style={{
                      padding: '4px 8px',
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      background: bankMode === 'harmonic' ? 'var(--lime)' : 'rgba(255,255,255,0.06)',
                      color: bankMode === 'harmonic' ? '#09090b' : 'var(--muted)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Harmonic Scale
                  </button>
                  <button
                    type="button"
                    onClick={() => setBankMode('standard')}
                    style={{
                      padding: '4px 8px',
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      background: bankMode === 'standard' ? 'var(--lime)' : 'rgba(255,255,255,0.06)',
                      color: bankMode === 'standard' ? '#09090b' : 'var(--muted)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    Fixed Bands
                  </button>
                </div>
              </div>

              {bankMode === 'harmonic' ? (
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <div style={{ flex: 2 }}>
                      <span style={{ display: 'block', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>
                        SONG KEY
                      </span>
                      <select
                        value={musicalKey}
                        onChange={e => setMusicalKey(e.target.value)}
                        style={{
                          width: '100%',
                          height: '42px',
                          background: '#121216',
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                          padding: '0 10px',
                          color: 'var(--lime)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '14px',
                          fontWeight: 'bold',
                        }}
                      >
                        {MUSICAL_KEYS.map(k => (
                          <option key={k} value={k}>
                            Key {k}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ flex: 3 }}>
                      <span style={{ display: 'block', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>
                        SCALE MODE
                      </span>
                      <div style={{ display: 'flex', height: '42px' }}>
                        <button
                          type="button"
                          onClick={() => setMusicalScale('major')}
                          style={{
                            flex: 1,
                            border: '1px solid var(--line)',
                            borderRight: 'none',
                            borderTopLeftRadius: '8px',
                            borderBottomLeftRadius: '8px',
                            background: musicalScale === 'major' ? 'rgba(217,255,67,0.15)' : '#121216',
                            color: musicalScale === 'major' ? 'var(--lime)' : 'white',
                            borderColor: musicalScale === 'major' ? 'var(--lime)' : 'var(--line)',
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                            cursor: 'pointer',
                          }}
                        >
                          Major (1·2·3·5)
                        </button>
                        <button
                          type="button"
                          onClick={() => setMusicalScale('minor')}
                          style={{
                            flex: 1,
                            border: '1px solid var(--line)',
                            borderTopRightRadius: '8px',
                            borderBottomRightRadius: '8px',
                            background: musicalScale === 'minor' ? 'rgba(217,255,67,0.15)' : '#121216',
                            color: musicalScale === 'minor' ? 'var(--lime)' : 'white',
                            borderColor: musicalScale === 'minor' ? 'var(--lime)' : 'var(--line)',
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                            cursor: 'pointer',
                          }}
                        >
                          Minor (1·3·4·5)
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Harmonic Note Badges */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginTop: '10px' }}>
                    {selectedBank.frequencies.map((freq, i) => (
                      <div
                        key={freq}
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '6px',
                          padding: '6px 4px',
                          textAlign: 'center',
                        }}
                      >
                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--lime)', display: 'block' }}>
                          {selectedBank.notes?.[i] ?? `#${i}`}
                        </span>
                        <small style={{ fontSize: '9px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                          {Math.round(freq)} Hz
                        </small>
                      </div>
                    ))}
                  </div>

                  <p style={{ margin: '8px 0 0', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
                    ✨ Consonant scale degrees in octave 7/8. Any audible bleed blends as musical sparkle/glockenspiel overtones rather than discordant beeps.
                  </p>
                </div>
              ) : (
                <div>
                  <select
                    value={carrierBankId}
                    onChange={e => setCarrierBankId(e.target.value)}
                    style={{
                      width: '100%',
                      height: '42px',
                      background: '#121216',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
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
                  <p style={{ margin: '8px 0 0', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {selectedBank.description}
                  </p>
                </div>
              )}
            </div>

            {/* 3B: BPM & Beat Subdivision Timing */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                  BEAT QUANTIZATION & TEMPO
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font-mono)', color: syncBpm ? 'var(--lime)' : 'var(--muted)' }}>
                  <input
                    type="checkbox"
                    checked={syncBpm}
                    onChange={e => setSyncBpm(e.target.checked)}
                  />
                  <span>Sync BPM</span>
                </label>
              </div>

              {syncBpm ? (
                <div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <input
                        type="number"
                        min={50}
                        max={220}
                        value={bpm}
                        onChange={e => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val)) setBpm(Math.max(50, Math.min(220, val)));
                        }}
                        style={{
                          width: '100%',
                          height: '42px',
                          background: '#121216',
                          border: '1px solid var(--line)',
                          borderRadius: '8px',
                          padding: '0 12px',
                          color: 'var(--lime)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '18px',
                          fontWeight: 'bold',
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleTapTempo}
                      className="button"
                      style={{
                        height: '42px',
                        padding: '0 14px',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        borderColor: tapTimestamps.length > 0 ? 'var(--lime)' : 'var(--line)',
                        color: tapTimestamps.length > 0 ? 'var(--lime)' : 'white',
                      }}
                    >
                      👆 Tap Tempo {tapTimestamps.length > 1 ? `(${bpm})` : ''}
                    </button>
                  </div>

                  {/* Computed timing breakdown */}
                  <div
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(217,255,67,0.06)',
                      border: '1px solid rgba(217,255,67,0.2)',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--lime)',
                    }}
                  >
                    <span>TEMPO: <b>{bpm} BPM</b> · 1/16th Note = <b>{activeSymbolMs} ms / symbol</b></span>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
                    🥁 Temporal onset masking: carrier attacks land directly on drum hits and hi-hats, masking the acoustic onset.
                  </p>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: 'var(--muted)' }}>MANUAL SYMBOL DURATION</span>
                    <b style={{ color: 'var(--lime)' }}>{symbolMs} MS</b>
                  </div>
                  <input
                    type="range"
                    min={110}
                    max={165}
                    step={5}
                    value={symbolMs}
                    onChange={e => setSymbolMs(parseInt(e.target.value, 10))}
                    style={{ width: '100%', accentColor: 'var(--lime)' }}
                  />
                  <p style={{ margin: '8px 0 0', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    Fixed duration without musical beat synchronization.
                  </p>
                </div>
              )}
            </div>

            {/* 3C: Envelope Camouflage Style */}
            <div>
              <label style={{ display: 'block', marginBottom: '10px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                ACOUSTIC CAMOUFLAGE ENVELOPE
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setEnvelopeMode('PERCUSSIVE')}
                  className="button"
                  style={{
                    flex: 1,
                    minHeight: '42px',
                    padding: '8px 10px',
                    background: envelopeMode === 'PERCUSSIVE' ? 'rgba(217,255,67,0.15)' : 'transparent',
                    borderColor: envelopeMode === 'PERCUSSIVE' ? 'var(--lime)' : 'var(--line)',
                    color: envelopeMode === 'PERCUSSIVE' ? 'var(--lime)' : 'white',
                    fontSize: '11px',
                    textAlign: 'center',
                  }}
                >
                  🥁 Percussive (Hi-Hat)
                </button>
                <button
                  type="button"
                  onClick={() => setEnvelopeMode('SUSTAINED')}
                  className="button"
                  style={{
                    flex: 1,
                    minHeight: '42px',
                    padding: '8px 10px',
                    background: envelopeMode === 'SUSTAINED' ? 'rgba(217,255,67,0.15)' : 'transparent',
                    borderColor: envelopeMode === 'SUSTAINED' ? 'var(--lime)' : 'var(--line)',
                    color: envelopeMode === 'SUSTAINED' ? 'var(--lime)' : 'white',
                    fontSize: '11px',
                    textAlign: 'center',
                  }}
                >
                  🌊 Sustained (Ambient)
                </button>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
                {envelopeMode === 'PERCUSSIVE'
                  ? 'Fast 2ms attack with smooth exponential decay. Disguises carrier bursts as acoustic hi-hats or shaker percussion.'
                  : 'Raised-cosine window across the whole slot duration. Best for ambient drones, strings, or pad textures.'}
              </p>
            </div>

            {/* 3D: Audibility Profile & Spectral Notching */}
            <div>
              <label style={{ display: 'block', marginBottom: '10px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                AUDIBILITY PROFILE & NOTCHING
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['SUBTLE', 'BALANCED', 'ROBUST'] as EmbedProfile[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProfile(p)}
                    className="button"
                    style={{
                      flex: 1,
                      minHeight: '42px',
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
              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
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
                      <strong>{selectedBank.notes ? selectedBank.notes[i] : `#${i}`}</strong>
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
