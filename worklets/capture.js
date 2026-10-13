// Runs in the audio thread. The AudioContext is created at 16 kHz, so input
// samples are already at the rate the Live API expects. We convert float32 to
// little-endian int16 and post ~40 ms frames to the main thread.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 640; // 40 ms @ 16 kHz
    this.buffer = new Int16Array(this.frameSize);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let sumSq = 0;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      sumSq += s * s;
      this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.frameSize) {
        const out = this.buffer.slice(0);
        const level = Math.sqrt(sumSq / channel.length);
        this.port.postMessage({ pcm: out.buffer, level }, [out.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
