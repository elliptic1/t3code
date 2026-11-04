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
  let stream: MediaStream | undefined;
  let capture: AudioWorkletNode | undefined;
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
  const close = () => {
    signal.removeEventListener("abort", close);
    stream?.getTracks().forEach((track) => track.stop());
    capture?.disconnect();
    clearAudio();
    socket?.close();
    if (context.state !== "closed") void context.close();
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    await context.resume();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    signal.throwIfAborted();
    await context.audioWorklet.addModule(
      new URL("/voice-capture-worklet.js", document.baseURI).href,
    );
    signal.throwIfAborted();
    capture = new AudioWorkletNode(context, "voice-capture");
    context.createMediaStreamSource(stream).connect(capture);
    // A silent output keeps the processing graph alive without monitoring the microphone.
    const silence = context.createGain();
    silence.gain.value = 0;
    capture.connect(silence).connect(context.destination);
    const url = new URL(connection.endpoint);
    if (connection.model) url.searchParams.set("model", connection.model);
    const protocols = !connection.clientSecret
      ? []
      : connection.protocol === "xai"
        ? [`xai-client-secret.${connection.clientSecret}`]
        : ["realtime", `openai-insecure-api-key.${connection.clientSecret}`];
    socket = new WebSocket(url, protocols);
    capture.port.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
      if (muted || socket?.readyState !== WebSocket.OPEN || signal.aborted) return;
      if (socket.bufferedAmount > 24000 * 2 * 3) {
        input.onError("Voice upload cannot keep up with the connection. Please reconnect.");
        return;
      }
      const bytes = new Uint8Array(event.data);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      send({ type: "input_audio_buffer.append", audio: btoa(binary) });
    });
    capture.port.start();
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
          node.addEventListener("ended", () => {
            playing.delete(node);
            node.disconnect();
            if (playing.size === 0) input.onEvent('{"type":"output_audio_buffer.stopped"}');
          });
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
    return {
      send,
      close,
      mute: (value: boolean) => {
        muted = value;
        stream?.getAudioTracks().forEach((track) => {
          track.enabled = !value;
        });
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}
