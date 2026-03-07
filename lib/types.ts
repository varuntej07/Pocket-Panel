export type ConversationIntent = "debate" | "argument" | "teaching" | "podcast" | "none";
export type Speaker = "A" | "B";

export interface ModeSuggestion {
  id: string;
  title: string;
  category: Exclude<ConversationIntent, "none">;
  description: string;
  formatGuidance: string;
  recommended?: boolean;
}

export interface IntentClassification {
  intent: ConversationIntent;
  suggestedModes: string[];
}

export interface SessionTurn {
  speaker: Speaker | "moderator";
  text: string;
  turnIndex: number;
  createdAt: number;
}

export interface SessionState {
  id: string;
  prompt: string;
  topicBreadcrumb: string;
  mode: ModeSuggestion;
  status: "created" | "running" | "ended" | "error";
  createdAt: number;
  updatedAt: number;
  turns: SessionTurn[];
  started: boolean;
  endedReason?: string;
  lastError?: string;
  pendingInjection?: string;
  socket?: {
    readyState: number;
    send: (payload: string) => void;
    close: (code?: number) => void;
  };
}
