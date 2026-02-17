import { logInfo } from "../telemetry";

interface ResolveBedrockModelIdParams {
  configuredModelId: string;
  explicitInferenceProfileId?: string;
  region?: string;
  scope: string;
}

declare global {
  var __POCKET_PANEL_MODEL_ID_LOGGED_KEYS__: Set<string> | undefined;
}

const loggedConversionKeys = globalThis.__POCKET_PANEL_MODEL_ID_LOGGED_KEYS__ ?? new Set<string>();
globalThis.__POCKET_PANEL_MODEL_ID_LOGGED_KEYS__ = loggedConversionKeys;

const GEOGRAPHY_PREFIXES = [
  "global.",
  "us.",
  "eu.",
  "apac.",
  "jp.",
  "in.",
  "ca.",
  "sa.",
  "me.",
  "af."
];

const normalize = (value: string | undefined): string => value?.trim() ?? "";

const hasInferenceProfilePrefix = (modelId: string): boolean =>
  GEOGRAPHY_PREFIXES.some((prefix) => modelId.startsWith(prefix));

const stripGeographyPrefix = (modelId: string): string | null => {
  const prefix = GEOGRAPHY_PREFIXES.find((candidatePrefix) => modelId.startsWith(candidatePrefix));
  if (!prefix) {
    return null;
  }
  return modelId.slice(prefix.length);
};

const isSonicModelId = (modelId: string): boolean =>
  modelId.startsWith("amazon.nova-sonic-") || modelId.startsWith("amazon.nova-2-sonic-");

const normalizeSonicModelId = (
  modelId: string,
  scope: string,
  region: string,
  source: "configuredModelId" | "explicitInferenceProfileId"
): string => {
  const strippedModelId = stripGeographyPrefix(modelId);
  if (!strippedModelId || !isSonicModelId(strippedModelId)) {
    return modelId;
  }

  const cacheKey = `sonic-prefix|${scope}|${region}|${source}|${modelId}|${strippedModelId}`;
  if (!loggedConversionKeys.has(cacheKey)) {
    loggedConversionKeys.add(cacheKey);
    logInfo("bedrock/model-id", "Normalized Sonic model ID by removing geographic prefix", {
      scope,
      region,
      source,
      configuredModelId: modelId,
      resolvedModelId: strippedModelId
    });
  }

  return strippedModelId;
};

export const resolveBedrockModelId = ({
  configuredModelId,
  explicitInferenceProfileId,
  region,
  scope
}: ResolveBedrockModelIdParams): string => {
  const normalizedRegion = normalize(region);
  const explicitProfileId = normalize(explicitInferenceProfileId);
  if (explicitProfileId) {
    return normalizeSonicModelId(explicitProfileId, scope, normalizedRegion, "explicitInferenceProfileId");
  }

  const modelId = normalizeSonicModelId(normalize(configuredModelId), scope, normalizedRegion, "configuredModelId");
  if (!modelId) {
    return "";
  }
  if (modelId.startsWith("arn:") || modelId.includes(":inference-profile/") || hasInferenceProfilePrefix(modelId)) {
    return modelId;
  }

  // Nova base IDs such as amazon.nova-lite-v1:0 require inference-profile IDs in many regions.
  if (modelId.startsWith("amazon.nova") && !isSonicModelId(modelId) && normalizedRegion.startsWith("us-")) {
    const resolvedModelId = `us.${modelId}`;
    const cacheKey = `${scope}|${normalizedRegion}|${modelId}|${resolvedModelId}`;

    if (!loggedConversionKeys.has(cacheKey)) {
      loggedConversionKeys.add(cacheKey);
      logInfo("bedrock/model-id", "Auto-converted Nova model ID to US inference profile ID", {
        scope,
        region: normalizedRegion,
        configuredModelId: modelId,
        resolvedModelId
      });
    }

    return resolvedModelId;
  }

  return modelId;
};
