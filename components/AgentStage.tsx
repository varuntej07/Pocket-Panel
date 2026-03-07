"use client";

import { useEffect, useRef } from "react";
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
}

export function AgentStage({
  nowSpeaking,
  topicBreadcrumb,
  modeTitle,
  transcriptTurns,
  synthesisText,
  synthesisComplete
}: AgentStageProps) {
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptTurns.length]);

  return (
    <section className="stage panel">
      <div className="stageHeader">
        <h2>Live Voice Stage</h2>
        <span>{modeTitle ?? "No mode selected"}</span>
      </div>
      <p className="topicBreadcrumb">{topicBreadcrumb || "Waiting for topic..."}</p>
      <div className="avatarRow">
        <div className={`avatarCard ${nowSpeaking === "A" ? "active" : ""}`}>
          <div className="avatar">A</div>
          <span>Agent A</span>
        </div>
        <div className="faceDivider" />
        <div className={`avatarCard ${nowSpeaking === "B" ? "active" : ""}`}>
          <div className="avatar">B</div>
          <span>Agent B</span>
        </div>
      </div>
      <p className="nowSpeaking">Now speaking: {nowSpeaking ? `Agent ${nowSpeaking}` : "Standby"}</p>

      {transcriptTurns.length > 0 && (
        <div className="transcriptPanel">
          <h3 className="transcriptHeading">Live Transcript</h3>
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
        </div>
      )}

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
