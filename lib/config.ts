import { loadEnvConfig } from "@next/env";

export interface AppConfig {
  conversation: {
    totalTurns: number;
    maxSecondsPerTurn: number;
    maxDurationSeconds: number;
    bedrockTimeoutMs: number;
    bedrockRetries: number;
    bedrockRetryBaseDelayMs: number;
    bedrockRetryMaxDelayMs: number;
    bedrockRetryJitterRatio: number;
    wsAudioChunkBytes: number;
    sessionTtlMs: number;
  };
  models: {
    intent: string;
    intentInferenceProfile: string;
    dialog: string;
    dialogInferenceProfile: string;
    ttsOrSonic: string;
    ttsOrSonicInferenceProfile: string;
  };
  voices: {
    agentA: string;
    agentB: string;
  };
  audio: {
    mimeType: string;
    format: string;
    sampleRate: number;
  };
}

declare global {
  var __POCKET_PANEL_ENV_LOADED__: boolean | undefined;
}

if (!globalThis.__POCKET_PANEL_ENV_LOADED__) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  globalThis.__POCKET_PANEL_ENV_LOADED__ = true;
}

const runtimeConfig: Pick<AppConfig, "conversation" | "voices" | "audio"> = {
  conversation: {
    totalTurns: 8,
    maxSecondsPerTurn: 28,
    maxDurationSeconds: 210,
    bedrockTimeoutMs: 35_000,
    bedrockRetries: 2,
    bedrockRetryBaseDelayMs: 300,
    bedrockRetryMaxDelayMs: 6_000,
    bedrockRetryJitterRatio: 0.2,
    wsAudioChunkBytes: 16_384,
    sessionTtlMs: 30 * 60 * 1000
  },
  voices: {
    agentA: "matthew",
    agentB: "amy"
  },
  audio: {
    mimeType: "audio/wav",
    format: "wav",
    sampleRate: 24_000
  }
};

export const appConfig: AppConfig = {
  conversation: runtimeConfig.conversation,
  models: {
    intent: process.env.BEDROCK_MODEL_ID_INTENT ?? "",
    intentInferenceProfile: process.env.BEDROCK_INFERENCE_PROFILE_ID_INTENT ?? "",
    dialog: process.env.BEDROCK_MODEL_ID_DIALOG ?? "",
    dialogInferenceProfile: process.env.BEDROCK_INFERENCE_PROFILE_ID_DIALOG ?? "",
    ttsOrSonic: process.env.BEDROCK_MODEL_ID_TTS_OR_SONIC ?? "",
    ttsOrSonicInferenceProfile: process.env.BEDROCK_INFERENCE_PROFILE_ID_TTS_OR_SONIC ?? ""
  },
  voices: runtimeConfig.voices,
  audio: runtimeConfig.audio
};
