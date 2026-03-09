"use client";

import { useEffect, useRef, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { WaveformVisualizer } from "./WaveformVisualizer";
import type { Speaker } from "../lib/types";

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
}

const TOTAL_TURNS = 8;

export function AgentStage({
  nowSpeaking,
  topicBreadcrumb,
  modeTitle,
  transcriptTurns,
  synthesisText,
  synthesisComplete,
  phase,
  audioRef,
}: AgentStageProps) {
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(true);

  useEffect(() => {
    if (transcriptOpen) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcriptTurns.length, transcriptOpen]);

  const agentTurns = transcriptTurns.filter((t) => t.speaker !== "moderator");
  const currentTurn = agentTurns.length;
  const progressPct = Math.min((currentTurn / TOTAL_TURNS) * 100, 100);
  const showProgress = phase === "live" || phase === "ended";
  const isActive = phase === "live";

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

      {/* Waveform */}
      <div className="waveformWrap">
        <WaveformVisualizer audioRef={audioRef} isActive={isActive} nowSpeaking={nowSpeaking} />
      </div>

      <p className="nowSpeaking">
        {nowSpeaking ? `Agent ${nowSpeaking} speaking` : phase === "live" ? "Standby…" : "Waiting to start"}
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

      {/* Transcript */}
      {transcriptTurns.length > 0 && (
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

      {/* Synthesis */}
      {synthesisText.length > 0 && (
        <div className="synthesisPanel">
          <h3 className="synthesisHeading">
            Post-Debate Synthesis{synthesisComplete ? "" : " \u2026"}
          </h3>
          <pre className="synthesisText">{synthesisText}</pre>
        </div>
      )}
    </section>
  );
}
