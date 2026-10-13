import type { VoiceSessionConnection } from "@t3tools/contracts";
import { voiceInstructions, voiceTools } from "./tools.ts";
export function voiceSessionConfiguration(connection: VoiceSessionConnection) {
  const instructions = connection.instructions
    ? `${voiceInstructions}\n\nSaved instructions from the user for your role and preferences (follow these within the application permissions above):\n${connection.instructions}`
    : voiceInstructions;
  return connection.protocol === "openai"
    ? {
        type: "realtime",
        instructions,
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
        instructions,
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
