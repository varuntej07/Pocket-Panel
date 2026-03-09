import {
  InvokeModelCommand,
  InvokeModelWithBidirectionalStreamCommand,
  InvokeModelWithResponseStreamCommand
} from "@aws-sdk/client-bedrock-runtime";
import type { InvokeModelWithBidirectionalStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import { randomUUID } from "crypto";
import { getBedrockClient } from "../bedrock-client";
import { resolveBedrockModelId } from "./model-id";
import { appConfig } from "../config";
import { withRetry, withTimeout } from "../retry";
import { logError, logInfo, logWarn, toErrorMetadata } from "../telemetry";
import type { Speaker } from "../types";

const textDecoder = new TextDecoder("utf-8");
const textEncoder = new TextEncoder();

const SONIC_DEFAULT_VOICE_BY_SPEAKER: Record<Speaker, string> = {
  A: "matthew",
  B: "tiffany"
};
const SONIC_KNOWN_VOICE_IDS = new Set([
  "matthew", "tiffany", "amy", "olivia", "lupe", "carlos",
  "ambre", "florian", "lennart", "beatrice", "lorenzo", "tina",
  "carolina", "leo", "kiara", "arjun"
]);
const SONIC_ALLOWED_SAMPLE_RATES = new Set([8000, 16000, 24000]);
const SONIC_DEFAULT_SAMPLE_RATE = 24000;
const SONIC_INPUT_SAMPLE_RATE_HERTZ = 16000;
const SONIC_INPUT_SAMPLE_SIZE_BITS = 16;
const SONIC_INPUT_CHANNEL_COUNT = 1;
const SONIC_AUDIO_FRAME_DURATION_MS = 32;
const SONIC_PRE_TEXT_SILENCE_MS = 1000;
const SONIC_POST_TEXT_SILENCE_MS = 15000;
const SONIC_PROMPT_END_DELAY_MS = 500;
const SONIC_SESSION_END_DELAY_MS = 300;
const SONIC_SYSTEM_INSTRUCTION =
  "You are a voice assistant. When the user sends you text, read it aloud exactly as written in natural spoken audio. Do not add, remove, change, or paraphrase any words. Do not add any commentary.";
const LOG_TEXT_PREVIEW_LIMIT = 160;
const LOG_EVENT_BYTES_PREVIEW_LIMIT = 120;
const HIDDEN_RESPONSE_BODY_PREVIEW_LIMIT = 2000;
const HIDDEN_RESPONSE_BODY_CAPTURE_LIMIT_BYTES = 32768;
const HIDDEN_RESPONSE_BODY_READ_TIMEOUT_MS = 1500;

const toPreviewText = (value: string, limit: number = LOG_TEXT_PREVIEW_LIMIT): string => {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
};

const toUtf8Preview = (value: Uint8Array, limit: number = LOG_EVENT_BYTES_PREVIEW_LIMIT): string => {
  const decoded = textDecoder.decode(value);
  if (decoded.length <= limit) {
    return decoded;
  }
  return `${decoded.slice(0, limit)}...`;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
};

const describeSonicRequestEvent = (event: SonicRequestEvent): Record<string, unknown> => {
  const eventRecord = asRecord(event.event);
  if (!eventRecord) {
    return { eventName: "unknown" };
  }
  const eventName = Object.keys(eventRecord)[0] ?? "unknown";
  const eventPayload = asRecord(eventRecord[eventName]);
  const details: Record<string, unknown> = {
    eventName
  };

  if (eventName === "sessionStart") {
    const inferenceConfiguration = asRecord(eventPayload?.inferenceConfiguration);
    const turnDetectionConfiguration = asRecord(eventPayload?.turnDetectionConfiguration);
    details.inferenceConfiguration = inferenceConfiguration
      ? {
          maxTokens: inferenceConfiguration.maxTokens,
          topP: inferenceConfiguration.topP,
          temperature: inferenceConfiguration.temperature
        }
      : undefined;
    details.turnDetectionConfiguration = turnDetectionConfiguration
      ? {
          endpointingSensitivity: turnDetectionConfiguration.endpointingSensitivity,
          maxSilenceDurationMs: turnDetectionConfiguration.maxSilenceDurationMs,
          threshold: turnDetectionConfiguration.threshold
        }
      : undefined;
  }
  if (eventName === "promptStart") {
    details.promptName = eventPayload?.promptName;
    details.voiceId = getByPath(eventPayload, "audioOutputConfiguration.voiceId");
    details.sampleRateHertz = getByPath(eventPayload, "audioOutputConfiguration.sampleRateHertz");
    details.mediaType = getByPath(eventPayload, "audioOutputConfiguration.mediaType");
    details.encoding = getByPath(eventPayload, "audioOutputConfiguration.encoding");
    details.audioType = getByPath(eventPayload, "audioOutputConfiguration.audioType");
  }
  if (eventName === "contentStart") {
    details.promptName = eventPayload?.promptName;
    details.contentName = eventPayload?.contentName;
    details.type = eventPayload?.type;
    details.interactive = eventPayload?.interactive;
    details.role = eventPayload?.role;
    details.textInputMediaType = getByPath(eventPayload, "textInputConfiguration.mediaType");
    details.audioInputMediaType = getByPath(eventPayload, "audioInputConfiguration.mediaType");
    details.audioInputSampleRateHertz = getByPath(eventPayload, "audioInputConfiguration.sampleRateHertz");
    details.audioInputSampleSizeBits = getByPath(eventPayload, "audioInputConfiguration.sampleSizeBits");
    details.audioInputChannelCount = getByPath(eventPayload, "audioInputConfiguration.channelCount");
    details.audioInputAudioType = getByPath(eventPayload, "audioInputConfiguration.audioType");
    details.audioInputEncoding = getByPath(eventPayload, "audioInputConfiguration.encoding");
  }
  if (eventName === "textInput") {
    const content = typeof eventPayload?.content === "string" ? eventPayload.content : "";
    details.promptName = eventPayload?.promptName;
    details.contentName = eventPayload?.contentName;
    details.textLength = content.length;
    details.textPreview = toPreviewText(content);
  }
  if (eventName === "audioInput") {
    const base64Content = typeof eventPayload?.content === "string" ? eventPayload.content : "";
    details.promptName = eventPayload?.promptName;
    details.contentName = eventPayload?.contentName;
    details.base64Length = base64Content.length;
    details.audioBytesLength = base64Content.length > 0 ? Buffer.from(base64Content, "base64").length : 0;
  }
  if (eventName === "contentEnd") {
    details.promptName = eventPayload?.promptName;
    details.contentName = eventPayload?.contentName;
  }
  if (eventName === "promptEnd") {
    details.promptName = eventPayload?.promptName;
  }

  return details;
};

const getBidirectionalStreamUnionKey = (event: InvokeModelWithBidirectionalStreamOutput): string => {
  const knownKeys = [
    "chunk",
    "validationException",
    "modelStreamErrorException",
    "throttlingException",
    "internalServerException",
    "serviceUnavailableException",
    "modelTimeoutException"
  ] as const;

  const matched = knownKeys.find((key) => key in event);
  if (matched) {
    return matched;
  }

  const dynamicKeys = Object.keys(event as unknown as Record<string, unknown>);
  if (dynamicKeys.length === 0) {
    return "unknown";
  }
  return `unknown:${dynamicKeys.join(",")}`;
};

const getSonicPayloadEventName = (payload: unknown): string => {
  const eventRecord = asRecord(getByPath(payload, "event"));
  if (!eventRecord) {
    return "missing-event";
  }
  return Object.keys(eventRecord)[0] ?? "unknown-event";
};

const getUnknownThrownErrorMetadata = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error || !error || typeof error !== "object") {
    return {};
  }

  const asObj = error as Record<string, unknown>;
  const unknownMessage =
    typeof asObj.message === "string"
      ? asObj.message
      : (() => {
          try {
            return JSON.stringify(asObj);
          } catch {
            return String(error);
          }
        })();

  return {
    unknownErrorType: "non-Error-throwable",
    unknownErrorKeys: Object.keys(asObj),
    unknownErrorMessage: toPreviewText(unknownMessage, HIDDEN_RESPONSE_BODY_PREVIEW_LIMIT)
  };
};

type ErrorWithHiddenResponse = Error & {
  $response?: {
    statusCode?: number;
    headers?: unknown;
    body?: unknown;
  };
};

type BodyWithTransformToString = {
  transformToString: () => Promise<string>;
};

const hasTransformToString = (value: unknown): value is BodyWithTransformToString =>
  Boolean(value && typeof value === "object" && "transformToString" in value && typeof value.transformToString === "function");

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  Boolean(value && typeof value === "object" && Symbol.asyncIterator in value);

const collectBodyPreviewFromAsyncIterable = async (
  body: AsyncIterable<unknown>,
  maxBytes: number
): Promise<{ bodyText: string; bytesCaptured: number; truncated: boolean }> => {
  const chunks: Uint8Array[] = [];
  let bytesCaptured = 0;
  let truncated = false;

  for await (const chunk of body) {
    let chunkBytes: Uint8Array | null = null;

    if (chunk instanceof Uint8Array) {
      chunkBytes = chunk;
    } else if (Buffer.isBuffer(chunk)) {
      chunkBytes = new Uint8Array(chunk);
    } else if (typeof chunk === "string") {
      chunkBytes = textEncoder.encode(chunk);
    }

    if (!chunkBytes || chunkBytes.length === 0) {
      continue;
    }

    const remainingBytes = maxBytes - bytesCaptured;
    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }

    if (chunkBytes.length > remainingBytes) {
      chunks.push(chunkBytes.slice(0, remainingBytes));
      bytesCaptured += remainingBytes;
      truncated = true;
      break;
    }

    chunks.push(chunkBytes);
    bytesCaptured += chunkBytes.length;
  }

  const merged = concatBytes(chunks);
  return {
    bodyText: textDecoder.decode(merged),
    bytesCaptured: merged.length,
    truncated
  };
};

const getHiddenResponseMetadata = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return {};
  }
  const typedError = error as ErrorWithHiddenResponse;
  if (!typedError.$response || typeof typedError.$response !== "object") {
    return {};
  }

  return {
    hiddenResponseStatusCode: typedError.$response.statusCode,
    hiddenResponseHeaders:
      typedError.$response.headers && typeof typedError.$response.headers === "object"
        ? typedError.$response.headers
        : undefined,
    hiddenResponseBodyType: typedError.$response.body ? typeof typedError.$response.body : undefined
  };
};

const getHiddenResponseBodyPreviewMetadata = async (error: unknown): Promise<Record<string, unknown>> => {
  if (!(error instanceof Error)) {
    return {};
  }

  const typedError = error as ErrorWithHiddenResponse;
  if (!typedError.$response || typeof typedError.$response !== "object") {
    return {};
  }

  const responseBody = typedError.$response.body;
  if (!responseBody) {
    return {};
  }

  try {
    if (typeof responseBody === "string") {
      return {
        hiddenResponseBodyPreview: toPreviewText(responseBody, HIDDEN_RESPONSE_BODY_PREVIEW_LIMIT),
        hiddenResponseBodyTextLength: responseBody.length
      };
    }

    if (responseBody instanceof Uint8Array || Buffer.isBuffer(responseBody)) {
      const bytes = responseBody instanceof Uint8Array ? responseBody : new Uint8Array(responseBody);
      return {
        hiddenResponseBodyPreview: toUtf8Preview(bytes, HIDDEN_RESPONSE_BODY_PREVIEW_LIMIT),
        hiddenResponseBodyBytesLength: bytes.length
      };
    }

    if (hasTransformToString(responseBody)) {
      const bodyText = await withTimeout(
        responseBody.transformToString(),
        HIDDEN_RESPONSE_BODY_READ_TIMEOUT_MS,
        "hiddenResponse.transformToString"
      );
      return {
        hiddenResponseBodyPreview: toPreviewText(bodyText, HIDDEN_RESPONSE_BODY_PREVIEW_LIMIT),
        hiddenResponseBodyTextLength: bodyText.length
      };
    }

    if (isAsyncIterable(responseBody)) {
      const preview = await withTimeout(
        collectBodyPreviewFromAsyncIterable(responseBody, HIDDEN_RESPONSE_BODY_CAPTURE_LIMIT_BYTES),
        HIDDEN_RESPONSE_BODY_READ_TIMEOUT_MS,
        "hiddenResponse.asyncIterator"
      );
      return {
        hiddenResponseBodyPreview: toPreviewText(preview.bodyText, HIDDEN_RESPONSE_BODY_PREVIEW_LIMIT),
        hiddenResponseBodyBytesCaptured: preview.bytesCaptured,
        hiddenResponseBodyTruncated: preview.truncated
      };
    }

    return {
      hiddenResponseBodyStringified: toPreviewText(String(responseBody), HIDDEN_RESPONSE_BODY_PREVIEW_LIMIT)
    };
  } catch (bodyReadError) {
    return {
      hiddenResponseBodyReadFailed: true,
      ...toErrorMetadata(bodyReadError)
    };
  }
};

const waitForMs = async (durationMs: number): Promise<void> => {
  if (durationMs <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

declare global {
  var __POCKET_PANEL_AUDIO_WARNING_KEYS__: Set<string> | undefined;
}

const audioWarningKeys = globalThis.__POCKET_PANEL_AUDIO_WARNING_KEYS__ ?? new Set<string>();
globalThis.__POCKET_PANEL_AUDIO_WARNING_KEYS__ = audioWarningKeys;

export interface SpeechSynthesisResult {
  audioBytes: Uint8Array;
  mimeType: string;
}

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  if (chunks.length === 0) {
    return new Uint8Array();
  }
  if (chunks.length === 1) {
    return chunks[0];
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

const tryParseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(textDecoder.decode(bytes));
  } catch {
    return null;
  }
};

const getByPath = (value: unknown, path: string): unknown => {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, value);
};

const isSonicModelId = (modelId: string): boolean => {
  const normalized = modelId.toLowerCase();
  return normalized.includes("nova-sonic") || normalized.includes("nova-2-sonic");
};

const maybeLogAudioWarning = (key: string, message: string, metadata: Record<string, unknown>): void => {
  if (audioWarningKeys.has(key)) {
    return;
  }
  audioWarningKeys.add(key);
  logWarn("audio", message, metadata);
};

const resolveSonicVoiceId = (speaker: Speaker): string => {
  const configuredVoiceId = (speaker === "A" ? appConfig.voices.agentA : appConfig.voices.agentB).trim();
  const normalizedVoiceId = configuredVoiceId.toLowerCase();
  const fallbackVoiceId = SONIC_DEFAULT_VOICE_BY_SPEAKER[speaker];

  if (SONIC_KNOWN_VOICE_IDS.has(normalizedVoiceId)) {
    return normalizedVoiceId;
  }

  maybeLogAudioWarning(
    `sonic-voice|${speaker}|${configuredVoiceId}|${fallbackVoiceId}`,
    "Configured Sonic voice is not recognized; using fallback voice",
    {
      speaker,
      configuredVoiceId,
      fallbackVoiceId,
      supportedVoiceIds: Array.from(SONIC_KNOWN_VOICE_IDS)
    }
  );
  return fallbackVoiceId;
};

const resolveSonicSampleRate = (): number => {
  const configuredSampleRate = appConfig.audio.sampleRate;
  if (SONIC_ALLOWED_SAMPLE_RATES.has(configuredSampleRate)) {
    return configuredSampleRate;
  }

  maybeLogAudioWarning(
    `sonic-sample-rate|${configuredSampleRate}|${SONIC_DEFAULT_SAMPLE_RATE}`,
    "Configured Sonic sample rate is invalid; using fallback sample rate",
    {
      configuredSampleRate,
      fallbackSampleRate: SONIC_DEFAULT_SAMPLE_RATE,
      allowedSampleRates: Array.from(SONIC_ALLOWED_SAMPLE_RATES)
    }
  );
  return SONIC_DEFAULT_SAMPLE_RATE;
};

const writeAscii = (target: Uint8Array, offset: number, value: string): void => {
  for (let i = 0; i < value.length; i += 1) {
    target[offset + i] = value.charCodeAt(i);
  }
};

// Nova Sonic returns LPCM bytes; wrap them in a WAV container for browser playback.
const encodePcm16LeToWav = (pcmBytes: Uint8Array, sampleRate: number): Uint8Array => {
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.length;

  const wavBytes = new Uint8Array(44 + dataSize);
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  writeAscii(wavBytes, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(wavBytes, 8, "WAVE");
  writeAscii(wavBytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(wavBytes, 36, "data");
  view.setUint32(40, dataSize, true);
  wavBytes.set(pcmBytes, 44);
  return wavBytes;
};

const extractAudioBase64 = (payload: unknown): string | undefined => {
  const candidatePaths = [
    "audio",
    "audioBase64",
    "output.audio",
    "output.audioBase64",
    "result.audio",
    "result.audioBase64",
    "data.audio",
    "data.audioBase64"
  ];
  for (const path of candidatePaths) {
    const candidate = getByPath(payload, path);
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
};

const extractAudioBytesFromPayload = (payload: unknown): Uint8Array | undefined => {
  const audioBase64 = extractAudioBase64(payload);
  if (!audioBase64) {
    return undefined;
  }
  return new Uint8Array(Buffer.from(audioBase64, "base64"));
};

const buildTtsPayloadVariants = (text: string, voiceId: string): unknown[] => [
  {
    inputText: text,
    voiceId,
    outputFormat: appConfig.audio.format,
    sampleRate: appConfig.audio.sampleRate
  },
  {
    text,
    voice: voiceId,
    format: appConfig.audio.format,
    sampleRate: appConfig.audio.sampleRate
  },
  {
    input: {
      text
    },
    voice: {
      id: voiceId
    },
    audio: {
      format: appConfig.audio.format,
      sampleRate: appConfig.audio.sampleRate
    }
  }
];

const tryStreamInvocation = async (modelId: string, payload: unknown): Promise<Uint8Array | null> => {
  const bedrock = getBedrockClient();
  logInfo("audio", "Attempting InvokeModelWithResponseStream for audio synthesis", {
    modelId,
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>) : []
  });

  const command = new InvokeModelWithResponseStreamCommand({
    modelId,
    body: JSON.stringify(payload),
    contentType: "application/json",
    accept: "application/json"
  });

  const response = (await withRetry(
    () => withTimeout(bedrock.send(command), appConfig.conversation.bedrockTimeoutMs, "ttsStreamInvoke"),
    {
      maxAttempts: appConfig.conversation.bedrockRetries + 1,
      baseDelayMs: appConfig.conversation.bedrockRetryBaseDelayMs,
      maxDelayMs: appConfig.conversation.bedrockRetryMaxDelayMs,
      jitterRatio: appConfig.conversation.bedrockRetryJitterRatio
    },
    "ttsStreamInvoke"
  )) as {
    body?: AsyncIterable<{
      chunk?: {
        bytes?: Uint8Array;
      };
    }>;
  };

  if (!response.body) {
    logWarn("audio", "InvokeModelWithResponseStream returned no body", {
      modelId
    });
    return null;
  }

  const rawAudioChunks: Uint8Array[] = [];
  const structuredAudioChunks: Uint8Array[] = [];
  let eventCount = 0;
  for await (const event of response.body) {
    eventCount += 1;
    const eventChunk = event.chunk?.bytes;
    if (!eventChunk || eventChunk.length === 0) {
      logWarn("audio", "Streaming response event did not include chunk bytes", {
        modelId,
        eventCount
      });
      continue;
    }
    const asJson = tryParseJson(eventChunk);
    const parsedAudio = asJson ? extractAudioBytesFromPayload(asJson) : undefined;
    if (parsedAudio && parsedAudio.length > 0) {
      structuredAudioChunks.push(parsedAudio);
    } else {
      rawAudioChunks.push(eventChunk);
    }
  }

  if (structuredAudioChunks.length > 0) {
    logInfo("audio", "InvokeModelWithResponseStream produced structured audio chunks", {
      modelId,
      eventCount,
      structuredChunkCount: structuredAudioChunks.length,
      structuredBytesTotal: structuredAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    });
    return concatBytes(structuredAudioChunks);
  }
  if (rawAudioChunks.length > 0) {
    logInfo("audio", "InvokeModelWithResponseStream produced raw audio chunks", {
      modelId,
      eventCount,
      rawChunkCount: rawAudioChunks.length,
      rawBytesTotal: rawAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    });
    return concatBytes(rawAudioChunks);
  }
  logWarn("audio", "InvokeModelWithResponseStream returned events but no audio bytes", {
    modelId,
    eventCount
  });
  return null;
};

const tryStandardInvocation = async (modelId: string, payload: unknown): Promise<Uint8Array | null> => {
  const bedrock = getBedrockClient();
  logInfo("audio", "Attempting InvokeModel for audio synthesis", {
    modelId,
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>) : []
  });

  const command = new InvokeModelCommand({
    modelId,
    body: JSON.stringify(payload),
    contentType: "application/json",
    accept: "application/json"
  });

  const response = (await withRetry(
    () => withTimeout(bedrock.send(command), appConfig.conversation.bedrockTimeoutMs, "ttsInvoke"),
    {
      maxAttempts: appConfig.conversation.bedrockRetries + 1,
      baseDelayMs: appConfig.conversation.bedrockRetryBaseDelayMs,
      maxDelayMs: appConfig.conversation.bedrockRetryMaxDelayMs,
      jitterRatio: appConfig.conversation.bedrockRetryJitterRatio
    },
    "ttsInvoke"
  )) as {
    body?: Uint8Array;
  };

  if (!response.body || response.body.length === 0) {
    logWarn("audio", "InvokeModel returned empty body", {
      modelId
    });
    return null;
  }

  const asJson = tryParseJson(response.body);
  if (!asJson) {
    logInfo("audio", "InvokeModel returned binary body directly", {
      modelId,
      bytesLength: response.body.length
    });
    return response.body;
  }

  const extracted = extractAudioBytesFromPayload(asJson) ?? null;
  if (!extracted) {
    logWarn("audio", "InvokeModel JSON body did not contain audio field", {
      modelId,
      payloadKeys: Object.keys(asRecord(asJson) ?? {})
    });
    return null;
  }

  logInfo("audio", "InvokeModel returned JSON-encoded audio", {
    modelId,
    bytesLength: extracted.length
  });
  return extracted;
};

type SonicRequestEvent =
  | {
      event: {
        sessionStart: {
          inferenceConfiguration: {
            maxTokens: number;
            topP: number;
            temperature: number;
          };
          turnDetectionConfiguration?: {
            endpointingSensitivity: "LOW" | "MEDIUM" | "HIGH";
          };
        };
      };
    }
  | {
      event: {
        promptStart: {
          promptName: string;
          textOutputConfiguration: {
            mediaType: "text/plain";
          };
          audioOutputConfiguration: {
            mediaType: "audio/lpcm";
            encoding: "base64";
            audioType: "SPEECH";
            sampleRateHertz: number;
            sampleSizeBits: 16;
            channelCount: 1;
            voiceId: string;
          };
          toolUseOutputConfiguration?: {
            mediaType: "application/json";
          };
        };
      };
    }
  | {
      event: {
        contentStart: {
          promptName: string;
          contentName: string;
          type: "TEXT";
          textInputConfiguration: {
            mediaType: "text/plain";
          };
          interactive: boolean;
          role: "SYSTEM" | "USER" | "SYSTEM_SPEECH";
        };
      };
    }
  | {
      event: {
        contentStart: {
          promptName: string;
          contentName: string;
          type: "AUDIO";
          audioInputConfiguration: {
            mediaType: "audio/lpcm";
            sampleRateHertz: number;
            sampleSizeBits: 16;
            channelCount: 1;
            audioType: "SPEECH";
            encoding: "base64";
          };
          interactive: boolean;
          role: "USER";
        };
      };
    }
  | {
      event: {
        textInput: {
          promptName: string;
          contentName: string;
          content: string;
        };
      };
    }
  | {
      event: {
        audioInput: {
          promptName: string;
          contentName: string;
          content: string;
        };
      };
    }
  | {
      event: {
        contentEnd: {
          promptName: string;
          contentName: string;
        };
      };
    }
  | {
      event: {
        promptEnd: {
          promptName: string;
        };
      };
    }
  | {
      event: {
        sessionEnd: Record<string, never>;
      };
    };

type SonicScheduledRequestEvent = {
  requestEvent: SonicRequestEvent;
  delayAfterMs?: number;
};

type SilentAudioInputFrame = {
  base64: string;
  durationMs: number;
  bytesLength: number;
};

const buildSilentAudioInputBase64 = (sampleRateHertz: number, durationMs: number): string => {
  const totalSamples = Math.max(1, Math.round((sampleRateHertz * durationMs) / 1000));
  const bytesPerSample = SONIC_INPUT_SAMPLE_SIZE_BITS / 8;
  const silentBytes = new Uint8Array(totalSamples * bytesPerSample * SONIC_INPUT_CHANNEL_COUNT);
  return Buffer.from(silentBytes).toString("base64");
};

const buildSilentAudioInputFrames = (
  sampleRateHertz: number,
  totalDurationMs: number,
  frameDurationMs: number
): SilentAudioInputFrame[] => {
  const frames: SilentAudioInputFrame[] = [];
  const normalizedFrameDurationMs = Math.max(1, frameDurationMs);
  let remainingDurationMs = Math.max(1, totalDurationMs);

  while (remainingDurationMs > 0) {
    const durationMs = Math.min(normalizedFrameDurationMs, remainingDurationMs);
    const base64 = buildSilentAudioInputBase64(sampleRateHertz, durationMs);
    frames.push({
      base64,
      durationMs,
      bytesLength: Buffer.from(base64, "base64").length
    });
    remainingDurationMs -= durationMs;
  }

  return frames;
};

const assertSonicRequestHasRequiredAudioContent = (events: SonicRequestEvent[]): void => {
  const hasAudioContentStart = events.some((event) => {
    const eventRecord = asRecord(event.event);
    const contentStart = asRecord(eventRecord?.contentStart);
    return contentStart?.type === "AUDIO";
  });
  const hasAudioInput = events.some((event) => {
    const eventRecord = asRecord(event.event);
    return Boolean(eventRecord?.audioInput);
  });

  if (!hasAudioContentStart || !hasAudioInput) {
    throw new Error("Nova Sonic request must include at least one AUDIO contentStart and one audioInput event.");
  }
};

const buildSonicRequestEvents = (text: string, voiceId: string, sampleRateHertz: number): SonicScheduledRequestEvent[] => {
  const promptName = `prompt-${randomUUID()}`;
  const systemContentName = `system-${randomUUID()}`;
  const audioInputContentName = `audio-${randomUUID()}`;
  const userTextContentName = `text-${randomUUID()}`;

  // Build pre-text silence (establishes the audio stream before sending text)
  const preTextSilenceFrames = buildSilentAudioInputFrames(
    SONIC_INPUT_SAMPLE_RATE_HERTZ,
    SONIC_PRE_TEXT_SILENCE_MS,
    SONIC_AUDIO_FRAME_DURATION_MS
  );
  // Build post-text silence (keeps audio stream alive while model generates audio)
  const postTextSilenceFrames = buildSilentAudioInputFrames(
    SONIC_INPUT_SAMPLE_RATE_HERTZ,
    SONIC_POST_TEXT_SILENCE_MS,
    SONIC_AUDIO_FRAME_DURATION_MS
  );
  const allSilenceFrames = [...preTextSilenceFrames, ...postTextSilenceFrames];
  const silentAudioInputBytesLength = allSilenceFrames.reduce((sum, frame) => sum + frame.bytesLength, 0);
  const silentAudioInputTotalDurationMs = allSilenceFrames.reduce((sum, frame) => sum + frame.durationMs, 0);

  const events: SonicScheduledRequestEvent[] = [
    // 1. Session start
    {
      requestEvent: {
        event: {
          sessionStart: {
            inferenceConfiguration: {
              maxTokens: 1024,
              topP: 0.9,
              temperature: 0.7
            },
            turnDetectionConfiguration: {
              endpointingSensitivity: "MEDIUM"
            }
          }
        }
      }
    },
    // 2. Prompt start with audio output config
    {
      requestEvent: {
        event: {
          promptStart: {
            promptName,
            textOutputConfiguration: {
              mediaType: "text/plain"
            },
            audioOutputConfiguration: {
              mediaType: "audio/lpcm",
              encoding: "base64",
              audioType: "SPEECH",
              sampleRateHertz,
              sampleSizeBits: 16,
              channelCount: 1,
              voiceId
            },
            toolUseOutputConfiguration: {
              mediaType: "application/json"
            }
          }
        }
      }
    },
    // 3. System prompt (non-interactive)
    {
      requestEvent: {
        event: {
          contentStart: {
            promptName,
            contentName: systemContentName,
            type: "TEXT",
            textInputConfiguration: {
              mediaType: "text/plain"
            },
            interactive: false,
            role: "SYSTEM"
          }
        }
      }
    },
    {
      requestEvent: {
        event: {
          textInput: {
            promptName,
            contentName: systemContentName,
            content: SONIC_SYSTEM_INSTRUCTION
          }
        }
      }
    },
    {
      requestEvent: {
        event: {
          contentEnd: {
            promptName,
            contentName: systemContentName
          }
        }
      }
    },
    // 4. Open user audio stream (must be active BEFORE sending text)
    {
      requestEvent: {
        event: {
          contentStart: {
            promptName,
            contentName: audioInputContentName,
            type: "AUDIO",
            audioInputConfiguration: {
              mediaType: "audio/lpcm",
              sampleRateHertz: SONIC_INPUT_SAMPLE_RATE_HERTZ,
              sampleSizeBits: SONIC_INPUT_SAMPLE_SIZE_BITS,
              channelCount: SONIC_INPUT_CHANNEL_COUNT,
              audioType: "SPEECH",
              encoding: "base64"
            },
            interactive: true,
            role: "USER"
          }
        }
      }
    },
    // 5. Pre-text silence (establish audio stream)
    ...preTextSilenceFrames.map((frame) => ({
      requestEvent: {
        event: {
          audioInput: {
            promptName,
            contentName: audioInputContentName,
            content: frame.base64
          }
        }
      },
      delayAfterMs: frame.durationMs
    })),
    // 6. Cross-modal text input (sent while audio stream is active)
    // role: "USER" + interactive: true triggers Nova Sonic to generate audio response.
    // System prompt instructs it to read the text verbatim.
    {
      requestEvent: {
        event: {
          contentStart: {
            promptName,
            contentName: userTextContentName,
            type: "TEXT",
            textInputConfiguration: {
              mediaType: "text/plain"
            },
            interactive: true,
            role: "USER"
          }
        }
      }
    },
    {
      requestEvent: {
        event: {
          textInput: {
            promptName,
            contentName: userTextContentName,
            content: text
          }
        }
      }
    },
    {
      requestEvent: {
        event: {
          contentEnd: {
            promptName,
            contentName: userTextContentName
          }
        }
      }
    },
    // 7. Post-text silence (keep audio stream alive while model generates audio)
    ...postTextSilenceFrames.map((frame) => ({
      requestEvent: {
        event: {
          audioInput: {
            promptName,
            contentName: audioInputContentName,
            content: frame.base64
          }
        }
      },
      delayAfterMs: frame.durationMs
    })),
    // 8. Close audio stream
    {
      requestEvent: {
        event: {
          contentEnd: {
            promptName,
            contentName: audioInputContentName
          }
        }
      },
      delayAfterMs: SONIC_PROMPT_END_DELAY_MS
    },
    // 9. End prompt and session
    {
      requestEvent: {
        event: {
          promptEnd: {
            promptName
          }
        }
      },
      delayAfterMs: SONIC_SESSION_END_DELAY_MS
    },
    {
      requestEvent: {
        event: {
          sessionEnd: {}
        }
      }
    }
  ];

  assertSonicRequestHasRequiredAudioContent(events.map((event) => event.requestEvent));

  logInfo("audio", "Built Nova Sonic bidirectional request events", {
    eventCount: events.length,
    hasAudioContentStart: true,
    hasAudioInputEvent: true,
    audioInputSampleRateHertz: SONIC_INPUT_SAMPLE_RATE_HERTZ,
    audioInputBytesLength: silentAudioInputBytesLength,
    audioInputFrameCount: allSilenceFrames.length,
    audioInputTotalDurationMs: silentAudioInputTotalDurationMs,
    audioInputFrameDurationMs: SONIC_AUDIO_FRAME_DURATION_MS,
    promptEndDelayMs: SONIC_PROMPT_END_DELAY_MS,
    sessionEndDelayMs: SONIC_SESSION_END_DELAY_MS,
    eventDescriptors: events.map(({ requestEvent, delayAfterMs }) => ({
      delayAfterMs: delayAfterMs ?? 0,
      ...describeSonicRequestEvent(requestEvent)
    }))
  });

  return events;
};

const buildSonicRequestBody = async function* (
  events: SonicScheduledRequestEvent[],
  completionSignal?: { done: boolean }
): AsyncIterable<{
  chunk: {
    bytes: Uint8Array;
  };
}> {
  for (let index = 0; index < events.length; index += 1) {
    // If the model has finished generating, skip remaining silence frames
    // but still send the closing events (contentEnd, promptEnd, sessionEnd)
    if (completionSignal?.done) {
      const eventName = describeSonicRequestEvent(events[index].requestEvent).eventName;
      if (eventName === "audioInput") {
        continue;
      }
    }
    const scheduledEvent = events[index];
    const encoded = textEncoder.encode(JSON.stringify(scheduledEvent.requestEvent));
    const delayAfterMs = scheduledEvent.delayAfterMs ?? 0;
    const eventDesc = describeSonicRequestEvent(scheduledEvent.requestEvent);
    // Skip logging individual silence frames to avoid flooding the console (~500 per attempt)
    if (eventDesc.eventName !== "audioInput") {
      logInfo("audio", "Sending Nova Sonic bidirectional request event", {
        index,
        bytesLength: encoded.length,
        delayAfterMs,
        ...eventDesc
      });
    }

    yield {
      chunk: {
        bytes: encoded
      }
    };

    if (delayAfterMs > 0) {
      await waitForMs(delayAfterMs);
    }
  }
};

const createBidirectionalEventError = (event: InvokeModelWithBidirectionalStreamOutput): Error | null => {
  if ("validationException" in event && event.validationException) {
    const error = new Error(event.validationException.message ?? "Nova Sonic bidirectional validation failure");
    error.name = "ValidationException";
    logError("audio", "Nova Sonic stream returned validationException event", {
      ...toErrorMetadata(error)
    });
    return error;
  }
  if ("modelStreamErrorException" in event && event.modelStreamErrorException) {
    const error = new Error(event.modelStreamErrorException.message ?? "Nova Sonic bidirectional stream failure");
    error.name = "ModelStreamErrorException";
    logError("audio", "Nova Sonic stream returned modelStreamErrorException event", {
      originalStatusCode: event.modelStreamErrorException.originalStatusCode,
      originalMessage: event.modelStreamErrorException.originalMessage,
      ...toErrorMetadata(error)
    });
    return error;
  }
  if ("throttlingException" in event && event.throttlingException) {
    const error = new Error(event.throttlingException.message ?? "Nova Sonic throttled");
    error.name = "ThrottlingException";
    logError("audio", "Nova Sonic stream returned throttlingException event", {
      ...toErrorMetadata(error)
    });
    return error;
  }
  if ("internalServerException" in event && event.internalServerException) {
    const error = new Error(event.internalServerException.message ?? "Nova Sonic internal server error");
    error.name = "InternalServerException";
    logError("audio", "Nova Sonic stream returned internalServerException event", {
      ...toErrorMetadata(error)
    });
    return error;
  }
  if ("serviceUnavailableException" in event && event.serviceUnavailableException) {
    const error = new Error(event.serviceUnavailableException.message ?? "Nova Sonic service unavailable");
    error.name = "ServiceUnavailableException";
    logError("audio", "Nova Sonic stream returned serviceUnavailableException event", {
      ...toErrorMetadata(error)
    });
    return error;
  }
  if ("modelTimeoutException" in event && event.modelTimeoutException) {
    const error = new Error(event.modelTimeoutException.message ?? "Nova Sonic stream timeout");
    error.name = "ModelTimeoutException";
    logError("audio", "Nova Sonic stream returned modelTimeoutException event", {
      ...toErrorMetadata(error)
    });
    return error;
  }
  if ("$unknown" in event && Array.isArray(event.$unknown)) {
    const [unknownEventName, unknownEventPayload] = event.$unknown;
    const payloadPreview =
      unknownEventPayload && typeof unknownEventPayload === "object"
        ? (() => {
            try {
              return JSON.stringify(unknownEventPayload);
            } catch {
              return String(unknownEventPayload);
            }
          })()
        : String(unknownEventPayload);
    const error = new Error(`Nova Sonic stream returned unknown event '${unknownEventName}'.`);
    error.name = "UnknownStreamEventException";
    logError("audio", "Nova Sonic stream returned unknown union event", {
      unknownEventName,
      unknownEventPayload: toPreviewText(payloadPreview, HIDDEN_RESPONSE_BODY_PREVIEW_LIMIT),
      ...toErrorMetadata(error)
    });
    return error;
  }
  return null;
};

const invokeNovaSonicBidirectional = async (text: string, modelId: string, voiceId: string): Promise<SpeechSynthesisResult> => {
  const bedrock = getBedrockClient();
  const configuredSampleRate = resolveSonicSampleRate();
  const requestTextPreview = toPreviewText(text);

  logInfo("audio", "Preparing Nova Sonic bidirectional invocation", {
    modelId,
    voiceId,
    configuredSampleRate,
    textLength: text.length,
    textPreview: requestTextPreview
  });

  const invokeOnce = async (): Promise<SpeechSynthesisResult> => {
    const requestEvents = buildSonicRequestEvents(text, voiceId, configuredSampleRate);
    const completionSignal = { done: false };
    const startedAtMs = Date.now();

    try {
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId,
        body: buildSonicRequestBody(requestEvents, completionSignal)
      });

      logInfo("audio", "Sending InvokeModelWithBidirectionalStream command", {
        modelId,
        voiceId,
        configuredSampleRate,
        requestEventCount: requestEvents.length
      });

      const response = (await bedrock.send(command)) as {
        body?: AsyncIterable<InvokeModelWithBidirectionalStreamOutput>;
      };

      logInfo("audio", "InvokeModelWithBidirectionalStream command acknowledged", {
        modelId,
        elapsedMs: Date.now() - startedAtMs,
        hasBody: Boolean(response.body)
      });

      if (!response.body) {
        throw new Error("Nova Sonic bidirectional invocation returned no stream body.");
      }

      return await withTimeout(
        (async () => {
          const pcmChunks: Uint8Array[] = [];
          let outputSampleRate = configuredSampleRate;
          let streamEventCount = 0;
          let chunkEventCount = 0;
          let chunkPayloadParseFailures = 0;
          let audioOutputEventCount = 0;
          const nonAudioEventNames = new Set<string>();

          for await (const streamEvent of response.body ?? []) {
            streamEventCount += 1;
            const unionKey = getBidirectionalStreamUnionKey(streamEvent);
            logInfo("audio", "Received Nova Sonic bidirectional stream union event", {
              modelId,
              streamEventCount,
              unionKey
            });

            const streamError = createBidirectionalEventError(streamEvent);
            if (streamError) {
              throw streamError;
            }

            if (!("chunk" in streamEvent)) {
              continue;
            }

            chunkEventCount += 1;
            const eventBytes = streamEvent.chunk?.bytes;
            if (!eventBytes || eventBytes.length === 0) {
              logWarn("audio", "Nova Sonic chunk event contained no bytes", {
                modelId,
                streamEventCount,
                chunkEventCount
              });
              continue;
            }

            const payload = tryParseJson(eventBytes);
            if (!payload || typeof payload !== "object") {
              chunkPayloadParseFailures += 1;
              logWarn("audio", "Failed to parse Nova Sonic chunk payload as JSON", {
                modelId,
                streamEventCount,
                chunkEventCount,
                bytesLength: eventBytes.length,
                utf8Preview: toUtf8Preview(eventBytes)
              });
              continue;
            }

            const eventName = getSonicPayloadEventName(payload);
            const payloadEvent = asRecord(getByPath(payload, "event"));
            if (eventName === "audioOutput") {
              audioOutputEventCount += 1;
              if (audioOutputEventCount <= 3 || audioOutputEventCount % 25 === 0) {
                logInfo("audio", "Received Nova Sonic audioOutput event", {
                  modelId,
                  audioOutputEventCount,
                  bytesLength: eventBytes.length
                });
              }
            } else {
              nonAudioEventNames.add(eventName);
              const completionStopReason = getByPath(payload, "event.completionEnd.stopReason");
              const usageTotalTokens = getByPath(payload, "event.usageEvent.totalTokens");
              const usageOutputSpeechTokens = getByPath(payload, "event.usageEvent.details.total.output.speechTokens");
              logInfo("audio", "Received Nova Sonic non-audio event", {
                modelId,
                eventName,
                eventKeys: payloadEvent ? Object.keys(payloadEvent) : [],
                completionStopReason,
                usageTotalTokens,
                usageOutputSpeechTokens
              });

              // Signal completion so the request sender can skip remaining silence
              if (eventName === "completionEnd") {
                completionSignal.done = true;
              }
            }

            const base64Audio = getByPath(payload, "event.audioOutput.content");
            if (typeof base64Audio === "string" && base64Audio.length > 0) {
              const decodedAudio = new Uint8Array(Buffer.from(base64Audio, "base64"));
              pcmChunks.push(decodedAudio);
              if (pcmChunks.length <= 3 || pcmChunks.length % 25 === 0) {
                logInfo("audio", "Decoded Nova Sonic audio chunk", {
                  modelId,
                  pcmChunkCount: pcmChunks.length,
                  decodedBytesLength: decodedAudio.length
                });
              }
            } else if (eventName === "audioOutput") {
              logWarn("audio", "audioOutput event missing event.audioOutput.content", {
                modelId,
                eventName,
                eventKeys: payloadEvent ? Object.keys(payloadEvent) : []
              });
            }

            const streamedSampleRate = getByPath(payload, "event.contentStart.audioOutputConfiguration.sampleRateHertz");
            if (typeof streamedSampleRate === "number" && streamedSampleRate > 0 && streamedSampleRate !== outputSampleRate) {
              outputSampleRate = streamedSampleRate;
              logInfo("audio", "Nova Sonic stream updated output sample rate", {
                modelId,
                outputSampleRate
              });
            }
          }

          if (pcmChunks.length === 0) {
            logError("audio", "Nova Sonic stream finished without audio chunks", {
              modelId,
              streamEventCount,
              chunkEventCount,
              chunkPayloadParseFailures,
              audioOutputEventCount,
              nonAudioEventNames: Array.from(nonAudioEventNames)
            });
            throw new Error("Nova Sonic did not return any audio output.");
          }

          const pcmBytes = concatBytes(pcmChunks);
          const wavBytes = encodePcm16LeToWav(pcmBytes, outputSampleRate);
          logInfo("audio", "Nova Sonic bidirectional stream synthesized WAV payload", {
            modelId,
            pcmChunkCount: pcmChunks.length,
            pcmBytesLength: pcmBytes.length,
            wavBytesLength: wavBytes.length,
            outputSampleRate,
            streamEventCount,
            chunkEventCount,
            chunkPayloadParseFailures,
            audioOutputEventCount,
            nonAudioEventNames: Array.from(nonAudioEventNames)
          });

          return {
            audioBytes: wavBytes,
            mimeType: "audio/wav"
          };
        })(),
        appConfig.conversation.bedrockTimeoutMs,
        "ttsBidirectionalRead"
      );
    } catch (rawError) {
      // Nova Sonic occasionally throws plain objects ({message: "..."}) instead
      // of Error instances.  Wrap them so the retry logic can classify them.
      // The server message "Try your request again" indicates these are retryable.
      const error: Error =
        rawError instanceof Error
          ? rawError
          : (() => {
              const msg =
                rawError && typeof rawError === "object" && "message" in rawError
                  ? String((rawError as Record<string, unknown>).message)
                  : String(rawError);
              const wrapped = new Error(msg);
              wrapped.name = "InternalServerException";
              return wrapped;
            })();

      logError("audio", "Nova Sonic bidirectional invocation attempt failed", {
        modelId,
        voiceId,
        configuredSampleRate,
        textLength: text.length,
        textPreview: requestTextPreview,
        requestEventCount: requestEvents.length,
        ...toErrorMetadata(error),
        ...getUnknownThrownErrorMetadata(rawError),
        ...getHiddenResponseMetadata(rawError)
      });

      const hiddenResponseBodyPreviewMetadata = await getHiddenResponseBodyPreviewMetadata(rawError);
      if (Object.keys(hiddenResponseBodyPreviewMetadata).length > 0) {
        logError("audio", "Nova Sonic bidirectional invocation hidden response body preview", {
          modelId,
          voiceId,
          ...hiddenResponseBodyPreviewMetadata
        });
      }

      throw error;
    }
  };

  return withRetry(
    invokeOnce,
    {
      maxAttempts: appConfig.conversation.bedrockRetries + 1,
      baseDelayMs: appConfig.conversation.bedrockRetryBaseDelayMs,
      maxDelayMs: appConfig.conversation.bedrockRetryMaxDelayMs,
      jitterRatio: appConfig.conversation.bedrockRetryJitterRatio,
      onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
        logWarn("audio", "Retrying Nova Sonic bidirectional invocation", {
          modelId,
          voiceId,
          configuredSampleRate,
          attempt,
          maxAttempts,
          delayMs,
          ...toErrorMetadata(error)
        });
      }
    },
    "ttsBidirectionalInvoke"
  );
};

const invokeLegacyAudioPath = async (text: string, modelId: string, voiceId: string): Promise<SpeechSynthesisResult> => {
  const payloads = buildTtsPayloadVariants(text, voiceId);
  logInfo("audio", "Using legacy TTS invocation path", {
    modelId,
    voiceId,
    payloadVariantCount: payloads.length,
    textLength: text.length,
    textPreview: toPreviewText(text)
  });

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    logInfo("audio", "Trying legacy TTS payload variant", {
      modelId,
      payloadVariantIndex: index,
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>) : []
    });

    try {
      const streamResult = await tryStreamInvocation(modelId, payload);
      if (streamResult && streamResult.length > 0) {
        logInfo("audio", "Legacy streaming invocation succeeded", {
          modelId,
          payloadVariantIndex: index,
          bytesLength: streamResult.length
        });
        return {
          audioBytes: streamResult,
          mimeType: appConfig.audio.mimeType
        };
      }
    } catch (error) {
      logWarn("audio", "Streaming audio invocation failed; falling back to standard invocation path", {
        modelId,
        payloadVariantIndex: index,
        ...toErrorMetadata(error)
      });
    }

    try {
      const standardResult = await tryStandardInvocation(modelId, payload);
      if (standardResult && standardResult.length > 0) {
        logInfo("audio", "Legacy standard invocation succeeded", {
          modelId,
          payloadVariantIndex: index,
          bytesLength: standardResult.length
        });
        return {
          audioBytes: standardResult,
          mimeType: appConfig.audio.mimeType
        };
      }
    } catch (error) {
      logWarn("audio", "Standard audio invocation failed; trying next payload variant", {
        modelId,
        payloadVariantIndex: index,
        ...toErrorMetadata(error)
      });
    }
  }

  const synthesisError = new Error("Bedrock audio synthesis failed for all payload variants.");
  logError("audio", "All audio synthesis paths failed", {
    modelId
  });
  throw synthesisError;
};

export const synthesizeSpeechAudio = async (text: string, speaker: Speaker): Promise<SpeechSynthesisResult> => {
  const modelId = resolveBedrockModelId({
    configuredModelId: appConfig.models.ttsOrSonic,
    explicitInferenceProfileId: appConfig.models.ttsOrSonicInferenceProfile,
    region: process.env.AWS_REGION,
    scope: "audio"
  });

  if (!modelId) {
    throw new Error(
      "BEDROCK_MODEL_ID_TTS_OR_SONIC or BEDROCK_INFERENCE_PROFILE_ID_TTS_OR_SONIC is required for audio synthesis."
    );
  }

  logInfo("audio", "Starting speech synthesis", {
    speaker,
    region: process.env.AWS_REGION ?? "",
    configuredModelId: appConfig.models.ttsOrSonic,
    explicitInferenceProfileId: appConfig.models.ttsOrSonicInferenceProfile,
    resolvedModelId: modelId,
    isSonicModel: isSonicModelId(modelId),
    textLength: text.length,
    textPreview: toPreviewText(text)
  });

  if (isSonicModelId(modelId)) {
    const voiceId = resolveSonicVoiceId(speaker);
    logInfo("audio", "Routing synthesis to Nova Sonic bidirectional streaming path", {
      speaker,
      modelId,
      voiceId
    });
    return invokeNovaSonicBidirectional(text, modelId, voiceId);
  }

  const voiceId = speaker === "A" ? appConfig.voices.agentA : appConfig.voices.agentB;
  logInfo("audio", "Routing synthesis to legacy TTS path", {
    speaker,
    modelId,
    voiceId
  });
  return invokeLegacyAudioPath(text, modelId, voiceId);
};

