import { getAllModes } from "./modes";
import type { ConversationIntent, ModeSuggestion } from "./types";

export const rankModeSuggestions = (
  intent: ConversationIntent,
  suggestedModeIds: string[]
): ModeSuggestion[] => {
  if (intent === "none") {
    return [];
  }

  const allModes = getAllModes();
  const byId = new Map(allModes.map((mode) => [mode.id, mode]));
  const suggested = suggestedModeIds
    .map((id) => byId.get(id))
    .filter((mode): mode is ModeSuggestion => Boolean(mode));

  const suggestedSet = new Set(suggested.map((mode) => mode.id));
  const intentMatches = allModes.filter((mode) => mode.category === intent && !suggestedSet.has(mode.id));
  const others = allModes.filter((mode) => mode.category !== intent && !suggestedSet.has(mode.id));

  return [...suggested, ...intentMatches, ...others].map((mode) => ({
    ...mode,
    recommended: suggestedSet.has(mode.id)
  }));
};
