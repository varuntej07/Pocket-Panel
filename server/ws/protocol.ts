import type { ModeSuggestion, Speaker } from "../../lib/types";

export type ServerWsEvent =
  | {
      type: "SESSION_READY";
      sessionId: string;
      mode: ModeSuggestion;
      topicBreadcrumb: string;
    }
  | {
      type: "SPEAKER_CHANGE";
      speaker: Speaker;
      turnIndex: number;
    }
  | {
      type: "TURN_TEXT";
      speaker: Speaker;
      turnIndex: number;
      text: string;
    }
  | {
      type: "AUDIO_CHUNK";
      speaker: Speaker;
      turnIndex: number;
      segmentIndex: number;
      chunkIndex: number;
      chunkBase64: string;
      mimeType: string;
      isFinalChunk: boolean;
      isFinalSegment: boolean;
    }
  | {
      type: "SESSION_END";
      reason: "completed" | "error" | "closed";
    }
  | {
      type: "SYNTHESIS_CHUNK";
      text: string;
      isFinal: boolean;
    }
  | { type: "TOOL_USE"; speaker: Speaker; turnIndex: number; query: string }
  | {
      type: "TOOL_RESULT";
      speaker: Speaker;
      turnIndex: number;
      sources: Array<{ title: string; url: string; snippet: string }>;
    }
  | {
      type: "ERROR";
      message: string;
    };

export type ClientWsEvent =
  | { type: "USER_INJECT"; text: string }
  | { type: "CLIENT_SPEECH_DONE" };
