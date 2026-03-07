import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBedrockClient } from "../bedrock-client";
import { resolveBedrockModelId } from "./model-id";
import { appConfig } from "../config";
import { withRetry, withTimeout } from "../retry";
import { logError, logInfo } from "../telemetry";
import type { ModeSuggestion } from "../types";

export interface AgentPositions {
  positionA: string;
  positionB: string;
}

export const generatePositions = async (topic: string, mode: ModeSuggestion): Promise<AgentPositions> => {
  const defaultPositions: AgentPositions = {
    positionA: `Agent A argues strongly in favor of the primary position on "${topic}".`,
    positionB: `Agent B argues strongly against it with a sharp opposing stance.`
  };

  const modelId = resolveBedrockModelId({
    configuredModelId: appConfig.models.dialog,
    explicitInferenceProfileId: appConfig.models.dialogInferenceProfile,
    region: process.env.AWS_REGION,
    scope: "positions"
  });

  if (!modelId) {
    logInfo("positions", "No model configured; using default positions");
    return defaultPositions;
  }

  const bedrock = getBedrockClient();

  try {
    const command = new ConverseCommand({
      modelId,
      system: [{ text: "You assign debate positions for a two-agent voice conversation. Be specific and concrete." }],
      messages: [
        {
          role: "user",
          content: [
            {
              text: `Topic: "${topic}"\nFormat: ${mode.title} (${mode.category})\n\nAssign Agent A a specific defensible position and Agent B the directly opposing position. Output exactly two sentences, the first starting with "Agent A argues that" and the second starting with "Agent B argues that". Nothing else.`
            }
          ]
        }
      ],
      inferenceConfig: {
        temperature: 0.1,
        maxTokens: 120
      }
    });

    const response = (await withRetry(
      () => withTimeout(bedrock.send(command), appConfig.conversation.bedrockTimeoutMs, "generatePositions"),
      {
        maxAttempts: appConfig.conversation.bedrockRetries + 1,
        baseDelayMs: appConfig.conversation.bedrockRetryBaseDelayMs,
        maxDelayMs: appConfig.conversation.bedrockRetryMaxDelayMs,
        jitterRatio: appConfig.conversation.bedrockRetryJitterRatio
      },
      "generatePositions"
    )) as { output?: { message?: { content?: Array<Record<string, unknown>> } } };

    const rawText = (response.output?.message?.content ?? [])
      .map((block: Record<string, unknown>) => (block as { text?: string }).text ?? "")
      .join(" ")
      .trim();

    logInfo("positions", "Generated agent positions", { rawText });

    const lines = rawText
      .split(/\n/)
      .map((l: string) => l.trim())
      .filter(Boolean);

    if (lines.length >= 2) {
      return { positionA: lines[0], positionB: lines[1] };
    }

    const aMatch = rawText.match(/Agent A[^.!?]*[.!?]/i);
    const bMatch = rawText.match(/Agent B[^.!?]*[.!?]/i);
    if (aMatch && bMatch) {
      return { positionA: aMatch[0], positionB: bMatch[0] };
    }

    return defaultPositions;
  } catch (error) {
    logError("positions", "Failed to generate positions; using defaults", { error: String(error) });
    return defaultPositions;
  }
};
