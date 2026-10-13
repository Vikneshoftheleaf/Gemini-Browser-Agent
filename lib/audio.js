// Microphone capture (16 kHz PCM16 -> callback) and playback of model audio (24 kHz PCM16).

export function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class MicCapture {
  constructor({ onChunk, onLevel }) {
    this.onChunk = onChunk; // (base64Pcm16) => void
    this.onLevel = onLevel; // (0..1) => void
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.muted = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    await this.ctx.audioWorklet.addModule(chrome.runtime.getURL("worklets/capture.js"));
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "capture-processor");
    this.node.port.onmessage = (e) => {
      const { pcm, level } = e.data;
      this.onLevel?.(this.muted ? 0 : Math.min(1, level * 6));
      if (this.muted) return;
      this.onChunk(bytesToBase64(new Uint8Array(pcm)));
    };
    source.connect(this.node);
    // Worklet needs a downstream connection in some Chrome versions to keep running.
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    this.node.connect(silent).connect(this.ctx.destination);
  }

  setMuted(m) {
    this.muted = m;
  }

  async stop() {
    try { this.node?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = this.stream = this.node = null;
  }
}

export class AudioPlayer {
  constructor({ onState } = {}) {
    this.onState = onState; // (isSpeaking) => void
    this.ctx = null;
    this.nextTime = 0;
    this.sources = new Set();
  }

  _ensure() {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: 24000 });
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  enqueue(base64Pcm16) {
    this._ensure();
    const bytes = base64ToBytes(base64Pcm16);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const f32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) f32[i] = samples[i] / 32768;

    const buf = this.ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);

    const startAt = Math.max(this.ctx.currentTime + 0.02, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buf.duration;

    this.sources.add(src);
    this.onState?.(true);
    src.onended = () => {
      this.sources.delete(src);
      if (this.sources.size === 0) this.onState?.(false);
    };
  }

  // Called when the user barges in and the server sends `interrupted`.
  interrupt() {
    for (const s of this.sources) {
      try { s.stop(); } catch {}
    }
    this.sources.clear();
    this.nextTime = 0;
    this.onState?.(false);
  }

  async close() {
    this.interrupt();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
