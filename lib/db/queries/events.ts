import { db } from "../index";
import { usageEvents } from "../schema";

export type EventType =
  | "session_created"
  | "session_started"
  | "session_completed"
  | "session_error"
  | "session_closed"
  | "session_expired"
  | "turn_completed"
  | "turn_started"
  | "synthesis_completed"
  | "search_called"
  | "safety_refusal"
  | "ws_connected"
  | "ws_disconnected"
  | "sonic_agent_invoked";

export const logEvent = async (params: {
  sessionId?: string;
  eventType: EventType;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> => {
  if (!db) return;
  await db.insert(usageEvents).values({
    sessionId: params.sessionId ?? null,
    eventType: params.eventType,
    metadata: params.metadata ?? null,
    ipAddress: params.ipAddress ?? null
  });
};
