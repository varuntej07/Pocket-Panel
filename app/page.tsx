"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentStage } from "../components/AgentStage";
import { LandingHero } from "../components/LandingHero";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { PlayerControls } from "../components/PlayerControls";
import { PromptForm } from "../components/PromptForm";
import { SuggestionsPanel } from "../components/SuggestionsPanel";
import { TopicLibrary } from "../components/TopicLibrary";
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
  const isPausedRef = useRef(false);
  const pausedTurnDonePendingRef = useRef(false);
  const [transcriptTurns, setTranscriptTurns] = useState<TranscriptTurn[]>([]);
  const [synthesisText, setSynthesisText] = useState("");
  const [synthesisComplete, setSynthesisComplete] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const segmentBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Monotonically increasing: each new TURN_TEXT increments this so stale
  // closures from previous turns cannot signal CLIENT_SPEECH_DONE.
  const speechGenRef = useRef(0);
  // Tracks which turns received server-streamed audio (Sonic agent mode).
  // When present, Browser TTS is skipped for that turn.
  const receivedAudioForTurnRef = useRef<Set<number>>(new Set());
  // Set to true when the server sends the final segment marker for a turn.
  // Cleared after CLIENT_SPEECH_DONE is sent, signalling playback is complete.
  const pendingTurnDoneRef = useRef(false);
  // Web Audio API context for gapless scheduling (replaces HTMLAudioElement queue).
  const audioCtxRef = useRef<AudioContext | null>(null);
  // The scheduled end time of the last queued buffer (audioCtx.currentTime units).
  const nextPlayTimeRef = useRef(0);
  // Serializes decode+schedule so concurrent decodeAudioData calls don't race on nextPlayTimeRef.
  const scheduleChainRef = useRef<Promise<void>>(Promise.resolve());

  const scrollToApp = useCallback(() => {
    document.getElementById("app-section")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleTopicSelect = useCallback((topic: string) => {
    setPrompt(topic);
    scrollToApp();
  }, [scrollToApp]);

  const resetPlayback = useCallback(() => {
    clientLogInfo("Resetting playback state", {
      bufferedSegments: segmentBufferRef.current.size
    });

    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    scheduleChainRef.current = Promise.resolve();
    segmentBufferRef.current.clear();
    isPlayingRef.current = false;
    sessionEndedRef.current = false;
    speechGenRef.current++; // invalidate any active speech generation
    receivedAudioForTurnRef.current.clear();
    pendingTurnDoneRef.current = false;
    isPausedRef.current = false;
    pausedTurnDonePendingRef.current = false;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsPaused(false);
    setIsAudioPlaying(false);
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
    const ctx = audioCtxRef.current;
    const audioActive = ctx ? ctx.currentTime < nextPlayTimeRef.current - 0.1 : false;
    if (sessionEndedRef.current && !audioActive) {
      clientLogInfo("Finalizing UI phase after session end", {
        audioActive,
        scheduledUntil: nextPlayTimeRef.current.toFixed(3)
      });
      setPhase((current: UiPhase) => (current === "error" ? current : "ended"));
    }
  }, []);

  // No HTMLAudioElement queue — scheduling is handled by AudioContext below.

  // Wire pause/resume into Web Speech API
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (isPaused) {
      window.speechSynthesis.pause();
    } else {
      window.speechSynthesis.resume();
    }
  }, [isPaused]);

  useEffect(
    () => () => {
      disconnectWs();
      resetPlayback();
    },
    [disconnectWs, resetPlayback]
  );

  const loadingLabel = useMemo(() => {
    if (phase === "classifying") {
      return "Classifying intent and proposing modes…";
    }
    if (phase === "starting") {
      return "Preparing your session…";
    }
    if (phase === "connecting") {
      return "Connecting to live audio stream…";
    }
    return "";
  }, [phase]);

  const enqueueAudioBlob = useCallback(
    (bytes: Uint8Array, mimeType: string) => {
      const normalized = new Uint8Array(bytes.length);
      normalized.set(bytes);

      const schedule = async () => {
        try {
          if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
            audioCtxRef.current = new AudioContext();
          }
          const ctx = audioCtxRef.current;
          if (ctx.state === "suspended" && !isPausedRef.current) await ctx.resume();

          const audioBuffer = await ctx.decodeAudioData(normalized.buffer.slice(0, normalized.byteLength));
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);

          const now = ctx.currentTime;
          const startTime = Math.max(now + 0.12, nextPlayTimeRef.current);
          source.start(startTime);
          nextPlayTimeRef.current = startTime + audioBuffer.duration;

          setIsAudioPlaying(true);
          clientLogInfo("Scheduled audio chunk via AudioContext", {
            bytesLength: bytes.length,
            mimeType,
            startTime: startTime.toFixed(3),
            duration: audioBuffer.duration.toFixed(3)
          });

          source.onended = () => {
            const ctxNow = audioCtxRef.current?.currentTime ?? 0;
            if (ctxNow >= nextPlayTimeRef.current - 0.1) {
              setIsAudioPlaying(false);
              finalizeIfEnded();
              if (pendingTurnDoneRef.current) {
                pendingTurnDoneRef.current = false;
                if (isPausedRef.current) {
                  pausedTurnDonePendingRef.current = true;
                } else {
                  const ws = wsRef.current;
                  if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "CLIENT_SPEECH_DONE" }));
                  }
                }
              }
            }
          };
        } catch {
          clientLogWarn("Audio scheduling failed — skipping chunk");
        }
      };

      scheduleChainRef.current = scheduleChainRef.current.then(() => schedule());
    },
    [finalizeIfEnded]
  );

  const sendInjection = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      clientLogWarn("Cannot inject: WebSocket not open");
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "USER_INJECT", text }));
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

        // Skip Browser TTS when server already streamed audio for this turn (Sonic agent mode)
        if (receivedAudioForTurnRef.current.has(payload.turnIndex)) {
          clientLogInfo("Skipping Browser TTS — server audio received for turn", {
            turnIndex: payload.turnIndex
          });
          return;
        }

        if (typeof window !== "undefined" && window.speechSynthesis) {
          // Cancel any residual speech from a previous stuck utterance.
          // Done here (not in SPEAKER_CHANGE) so we never cancel a live utterance
          // and accidentally trigger onerror → premature CLIENT_SPEECH_DONE.
          window.speechSynthesis.cancel();

          // Increment generation so any stale closures from the previous turn
          // cannot fire CLIENT_SPEECH_DONE for this turn.
          const gen = ++speechGenRef.current;

          // Chrome TTS truncation bug: utterances longer than ~100 chars stop
          // mid-sentence and fire onend prematurely. Fix: speak one sentence at
          // a time so each chunk is short enough to complete reliably.
          const sentences = (payload.text.match(/[^.!?]+[.!?]+/g) ?? [payload.text])
            .map((s) => s.trim())
            .filter(Boolean);

          const voices = window.speechSynthesis.getVoices();
          const voice =
            payload.speaker === "A"
              ? (voices.find((v) => /google us english/i.test(v.name)) ??
                  voices.find((v) => v.lang === "en-US" && /male/i.test(v.name)) ??
                  voices.find((v) => v.lang === "en-US") ??
                  null)
              : (voices.find((v) => /google uk english female/i.test(v.name)) ??
                  voices.find((v) => v.lang === "en-GB") ??
                  voices.find((v) => v.lang.startsWith("en") && /female/i.test(v.name)) ??
                  null);
          const pitch = payload.speaker === "A" ? 0.88 : 1.12;

          const signalDone = () => {
            if (speechGenRef.current !== gen) return;
            setIsAudioPlaying(false);
            speechUtteranceRef.current = null;
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "CLIENT_SPEECH_DONE" }));
            }
            finalizeIfEnded();
          };

          const speakSentence = (index: number) => {
            if (speechGenRef.current !== gen) return; // stale turn, abort
            if (index >= sentences.length) {
              signalDone();
              return;
            }
            const utterance = new SpeechSynthesisUtterance(sentences[index]);
            utterance.voice = voice;
            utterance.rate = 1.0;
            utterance.pitch = pitch;
            utterance.volume = 1;

            utterance.onstart = () => {
              if (speechGenRef.current === gen) setIsAudioPlaying(true);
            };
            utterance.onend = () => {
              if (speechGenRef.current !== gen) return;
              speakSentence(index + 1); // advance to next sentence
            };
            utterance.onerror = (e) => {
              if (speechGenRef.current !== gen) return;
              if (e.error === "canceled") return; // our own cancel() at turn start, ignore
              clientLogWarn("Speech synthesis error", { error: e.error, sentence: index });
              signalDone(); // real error: unblock the server
            };

            speechUtteranceRef.current = utterance;
            window.speechSynthesis.speak(utterance);
          };

          speakSentence(0);
        }
        return;
      }

      if (payload.type === "AUDIO_CHUNK") {
        receivedAudioForTurnRef.current.add(payload.turnIndex);

        // Empty chunkBase64 = final segment marker from Sonic agent mode; skip decode
        if (payload.chunkBase64 === "") {
          if (payload.isFinalSegment) {
            clientLogInfo("Received empty final segment marker", {
              speaker: payload.speaker,
              turnIndex: payload.turnIndex
            });
            // source.onended on the last scheduled buffer will send CLIENT_SPEECH_DONE.
            pendingTurnDoneRef.current = true;
          }
          return;
        }

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
          if (payload.isFinalSegment) {
            // Legacy server-TTS: mark turn done; source.onended will send CLIENT_SPEECH_DONE.
            pendingTurnDoneRef.current = true;
          }
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

      if (!data.modes || data.modes.length === 0) {
        setPhase("idle");
        setErrorMessage(
          "This prompt does not clearly fit debate, argument, teaching, or podcast. Try reframing it."
        );
        return;
      }

      // Auto-start with the recommended mode (or first mode) — skip mode selection panel
      const autoMode = data.modes.find((m) => m.recommended) ?? data.modes[0];
      void startSession(autoMode);
    } catch (error) {
      clientLogError("Classification request failed", {
        error: String(error)
      });
      setPhase("error");
      setErrorMessage(String(error));
    }
  }, [disconnectWs, prompt, resetPlayback, startSession]);

  const togglePause = useCallback(() => {
    if (!isPaused) {
      clientLogInfo("Pausing playback");
      isPausedRef.current = true;
      void audioCtxRef.current?.suspend();
      setIsPaused(true);
      return;
    }
    clientLogInfo("Resuming playback");
    isPausedRef.current = false;
    void audioCtxRef.current?.resume();
    setIsPaused(false);
    if (pausedTurnDonePendingRef.current) {
      pausedTurnDonePendingRef.current = false;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "CLIENT_SPEECH_DONE" }));
      }
    }
  }, [isPaused]);

  const handleRestart = useCallback(() => {
    if (!selectedMode) {
      return;
    }
    void startSession(selectedMode);
  }, [selectedMode, startSession]);

  const showTopicLibrary = phase === "idle" || phase === "ready";

  return (
    <>
      <LandingHero onStart={scrollToApp} onTopicSelect={handleTopicSelect} />

      <main id="app-section" className="appShell">
        <LoadingOverlay visible={phase === "classifying" || phase === "starting" || phase === "connecting"} phaseLabel={loadingLabel} />

        <div className="column">
          <PromptForm prompt={prompt} disabled={phase === "classifying" || phase === "starting" || phase === "connecting"} onChange={setPrompt} onSubmit={() => void handleClassify()} />
          {intent && <p className="intentText">Detected intent: {intent}</p>}
          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
          {showTopicLibrary && <TopicLibrary onSelect={handleTopicSelect} />}
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
            phase={phase}
            isAudioPlaying={isAudioPlaying}
          />
          <PlayerControls
            canControl={Boolean(sessionId)}
            isPaused={isPaused}
            isLive={phase === "live"}
            onTogglePause={togglePause}
            onRestart={handleRestart}
            onInject={sendInjection}
          />
          <audio ref={audioRef} hidden />
        </div>
      </main>
    </>
  );
}
