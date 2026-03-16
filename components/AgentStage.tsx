"use client";

import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { WaveformVisualizer } from "./WaveformVisualizer";
import type { Speaker } from "../lib/types";

const WAITING_CAPTIONS = [
  "Synthesizing the debate…",
  "Agents contemplating their next move…",
  "Warming up the vocal cords…",
  "Formulating counterarguments…",
  "Cross-referencing the facts…",
  "Agents deep in thought…",
  "Preparing a compelling point…",
  "Loading perspectives…",
  "Calibrating opinions…",
  "The stage is almost set…",
  "Consulting the argument playbook…",
  "Agent A sharpening their rhetoric…",
  "Brewing the perfect rebuttal…",
];

interface TranscriptTurn {
  speaker: Speaker | "moderator";
  turnIndex: number;
  text: string;
}

interface AgentStageProps {
  nowSpeaking: Speaker | null;
  topicBreadcrumb: string;
  modeTitle?: string;
  transcriptTurns: TranscriptTurn[];
  synthesisText: string;
  synthesisComplete: boolean;
  phase: string;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isAudioPlaying: boolean;
}

const TOTAL_TURNS = 8;

export function AgentStage({
  nowSpeaking,
  topicBreadcrumb,
  modeTitle,
  transcriptTurns,
  phase,
  audioRef,
  isAudioPlaying,
}: AgentStageProps) {
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [captionIndex, setCaptionIndex] = useState(0);

  useEffect(() => {
    if (transcriptOpen) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcriptTurns.length, transcriptOpen]);

  // Rotate captions while waiting for audio
  const showCaptions = phase === "live" && !isAudioPlaying;
  useEffect(() => {
    if (!showCaptions) return;
    const id = setInterval(() => {
      setCaptionIndex((i) => (i + 1) % WAITING_CAPTIONS.length);
    }, 2500);
    return () => clearInterval(id);
  }, [showCaptions]);

  const agentTurns = transcriptTurns.filter((t) => t.speaker !== "moderator");
  const currentTurn = agentTurns.length;
  const progressPct = Math.min((currentTurn / TOTAL_TURNS) * 100, 100);
  const showProgress = phase === "live" || phase === "ended";
  const isEnded = phase === "ended";

  return (
    <section className="stage panel">
      <div className="stageHeader">
        <h2>Live Voice Stage</h2>
        <span>{modeTitle ?? "No mode selected"}</span>
      </div>
      <p className="topicBreadcrumb">{topicBreadcrumb || "Waiting for topic…"}</p>

      {/* Avatar row */}
      <div className="avatarRow">
        <AgentAvatar agent="A" isActive={nowSpeaking === "A"} phase={phase} />
        <div className="faceDivider" />
        <AgentAvatar agent="B" isActive={nowSpeaking === "B"} phase={phase} />
      </div>

      {/* Waveform or waiting captions */}
      <div className="waveformWrap">
        {showCaptions ? (
          <p className="waitingCaption">{WAITING_CAPTIONS[captionIndex]}</p>
        ) : (
          <WaveformVisualizer audioRef={audioRef} isActive={isAudioPlaying} nowSpeaking={nowSpeaking} />
        )}
      </div>

      <p className="nowSpeaking">
        {isAudioPlaying && nowSpeaking ? `Agent ${nowSpeaking} speaking` : phase === "live" ? "Standby…" : "Waiting to start"}
      </p>

      {/* Progress indicator */}
      {showProgress && (
        <div className="progressWrap">
          <div className="progressHeader">
            <span className="progressStatus">
              Turn {Math.min(currentTurn, TOTAL_TURNS)} of {TOTAL_TURNS}
              {nowSpeaking ? ` — Agent ${nowSpeaking} speaking` : ""}
            </span>
            <span className={`progressChip progressChip--${phase}`}>
              {phase === "ended" ? "Complete" : "Live"}
            </span>
          </div>
          <div className="progressBar">
            <div className="progressFill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="progressDots">
            {Array.from({ length: TOTAL_TURNS }).map((_, i) => (
              <div
                key={i}
                className={`progressDot ${i < currentTurn ? "progressDot--filled" : ""}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Live Transcript (hidden once ended — full transcript shown below) */}
      {transcriptTurns.length > 0 && !isEnded && (
        <div className="transcriptPanel">
          <div className="transcriptHeaderRow">
            <h3 className="transcriptHeading">Live Transcript</h3>
            <button
              type="button"
              className="transcriptToggle"
              onClick={() => setTranscriptOpen((o) => !o)}
              aria-expanded={transcriptOpen}
            >
              {transcriptOpen ? "Collapse ▲" : "Expand ▼"}
            </button>
          </div>
          {transcriptOpen && (
            <div className="transcriptScroll">
              {transcriptTurns.map((turn) => (
                <div
                  key={`${turn.turnIndex}-${turn.speaker}`}
                  className={`transcriptTurn transcriptTurn--${turn.speaker === "moderator" ? "moderator" : turn.speaker.toLowerCase()}`}
                >
                  <span className="transcriptSpeaker">
                    {turn.speaker === "moderator" ? "[MODERATOR]" : `Agent ${turn.speaker}`}
                  </span>
                  <p className="transcriptText">{turn.text}</p>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>
      )}

      {/* Full Conversation Transcript — shown at the end */}
      {isEnded && transcriptTurns.length > 0 && (
        <div className="transcriptPanel">
          <h3 className="transcriptHeading">Full Conversation Transcript</h3>
          <div className="transcriptScroll">
            {transcriptTurns
              .filter((turn) => turn.speaker !== "moderator")
              .map((turn) => (
                <div
                  key={`${turn.turnIndex}-${turn.speaker}`}
                  className={`transcriptTurn transcriptTurn--${turn.speaker.toLowerCase()}`}
                >
                  <span className="transcriptSpeaker">Agent {turn.speaker}</span>
                  <p className="transcriptText">{turn.text}</p>
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
