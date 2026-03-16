"use client";

import { type ChangeEvent, type KeyboardEvent, useState } from "react";

interface PlayerControlsProps {
  canControl: boolean;
  isPaused: boolean;
  isLive: boolean;
  onTogglePause: () => void;
  onRestart: () => void;
  onInject: (text: string) => void;
}

export function PlayerControls({
  canControl,
  isPaused,
  isLive,
  onTogglePause,
  onRestart,
  onInject
}: PlayerControlsProps) {
  const [injectionText, setInjectionText] = useState("");

  const handleSendInjection = () => {
    const trimmed = injectionText.trim();
    if (!trimmed) {
      return;
    }
    onInject(trimmed);
    setInjectionText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handleSendInjection();
    }
  };

  return (
    <section className="controls panel">
      <div className="controlsRow">
        <button type="button" onClick={onTogglePause} disabled={!canControl} className="primaryButton">
          {isPaused ? "Play" : "Pause"}
        </button>
        <button type="button" onClick={onRestart} className="ghostButton">
          Restart Session
        </button>
      </div>
      {isLive && (
        <div className="injectionRow">
          <input
            type="text"
            className="injectionInput"
            placeholder="Ask the moderator a question..."
            value={injectionText}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setInjectionText(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={280}
          />
          <button
            type="button"
            className="ghostButton injectionSend"
            onClick={handleSendInjection}
            disabled={!injectionText.trim()}
          >
            Ask
          </button>
        </div>
      )}
    </section>
  );
}
