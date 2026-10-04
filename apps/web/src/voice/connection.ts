import { voiceSessionConfiguration } from "@t3tools/client-runtime/voice-conversation/session";
import type { VoiceSessionConnection } from "@t3tools/contracts";
import {
  createVoiceConversationController,
  type VoiceAction,
} from "@t3tools/client-runtime/voice-conversation";
import { connectPcmSocket } from "./pcmSocket";

export interface VoiceConnection {
  close: () => void;
  mute: (muted: boolean) => void;
  notify: (message: string) => void;
}
export async function connectVoice(input: {
  connection: VoiceSessionConnection;
  signal: AbortSignal;
  execute: (action: VoiceAction) => Promise<unknown>;
  onTranscript: (speaker: "You" | "T3", text: string) => void;
  onError: (message: string) => void;
  onStatus: (status: string) => void;
}): Promise<VoiceConnection> {
  const { connection, signal } = input;
  signal.throwIfAborted();
  let send: (event: unknown) => void = () => {};
  const controller = createVoiceConversationController({ ...input, send: (event) => send(event) });
  const onEvent = controller.onEvent;
  const session = voiceSessionConfiguration(connection);
  if (connection.transport === "websocket") {
    const socket = await connectPcmSocket({ connection, signal, onEvent, onError: input.onError });
    send = socket.send;
    send({ type: "session.update", session });
    input.onStatus("Listening");
    return { ...socket, notify: controller.notify };
  }
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  let stream: MediaStream | undefined;
  const close = () => {
    stream?.getTracks().forEach((track) => track.stop());
    pc.close();
    audio.pause();
    audio.srcObject = null;
    signal.removeEventListener("abort", close);
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    signal.throwIfAborted();
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    pc.addEventListener("track", (event) => {
      if (signal.aborted) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio
        .play()
        .catch(() => input.onError("Audio playback was blocked. End voice and start again."));
    });
    pc.addEventListener("connectionstatechange", () => {
      if (["failed", "disconnected"].includes(pc.connectionState))
        input.onError("Voice connection lost. Start a new conversation to reconnect.");
    });
    const channel = pc.createDataChannel("oai-events");
    send = (event) => {
      if (!signal.aborted && channel.readyState === "open") channel.send(JSON.stringify(event));
    };
    channel.addEventListener("message", (event) => onEvent(String(event.data)));
    const ready = new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      channel.addEventListener("open", () => {
        signal.removeEventListener("abort", abort);
        send({ type: "session.update", session });
        resolve();
      });
      channel.addEventListener("error", () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("Could not open the voice data channel."));
      });
    });
    // The abort may occur while fetching SDP, before we await the channel.
    void ready.catch(() => {});
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch(connection.endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/sdp",
        ...(connection.clientSecret ? { Authorization: `Bearer ${connection.clientSecret}` } : {}),
      },
      body: offer.sdp ?? "",
    });
    if (!response.ok) throw new Error(`Voice connection failed (HTTP ${response.status}).`);
    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
    await ready;
    input.onStatus("Listening");
    return {
      close,
      notify: controller.notify,
      mute: (muted) =>
        stream?.getAudioTracks().forEach((track) => {
          track.enabled = !muted;
        }),
    };
  } catch (error) {
    close();
    throw error;
  }
}
