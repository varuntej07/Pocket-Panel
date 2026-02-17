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
      type: "ERROR";
      message: string;
    };
