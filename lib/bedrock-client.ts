import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

declare global {
  var __POCKET_PANEL_BEDROCK_CLIENT__: BedrockRuntimeClient | undefined;
}

export const getBedrockClient = (): BedrockRuntimeClient => {
  if (!globalThis.__POCKET_PANEL_BEDROCK_CLIENT__) {
    globalThis.__POCKET_PANEL_BEDROCK_CLIENT__ = new BedrockRuntimeClient({
      region: process.env.AWS_REGION
    });
  }
  return globalThis.__POCKET_PANEL_BEDROCK_CLIENT__;
};
