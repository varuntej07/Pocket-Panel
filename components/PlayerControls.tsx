"use client";

import type { ChangeEvent } from "react";

interface PlayerControlsProps {
  canControl: boolean;
  isPaused: boolean;
  volume: number;
  onTogglePause: () => void;
  onVolumeChange: (value: number) => void;
  onRestart: () => void;
}

export function PlayerControls({
  canControl,
  isPaused,
  volume,
  onTogglePause,
  onVolumeChange,
  onRestart
}: PlayerControlsProps) {
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
      <label className="volumeControl">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onVolumeChange(Number(event.target.value))}
        />
      </label>
    </section>
  );
}
