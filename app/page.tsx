"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentStage } from "../components/AgentStage";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { PlayerControls } from "../components/PlayerControls";
import { PromptForm } from "../components/PromptForm";
import { SuggestionsPanel } from "../components/SuggestionsPanel";
import type { ModeSuggestion, Speaker } from "../lib/types";

type UiPhase = "idle" | "classifying" | "ready" | "starting" | "connecting" | "live" | "ended" | "error";

interface TranscriptTurn {
  speaker: Speaker | "moderator";
  turnIndex: number;
  text: string;
}

interface ClassifyResponse {
  intent: string;
  modes: ModeSuggestion[];
  error?: string;
}

interface StartResponse {
  sessionId: string;
  wsUrl: string;
  error?: string;
}

type WsMessage =
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
  | {
      type: "ERROR";
      message: string;
    };

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const mergeBytes = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
};

const clientLogInfo = (message: string, metadata?: Record<string, unknown>): void => {
  if (metadata) {
    console.info(`[PocketPanel/client] ${message}`, metadata);
    return;
  }
  console.info(`[PocketPanel/client] ${message}`);
};

const clientLogWarn = (message: string, metadata?: Record<string, unknown>): void => {
  if (metadata) {
    console.warn(`[PocketPanel/client] ${message}`, metadata);
    return;
  }
  console.warn(`[PocketPanel/client] ${message}`);
};

const clientLogError = (message: string, metadata?: Record<string, unknown>): void => {
  if (metadata) {
    console.error(`[PocketPanel/client] ${message}`, metadata);
    return;
  }
  console.error(`[PocketPanel/client] ${message}`);
};

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [intent, setIntent] = useState<string>("");
  const [modes, setModes] = useState<ModeSuggestion[]>([]);
  const [selectedMode, setSelectedMode] = useState<ModeSuggestion | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [topicBreadcrumb, setTopicBreadcrumb] = useState("");
  const [nowSpeaking, setNowSpeaking] = useState<Speaker | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isPaused, setIsPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [transcriptTurns, setTranscriptTurns] = useState<TranscriptTurn[]>([]);
  const [synthesisText, setSynthesisText] = useState("");
  const [synthesisComplete, setSynthesisComplete] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const activeUrlRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(1);
  const sessionEndedRef = useRef(false);
  const segmentBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());

  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const resetPlayback = useCallback(() => {
    clientLogInfo("Resetting playback state", {
      queuedUrls: audioQueueRef.current.length,
      hasActiveUrl: Boolean(activeUrlRef.current),
      bufferedSegments: segmentBufferRef.current.size
    });

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }

    if (activeUrlRef.current) {
      URL.revokeObjectURL(activeUrlRef.current);
      activeUrlRef.current = null;
    }

    for (const url of audioQueueRef.current) {
      URL.revokeObjectURL(url);
    }
    audioQueueRef.current = [];
    segmentBufferRef.current.clear();
    isPlayingRef.current = false;
    sessionEndedRef.current = false;
    setIsPaused(false);
    setNowSpeaking(null);
    setTranscriptTurns([]);
    setSynthesisText("");
    setSynthesisComplete(false);
  }, []);

  const disconnectWs = useCallback(() => {
    if (wsRef.current) {
      clientLogInfo("Closing websocket connection from client");
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const finalizeIfEnded = useCallback(() => {
    if (sessionEndedRef.current && !isPlayingRef.current && audioQueueRef.current.length === 0) {
      clientLogInfo("Finalizing UI phase after session end", {
        isPlaying: isPlayingRef.current,
        queueLength: audioQueueRef.current.length
      });
      setPhase((current: UiPhase) => (current === "error" ? current : "ended"));
    }
  }, []);

  const pumpQueue = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || isPaused || isPlayingRef.current) {
      return;
    }
    const nextUrl = audioQueueRef.current.shift();
    if (!nextUrl) {
      finalizeIfEnded();
      return;
    }

    audio.src = nextUrl;
    audio.volume = volumeRef.current;
    activeUrlRef.current = nextUrl;
    isPlayingRef.current = true;
    clientLogInfo("Starting playback for queued audio blob", {
      queueLengthAfterShift: audioQueueRef.current.length,
      volume: volumeRef.current
    });

    void audio.play().catch(() => {
      clientLogWarn("Audio playback call rejected in pumpQueue");
      isPlayingRef.current = false;
    });
  }, [finalizeIfEnded, isPaused]);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    const audio = audioRef.current;
    const onEnded = () => {
      clientLogInfo("Audio element ended playback");
      isPlayingRef.current = false;
      if (activeUrlRef.current) {
        URL.revokeObjectURL(activeUrlRef.current);
        activeUrlRef.current = null;
      }
      pumpQueue();
    };
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("ended", onEnded);
    };
  }, [pumpQueue]);

  useEffect(() => {
    if (!isPaused) {
      pumpQueue();
    }
  }, [isPaused, pumpQueue]);

  useEffect(
    () => () => {
      disconnectWs();
      resetPlayback();
    },
    [disconnectWs, resetPlayback]
  );

  const loadingLabel = useMemo(() => {
    if (phase === "classifying") {
      return "Classifying intent and proposing modes...";
    }
    if (phase === "starting") {
      return "Preparing your session...";
    }
    if (phase === "connecting") {
      return "Connecting to live audio stream...";
    }
    return "";
  }, [phase]);

  const enqueueAudioBlob = useCallback(
    (bytes: Uint8Array, mimeType: string) => {
      const normalized = new Uint8Array(bytes.length);
      normalized.set(bytes);
      const blob = new Blob([normalized.buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      audioQueueRef.current.push(url);
      clientLogInfo("Enqueued synthesized audio blob", {
        bytesLength: bytes.length,
        mimeType,
        queueLength: audioQueueRef.current.length
      });
      pumpQueue();
    },
    [pumpQueue]
  );

  const sendInjection = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      clientLogWarn("Cannot inject: WebSocket not open");
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "USER_INJECT", text }));
    // Immediately show the moderator turn in the transcript
    setTranscriptTurns((prev) => [
      ...prev,
      { speaker: "moderator" as const, turnIndex: 0, text }
    ]);
    clientLogInfo("User injection sent", { textLength: text.length });
  }, []);

  const handleWsMessage = useCallback(
    (event: MessageEvent<string>) => {
      clientLogInfo("Websocket message received", {
        payloadLength: event.data.length
      });

      let payload: WsMessage;
      try {
        payload = JSON.parse(event.data) as WsMessage;
      } catch (error) {
        clientLogError("Failed to parse websocket payload as JSON", {
          error: String(error),
          rawPayloadPreview: event.data.slice(0, 220)
        });
        setErrorMessage("Malformed websocket payload.");
        setPhase("error");
        return;
      }
      clientLogInfo("Parsed websocket message", {
        type: payload.type
      });

      if (payload.type === "SESSION_READY") {
        clientLogInfo("Session is ready", {
          sessionId: payload.sessionId,
          modeId: payload.mode.id
        });
        setPhase("live");
        setTopicBreadcrumb(payload.topicBreadcrumb);
        setSelectedMode(payload.mode);
        setErrorMessage("");
        return;
      }

      if (payload.type === "SPEAKER_CHANGE") {
        clientLogInfo("Speaker changed", {
          speaker: payload.speaker,
          turnIndex: payload.turnIndex
        });
        setNowSpeaking(payload.speaker);
        return;
      }

      if (payload.type === "TURN_TEXT") {
        clientLogInfo("Turn text received", {
          speaker: payload.speaker,
          turnIndex: payload.turnIndex,
          textLength: payload.text.length
        });
        setTranscriptTurns((prev) => [
          ...prev,
          { speaker: payload.speaker, turnIndex: payload.turnIndex, text: payload.text }
        ]);
        return;
      }

      if (payload.type === "AUDIO_CHUNK") {
        const segmentKey = `${payload.turnIndex}:${payload.segmentIndex}:${payload.speaker}`;
        const existing = segmentBufferRef.current.get(segmentKey) ?? [];
        existing.push(base64ToBytes(payload.chunkBase64));
        segmentBufferRef.current.set(segmentKey, existing);

        if (payload.chunkIndex === 0 || payload.isFinalChunk) {
          clientLogInfo("Received audio chunk", {
            speaker: payload.speaker,
            turnIndex: payload.turnIndex,
            segmentIndex: payload.segmentIndex,
            chunkIndex: payload.chunkIndex,
            mimeType: payload.mimeType,
            isFinalChunk: payload.isFinalChunk,
            isFinalSegment: payload.isFinalSegment,
            bufferedChunkCountForSegment: existing.length
          });
        }

        if (payload.isFinalChunk) {
          const segmentBytes = mergeBytes(existing);
          segmentBufferRef.current.delete(segmentKey);
          clientLogInfo("Merged final segment audio", {
            speaker: payload.speaker,
            turnIndex: payload.turnIndex,
            segmentIndex: payload.segmentIndex,
            mergedBytesLength: segmentBytes.length
          });
          enqueueAudioBlob(segmentBytes, payload.mimeType);
        }
        return;
      }

      if (payload.type === "SESSION_END") {
        clientLogInfo("Session end received", {
          reason: payload.reason
        });
        sessionEndedRef.current = true;
        finalizeIfEnded();
        return;
      }

      if (payload.type === "SYNTHESIS_CHUNK") {
        if (payload.isFinal) {
          setSynthesisComplete(true);
          clientLogInfo("Synthesis complete");
        } else {
          setSynthesisText((prev) => prev + payload.text);
        }
        return;
      }

      if (payload.type === "ERROR") {
        clientLogError("Session error event received", {
          message: payload.message
        });
        sessionEndedRef.current = true;
        setErrorMessage(payload.message);
        setPhase("error");
      }
    },
    [enqueueAudioBlob, finalizeIfEnded]
  );

  const startSession = useCallback(
    async (mode: ModeSuggestion) => {
      clientLogInfo("Starting session request", {
        modeId: mode.id,
        promptLength: prompt.length
      });

      setSelectedMode(mode);
      setErrorMessage("");
      setPhase("starting");
      resetPlayback();
      disconnectWs();

      try {
        const startResponse = await fetch("/api/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prompt,
            modeId: mode.id
          })
        });

        const data = (await startResponse.json()) as StartResponse;
        if (!startResponse.ok || !data.sessionId || !data.wsUrl) {
          throw new Error(data.error ?? "Failed to start session.");
        }

        clientLogInfo("Session start response received", {
          sessionId: data.sessionId,
          wsUrl: data.wsUrl
        });

        setSessionId(data.sessionId);
        setPhase("connecting");

        const ws = new WebSocket(data.wsUrl);
        wsRef.current = ws;

        ws.onmessage = handleWsMessage;
        ws.onopen = () => {
          clientLogInfo("Websocket opened");
          setErrorMessage("");
        };
        ws.onerror = (errorEvent: Event) => {
          clientLogError("Websocket error event fired", {
            type: errorEvent.type
          });
          setErrorMessage("WebSocket connection error.");
          setPhase("error");
        };
        ws.onclose = (closeEvent: CloseEvent) => {
          clientLogWarn("Websocket closed", {
            code: closeEvent.code,
            reason: closeEvent.reason,
            wasClean: closeEvent.wasClean
          });
          finalizeIfEnded();
        };
      } catch (error) {
        clientLogError("Session start failed", {
          error: String(error)
        });
        setErrorMessage(String(error));
        setPhase("error");
      }
    },
    [disconnectWs, finalizeIfEnded, handleWsMessage, prompt, resetPlayback]
  );

  const handleClassify = useCallback(async () => {
    clientLogInfo("Starting classify request", {
      promptLength: prompt.length
    });

    setErrorMessage("");
    setIntent("");
    setModes([]);
    setSelectedMode(null);
    setSessionId(null);
    setTopicBreadcrumb("");
    disconnectWs();
    resetPlayback();
    setPhase("classifying");

    try {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt })
      });

      const data = (await response.json()) as ClassifyResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Classification failed.");
      }

      clientLogInfo("Classification response received", {
        intent: data.intent,
        modeCount: data.modes?.length ?? 0
      });

      setIntent(data.intent);
      setModes(data.modes ?? []);

      if (!data.modes || data.modes.length === 0) {
        setPhase("idle");
        setErrorMessage(
          "This prompt does not clearly fit debate, argument, teaching, or podcast. Try reframing it."
        );
        return;
      }

      setPhase("ready");
    } catch (error) {
      clientLogError("Classification request failed", {
        error: String(error)
      });
      setPhase("error");
      setErrorMessage(String(error));
    }
  }, [disconnectWs, prompt, resetPlayback]);

  const togglePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (!isPaused) {
      clientLogInfo("Pausing playback");
      audio.pause();
      setIsPaused(true);
      return;
    }

    clientLogInfo("Resuming playback");
    setIsPaused(false);
    if (audio.src && audio.paused) {
      void audio.play().catch(() => {
        clientLogWarn("Audio playback failed to resume");
        setErrorMessage("Playback failed to resume.");
      });
      isPlayingRef.current = true;
      return;
    }
    pumpQueue();
  }, [isPaused, pumpQueue]);

  const handleRestart = useCallback(() => {
    if (!selectedMode) {
      return;
    }
    void startSession(selectedMode);
  }, [selectedMode, startSession]);

  return (
    <main className="appShell">
      <LoadingOverlay visible={phase === "classifying" || phase === "starting" || phase === "connecting"} phaseLabel={loadingLabel} />

      <div className="column">
        <PromptForm prompt={prompt} disabled={phase === "classifying" || phase === "starting" || phase === "connecting"} onChange={setPrompt} onSubmit={() => void handleClassify()} />
        <p className="intentText">Detected intent: {intent || "Not classified yet"}</p>
        {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
        <SuggestionsPanel modes={modes} selectedModeId={selectedMode?.id} onSelect={(mode) => void startSession(mode)} />
      </div>

      <div className="column">
        <AgentStage
          nowSpeaking={nowSpeaking}
          topicBreadcrumb={topicBreadcrumb}
          modeTitle={selectedMode?.title}
          transcriptTurns={transcriptTurns}
          synthesisText={synthesisText}
          synthesisComplete={synthesisComplete}
        />
        <PlayerControls
          canControl={Boolean(sessionId)}
          isPaused={isPaused}
          volume={volume}
          isLive={phase === "live"}
          onTogglePause={togglePause}
          onVolumeChange={setVolume}
          onRestart={handleRestart}
          onInject={sendInjection}
        />
        <audio ref={audioRef} hidden />
      </div>
    </main>
  );
}
