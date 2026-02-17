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
const SONIC_KNOWN_VOICE_IDS = new Set(["matthew", "tiffany", "amy"]);
const SONIC_ALLOWED_SAMPLE_RATES = new Set([8000, 16000, 24000]);
const SONIC_DEFAULT_SAMPLE_RATE = 24000;
const SONIC_SYSTEM_INSTRUCTION =
  "You are a speech synthesis assistant. Repeat the USER content exactly and only as natural spoken audio. Do not add, remove, or paraphrase any words.";
const LOG_TEXT_PREVIEW_LIMIT = 160;
const LOG_EVENT_BYTES_PREVIEW_LIMIT = 120;

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
  }
  if (eventName === "textInput") {
    const content = typeof eventPayload?.content === "string" ? eventPayload.content : "";
    details.promptName = eventPayload?.promptName;
    details.contentName = eventPayload?.contentName;
    details.textLength = content.length;
    details.textPreview = toPreviewText(content);
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

type ErrorWithHiddenResponse = Error & {
  $response?: {
    statusCode?: number;
    headers?: unknown;
    body?: unknown;
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
          turnDetectionConfiguration: {
            maxSilenceDurationMs: number;
            threshold: number;
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
          toolUseOutputConfiguration: {
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
        textInput: {
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

const buildSonicRequestEvents = (text: string, voiceId: string, sampleRateHertz: number): SonicRequestEvent[] => {
  const promptName = `prompt-${randomUUID()}`;
  const contentName = `text-${randomUUID()}`;

  const events: SonicRequestEvent[] = [
    {
      event: {
        sessionStart: {
          inferenceConfiguration: {
            maxTokens: 1024,
            topP: 0.9,
            temperature: 0.7
          },
          // Match Nova Sonic bidirectional contract for endpointing configuration.
          turnDetectionConfiguration: {
            maxSilenceDurationMs: 2000,
            threshold: 0.9
          }
        }
      }
    },
    {
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
    },
    {
      event: {
        contentStart: {
          promptName,
          contentName,
          type: "TEXT",
          textInputConfiguration: {
            mediaType: "text/plain"
          },
          interactive: true,
          role: "SYSTEM"
        }
      }
    },
    {
      event: {
        textInput: {
          promptName,
          contentName,
          content: text
        }
      }
    },
    {
      event: {
        contentEnd: {
          promptName,
          contentName
        }
      }
    },
    {
      event: {
        promptEnd: {
          promptName
        }
      }
    },
    {
      event: {
        sessionEnd: {}
      }
    }
  ];

  logInfo("audio", "Built Nova Sonic bidirectional request events", {
    eventCount: events.length,
    eventDescriptors: events.map((event) => describeSonicRequestEvent(event))
  });

  return events;
};

const buildSonicRequestBody = async function* (
  events: SonicRequestEvent[]
): AsyncIterable<{
  chunk: {
    bytes: Uint8Array;
  };
}> {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const encoded = textEncoder.encode(JSON.stringify(event));
    logInfo("audio", "Sending Nova Sonic bidirectional request event", {
      index,
      bytesLength: encoded.length,
      ...describeSonicRequestEvent(event)
    });

    yield {
      chunk: {
        bytes: encoded
      }
    };
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
    const startedAtMs = Date.now();

    try {
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId,
        body: buildSonicRequestBody(requestEvents)
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

      return withTimeout(
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
              logInfo("audio", "Received Nova Sonic non-audio event", {
                modelId,
                eventName,
                eventKeys: payloadEvent ? Object.keys(payloadEvent) : []
              });
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
    } catch (error) {
      logError("audio", "Nova Sonic bidirectional invocation attempt failed", {
        modelId,
        voiceId,
        configuredSampleRate,
        textLength: text.length,
        textPreview: requestTextPreview,
        requestEventCount: requestEvents.length,
        ...toErrorMetadata(error),
        ...getHiddenResponseMetadata(error)
      });
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
