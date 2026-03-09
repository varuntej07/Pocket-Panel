import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBedrockClient } from "../bedrock-client";
import { resolveBedrockModelId } from "./model-id";
import { appConfig } from "../config";
import { buildDialogSystemPrompt, buildDialogUserPrompt } from "../prompts";
import { withRetry, withTimeout } from "../retry";
import { logError, logInfo, toErrorMetadata } from "../telemetry";
import type { ModeSuggestion, SessionTurn, Speaker } from "../types";
import { searchWeb, type BraveResult } from "../brave-search";

interface GenerateDialogTurnParams {
  topic: string;
  mode: ModeSuggestion;
  speaker: Speaker;
  turnIndex: number;
  totalTurns: number;
  history: SessionTurn[];
  agentPosition?: string;
}

type ToolEventCallback = (
  event: { phase: "use"; query: string } | { phase: "result"; sources: BraveResult[] }
) => void;

const fallbackUtterance = (params: GenerateDialogTurnParams): string => {
  const { speaker, topic, mode, turnIndex } = params;
  const prefix = speaker === "A" ? "Agent A view" : "Agent B response";
  return `${prefix} on ${topic}: this ${mode.category} turn ${turnIndex} keeps the argument focused, concrete, and easy to follow by audio.`;
};

const retryOptions = {
  maxAttempts: appConfig.conversation.bedrockRetries + 1,
  baseDelayMs: appConfig.conversation.bedrockRetryBaseDelayMs,
  maxDelayMs: appConfig.conversation.bedrockRetryMaxDelayMs,
  jitterRatio: appConfig.conversation.bedrockRetryJitterRatio
};

type ConverseResponse = {
  stopReason?: string;
  output?: {
    message?: {
      content?: Array<Record<string, unknown>>;
    };
  };
};

const extractText = (contentBlocks: Array<Record<string, unknown>>): string =>
  contentBlocks
    .map((block) => {
      if (typeof block !== "object" || block === null) return "";
      const maybeText = (block as { text?: string }).text;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const searchWebToolConfig = {
  tools: [
    {
      toolSpec: {
        name: "search_web",
        description:
          "Search the web for current facts, statistics, or recent events to support your argument.",
        inputSchema: {
          json: {
            type: "object",
            properties: {
              query: { type: "string", description: "Concise search query (under 10 words)" }
            },
            required: ["query"]
          } as never
        }
      }
    }
  ],
  toolChoice: { auto: {} }
};

export const generateDialogTurn = async (
  params: GenerateDialogTurnParams,
  onToolEvent?: ToolEventCallback
): Promise<string> => {
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

  const systemPrompt = buildDialogSystemPrompt(
    params.mode,
    appConfig.conversation.maxSecondsPerTurn,
    params.speaker,
    params.agentPosition
  );

  try {
    const firstCommand = new ConverseCommand({
      modelId,
      system: [{ text: systemPrompt }],
      messages: [{ role: "user", content: [{ text: userPrompt }] }],
      toolConfig: searchWebToolConfig,
      inferenceConfig: {
        temperature: 0.7,
        maxTokens: 400
      }
    });

    const firstResponse = (await withRetry(
      () => withTimeout(bedrock.send(firstCommand), appConfig.conversation.bedrockTimeoutMs, "generateDialogTurn#1"),
      retryOptions,
      "generateDialogTurn#1"
    )) as ConverseResponse;

    const firstContentBlocks = firstResponse.output?.message?.content ?? [];

    // Check if Nova chose to use the search_web tool
    const toolUseBlock = firstContentBlocks.find(
      (block: Record<string, unknown>) =>
        typeof block === "object" &&
        block !== null &&
        "toolUse" in block &&
        typeof (block as { toolUse?: { name?: string } }).toolUse?.name === "string" &&
        (block as { toolUse?: { name?: string } }).toolUse?.name === "search_web"
    ) as
      | { toolUse?: { toolUseId?: string; name?: string; input?: { query?: string } } }
      | undefined;

    if (firstResponse.stopReason === "tool_use" && toolUseBlock?.toolUse) {
      const toolUseId = toolUseBlock.toolUse.toolUseId ?? "search-tool";
      const query = toolUseBlock.toolUse.input?.query ?? params.topic;

      logInfo("dialog", "search_web tool invoked", { query, speaker: params.speaker, turnIndex: params.turnIndex });
      onToolEvent?.({ phase: "use", query });

      const sources = await searchWeb(query);
      onToolEvent?.({ phase: "result", sources });

      const searchResultsText =
        sources.length > 0
          ? sources
              .map((s, i) => `${i + 1}. ${s.title}\n   URL: ${s.url}\n   ${s.snippet}`)
              .join("\n\n")
          : "No search results found.";

      const secondCommand = new ConverseCommand({
        modelId,
        system: [{ text: systemPrompt }],
        messages: [
          { role: "user", content: [{ text: userPrompt }] },
          {
            role: "assistant",
            content: firstContentBlocks as never
          },
          {
            role: "user",
            content: [
              {
                toolResult: {
                  toolUseId,
                  content: [{ text: searchResultsText }]
                }
              } as never
            ]
          }
        ],
        inferenceConfig: {
          temperature: 0.7,
          maxTokens: 400
        }
      });

      const secondResponse = (await withRetry(
        () => withTimeout(bedrock.send(secondCommand), appConfig.conversation.bedrockTimeoutMs, "generateDialogTurn#2"),
        retryOptions,
        "generateDialogTurn#2"
      )) as ConverseResponse;

      const secondContentBlocks = secondResponse.output?.message?.content ?? [];
      const text = extractText(secondContentBlocks);
      return text || fallbackUtterance(params);
    }

    // No tool call — extract text directly from first response
    const text = extractText(firstContentBlocks);
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
