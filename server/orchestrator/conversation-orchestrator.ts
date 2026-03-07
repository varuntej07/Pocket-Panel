import { chunkBuffer, splitTextForSpeech } from "../../lib/audio";
import { synthesizeSpeechAudio } from "../../lib/bedrock/audio";
import { generateDialogTurn } from "../../lib/bedrock/dialog";
import { generatePositions } from "../../lib/bedrock/positions";
import { generateSynthesis } from "../../lib/bedrock/synthesis";
import { appConfig } from "../../lib/config";
import { buildSceneSetup } from "../../lib/prompts";
import {
  appendSessionTurn,
  consumePendingInjection,
  getSession,
  markSessionEnded,
  markSessionError,
  markSessionStarted
} from "../../lib/session-store";
import { logError, logInfo, toErrorMetadata } from "../../lib/telemetry";
import type { SessionTurn, Speaker } from "../../lib/types";
import type { ServerWsEvent } from "../ws/protocol";

declare global {
  var __POCKET_PANEL_RUNNING_SESSIONS__: Set<string> | undefined;
}

const runningSessions = globalThis.__POCKET_PANEL_RUNNING_SESSIONS__ ?? new Set<string>();
globalThis.__POCKET_PANEL_RUNNING_SESSIONS__ = runningSessions;

const WS_OPEN = 1;

const getLiveSocket = (sessionId: string) => {
  const session = getSession(sessionId);
  if (!session?.socket || session.socket.readyState !== WS_OPEN) {
    return null;
  }
  return session.socket;
};

const sendEvent = (sessionId: string, event: ServerWsEvent): void => {
  const socket = getLiveSocket(sessionId);
  if (!socket) {
    throw new Error(`No active WebSocket for session ${sessionId}`);
  }
  socket.send(JSON.stringify(event));
};

const trySendEvent = (sessionId: string, event: ServerWsEvent): void => {
  const socket = getLiveSocket(sessionId);
  if (socket) {
    socket.send(JSON.stringify(event));
  }
};

const isSessionClosed = (sessionId: string): boolean => getLiveSocket(sessionId) === null;

const streamSegmentAudio = async (params: {
  sessionId: string;
  speaker: Speaker;
  turnIndex: number;
  segmentIndex: number;
  segmentText: string;
  isFinalSegment: boolean;
}): Promise<void> => {
  const { sessionId, speaker, turnIndex, segmentIndex, segmentText, isFinalSegment } = params;
  logInfo("orchestrator", "Synthesizing segment audio", {
    sessionId,
    speaker,
    turnIndex,
    segmentIndex,
    isFinalSegment,
    segmentTextLength: segmentText.length,
    segmentTextPreview: segmentText.slice(0, 160)
  });

  try {
    const { audioBytes, mimeType } = await synthesizeSpeechAudio(segmentText, speaker);
    const chunks = chunkBuffer(audioBytes, appConfig.conversation.wsAudioChunkBytes);

    logInfo("orchestrator", "Segment audio synthesized", {
      sessionId,
      speaker,
      turnIndex,
      segmentIndex,
      isFinalSegment,
      mimeType,
      audioBytesLength: audioBytes.length,
      wsChunkCount: chunks.length,
      wsAudioChunkBytes: appConfig.conversation.wsAudioChunkBytes
    });

    for (let i = 0; i < chunks.length; i += 1) {
      if (isSessionClosed(sessionId)) {
        throw new Error("WebSocket closed while streaming audio");
      }

      if (i === 0 || i === chunks.length - 1) {
        logInfo("orchestrator", "Sending websocket audio chunk", {
          sessionId,
          speaker,
          turnIndex,
          segmentIndex,
          chunkIndex: i,
          chunkBytesLength: chunks[i].length,
          isFinalChunk: i === chunks.length - 1,
          isFinalSegment: i === chunks.length - 1 && isFinalSegment
        });
      }

      sendEvent(sessionId, {
        type: "AUDIO_CHUNK",
        speaker,
        turnIndex,
        segmentIndex,
        chunkIndex: i,
        chunkBase64: Buffer.from(chunks[i]).toString("base64"),
        mimeType,
        isFinalChunk: i === chunks.length - 1,
        isFinalSegment: i === chunks.length - 1 && isFinalSegment
      });
    }
  } catch (error) {
    logError("orchestrator", "Segment audio pipeline failed", {
      sessionId,
      speaker,
      turnIndex,
      segmentIndex,
      isFinalSegment,
      segmentTextLength: segmentText.length,
      ...toErrorMetadata(error)
    });
    throw error;
  }
};

const streamSynthesis = async (sessionId: string): Promise<void> => {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  logInfo("orchestrator", "Starting post-debate synthesis", { sessionId });

  const agentTurns = session.turns.filter((t) => t.speaker === "A" || t.speaker === "B");
  if (agentTurns.length === 0) {
    return;
  }

  try {
    let hasChunks = false;
    for await (const chunk of generateSynthesis(session.prompt, session.mode, session.turns)) {
      hasChunks = true;
      trySendEvent(sessionId, {
        type: "SYNTHESIS_CHUNK",
        text: chunk,
        isFinal: false
      });
    }
    if (hasChunks) {
      trySendEvent(sessionId, {
        type: "SYNTHESIS_CHUNK",
        text: "",
        isFinal: true
      });
    }
    logInfo("orchestrator", "Synthesis streamed to client", { sessionId });
  } catch (error) {
    logError("orchestrator", "Synthesis streaming failed", { sessionId, ...toErrorMetadata(error) });
  }
};

const runSessionConversation = async (sessionId: string): Promise<void> => {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  markSessionStarted(sessionId);
  sendEvent(sessionId, {
    type: "SESSION_READY",
    sessionId,
    mode: session.mode,
    topicBreadcrumb: session.topicBreadcrumb
  });

  logInfo("orchestrator", "Session started", {
    sessionId,
    modeId: session.mode.id
  });

  try {
    // Pre-generate agent positions for consistent, opposed stances
    const positions = await generatePositions(session.prompt, session.mode);
    logInfo("orchestrator", "Agent positions assigned", {
      sessionId,
      positionA: positions.positionA,
      positionB: positions.positionB
    });

    const deadlineMs = Date.now() + appConfig.conversation.maxDurationSeconds * 1000;

    for (let turnIndex = 1; turnIndex <= appConfig.conversation.totalTurns; turnIndex += 1) {
      if (isSessionClosed(sessionId)) {
        markSessionEnded(sessionId, "closed");
        return;
      }
      if (Date.now() >= deadlineMs) {
        break;
      }

      const speaker: Speaker = turnIndex % 2 === 1 ? "A" : "B";
      sendEvent(sessionId, {
        type: "SPEAKER_CHANGE",
        speaker,
        turnIndex
      });

      const activeSession = getSession(sessionId);
      if (!activeSession) {
        return;
      }

      // Check for moderator injection and prepend to history if present
      const injectedText = consumePendingInjection(sessionId);
      const historyWithInjection: SessionTurn[] = injectedText
        ? [
            ...activeSession.turns,
            {
              speaker: "moderator" as const,
              text: injectedText,
              turnIndex: 0,
              createdAt: Date.now()
            }
          ]
        : activeSession.turns;

      if (injectedText) {
        logInfo("orchestrator", "Moderator injection applied", { sessionId, injectedText });
      }

      const agentPosition = speaker === "A" ? positions.positionA : positions.positionB;

      const turnText = await generateDialogTurn({
        topic: activeSession.prompt,
        mode: activeSession.mode,
        speaker,
        turnIndex,
        totalTurns: appConfig.conversation.totalTurns,
        history: historyWithInjection,
        agentPosition
      });

      appendSessionTurn(sessionId, speaker, turnIndex, turnText);

      // Emit transcript text before audio so UI can show it immediately
      sendEvent(sessionId, {
        type: "TURN_TEXT",
        speaker,
        turnIndex,
        text: turnText
      });

      logInfo("orchestrator", "Generated dialog turn", {
        sessionId,
        speaker,
        turnIndex,
        turnTextLength: turnText.length,
        turnTextPreview: turnText.slice(0, 180)
      });

      const segments = splitTextForSpeech(turnText);
      if (segments.length === 0) {
        logInfo("orchestrator", "No speakable segments produced for turn", {
          sessionId,
          speaker,
          turnIndex
        });
        continue;
      }

      if (turnIndex === 1 && speaker === "A") {
        segments.unshift(buildSceneSetup(activeSession.prompt, activeSession.mode));
        logInfo("orchestrator", "Prepended scene setup segment for first turn", {
          sessionId,
          speaker,
          turnIndex
        });
      }

      logInfo("orchestrator", "Turn segmented for speech synthesis", {
        sessionId,
        speaker,
        turnIndex,
        segmentCount: segments.length,
        segmentLengths: segments.map((segment) => segment.length)
      });

      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        if (Date.now() >= deadlineMs) {
          logInfo("orchestrator", "Reached conversation deadline while streaming segments", {
            sessionId,
            speaker,
            turnIndex,
            segmentIndex
          });
          break;
        }
        await streamSegmentAudio({
          sessionId,
          speaker,
          turnIndex,
          segmentIndex,
          segmentText: segments[segmentIndex],
          isFinalSegment: segmentIndex === segments.length - 1
        });
      }
    }

    if (!isSessionClosed(sessionId)) {
      sendEvent(sessionId, {
        type: "SESSION_END",
        reason: "completed"
      });
    }
    markSessionEnded(sessionId, "completed");
    logInfo("orchestrator", "Session completed", { sessionId });

    // Stream post-debate synthesis after SESSION_END
    await streamSynthesis(sessionId);
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const causeMessage = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = causeMessage
      ? `Conversation failed: ${baseMessage}. Cause: ${causeMessage}`
      : `Conversation failed: ${baseMessage}`;
    markSessionError(sessionId, message);
    logError("orchestrator", message, {
      sessionId,
      ...toErrorMetadata(error)
    });

    const socket = getLiveSocket(sessionId);
    if (socket) {
      socket.send(
        JSON.stringify({
          type: "ERROR",
          message
        } satisfies ServerWsEvent)
      );
      socket.send(
        JSON.stringify({
          type: "SESSION_END",
          reason: "error"
        } satisfies ServerWsEvent)
      );
    }
    markSessionEnded(sessionId, "error");
  }
};

export const startConversationIfNeeded = (sessionId: string): void => {
  if (runningSessions.has(sessionId)) {
    return;
  }

  runningSessions.add(sessionId);
  void runSessionConversation(sessionId).finally(() => {
    runningSessions.delete(sessionId);
  });
};
