import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBedrockClient } from "../bedrock-client";
import { resolveBedrockModelId } from "./model-id";
import { appConfig } from "../config";
import { buildDialogSystemPrompt, buildDialogUserPrompt } from "../prompts";
import { withRetry, withTimeout } from "../retry";
import { logError, logInfo, toErrorMetadata } from "../telemetry";
import type { ModeSuggestion, SessionTurn, Speaker } from "../types";

interface GenerateDialogTurnParams {
  topic: string;
  mode: ModeSuggestion;
  speaker: Speaker;
  turnIndex: number;
  totalTurns: number;
  history: SessionTurn[];
  agentPosition?: string;
}

const fallbackUtterance = (params: GenerateDialogTurnParams): string => {
  const { speaker, topic, mode, turnIndex } = params;
  const prefix = speaker === "A" ? "Agent A view" : "Agent B response";
  return `${prefix} on ${topic}: this ${mode.category} turn ${turnIndex} keeps the argument focused, concrete, and easy to follow by audio.`;
};

export const generateDialogTurn = async (params: GenerateDialogTurnParams): Promise<string> => {
  const modelId = resolveBedrockModelId({
    configuredModelId: appConfig.models.dialog,
    explicitInferenceProfileId: appConfig.models.dialogInferenceProfile,
    region: process.env.AWS_REGION,
    scope: "dialog"
  });

  if (!modelId) {
    logInfo("dialog", "BEDROCK_MODEL_ID_DIALOG/BEDROCK_INFERENCE_PROFILE_ID_DIALOG missing, using fallback utterance");
    return fallbackUtterance(params);
  }

  const bedrock = getBedrockClient();
  const userPrompt = buildDialogUserPrompt({
    topic: params.topic,
    mode: params.mode,
    speaker: params.speaker,
    turnIndex: params.turnIndex,
    totalTurns: params.totalTurns,
    history: params.history
  });

  try {
    const command = new ConverseCommand({
      modelId,
      system: [
        {
          text: buildDialogSystemPrompt(
            params.mode,
            appConfig.conversation.maxSecondsPerTurn,
            params.speaker,
            params.agentPosition
          )
        }
      ],
      messages: [
        {
          role: "user",
          content: [{ text: userPrompt }]
        }
      ],
      inferenceConfig: {
        temperature: 0.7,
        maxTokens: 400
      }
    });

    const response = (await withRetry(
      () => withTimeout(bedrock.send(command), appConfig.conversation.bedrockTimeoutMs, "generateDialogTurn"),
      {
        maxAttempts: appConfig.conversation.bedrockRetries + 1,
        baseDelayMs: appConfig.conversation.bedrockRetryBaseDelayMs,
        maxDelayMs: appConfig.conversation.bedrockRetryMaxDelayMs,
        jitterRatio: appConfig.conversation.bedrockRetryJitterRatio
      },
      "generateDialogTurn"
    )) as {
      output?: {
        message?: {
          content?: Array<Record<string, unknown>>;
        };
      };
    };

    const text = (response.output?.message?.content ?? [])
      .map((block: Record<string, unknown>) => {
        if (typeof block !== "object" || block === null) {
          return "";
        }
        const maybeText = (block as { text?: string }).text;
        return typeof maybeText === "string" ? maybeText : "";
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return fallbackUtterance(params);
    }
    return text;
  } catch (error) {
    logError("dialog", "Bedrock dialog generation failed; using fallback utterance", {
      modelId,
      ...toErrorMetadata(error),
      turnIndex: params.turnIndex
    });
    return fallbackUtterance(params);
  }
};
