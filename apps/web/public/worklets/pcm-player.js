// AudioWorklet of the desktop app's screen share audio (apps/web/src/platform/screenAudio.ts): plays PCM that arrives in
// chunks (16 bit signed, interleaved stereo, 48 kHz, from the shell's native capture helper) as a continuous signal.
// Plain JavaScript in public/ on purpose: a worklet is loaded by URL, and the app's Content-Security-Policy allows scripts
// from the app itself only (no blob: URLs).
const RATE = 48000;
const CAPACITY = RATE * 2;          // two seconds per channel
const START_AT = RATE * 0.08;       // begin (and resume after running dry) with 80 ms buffered, so small gaps do not click
const TOO_MUCH = RATE * 0.5;        // more than half a second behind: drop down to the start level (the clocks drifted)

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(CAPACITY);
    this.right = new Float32Array(CAPACITY);
    this.read = 0; this.write = 0; this.size = 0; this.playing = false;
    this.port.onmessage = (event) => {
      const bytes = event.data;
      if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) return;
      const view = bytes instanceof Uint8Array ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 4)) : new DataView(bytes, 0, bytes.byteLength - (bytes.byteLength % 4));
      for (let i = 0; i + 3 < view.byteLength; i += 4) {
        if (this.size === CAPACITY) { this.read = (this.read + 1) % CAPACITY; this.size--; }
        this.left[this.write] = view.getInt16(i, true) / 32768;
        this.right[this.write] = view.getInt16(i + 2, true) / 32768;
        this.write = (this.write + 1) % CAPACITY; this.size++;
      }
      if (this.size > TOO_MUCH) { const drop = this.size - START_AT; this.read = (this.read + drop) % CAPACITY; this.size -= drop; }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const l = out[0], r = out[1] ?? out[0];
    if (!this.playing && this.size >= START_AT) this.playing = true;
    for (let i = 0; i < l.length; i++) {
      if (this.playing && this.size > 0) {
        l[i] = this.left[this.read]; r[i] = this.right[this.read];
        this.read = (this.read + 1) % CAPACITY; this.size--;
      } else { l[i] = 0; r[i] = 0; this.playing = false; }
    }
    return true;
  }
}
registerProcessor("pcm-player", PcmPlayer);
