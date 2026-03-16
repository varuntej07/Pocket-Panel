import type { ModeSuggestion, SessionTurn, Speaker } from "./types";

// ---------------------------------------------------------------------------
// Nova Sonic Agent Mode prompts
// ---------------------------------------------------------------------------

export const buildSonicAgentSystemPrompt = (params: {
  speaker: Speaker;
  mode: ModeSuggestion;
  assignedPosition: string;
}): string => {
  const { speaker, mode, assignedPosition } = params;

  const speakerInstruction =
    speaker === "A"
      ? "You open the exchange. Make a sharp, confident claim and own it. No introduction — start with your point."
      : "You respond to what was just said. Disagree directly, push back with conviction. React like you genuinely heard it and want to challenge it. No preamble.";

  const positionInstruction = assignedPosition
    ? `Your assigned position: ${assignedPosition}. Hold it firmly throughout.`
    : "";

  return [
    moderatorSpec,
    speakerInstruction,
    positionInstruction,
    formatRulesByCategory[mode.category],
    `Mode guidance: ${mode.formatGuidance}`,
    "Target length: 3 to 5 sentences. Always finish every sentence you start.",
    "Use contractions, vary your pace, show conviction. React to what you hear.",
    "Avoid 'First', 'Second', 'Finally', 'In conclusion', and other essay transitions. Speak like you're in a heated room, not writing an op-ed.",
    "CRITICAL: Never announce or restate the topic. Do not say 'Today's topic is', 'We're here to discuss', 'The topic today is', or any variation. Launch directly into your argument."
  ]
    .filter(Boolean)
    .join(" ");
};

export const buildSonicAgentUserPrompt = (params: {
  topic: string;
  speaker: Speaker;
  turnIndex: number;
  totalTurns: number;
  opponentText: string | null;
  history: SessionTurn[];
  injectedContext?: string;
}): string => {
  const { topic, speaker, turnIndex, totalTurns, opponentText, history, injectedContext } = params;

  const shortHistory = history
    .slice(-6)
    .map((turn) => {
      if (turn.speaker === "moderator") return `[moderator]: ${turn.text}`;
      return turn.speaker === speaker ? `[you]: ${turn.text}` : `[them]: ${turn.text}`;
    })
    .join("\n");

  const parts: string[] = [`Topic: ${topic}`, `Turn: ${turnIndex} of ${totalTurns}`];

  if (shortHistory) {
    parts.push(`Conversation so far:\n${shortHistory}`);
  }

  if (turnIndex === 1) {
    parts.push("You go first. Make your opening argument.");
  } else if (opponentText) {
    parts.push(`[them]: ${opponentText}\n\nRespond to what they just said. Speak your turn now.`);
  }

  if (injectedContext) {
    parts.push(`A moderator interjected: ${injectedContext}. Address this in your response.`);
  }

  parts.push("Speak your turn now. Do not introduce yourself or announce your side. Start directly with your argument.");

  return parts.join("\n\n");
};

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
    "You are an expert podcaster. After reviewing a debate transcript, produce a structured post-debate synthesis.",
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
  "You are participating in a live two-person voice conversation.",
  "Speak in full, complete sentences — never cut a thought short.",
  "No bullet points or markdown; output plain natural speech only.",
  "Use contractions, natural rhythm, and vary sentence length — this is audio.",
  "CRITICAL: Never say your name, role, or position label. Never say 'Agent A', 'Agent B', 'Voice 1', 'Voice 2', 'As the pro side', 'As the against side', or any self-introduction. Jump straight into your point.",
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
    "Debate format: make a clear claim, back it with reasoning or an example, then challenge the other side with a pointed question or rebuttal.",
  teaching:
    "Teaching format: Socratic style, step-by-step instruction, concept checks, concrete examples.",
  podcast:
    "Podcast format: host and guest vibe, rich conversational turns, natural pacing, recap near ending.",
  argument:
    "Argument format: adversarial but safe and respectful, sharp disagreement, no abusive language."
};

export const buildSceneSetup = (prompt: string, _mode: ModeSuggestion): string =>
  `Today's topic: ${prompt}. Let's get into it.`;

export const buildDialogSystemPrompt = (
  mode: ModeSuggestion,
  maxSecondsPerTurn: number,
  targetSpeaker: Speaker,
  assignedPosition?: string
): string => {
  const approximateWords = Math.max(60, Math.round(maxSecondsPerTurn * 2.5));
  const speakerInstruction =
    targetSpeaker === "A"
      ? "You open the exchange. Make a sharp, confident claim and own it. No introduction — start with your point."
      : "You respond to what was just said. Disagree directly, push back with conviction. React like you genuinely heard it and want to challenge it. No preamble.";
  const positionInstruction = assignedPosition
    ? `Your assigned position: ${assignedPosition} Hold it firmly throughout.`
    : "";

  return [
    moderatorSpec,
    speakerInstruction,
    positionInstruction,
    formatRulesByCategory[mode.category],
    `Mode guidance: ${mode.formatGuidance}`,
    `Target length: ${approximateWords} words — that is 3 to 5 complete sentences. Always finish every sentence you start. Never stop mid-thought.`,
    "Avoid 'First', 'Second', 'Finally', 'In conclusion', and other essay transitions. Speak like you're in a heated room, not writing an op-ed."
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
    .map((turn) => {
      if (turn.speaker === "moderator") return `[moderator]: ${turn.text}`;
      return turn.speaker === speaker ? `[you]: ${turn.text}` : `[them]: ${turn.text}`;
    })
    .join("\n");

  return [
    `Topic: ${topic}`,
    `Mode: ${mode.title} (${mode.category})`,
    `Turn: ${turnIndex} of ${totalTurns}`,
    shortHistory ? `Conversation so far:\n${shortHistory}` : "Conversation so far: none yet",
    "Speak your turn now. Do not introduce yourself or announce your side. Start directly with your argument."
  ].join("\n\n");
};
