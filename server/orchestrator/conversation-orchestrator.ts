import { chunkBuffer, splitTextForSpeech } from "../../lib/audio";
import { encodePcm16LeToWav, invokeSonicAsAgent, synthesizeSpeechAudio } from "../../lib/bedrock/audio";
import { generateDialogTurn } from "../../lib/bedrock/dialog";
import { generatePositions } from "../../lib/bedrock/positions";
import { generateSynthesis } from "../../lib/bedrock/synthesis";
import { appConfig } from "../../lib/config";
import { buildSonicAgentSystemPrompt, buildSonicAgentUserPrompt } from "../../lib/prompts";
import {
  appendSessionTurn,
  awaitSpeechDone,
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

      if (process.env.SONIC_AGENT_MODE === "true") {
        // ── Nova Sonic Agent Mode ──
        // Sonic generates its OWN text + audio response (no separate text LLM step).
        const systemPrompt = buildSonicAgentSystemPrompt({
          speaker,
          mode: activeSession.mode,
          assignedPosition: agentPosition
        });

        const userPrompt = buildSonicAgentUserPrompt({
          topic: activeSession.prompt,
          speaker,
          turnIndex,
          totalTurns: appConfig.conversation.totalTurns,
          history: historyWithInjection,
          injectedContext: injectedText ?? undefined
        });

        const voiceId = speaker === "A" ? appConfig.voices.agentA : appConfig.voices.agentB;
        let segmentIndex = 0;
        let pcmBuffer: Uint8Array[] = [];
        let bufferBytes = 0;
        let sampleRate = 24000;
        const FLUSH_THRESHOLD = 4800; // ~100ms at 24kHz mono 16-bit

        const flushPcmBuffer = () => {
          if (bufferBytes === 0) return;
          const totalLength = pcmBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of pcmBuffer) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          const wavChunk = encodePcm16LeToWav(merged, sampleRate);
          sendEvent(sessionId, {
            type: "AUDIO_CHUNK",
            speaker,
            turnIndex,
            segmentIndex: segmentIndex++,
            chunkIndex: 0,
            chunkBase64: Buffer.from(wavChunk).toString("base64"),
            mimeType: "audio/wav",
            isFinalChunk: true,
            isFinalSegment: false
          });
          pcmBuffer = [];
          bufferBytes = 0;
        };

        let turnTextAccumulator = "";

        logInfo("orchestrator", "Invoking Sonic agent mode", {
          sessionId,
          speaker,
          turnIndex,
          voiceId,
          systemPromptLength: systemPrompt.length,
          userPromptLength: userPrompt.length
        });

        const result = await invokeSonicAsAgent(
          { systemPrompt, userPrompt, voiceId },
          {
            onAudioChunk: (pcmBytes, sr) => {
              sampleRate = sr;
              pcmBuffer.push(pcmBytes);
              bufferBytes += pcmBytes.length;
              if (bufferBytes >= FLUSH_THRESHOLD) flushPcmBuffer();
            },
            onTextChunk: (text) => {
              turnTextAccumulator += text;
            }
          }
        );

        // Flush remaining audio
        flushPcmBuffer();
        // Send final segment marker (empty chunk signals end of this turn's audio)
        sendEvent(sessionId, {
          type: "AUDIO_CHUNK",
          speaker,
          turnIndex,
          segmentIndex,
          chunkIndex: 0,
          chunkBase64: "",
          mimeType: "audio/wav",
          isFinalChunk: true,
          isFinalSegment: true
        });

        // Wait for client to finish playing this turn's audio before proceeding.
        // This prevents Turn B from generating while Turn A is still playing.
        await awaitSpeechDone(sessionId, 90_000);

        const finalText = result.fullText || turnTextAccumulator || "Response generated.";
        appendSessionTurn(sessionId, speaker, turnIndex, finalText);
        sendEvent(sessionId, {
          type: "TURN_TEXT",
          speaker,
          turnIndex,
          text: finalText
        });

        logInfo("orchestrator", "Sonic agent turn completed", {
          sessionId,
          speaker,
          turnIndex,
          textLength: finalText.length,
          totalAudioBytes: result.totalAudioBytes,
          textPreview: finalText.slice(0, 180)
        });
      } else {
        // ── Text LLM + TTS path  ──
        const turnText = await generateDialogTurn(
          {
            topic: activeSession.prompt,
            mode: activeSession.mode,
            speaker,
            turnIndex,
            totalTurns: appConfig.conversation.totalTurns,
            history: historyWithInjection,
            agentPosition
          },
          (event) => {
            if (event.phase === "use") {
              trySendEvent(sessionId, { type: "TOOL_USE", speaker, turnIndex, query: event.query });
            } else {
              trySendEvent(sessionId, { type: "TOOL_RESULT", speaker, turnIndex, sources: event.sources });
            }
          }
        );

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

        if (process.env.BROWSER_TTS_ENABLED === "true") {
          const wordCount = turnText.trim().split(/\s+/).length;
          const estimatedMs = (wordCount / 2.5) * 1000 + 5000;
          const timeoutMs = Math.max(15_000, Math.min(estimatedMs, 75_000));
          logInfo("orchestrator", "Awaiting client speech done", { sessionId, speaker, turnIndex, wordCount, timeoutMs });
          await awaitSpeechDone(sessionId, timeoutMs);
          logInfo("orchestrator", "Client speech done, continuing", { sessionId, speaker, turnIndex });
        } else {
          const segments = splitTextForSpeech(turnText);
          if (segments.length === 0) {
            logInfo("orchestrator", "No speakable segments produced for turn", {
              sessionId,
              speaker,
              turnIndex
            });
            continue;
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

          // Wait for client to finish playing before generating the next turn.
          await awaitSpeechDone(sessionId, 90_000);
        }
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
