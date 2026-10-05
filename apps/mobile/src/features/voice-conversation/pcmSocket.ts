import { AudioContext, AudioRecorder, type AudioBufferSourceNode } from "react-native-audio-api";
import type { VoiceSessionConnection } from "@t3tools/contracts";

export async function connectPcmSocket(input: {
  connection: VoiceSessionConnection;
  signal: AbortSignal;
  onEvent: (data: string) => void;
  onError: (message: string) => void;
}) {
  const { connection, signal } = input;
  signal.throwIfAborted();
  const context = new AudioContext({ sampleRate: 24000 });
  const playing = new Set<AudioBufferSourceNode>();
  let nextTime = 0;
  let itemId = "";
  let itemStart = 0;
  let itemDuration = 0;
  const recorder = new AudioRecorder();
  let recordingStart: Promise<unknown> | undefined;
  let socket: WebSocket | undefined;
  let muted = false;
  const send = (event: unknown) => {
    if (!signal.aborted && socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(event));
  };
  const clearAudio = () => {
    for (const node of playing) node.stop();
    playing.clear();
    nextTime = 0;
  };
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    signal.removeEventListener("abort", close);
    recorder.clearOnAudioReady();
    recorder.clearOnError();
    clearAudio();
    socket?.close();
    closing = (async () => {
      try {
        await recordingStart;
      } finally {
        try {
          await recorder.stop();
        } finally {
          if (context.state !== "closed") await context.close();
        }
      }
    })();
    return closing;
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    await context.resume();
    signal.throwIfAborted();
    const url = new URL(connection.endpoint);
    if (connection.model) url.searchParams.set("model", connection.model);
    const protocols = !connection.clientSecret
      ? []
      : connection.protocol === "xai"
        ? [`xai-client-secret.${connection.clientSecret}`]
        : ["realtime", `openai-insecure-api-key.${connection.clientSecret}`];
    // React Native's socket takes a string and throws on a URL object.
    socket = new WebSocket(url.href, protocols);
    const callbackResult = recorder.onAudioReady(
      { sampleRate: 24000, bufferLength: 2400, channelCount: 1 },
      ({ buffer, numFrames }) => {
        if (muted || socket?.readyState !== WebSocket.OPEN || signal.aborted) return;
        if (socket.bufferedAmount > 24000 * 2 * 3) {
          input.onError("Voice upload cannot keep up. Please reconnect.");
          return;
        }
        if (buffer.sampleRate !== 24000) {
          input.onError("This device could not provide 24 kHz voice audio.");
          return;
        }
        const samples = buffer.getChannelData(0);
        const bytes = new Uint8Array(numFrames * 2);
        const pcm = new DataView(bytes.buffer);
        for (let i = 0; i < numFrames; i++) {
          const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
          pcm.setInt16(i * 2, value < 0 ? value * 32768 : value * 32767, true);
        }
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        send({ type: "input_audio_buffer.append", audio: btoa(binary) });
      },
    );
    if (callbackResult.status === "error") throw new Error(callbackResult.message);
    recorder.onError(({ message }) => input.onError(message));
    socket.addEventListener("message", (event) => {
      if (signal.aborted || typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data) as { type?: string; delta?: string; item_id?: string };
        if (
          ["response.output_audio.delta", "response.audio.delta"].includes(data.type ?? "") &&
          typeof data.delta === "string"
        ) {
          const binary = atob(data.delta);
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          const pcm = new DataView(bytes.buffer);
          const buffer = context.createBuffer(1, Math.floor(bytes.length / 2), 24000);
          const channel = buffer.getChannelData(0);
          for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768;
          const start = Math.max(context.currentTime, nextTime);
          if (start - context.currentTime > 30)
            throw new Error("Voice playback buffer exceeded 30 seconds.");
          if (data.item_id && data.item_id !== itemId) {
            itemId = data.item_id;
            itemStart = start;
            itemDuration = 0;
          }
          itemDuration += buffer.duration;
          const node = context.createBufferSource();
          node.buffer = buffer;
          node.connect(context.destination);
          if (playing.size === 0) input.onEvent('{"type":"output_audio_buffer.started"}');
          playing.add(node);
          node.onEnded = () => {
            playing.delete(node);
            node.disconnect();
            if (playing.size === 0) input.onEvent('{"type":"output_audio_buffer.stopped"}');
          };
          node.start(start);
          nextTime = start + buffer.duration;
        }
        if (data.type === "input_audio_buffer.speech_started") {
          if (playing.size && itemId)
            send({
              type: "conversation.item.truncate",
              item_id: itemId,
              content_index: 0,
              audio_end_ms: Math.floor(
                Math.min(itemDuration, Math.max(0, context.currentTime - itemStart)) * 1000,
              ),
            });
          input.onEvent(event.data);
          clearAudio();
          input.onEvent('{"type":"output_audio_buffer.cleared"}');
          return;
        }
        input.onEvent(event.data);
      } catch {
        input.onError("Invalid realtime audio received from the voice provider.");
      }
    });
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      socket!.addEventListener("open", () => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
      socket!.addEventListener("error", () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("Could not connect to the realtime WebSocket."));
        input.onError("Voice WebSocket connection failed.");
      });
      socket!.addEventListener("close", () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("Voice connection closed."));
        if (!signal.aborted) input.onError("Voice connection closed. Start again to reconnect.");
      });
    });
    signal.throwIfAborted();
    recordingStart = recorder.start();
    const result = await recordingStart;
    signal.throwIfAborted();
    if (result && typeof result === "object" && "status" in result && result.status === "error")
      throw new Error("Could not start the microphone.");
    return {
      send,
      close,
      mute: (value: boolean) => {
        muted = value;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
