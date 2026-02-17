import type { ConversationIntent, ModeSuggestion } from "./types";

export const MODE_CATALOG: ModeSuggestion[] = [
  {
    id: "debate-rapid-fire-crossfire",
    title: "Rapid Fire Crossfire",
    category: "debate",
    description: "Fast claim-counterclaim rounds with tight timing.",
    formatGuidance: "Short statements, immediate rebuttals, one supporting detail per turn."
  },
  {
    id: "debate-evidence-first",
    title: "Evidence First Duel",
    category: "debate",
    description: "Every argument must cite a concrete example or data point.",
    formatGuidance: "Lead with evidence, then interpretation, then challenge."
  },
  {
    id: "debate-policy-impact",
    title: "Policy Impact Debate",
    category: "debate",
    description: "Focus on real-world effects, tradeoffs, and unintended consequences.",
    formatGuidance: "Claim, impact path, counter-impact."
  },
  {
    id: "debate-ethical-triangle",
    title: "Ethical Triangle",
    category: "debate",
    description: "Arguments rotate through fairness, utility, and rights.",
    formatGuidance: "One ethical lens per turn, explicit contrast with opponent."
  },
  {
    id: "debate-historical-analogies",
    title: "Historical Analogies",
    category: "debate",
    description: "Both agents use historical parallels to defend positions.",
    formatGuidance: "Analogy plus caveat, then opponent stress-test."
  },
  {
    id: "debate-data-vs-story",
    title: "Data vs Story",
    category: "debate",
    description: "One agent emphasizes numbers, the other narrative impact.",
    formatGuidance: "Contrast quantitative and qualitative proof styles."
  },
  {
    id: "debate-closing-strike",
    title: "Closing Strike",
    category: "debate",
    description: "Build to concise closing arguments with strongest evidence only.",
    formatGuidance: "Escalate clarity each turn; final turn is a compact closing."
  },
  {
    id: "debate-moderated-lightning",
    title: "Moderated Lightning",
    category: "debate",
    description: "Moderator-style structure with strict, very short turns.",
    formatGuidance: "Single thesis sentence, single defense sentence."
  },
  {
    id: "debate-fallacy-hunt",
    title: "Fallacy Hunt",
    category: "debate",
    description: "Each side challenges logical weaknesses in real time.",
    formatGuidance: "Flag fallacy, correct framing, continue argument."
  },
  {
    id: "argument-red-team-blue-team",
    title: "Red Team vs Blue Team",
    category: "argument",
    description: "Direct adversarial framing over strategy choices.",
    formatGuidance: "Aggressive critique with practical counterproposal."
  },
  {
    id: "argument-priorities-collision",
    title: "Priorities Collision",
    category: "argument",
    description: "Competing priorities clash in each round.",
    formatGuidance: "State priority hierarchy and attack opponent priorities."
  },
  {
    id: "argument-cost-benefit-clash",
    title: "Cost-Benefit Clash",
    category: "argument",
    description: "Arguments centered on what is worth paying for.",
    formatGuidance: "Cost argument, value argument, risk argument."
  },
  {
    id: "argument-principles-vs-pragmatism",
    title: "Principles vs Pragmatism",
    category: "argument",
    description: "Normative ideals collide with practical execution.",
    formatGuidance: "One principle-led turn followed by one feasibility rebuttal."
  },
  {
    id: "argument-constraint-boxing",
    title: "Constraint Boxing",
    category: "argument",
    description: "Both sides argue under strict budget/time constraints.",
    formatGuidance: "Challenge assumptions and force realistic constraints."
  },
  {
    id: "argument-scarcity-conflict",
    title: "Scarcity Conflict",
    category: "argument",
    description: "Competing uses of limited resources drive the tension.",
    formatGuidance: "Defend allocation, attack opportunity cost."
  },
  {
    id: "argument-risk-showdown",
    title: "Risk Showdown",
    category: "argument",
    description: "The argument focuses on which risks matter most.",
    formatGuidance: "Name top risk, mitigation, and opponent blind spot."
  },
  {
    id: "argument-hardline-compromise",
    title: "Hardline to Compromise",
    category: "argument",
    description: "Start hardline, end with narrow compromise possibilities.",
    formatGuidance: "Strong pushback first, tactical concession later."
  },
  {
    id: "teaching-socratic-ladder",
    title: "Socratic Ladder",
    category: "teaching",
    description: "Question-driven teaching with progressive difficulty.",
    formatGuidance: "Ask a guiding question, answer briefly, then deepen."
  },
  {
    id: "teaching-analogy-lab",
    title: "Analogy Lab",
    category: "teaching",
    description: "Teach with vivid analogies before formal definitions.",
    formatGuidance: "Analogy, technical mapping, check understanding."
  },
  {
    id: "teaching-misconception-debugger",
    title: "Misconception Debugger",
    category: "teaching",
    description: "Target common mistakes and correct them clearly.",
    formatGuidance: "State misconception, explain why, replace with correct model."
  },
  {
    id: "teaching-first-principles",
    title: "First Principles Build",
    category: "teaching",
    description: "Start from fundamentals and build layer by layer.",
    formatGuidance: "Define primitives, compose them, apply in an example."
  },
  {
    id: "teaching-case-walkthrough",
    title: "Case Walkthrough",
    category: "teaching",
    description: "Teach by walking through a concrete scenario.",
    formatGuidance: "Set context, reason step-by-step, summarize lesson."
  },
  {
    id: "teaching-step-checkpoint",
    title: "Step Checkpoint",
    category: "teaching",
    description: "Frequent quick checks to verify understanding.",
    formatGuidance: "One concept per turn, one comprehension checkpoint."
  },
  {
    id: "teaching-question-drill",
    title: "Question Drill",
    category: "teaching",
    description: "Rapid Q&A style for focused exam-like prep.",
    formatGuidance: "Prompt, answer, why-it-matters line."
  },
  {
    id: "teaching-visualization-verbal",
    title: "Visualization Verbalizer",
    category: "teaching",
    description: "Describe mental models as if drawing them aloud.",
    formatGuidance: "Paint a mental image, then anchor it in formal terms."
  },
  {
    id: "teaching-masterclass-mini",
    title: "Mini Masterclass",
    category: "teaching",
    description: "Polished expert-led walkthrough with concise checkpoints.",
    formatGuidance: "Teach, test, recap in each round."
  },
  {
    id: "podcast-host-guest-deep-dive",
    title: "Host-Guest Deep Dive",
    category: "podcast",
    description: "Classic long-form host and guest structure.",
    formatGuidance: "Warm open, deep analysis, practical takeaway."
  },
  {
    id: "podcast-hot-take-breakdown",
    title: "Hot Take Breakdown",
    category: "podcast",
    description: "A bold claim is tested from multiple angles.",
    formatGuidance: "State hot take, challenge it, refine it."
  },
  {
    id: "podcast-founder-story",
    title: "Founder Story Arc",
    category: "podcast",
    description: "Narrative-heavy founder style with lessons learned.",
    formatGuidance: "Origin, obstacle, pivot, lesson."
  },
  {
    id: "podcast-newsroom-roundup",
    title: "Newsroom Roundup",
    category: "podcast",
    description: "Host and analyst break down timely developments.",
    formatGuidance: "Headline, context, implications."
  },
  {
    id: "podcast-beginner-friendly-explainer",
    title: "Beginner Explainer Cast",
    category: "podcast",
    description: "Friendly explanations for new listeners.",
    formatGuidance: "Plain language, examples, recap."
  },
  {
    id: "podcast-contrarian-corner",
    title: "Contrarian Corner",
    category: "podcast",
    description: "Host probes an intentionally contrarian guest angle.",
    formatGuidance: "Present mainstream view, challenge, resolve."
  },
  {
    id: "podcast-expert-qa",
    title: "Expert Q&A Spotlight",
    category: "podcast",
    description: "Question-driven interview with authoritative answers.",
    formatGuidance: "Question-first pacing with concise expert replies."
  },
  {
    id: "podcast-retro-future",
    title: "Retro to Future",
    category: "podcast",
    description: "Compare past patterns with future projections.",
    formatGuidance: "Then vs now vs next framing."
  },
  {
    id: "podcast-recap-and-takeaways",
    title: "Recap and Takeaways",
    category: "podcast",
    description: "Balanced discussion ending with clear practical takeaways.",
    formatGuidance: "Segmented discussion with a recap ending."
  }
];

export const getAllModes = (): ModeSuggestion[] => MODE_CATALOG;

export const getModeById = (modeId: string): ModeSuggestion | undefined =>
  MODE_CATALOG.find((mode) => mode.id === modeId);

export const getModesByCategory = (category: Exclude<ConversationIntent, "none">): ModeSuggestion[] =>
  MODE_CATALOG.filter((mode) => mode.category === category);
