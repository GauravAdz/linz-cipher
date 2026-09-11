/**
 * Encodes floating-point PCM audio into a standard 16-bit PCM WAV container.
 */
export function encodeWav(
  channelData: Float32Array | Float32Array[],
  sampleRate: number,
): Uint8Array {
  const channels = Array.isArray(channelData) ? channelData : [channelData];
  const numChannels = channels.length;
  const numSamples = channels[0].length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Helper to write ASCII strings
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF Chunk Descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // chunkSize = 36 + subchunk2Size
  writeString(8, 'WAVE');

  // "fmt " Subchunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);          // subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);           // audioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // numChannels
  view.setUint32(24, sampleRate, true);  // sampleRate
  view.setUint32(28, byteRate, true);    // byteRate
  view.setUint16(32, blockAlign, true);  // blockAlign
  view.setUint16(34, 16, true);          // bitsPerSample

  // "data" Subchunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write interleaved PCM 16-bit samples
  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < numSamples; sampleIndex++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][sampleIndex]));
      // Convert float [-1.0, 1.0] to int16 [-32768, 32767]
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(int16), true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}
