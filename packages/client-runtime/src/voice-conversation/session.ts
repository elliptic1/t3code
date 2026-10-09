import type { VoiceSessionConnection } from "@t3tools/contracts";
import { voiceInstructions, voiceTools } from "./tools.ts";
export function voiceSessionConfiguration(connection: VoiceSessionConnection) {
  return connection.protocol === "openai"
    ? {
        type: "realtime",
        instructions: voiceInstructions,
        tools: voiceTools,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            ...(connection.transcriptionModel
              ? { transcription: { model: connection.transcriptionModel } }
              : {}),
            turn_detection: {
              type: "server_vad",
              interrupt_response: true,
              create_response: true,
            },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            ...(connection.voice ? { voice: connection.voice } : {}),
          },
        },
      }
    : {
        instructions: voiceInstructions,
        tools: voiceTools,
        ...(connection.voice ? { voice: connection.voice } : {}),
        turn_detection: { type: "server_vad" },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            ...(connection.transcriptionModel
              ? { transcription: { model: connection.transcriptionModel } }
              : {}),
          },
          output: { format: { type: "audio/pcm", rate: 24000 } },
        },
      };
}
