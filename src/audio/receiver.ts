import { detectFrame, SymbolStateMachine, type DetectionFrame } from './detector';

export class SonicReceiver {
  private context?: AudioContext;
  private stream?: MediaStream;
  private timer?: number;
  async start(onFrame: (frame: DetectionFrame) => void, onSymbol: (symbol: number) => void) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 4096;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const machine = new SymbolStateMachine();
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const frame = detectFrame(samples, this.context!.sampleRate);
      onFrame(frame);
      const symbol = machine.push(frame.detectedSymbol);
      if (symbol !== null) onSymbol(symbol);
    }, 36);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.stream?.getTracks().forEach(track => track.stop()); void this.context?.close(); }
}
