import type { ModeSuggestion, SessionTurn, Speaker } from "./types";

export const buildSynthesisPrompt = (
  topic: string,
  mode: ModeSuggestion,
  turns: SessionTurn[]
): { systemPrompt: string; userPrompt: string } => {
  const transcript = turns
    .map((turn) =>
      turn.speaker === "moderator" ? `[MODERATOR]: ${turn.text}` : `Agent ${turn.speaker}: ${turn.text}`
    )
    .join("\n\n");

  const systemPrompt = [
    "You are an expert debate analyst. After reviewing a debate transcript, produce a structured post-debate synthesis.",
    "Be objective, precise, and insightful. Use plain text only — no markdown headers or bullet points.",
    "Structure your response with these clearly labeled sections:",
    "AGENT A POSITION: | AGENT B POSITION: | STRONGEST ARGUMENT (A): | STRONGEST ARGUMENT (B): | LOGICAL VERDICT: | FOLLOW-UP QUESTIONS:"
  ].join(" ");

  const userPrompt = [
    `Topic: "${topic}"`,
    `Format: ${mode.title} (${mode.category})`,
    "",
    "Transcript:",
    transcript,
    "",
    "Provide a structured post-debate synthesis: each side's core position, their strongest argument, which side made the stronger logical case and why, and 2 concrete follow-up questions worth exploring."
  ].join("\n");

  return { systemPrompt, userPrompt };
};

const moderatorSpec = [
  "You are a strict moderator controlling a two-agent voice conversation.",
  "Enforce turn-taking with zero overlap and no interruptions.",
  "Keep each turn concise and spoken-language friendly.",
  "No bullet points or markdown; output plain natural speech only.",
  "No unsafe content, hate, harassment, or instructions for wrongdoing."
].join(" ");

export const buildClassifierSystemPrompt = (): string =>
  [
    "You classify user prompts into one intent category.",
    "Allowed intents: debate, argument, teaching, podcast, none.",
    "Use the classify_intent tool exactly once.",
    "If the prompt does not fit those categories, return intent=none and an empty suggestedModes array.",
    "When it fits, provide up to 10 relevant mode IDs from the provided catalog."
  ].join(" ");

export const buildClassifierUserPrompt = (prompt: string, modeCatalog: ModeSuggestion[]): string => {
  const catalogText = modeCatalog
    .map((mode) => `${mode.id} [${mode.category}] - ${mode.title}: ${mode.description}`)
    .join("\n");

  return `User prompt:\n${prompt}\n\nMode catalog:\n${catalogText}\n\nCall classify_intent with your result.`;
};

const formatRulesByCategory: Record<ModeSuggestion["category"], string> = {
  debate:
    "Debate format: claims, counterclaims, evidence, short crisp turns, clear challenges each turn.",
  teaching:
    "Teaching format: Socratic style, step-by-step instruction, concept checks, concrete examples.",
  podcast:
    "Podcast format: host and guest vibe, richer turns, conversational pacing, recap near ending.",
  argument:
    "Argument format: adversarial but safe and respectful, sharp disagreement, no abusive language."
};

export const buildSceneSetup = (prompt: string, mode: ModeSuggestion): string =>
  `Scene setup: two expert voices face each other on "${prompt}". The format is ${mode.title}, so the exchange stays focused, vivid, and easy to follow by ear.`;

export const buildDialogSystemPrompt = (
  mode: ModeSuggestion,
  maxSecondsPerTurn: number,
  targetSpeaker: Speaker,
  assignedPosition?: string
): string => {
  const approximateWords = Math.max(35, Math.round(maxSecondsPerTurn * 2.4));
  const speakerInstruction =
    targetSpeaker === "A"
      ? "You are Agent A. You lead with clear framing and sharp structure."
      : "You are Agent B. You respond directly and pressure-test assumptions.";
  const positionInstruction = assignedPosition
    ? `Your assigned position: ${assignedPosition} Hold it firmly throughout.`
    : "";

  return [
    moderatorSpec,
    speakerInstruction,
    positionInstruction,
    formatRulesByCategory[mode.category],
    `Mode guidance: ${mode.formatGuidance}`,
    `Target length: around ${approximateWords} words so it sounds like about ${maxSecondsPerTurn} seconds.`
  ]
    .filter(Boolean)
    .join(" ");
};

export const buildDialogUserPrompt = (params: {
  topic: string;
  mode: ModeSuggestion;
  speaker: Speaker;
  turnIndex: number;
  totalTurns: number;
  history: SessionTurn[];
}): string => {
  const { topic, mode, speaker, turnIndex, totalTurns, history } = params;
  const shortHistory = history
    .slice(-6)
    .map((turn) => (turn.speaker === "moderator" ? `[MODERATOR]: ${turn.text}` : `${turn.speaker}: ${turn.text}`))
    .join("\n");

  return [
    `Topic: ${topic}`,
    `Mode: ${mode.title} (${mode.category})`,
    `Current turn: ${turnIndex}/${totalTurns}`,
    `Current speaker: Agent ${speaker}`,
    shortHistory ? `Recent context:\n${shortHistory}` : "Recent context: none yet",
    "Deliver one natural spoken turn only. Do not include stage directions."
  ].join("\n\n");
};
