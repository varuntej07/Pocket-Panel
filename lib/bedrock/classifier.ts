import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBedrockClient } from "../bedrock-client";
import { resolveBedrockModelId } from "./model-id";
import { appConfig } from "../config";
import { getAllModes, getModesByCategory } from "../modes";
import { buildClassifierSystemPrompt, buildClassifierUserPrompt } from "../prompts";
import { withRetry, withTimeout } from "../retry";
import {
  ClassifyIntentOutputSchema,
  classifyIntentToolJsonSchema,
  classifyIntentToolName
} from "../tool-schemas";
import { logError, logInfo, toErrorMetadata } from "../telemetry";
import type { ConversationIntent, IntentClassification } from "../types";

const heuristicClassifyIntent = (prompt: string): IntentClassification => {
  const lower = prompt.toLowerCase();

  let intent: ConversationIntent = "none";
  if (/\b(debate|pros and cons|counterpoint|versus|vs)\b/.test(lower)) {
    intent = "debate";
  } else if (/\b(argument|argue|conflict|disagree|adversarial)\b/.test(lower)) {
    intent = "argument";
  } else if (/\b(teach|lesson|explain|learn|tutorial)\b/.test(lower)) {
    intent = "teaching";
  } else if (/\b(podcast|episode|host|guest|interview)\b/.test(lower)) {
    intent = "podcast";
  }

  const suggestedModes =
    intent === "none" ? [] : getModesByCategory(intent).slice(0, 8).map((mode) => mode.id);
  return { intent, suggestedModes };
};

export const classifyIntentWithTools = async (prompt: string): Promise<IntentClassification> => {
  const modelId = resolveBedrockModelId({
    configuredModelId: appConfig.models.intent,
    explicitInferenceProfileId: appConfig.models.intentInferenceProfile,
    region: process.env.AWS_REGION,
    scope: "intent-classifier"
  });

  if (!modelId) {
    logInfo(
      "classifier",
      "BEDROCK_MODEL_ID_INTENT/BEDROCK_INFERENCE_PROFILE_ID_INTENT missing, using heuristic classification"
    );
    return heuristicClassifyIntent(prompt);
  }

  const bedrock = getBedrockClient();
  const modeCatalog = getAllModes();

  try {
    const command = new ConverseCommand({
      modelId,
      system: [{ text: buildClassifierSystemPrompt() }],
      messages: [
        {
          role: "user",
          content: [{ text: buildClassifierUserPrompt(prompt, modeCatalog) }]
        }
      ],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: classifyIntentToolName,
              description: "Classify intent and return suggested mode IDs.",
              inputSchema: {
                json: classifyIntentToolJsonSchema as never
              }
            }
          }
        ],
        toolChoice: {
          tool: {
            name: classifyIntentToolName
          }
        }
      },
      inferenceConfig: {
        temperature: 0.1,
        maxTokens: 256
      }
    });

    const response = (await withRetry(
      () => withTimeout(bedrock.send(command), appConfig.conversation.bedrockTimeoutMs, "classifyIntent"),
      {
        maxAttempts: appConfig.conversation.bedrockRetries + 1,
        baseDelayMs: appConfig.conversation.bedrockRetryBaseDelayMs,
        maxDelayMs: appConfig.conversation.bedrockRetryMaxDelayMs,
        jitterRatio: appConfig.conversation.bedrockRetryJitterRatio
      },
      "classifyIntent"
    )) as {
      output?: {
        message?: {
          content?: Array<Record<string, unknown>>;
        };
      };
      usage?: { inputTokens?: number; outputTokens?: number };
    };

    logInfo("classifier", "Bedrock classify token usage", {
      modelId,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0
    });

    const contentBlocks = response.output?.message?.content ?? [];
    const toolUseBlock = contentBlocks.find(
      (block: Record<string, unknown>) =>
        typeof block === "object" &&
        block !== null &&
        "toolUse" in block &&
        typeof (block as { toolUse?: { name?: string } }).toolUse?.name === "string" &&
        (block as { toolUse?: { name?: string } }).toolUse?.name === classifyIntentToolName
    ) as
      | {
          toolUse?: {
            input?: unknown;
          };
        }
      | undefined;

    const input = toolUseBlock?.toolUse?.input;
    const parsed = ClassifyIntentOutputSchema.parse(input);
    const validModeIds = new Set(modeCatalog.map((mode) => mode.id));
    const suggestedModes = parsed.suggestedModes.filter((id: string) => validModeIds.has(id));

    return {
      intent: parsed.intent,
      suggestedModes
    };
  } catch (error) {
    logError("classifier", "Bedrock tool classification failed; falling back to heuristic", {
      modelId,
      ...toErrorMetadata(error)
    });
    return heuristicClassifyIntent(prompt);
  }
};
