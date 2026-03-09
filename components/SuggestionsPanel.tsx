"use client";

import { useRef, useState } from "react";
import type { ModeSuggestion } from "../lib/types";

interface SuggestionsPanelProps {
  modes: ModeSuggestion[];
  selectedModeId?: string;
  onSelect: (mode: ModeSuggestion) => void;
}

type FilterCategory = "all" | "debate" | "teaching" | "podcast" | "argument";

const FILTER_TABS: { id: FilterCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "debate", label: "Debate" },
  { id: "teaching", label: "Teaching" },
  { id: "podcast", label: "Podcast" },
  { id: "argument", label: "Argument" },
];

const CATEGORY_ICON: Record<string, string> = {
  debate: "⚖",
  teaching: "🎓",
  podcast: "🎙",
  argument: "⚡",
};

export function SuggestionsPanel({ modes, selectedModeId, onSelect }: SuggestionsPanelProps) {
  const [filter, setFilter] = useState<FilterCategory>("all");

  const filtered = filter === "all" ? modes : modes.filter((m) => m.category === filter);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rotX = ((e.clientY - cy) / (rect.height / 2)) * -8;
    const rotY = ((e.clientX - cx) / (rect.width / 2)) * 8;
    import("gsap").then(({ gsap }) => {
      gsap.to(card, {
        rotateX: rotX,
        rotateY: rotY,
        transformPerspective: 600,
        duration: 0.2,
        ease: "power2.out",
      });
    });
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    import("gsap").then(({ gsap }) => {
      gsap.to(e.currentTarget, {
        rotateX: 0,
        rotateY: 0,
        duration: 0.4,
        ease: "power2.out",
      });
    });
  };

  if (modes.length === 0) return null;

  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Choose a Conversation Mode</h2>
        <span>{filtered.length} options</span>
      </div>

      {/* Filter tabs */}
      <div className="filterTabs" role="tablist">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            className={`filterTab ${filter === tab.id ? "filterTab--active" : ""}`}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="modeGrid" role="list" aria-label="Conversation modes">
        {filtered.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`modeCard ${selectedModeId === mode.id ? "selected" : ""}`}
            onClick={() => onSelect(mode)}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ transformStyle: "preserve-3d" }}
          >
            <div className="modeMeta">
              <span className={`pill ${mode.category}`}>
                {CATEGORY_ICON[mode.category] ?? ""} {mode.category}
              </span>
              {mode.recommended ? <span className="pill recommended">★ recommended</span> : null}
            </div>
            <h3>{mode.title}</h3>
            <p>{mode.description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
