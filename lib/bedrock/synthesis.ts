import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBedrockClient } from "../bedrock-client";
import { resolveBedrockModelId } from "./model-id";
import { appConfig } from "../config";
import { buildSynthesisPrompt } from "../prompts";
import { logError, logInfo } from "../telemetry";
import type { ModeSuggestion, SessionTurn } from "../types";

export async function* generateSynthesis(
  topic: string,
  mode: ModeSuggestion,
  turns: SessionTurn[]
): AsyncGenerator<string> {
  const modelId = resolveBedrockModelId({
    configuredModelId: appConfig.models.dialog,
    explicitInferenceProfileId: appConfig.models.dialogInferenceProfile,
    region: process.env.AWS_REGION,
    scope: "synthesis"
  });

  if (!modelId) {
    logInfo("synthesis", "No model configured; skipping synthesis");
    yield "Synthesis unavailable: no model configured.";
    return;
  }

  const bedrock = getBedrockClient();
  const { systemPrompt, userPrompt } = buildSynthesisPrompt(topic, mode, turns);

  try {
    const command = new ConverseStreamCommand({
      modelId,
      system: [{ text: systemPrompt }],
      messages: [{ role: "user", content: [{ text: userPrompt }] }],
      inferenceConfig: {
        temperature: 0.3,
        maxTokens: 600
      }
    });

    const response = await bedrock.send(command);

    for await (const event of response.stream ?? []) {
      const delta = event.contentBlockDelta?.delta?.text;
      if (typeof delta === "string" && delta.length > 0) {
        yield delta;
      }
    }

    logInfo("synthesis", "Synthesis stream completed");
  } catch (error) {
    logError("synthesis", "Synthesis streaming failed", { error: String(error) });
    yield "\n[Synthesis could not be generated.]";
  }
}
