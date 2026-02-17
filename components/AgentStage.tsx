"use client";

import type { Speaker } from "../lib/types";

interface AgentStageProps {
  nowSpeaking: Speaker | null;
  topicBreadcrumb: string;
  modeTitle?: string;
}

export function AgentStage({ nowSpeaking, topicBreadcrumb, modeTitle }: AgentStageProps) {
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
    </section>
  );
}
