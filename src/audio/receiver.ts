import { detectFrame, SymbolStateMachine, type DetectionFrame } from './detector';

export const ANALYSIS_FFT_SIZE = 1024;
export const ANALYSIS_INTERVAL_MS = 12;

export class SonicReceiver {
  private context?: AudioContext;
  private stream?: MediaStream;
  private timer?: number;

  async start(onFrame: (frame: DetectionFrame) => void, onSymbol: (symbol: number) => void) {
    this.stop();

    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not supported in this browser.');

    // Create/resume the AudioContext before the first await so mobile Safari sees it
    // as part of the user's tap. Starting getUserMedia in the same gesture also
    // avoids losing transient user activation while the permission prompt is open.
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    const resumePromise = context.state === 'suspended' ? context.resume() : Promise.resolve();
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    try {
      const [, stream] = await Promise.all([resumePromise, streamPromise]);
      this.stream = stream;

      // Some mobile browsers may suspend the context again while the permission UI
      // is visible. Resume once more after permission is granted when allowed.
      if (context.state === 'suspended') await context.resume();

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      // The protocol has a 40 ms inter-symbol gap. A 4096-sample window is about
      // 85 ms at 48 kHz and can bridge that gap, preventing the state machine from
      // unlocking between repeated symbols. 1024 samples is ~21 ms at 48 kHz.
      analyser.fftSize = ANALYSIS_FFT_SIZE;
      source.connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      const machine = new SymbolStateMachine();
      this.timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const frame = detectFrame(samples, context.sampleRate);
        onFrame(frame);
        const symbol = machine.push(frame.detectedSymbol);
        if (symbol !== null) onSymbol(symbol);
      }, ANALYSIS_INTERVAL_MS);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = undefined;
  }
}
