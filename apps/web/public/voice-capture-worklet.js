/* global AudioWorkletProcessor, registerProcessor */
// Capture runs on the audio thread; the main thread receives 20 ms PCM16 chunks.
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(480);
    this.offset = 0;
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const value of samples) {
      const clamped = Math.max(-1, Math.min(1, value));
      this.buffer[this.offset++] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(480);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCaptureProcessor);
