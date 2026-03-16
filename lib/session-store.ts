import { randomUUID } from "node:crypto";
import { appConfig } from "./config";
import type { ModeSuggestion, SessionState, SessionTurn, Speaker } from "./types";

interface SessionStoreShape {
  sessions: Map<string, SessionState>;
}

declare global {
  var __POCKET_PANEL_SESSION_STORE__: SessionStoreShape | undefined;
}

const globalStore =
  globalThis.__POCKET_PANEL_SESSION_STORE__ ??
  (globalThis.__POCKET_PANEL_SESSION_STORE__ = {
    sessions: new Map<string, SessionState>()
  });

const touch = (session: SessionState): void => {
  session.updatedAt = Date.now();
};

const pruneExpiredSessions = (): void => {
  const cutoff = Date.now() - appConfig.conversation.sessionTtlMs;
  for (const [sessionId, session] of globalStore.sessions.entries()) {
    if (session.updatedAt < cutoff) {
      globalStore.sessions.delete(sessionId);
    }
  }
};

export const createSession = (prompt: string, mode: ModeSuggestion): SessionState => {
  pruneExpiredSessions();

  const sessionId = randomUUID();
  const state: SessionState = {
    id: sessionId,
    prompt,
    topicBreadcrumb: prompt.trim().slice(0, 120),
    mode,
    status: "created",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
    started: false
  };
  globalStore.sessions.set(sessionId, state);
  return state;
};

export const getSession = (sessionId: string): SessionState | undefined => globalStore.sessions.get(sessionId);

export const setSessionSocket = (sessionId: string, socket: SessionState["socket"]): void => {
  const session = globalStore.sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.socket = socket;
  touch(session);
};

export const clearSessionSocket = (sessionId: string): void => {
  const session = globalStore.sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.socket = undefined;
  touch(session);
};

export const markSessionStarted = (sessionId: string): void => {
  const session = globalStore.sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.started = true;
  session.status = "running";
  touch(session);
};

export const markSessionError = (sessionId: string, errorMessage: string): void => {
  const session = globalStore.sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.status = "error";
  session.lastError = errorMessage;
  touch(session);
};

export const markSessionEnded = (sessionId: string, reason: string): void => {
  const session = globalStore.sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.status = "ended";
  session.endedReason = reason;
  touch(session);
};

export const appendSessionTurn = (
  sessionId: string,
  speaker: Speaker,
  turnIndex: number,
  text: string
): SessionTurn | undefined => {
  const session = globalStore.sessions.get(sessionId);
  if (!session) {
    return undefined;
  }
  const turn: SessionTurn = {
    speaker,
    text,
    turnIndex,
    createdAt: Date.now()
  };
  session.turns.push(turn);
  touch(session);
  return turn;
};

export const setPendingInjection = (sessionId: string, text: string): void => {
  const session = globalStore.sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.pendingInjection = text;
  touch(session);
};

export const consumePendingInjection = (sessionId: string): string | undefined => {
  const session = globalStore.sessions.get(sessionId);
  if (!session?.pendingInjection) {
    return undefined;
  }
  const text = session.pendingInjection;
  session.pendingInjection = undefined;
  touch(session);
  return text;
};

export const listSessions = (): SessionState[] => Array.from(globalStore.sessions.values());

// Used by the browser-TTS flow: orchestrator awaits this promise, client resolves it
// by sending CLIENT_SPEECH_DONE over the WebSocket when the utterance ends.
export const awaitSpeechDone = (sessionId: string, timeoutMs: number): Promise<void> => {
  return new Promise<void>((resolve) => {
    const session = globalStore.sessions.get(sessionId);
    if (!session) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (session.speechDoneResolve) {
        session.speechDoneResolve = undefined;
      }
      resolve();
    }, timeoutMs);
    session.speechDoneResolve = () => {
      clearTimeout(timer);
      session.speechDoneResolve = undefined;
      resolve();
    };
  });
};

export const signalSpeechDone = (sessionId: string): void => {
  const session = globalStore.sessions.get(sessionId);
  if (session?.speechDoneResolve) {
    session.speechDoneResolve();
  }
};
