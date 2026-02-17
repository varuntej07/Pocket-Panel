"use client";

import type { ModeSuggestion } from "../lib/types";

interface SuggestionsPanelProps {
  modes: ModeSuggestion[];
  selectedModeId?: string;
  onSelect: (mode: ModeSuggestion) => void;
}

export function SuggestionsPanel({ modes, selectedModeId, onSelect }: SuggestionsPanelProps) {
  if (modes.length === 0) {
    return null;
  }

  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Choose a Conversation Mode</h2>
        <span>{modes.length} options</span>
      </div>
      <div className="modeGrid" role="list" aria-label="Conversation modes">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`modeCard ${selectedModeId === mode.id ? "selected" : ""}`}
            onClick={() => onSelect(mode)}
          >
            <div className="modeMeta">
              <span className={`pill ${mode.category}`}>{mode.category}</span>
              {mode.recommended ? <span className="pill recommended">recommended</span> : null}
            </div>
            <h3>{mode.title}</h3>
            <p>{mode.description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
