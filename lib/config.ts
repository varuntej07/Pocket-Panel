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

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoundedNumber = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = toNumber(value, fallback);
  return Math.min(max, Math.max(min, parsed));
};

export const appConfig: AppConfig = {
  conversation: {
    totalTurns: toNumber(process.env.CONVERSATION_TOTAL_TURNS, 8),
    maxSecondsPerTurn: toNumber(process.env.CONVERSATION_MAX_SECONDS_PER_TURN, 18),
    maxDurationSeconds: toNumber(process.env.CONVERSATION_MAX_DURATION_SECONDS, 210),
    bedrockTimeoutMs: toNumber(process.env.BEDROCK_TIMEOUT_MS, 25000),
    bedrockRetries: toNumber(process.env.BEDROCK_RETRIES, 2),
    bedrockRetryBaseDelayMs: toNumber(process.env.BEDROCK_RETRY_BASE_DELAY_MS, 300),
    bedrockRetryMaxDelayMs: toNumber(process.env.BEDROCK_RETRY_MAX_DELAY_MS, 6000),
    bedrockRetryJitterRatio: toBoundedNumber(process.env.BEDROCK_RETRY_JITTER_RATIO, 0.2, 0, 1),
    wsAudioChunkBytes: toNumber(process.env.WS_AUDIO_CHUNK_BYTES, 16_384),
    sessionTtlMs: toNumber(process.env.SESSION_TTL_MS, 30 * 60 * 1000)
  },
  models: {
    intent: process.env.BEDROCK_MODEL_ID_INTENT ?? "",
    intentInferenceProfile: process.env.BEDROCK_INFERENCE_PROFILE_ID_INTENT ?? "",
    dialog: process.env.BEDROCK_MODEL_ID_DIALOG ?? "",
    dialogInferenceProfile: process.env.BEDROCK_INFERENCE_PROFILE_ID_DIALOG ?? "",
    ttsOrSonic: process.env.BEDROCK_MODEL_ID_TTS_OR_SONIC ?? "",
    ttsOrSonicInferenceProfile: process.env.BEDROCK_INFERENCE_PROFILE_ID_TTS_OR_SONIC ?? ""
  },
  voices: {
    agentA: process.env.AGENT_A_VOICE ?? "alloy",
    agentB: process.env.AGENT_B_VOICE ?? "verse"
  },
  audio: {
    mimeType: process.env.AUDIO_MIME_TYPE ?? "audio/wav",
    format: process.env.AUDIO_FORMAT ?? "wav",
    sampleRate: toNumber(process.env.AUDIO_SAMPLE_RATE, 24000)
  }
};
